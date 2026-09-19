#!/usr/bin/env python3
"""Destructive deployment drills, restricted to a disposable GitHub Actions runner."""
import json
import os
from pathlib import Path
import shutil
import subprocess
import sys
import tempfile
import time

ROOT = Path(__file__).resolve().parent.parent
PREFIX = Path('/opt/contexthub-drill')
SERVICE = 'contexthub-drill'
PROJECT = 'contexthub-drill'


def run(*args, ok=True, capture=False, env=None):
    result = subprocess.run([str(a) for a in args], cwd=ROOT, text=True,
                            stdout=subprocess.PIPE, stderr=subprocess.STDOUT,
                            env={**os.environ, **(env or {})})
    if (result.returncode == 0) != ok:
        print(result.stdout[-12000:])
        raise RuntimeError('Unexpected exit status: ' + ' '.join(map(str, args)))
    if capture:
        return result.stdout.strip().splitlines()[-1]
    print('PASS:', ' '.join(map(str, args[:3])), flush=True)


def journal(mode):
    rows = []
    for p in Path('/var/backups/contexthub').glob('upgrade-*/upgrade.json'):
        row = json.loads(p.read_text())
        if row['mode'] == mode and (row['prefix'] == str(PREFIX) if mode == 'source' else row['project'] == PROJECT):
            rows.append(p)
    return sorted(rows)[-1].parent


def fixture(mode, action):
    if mode == 'source':
        return run('node', ROOT / 'deploy/recovery-fixture.mjs', PREFIX / 'app', action,
                   'http://127.0.0.1:8088', capture=True)
    return run('docker', 'compose', 'exec', '-T', 'app', 'node', '/tmp/recovery-fixture.mjs',
               '/app', action, 'http://127.0.0.1:8080', capture=True)


def recover(mode, directory, ok=True):
    flags = ['--prefix', PREFIX, '--service', SERVICE, '--skip-caddy'] if mode == 'source' else ['--project', PROJECT]
    run('python3', 'deploy/upgrade.py', mode, '--recover', directory, *flags, ok=ok)


def source_drill(temp):
    flags = ['--prefix', PREFIX, '--service', SERVICE, '--external-https', '--skip-dependencies', '--port', '8088']
    run('bash', 'deploy/install.sh', *flags)
    expected = fixture('source', 'seed')
    run('bash', 'deploy/install.sh', *flags)
    committed = journal('source')
    assert json.loads((committed / 'upgrade.json').read_text())['phase'] == 'committed'
    assert fixture('source', 'verify') == expected
    changed = fixture('source', 'write')
    recover('source', committed, ok=False)
    assert fixture('source', 'verify') == changed
    archive = temp / 'source.tar.gz'
    run('python3', 'deploy/backup.py', 'backup', archive, '--prefix', PREFIX, '--service', SERVICE, '--skip-caddy')
    run('python3', 'deploy/backup.py', 'verify', archive)
    # Mutation proves restore replaces state rather than merely reopening the same database.
    state = PREFIX / 'app/.wrangler'
    marker = state / 'server/after-backup'
    marker.write_text('must disappear')
    run('python3', 'deploy/backup.py', 'restore', archive, '--prefix', PREFIX, '--service', SERVICE, '--skip-caddy', '--replace-existing')
    assert not marker.exists()
    run('systemctl', 'start', SERVICE)
    wait_health(8088)
    assert fixture('source', 'verify') == changed
    stage = temp / 'bad-stage'
    shutil.copytree(PREFIX / 'app', stage / 'production', ignore=shutil.ignore_patterns('.wrangler'))
    (stage / 'production/scripts/schema-check.mjs').write_text("throw new Error('Injected migration failure');\n")
    run('python3', 'deploy/upgrade.py', 'source', '--prefix', PREFIX, '--service', SERVICE,
        '--skip-caddy', '--stage', stage, ok=False)
    rolled = journal('source')
    assert json.loads((rolled / 'upgrade.json').read_text())['phase'] == 'rolled-back'
    wait_health(8088)
    assert fixture('source', 'verify') == changed
    # Replay a persisted interrupted-install journal through the public recovery command.
    run('systemctl', 'stop', SERVICE)
    row = json.loads((rolled / 'upgrade.json').read_text()); row['phase'] = 'installing'
    (rolled / 'upgrade.json').write_text(json.dumps(row))
    marker.write_text('interrupted mutation')
    recover('source', rolled)
    wait_health(8088)
    assert not marker.exists()
    assert fixture('source', 'verify') == changed
    run('systemctl', 'stop', SERVICE)


