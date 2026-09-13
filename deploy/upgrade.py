import argparse
import fcntl
import json
import os
from pathlib import Path
import shutil
import signal
import subprocess
import sys
import tempfile
import urllib.request

import backup

ROOT = Path(__file__).resolve().parent.parent
BASE = Path('/var/backups/contexthub')


def command(*args, env=None):
    subprocess.run([str(a) for a in args], check=True, env=env)


def save_json(path, value):
    temp = path.with_suffix('.tmp')
    with temp.open('w') as output:
        json.dump(value, output)
        output.flush()
        os.fsync(output.fileno())
    temp.chmod(0o600)
    temp.replace(path)


def stopped_signal(signum, frame):
    raise InterruptedError('Upgrade interrupted; restoring the previous release.')


def copy_code(source, target):
    shutil.copytree(source, target, symlinks=True,
                    ignore=lambda directory, names: [n for n in names if n in ('.wrangler', '.mf')])


def configuration_files(args):
    return [Path('/etc/systemd/system') / (args.service + '.service'),
            Path('/etc/caddy/contexthub-bootstrap.json'),
            Path('/etc/systemd/system/caddy-api.service.d/contexthub.conf')]


def save_config(args, directory):
    result = []
    for index, path in enumerate(configuration_files(args)):
        if path.is_symlink():
            raise ValueError('Service configuration must not be a symlink.')
        result.append({'path': str(path), 'exists': path.exists()})
        if path.exists():
            shutil.copy2(path, directory / ('config-' + str(index)))
    save_json(directory / 'configuration.json', result)


def restore_config(args, directory):
    rows = json.loads((directory / 'configuration.json').read_text())
    if [r['path'] for r in rows] != [str(p) for p in configuration_files(args)]:
        raise ValueError('Unexpected service configuration paths.')
    for index, row in enumerate(rows):
        path = Path(row['path'])
        if row['exists']:
            path.parent.mkdir(parents=True, exist_ok=True)
            shutil.copy2(directory / ('config-' + str(index)), path)
        else:
            path.unlink(missing_ok=True)
    command('systemctl', 'daemon-reload')


def restore_files(instance, directory):
    with tempfile.TemporaryDirectory(prefix='contexthub-upgrade-restore-') as temp:
        staging = Path(temp)
        manifest = backup.unpack(directory / 'state.tar.gz', staging)
        backup.restore(instance, staging, manifest, True)


def record_compose(instance):
    config = json.loads(backup.run(*instance.compose, 'config', '--format', 'json').stdout)
    save_json(instance.paths['app'] / 'server/deployment-compose.json', config)


def frozen_compose(instance, directory):
    saved = instance.paths['app'] / 'server/deployment-compose.json'
    config = json.loads(saved.read_text() if saved.exists() else backup.run(*instance.compose, 'config', '--format', 'json').stdout)
    for volume in config['services']['caddy'].get('volumes', []):
        if volume.get('type') == 'bind' and volume.get('target') == '/etc/caddy/bootstrap.json':
            snapshot = directory / 'caddy-bootstrap.json'
            shutil.copy2(volume['source'], snapshot)
            snapshot.chmod(0o644)
            volume['source'] = str(snapshot)
    for service in ['app', 'caddy']:
        container = backup.run(*instance.compose, 'ps', '-aq', service).stdout.strip()
        if not container:
            raise ValueError('Existing deployment is incomplete; restore it before upgrading.')
        image = json.loads(backup.run('docker', 'inspect', container).stdout)[0]['Image']
        # Tag immutable images before build can move the current release tag.
        tag = 'contexthub-rollback-' + service + ':' + directory.name
        command('docker', 'tag', image, tag)
        config['services'][service]['image'] = tag
        config['services'][service].pop('build', None)
    # Escape Compose interpolation in the already resolved configuration.
    path = directory / 'compose.json'
    path.write_text(json.dumps(config).replace('$', '$$'))
    path.chmod(0o600)
    return path