def wait_health(port):
    import urllib.request
    for _ in range(60):
        try:
            with urllib.request.urlopen('http://127.0.0.1:' + str(port) + '/login', timeout=2) as r:
                if r.status == 200:
                    return
        except Exception:
            time.sleep(1)
    raise RuntimeError('Service did not recover')


def docker_drill(temp):
    envfile = ROOT / '.env'
    envfile.write_text('COMPOSE_PROJECT_NAME=' + PROJECT + '\nCONTEXT_HUB_PORT=8080\n')
    run('bash', 'deploy/docker.sh')
    run('docker', 'compose', 'cp', 'deploy/recovery-fixture.mjs', 'app:/tmp/recovery-fixture.mjs')
    expected = fixture('docker', 'seed')
    run('bash', 'deploy/docker.sh')
    run('docker', 'compose', 'cp', 'deploy/recovery-fixture.mjs', 'app:/tmp/recovery-fixture.mjs')
    committed = journal('docker')
    assert fixture('docker', 'verify') == expected
    changed = fixture('docker', 'write')
    recover('docker', committed, ok=False)
    assert fixture('docker', 'verify') == changed
    archive = temp / 'docker.tar.gz'
    run('python3', 'deploy/backup.py', 'backup', archive, '--mode', 'docker', '--project', PROJECT)
    run('docker', 'compose', 'exec', '-T', 'app', 'node', '-e', "require('fs').writeFileSync('/app/.wrangler/server/after-backup','remove')")
    run('python3', 'deploy/backup.py', 'restore', archive, '--mode', 'docker', '--project', PROJECT, '--replace-existing')
    run('docker', 'compose', 'start', 'caddy', 'app')
    wait_health(8080)
    assert fixture('docker', 'verify') == changed
    dockerfile = ROOT / 'Dockerfile'; original = dockerfile.read_bytes()
    try:
        dockerfile.write_text('FROM contexthub:check\nCMD ["node","-e","require(\'fs\').writeFileSync(\'/app/.wrangler/server/failed-upgrade\',\'remove\');process.exit(1)"]\n')
        run('bash', 'deploy/docker.sh', ok=False)
    finally:
        dockerfile.write_bytes(original)
    rolled = journal('docker')
    assert json.loads((rolled / 'upgrade.json').read_text())['phase'] == 'rolled-back'
    run('docker', 'compose', 'cp', 'deploy/recovery-fixture.mjs', 'app:/tmp/recovery-fixture.mjs')
    wait_health(8080)
    assert fixture('docker', 'verify') == changed
    run('docker', 'compose', 'exec', '-T', 'app', 'node', '-e', "for(const n of ['failed-upgrade','after-backup'])if(require('fs').existsSync('/app/.wrangler/server/'+n))process.exit(1)")
    run('docker', 'compose', 'stop')
    row = json.loads((rolled / 'upgrade.json').read_text()); row['phase'] = 'installing'
    (rolled / 'upgrade.json').write_text(json.dumps(row))
    recover('docker', rolled)
    run('docker', 'compose', 'cp', 'deploy/recovery-fixture.mjs', 'app:/tmp/recovery-fixture.mjs')
    wait_health(8080)
    assert fixture('docker', 'verify') == changed


def main():
    if os.environ.get('GITHUB_ACTIONS') != 'true' or os.geteuid() != 0 or sys.platform != 'linux':
        raise RuntimeError('Run only as root on an isolated GitHub Actions Linux runner.')
    if PREFIX.exists() or (ROOT / '.env').exists():
        raise RuntimeError('Refusing an existing instance or environment file.')
    try:
        with tempfile.TemporaryDirectory(prefix='contexthub-recovery-drill-') as temp:
            source_drill(Path(temp))
            docker_drill(Path(temp))
        print('Source and Docker: upgrade, committed-write protection, backup restore, failure rollback and interrupted recovery PASS.')
    finally:
        subprocess.run(['systemctl', 'stop', SERVICE], check=False, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        if (ROOT / '.env').exists():
            subprocess.run(['docker','compose','-p',PROJECT,'down','-v'],cwd=ROOT,check=False)
            (ROOT / '.env').unlink()


if __name__ == '__main__':
    main()