def rollback(instance, directory, journal):
    instance.stop(instance.active())
    if instance.args.mode == 'source':
        target = Path(instance.args.prefix) / 'app'
        failed = directory / 'failed-app'
        if not failed.exists():
            target.rename(failed)
        elif target.exists():
            target.rename(directory / ('interrupted-restore-' + backup.stamp()))
        copy_code(directory / 'app', target)
        uid, gid = instance.owners()['app']
        for relative in ['dist/server/.wrangler', 'node_modules/.mf']:
            cache = target / relative
            cache.mkdir(parents=True, mode=0o700, exist_ok=True)
            os.chown(cache, uid, gid)
        restore_config(instance.args, directory)
    restore_files(instance, directory)
    if instance.args.mode == 'source':
        instance.start(journal['active'])
    else:
        command('docker', 'compose', '-p', journal['project'], '--env-file', '/dev/null',
                '-f', directory / 'compose.json', 'up', '-d', '--no-build', '--wait', '--wait-timeout', '180')
    journal['phase'] = 'rolled-back'
    save_json(directory / 'upgrade.json', journal)
    print('Previous code, accounts, tasks and certificate state restored.')


def perform(args):
    instance = backup.Instance(args)
    if args.recover:
        directory = args.recover.resolve()
        if directory.parent != BASE.resolve() or not directory.name.startswith('upgrade-'):
            raise ValueError('Recovery path must be a saved upgrade under /var/backups/contexthub.')
        journal = json.loads((directory / 'upgrade.json').read_text())
        for key in ['mode', 'prefix', 'service', 'skip_caddy', 'project']:
            if journal[key] != getattr(args, key):
                raise ValueError('Recovery options must match the saved deployment.')
        if journal['phase'] == 'snapshotting':
            instance.start(journal['active'])
            journal['phase'] = 'cancelled'
            save_json(directory / 'upgrade.json', journal)
            print('Snapshot was interrupted before migration; previous services restarted.')
            return
        if journal['phase'] != 'installing':
            raise ValueError('Only an interrupted or failed upgrade can be recovered.')
        rollback(instance, directory, journal)
        return
    pending = []
    for path in BASE.glob('upgrade-*/upgrade.json'):
        record = json.loads(path.read_text())
        if record['phase'] in ('installing', 'snapshotting') and record['mode'] == args.mode and (
                (args.mode == 'source' and record['prefix'] == args.prefix) or
                (args.mode == 'docker' and record['project'] == args.project)):
            pending.append(path.parent)
    if pending:
        raise ValueError('Recover the interrupted upgrade first: ' + str(pending[0]))
    directory = BASE / ('upgrade-' + backup.stamp())
    directory.mkdir(mode=0o700)
    journal = {key: getattr(args, key) for key in ['mode', 'prefix', 'service', 'skip_caddy', 'project']}
    journal.update(phase='preparing', active=instance.active())
    save_json(directory / 'upgrade.json', journal)
    if args.mode == 'docker':
        frozen_compose(instance, directory)
        command(*instance.compose, 'build', 'app')
    else:
        # app code is immutable while the old service runs; state is backed up only after stop.
        copy_code(Path(args.prefix) / 'app', directory / 'app')
        save_config(args, directory)
    journal['phase'] = 'snapshotting'
    save_json(directory / 'upgrade.json', journal)
    try:
        instance.stop(journal['active'])
        backup.pack(instance.paths, directory / 'state.tar.gz', args.mode)
        with tempfile.TemporaryDirectory(prefix='contexthub-upgrade-verify-') as temp:
            backup.unpack(directory / 'state.tar.gz', Path(temp))
    except BaseException:
        instance.start(journal['active'])
        journal['phase'] = 'cancelled'
        save_json(directory / 'upgrade.json', journal)
        raise
    marker = instance.paths['app'] / 'server/upgrade-maintenance'
    try:
        journal['phase'] = 'installing'
        save_json(directory / 'upgrade.json', journal)
        marker.write_text('Upgrade in progress. Do not remove until health checks pass.\n')
        marker.chmod(0o644)
        if args.mode == 'source':
            env = {**os.environ, 'CONTEXT_HUB_UPGRADE_CHILD': '1', 'CONTEXT_HUB_STAGED_APP': str(args.stage)}
            flags = ['--prefix', args.prefix, '--service', args.service, '--skip-dependencies']
            if args.skip_caddy:
                flags += ['--external-https']
            if getattr(args, 'port', ''):
                flags += ['--port', args.port]
            if args.domain:
                flags += ['--domain', args.domain]
            if args.accept_acme_terms:
                flags += ['--accept-acme-terms']
            command('bash', ROOT / 'deploy/install.sh', *flags, env=env)
            if not args.skip_caddy:
                command('systemctl', 'start', 'caddy-api')
        else:
            command(*instance.compose, 'up', '-d', '--no-build', '--wait', '--wait-timeout', '180')
        # Maintenance remains in effect through verification; no new user writes can be lost on rollback.
        if args.mode == 'docker':
            command(*instance.compose, 'exec', '-T', 'app', 'node', '-e',
                    "fetch('http://127.0.0.1:4310/healthz').then(async r=>{if(!r.ok||!(await r.json()).ok)process.exit(1)}).catch(()=>process.exit(1))")
        else:
            with urllib.request.urlopen('http://127.0.0.1:4310/healthz', timeout=10) as response:
                if not json.load(response).get('ok'):
                    raise ValueError('Health check failed.')
        if args.mode == 'docker':
            record_compose(instance)
        # Commit before removing the maintenance gate. Recovery must never undo accepted user writes.
        journal['phase'] = 'committed'
        save_json(directory / 'upgrade.json', journal)
        marker.unlink()
    except BaseException:
        if journal['phase'] == 'committed':
            raise RuntimeError('Upgrade committed but maintenance could not be removed: ' + str(marker))
        try:
            rollback(instance, directory, journal)
        except BaseException:
            print('Recovery incomplete. Keep services stopped and run deploy/upgrade.py with --recover ' + str(directory), file=sys.stderr)
        raise
    print('Upgrade complete. Previous release and verified state: ' + str(directory), flush=True)
    command(sys.executable, ROOT / 'deploy/access-info.py', args.mode, '--prefix', args.prefix)


def main():
    parser = argparse.ArgumentParser(description='Upgrade an existing instance; restore code and data together on failure.')
    parser.add_argument('mode', choices=['source', 'docker'])
    parser.add_argument('--prefix', default='/opt/contexthub')
    parser.add_argument('--service', default='contexthub')
    parser.add_argument('--skip-caddy', action='store_true')
    parser.add_argument('--project', default='contexthub')
    parser.add_argument('--stage', type=Path)
    parser.add_argument('--domain', default='')
    parser.add_argument('--port', default='')
    parser.add_argument('--accept-acme-terms', action='store_true')
    parser.add_argument('--recover', type=Path)
    parser.add_argument('--record-compose', action='store_true')
    args = parser.parse_args()
    args.action = 'backup'
    if sys.platform != 'linux' or os.geteuid() != 0:
        parser.error('Run with sudo on the Linux deployment host.')
    if args.mode == 'source' and not args.recover and not args.stage:
        parser.error('Use deploy/install.sh to build and upgrade a source installation.')
    os.umask(0o077)
    BASE.mkdir(mode=0o700, parents=True, exist_ok=True)
    BASE.chmod(0o700)
    for sig in [signal.SIGINT, signal.SIGTERM]:
        signal.signal(sig, stopped_signal)
    with open('/var/lock/contexthub-upgrade.lock', 'a') as lock:
        fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        if args.record_compose:
            if args.mode != 'docker':
                raise ValueError('Compose receipts apply only to Docker.')
            record_compose(backup.Instance(args))
        else:
            perform(args)


if __name__ == '__main__':
    try:
        main()
    except (Exception, KeyboardInterrupt) as error:
        print('Upgrade failed: ' + str(error), file=sys.stderr)
        sys.exit(1)
