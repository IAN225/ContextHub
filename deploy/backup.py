#!/usr/bin/env python3
"""Offline, verified backups for the standard Linux source/Compose deployments."""
import argparse
import datetime
import hashlib
import io
import json
import os
from pathlib import Path, PurePosixPath
import pwd
import re
import shutil
import subprocess
import sys
import tarfile
import tempfile

ROOT = Path(__file__).resolve().parent.parent
FORMAT = 'contexthub-backup-v1'


def run(*args, check=True):
    return subprocess.run(args, text=True, stdout=subprocess.PIPE,
                          stderr=subprocess.PIPE, check=check)


def digest(path):
    with path.open('rb') as source:
        return hashlib.file_digest(source, 'sha256').hexdigest()


def pack(paths, output, mode):
    """All writers must be stopped by the caller before invoking this function."""
    rows = {}
    for label, root in paths.items():
        for file in sorted(root.rglob('*')):
            if file.is_symlink() or not (file.is_file() or file.is_dir()):
                raise ValueError(f'Unsupported state file: {file}')
            if file.is_file():
                rows[f'{label}/{file.relative_to(root).as_posix()}'] = digest(file)
    if 'app/server/accounts.sqlite' not in rows:
        raise ValueError('No account database found; refusing an incomplete backup.')
    manifest = {'format': FORMAT, 'mode': mode, 'createdAt': stamp(),
                'roots': list(paths), 'files': rows}
    # Exclusive creation prevents clobbering an earlier backup, including symlinks.
    with output.open('xb') as destination:
        os.chmod(output, 0o600)
        with tarfile.open(fileobj=destination, mode='w:gz', dereference=True) as archive:
            content = json.dumps(manifest).encode()
            info = tarfile.TarInfo('manifest.json')
            info.size, info.mode = len(content), 0o600
            archive.addfile(info, io.BytesIO(content))
            for label, root in paths.items():
                archive.add(root, arcname=label)
    return manifest


def unpack(archive_path, staging):
    """Reject traversal, links, unexpected files and corruption before touching live state."""
    with tarfile.open(archive_path, 'r:gz') as archive:
        members = archive.getmembers()
        seen = set()
        for member in members:
            name = member.name
            parts = PurePosixPath(name).parts
            if (not parts or name.startswith('/') or '\\' in name or
                    '..' in parts or name in seen or
                    not (member.isfile() or member.isdir())):
                raise ValueError('Unsafe or duplicate archive entry.')
            seen.add(name)
        info = archive.getmember('manifest.json')
        if not info.isfile() or info.size > 16 * 1024 * 1024:
            raise ValueError('Invalid backup manifest.')
        manifest = json.load(archive.extractfile(info))
        if (manifest.get('format') != FORMAT or
                manifest.get('mode') not in ('source', 'docker') or
                not isinstance(manifest.get('files'), dict) or
                not isinstance(manifest.get('roots'), list) or
                not set(manifest['roots']).issubset({'app', 'caddy', 'caddy_data', 'caddy_config'}) or
                'app' not in manifest['roots']):
            raise ValueError('Unsupported backup format.')
        files = {m.name for m in members if m.isfile() and m.name != 'manifest.json'}
        if files != set(manifest['files']) or 'app/server/accounts.sqlite' not in files:
            raise ValueError('Backup file list does not match manifest.')
        for member in members:
            if member.name == 'manifest.json':
                continue
            if PurePosixPath(member.name).parts[0] not in manifest['roots']:
                raise ValueError('Unexpected backup root.')
            target = staging / member.name
            if member.isdir():
                target.mkdir(parents=True, exist_ok=True, mode=0o700)
            else:
                target.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
                with archive.extractfile(member) as src, target.open('xb') as dst:
                    shutil.copyfileobj(src, dst)
                target.chmod(0o600)
                if digest(target) != manifest['files'][member.name]:
                    raise ValueError(f'Backup checksum failed: {member.name}')
        for label in manifest['roots']:
            if not (staging / label).is_dir():
                raise ValueError('Backup is missing a state directory.')
        return manifest


def stamp():
    return datetime.datetime.now(datetime.timezone.utc).strftime('%Y%m%d-%H%M%S-%f')


class Instance:
    def __init__(self, args):
        self.args = args
        self.paths = {}
        self.units = []
        self.compose = ['docker', 'compose', '--project-directory', str(ROOT)]
        if args.project:
            if not re.fullmatch(r'[a-z0-9][a-z0-9_-]*', args.project):
                raise ValueError('Invalid Compose project name.')
            self.compose += ['-p', args.project]
        if args.mode == 'source':
            if not re.fullmatch(r'/opt/contexthub(?:-[a-z0-9-]+)?', args.prefix):
                raise ValueError('Invalid source prefix.')
            if not re.fullmatch(r'contexthub(?:-[a-z0-9-]+)?', args.service):
                raise ValueError('Invalid service name.')
            prefix = Path(args.prefix)
            if prefix.resolve() != prefix:
                raise ValueError('Source prefix must not traverse a symlink.')
            self.paths['app'] = prefix / 'demo/.wrangler'
            self.units = [args.service]
            if not args.skip_caddy:
                self.paths['caddy'] = Path('/var/lib/caddy')
                self.units += ['caddy-api', 'caddy']
        else:
            config = json.loads(run(*self.compose, 'config', '--format', 'json').stdout)
            for label, volume in [('app', 'app_data'), ('caddy_data', 'caddy_data'),
                                  ('caddy_config', 'caddy_config')]:
                name = config['volumes'][volume]['name']
                inspected = run('docker', 'volume', 'inspect', name, check=False)
                if inspected.returncode and args.action == 'restore':
                    run('docker', 'volume', 'create', name)
                    inspected = run('docker', 'volume', 'inspect', name)
                if inspected.returncode:
                    raise ValueError(f'Volume not found: {name}')
                spec = json.loads(inspected.stdout)[0]
                path = Path(spec['Mountpoint'])
                if spec['Driver'] != 'local' or spec.get('Options') or not path.is_dir():
                    raise ValueError('Requires local Docker volumes on this Linux host.')
                self.paths[label] = path
        for path in self.paths.values():
            if path.resolve() != path:
                raise ValueError(f'State directory must not traverse a symlink: {path}')

    def active(self):
        if self.args.mode == 'source':
            return [u for u in self.units if run('systemctl', 'is-active', '--quiet', u,
                                                check=False).returncode == 0]
        return run(*self.compose, 'ps', '--services', '--status', 'running').stdout.split()

    def stop(self, active):
        if not active:
            return
        if self.args.mode == 'source':
            run('systemctl', 'stop', *active)
        else:
            run(*self.compose, 'stop', '-t', '180', *active)

    def start(self, active):
        if not active:
            return
        if self.args.mode == 'source':
            run('systemctl', 'start', *reversed(active))
        else:
            # Network owner first; start preserves the stopped containers and volumes.
            for service in ['caddy', 'app']:
                if service in active:
                    run(*self.compose, 'start', service)

    def owners(self):
        if self.args.mode == 'docker':
            return {label: ((1000, 1000) if label == 'app' else (0, 0))
                    for label in self.paths}
        return {label: (pwd.getpwnam('contexthub' if label == 'app' else 'caddy').pw_uid,
                        pwd.getpwnam('contexthub' if label == 'app' else 'caddy').pw_gid)
                for label in self.paths}


def restore(instance, staging, manifest, replace):
    if manifest['mode'] != instance.args.mode or set(manifest['roots']) != set(instance.paths):
        raise ValueError('Restore using the same deployment mode and Caddy selection as the backup.')
    owners = instance.owners()  # Require installation users before stopping or changing anything.
    occupied = [p for p in instance.paths.values() if p.exists() and any(p.iterdir())]
    if occupied and not replace:
        raise ValueError('Destination contains data. Use a fresh destination or --replace-existing; '
                         'replaced files will be retained under /var/backups/contexthub.')
    active = instance.active()
    instance.stop(active)
    # Restore intentionally leaves services stopped, even on failure. Never serve a partial restore.
    safety = Path('/var/backups/contexthub') / ('before-restore-' + stamp())
    safety.mkdir(parents=True, mode=0o700)
    safety.chmod(0o700)
    for label, target in instance.paths.items():
        target.mkdir(parents=True, exist_ok=True)
        saved = safety / label
        saved.mkdir(mode=0o700)
        for child in target.iterdir():
            shutil.move(str(child), saved / child.name)
        shutil.copytree(staging / label, target, dirs_exist_ok=True)
        uid, gid = owners[label]
        for file in [target, *target.rglob('*')]:
            os.chown(file, uid, gid)
            file.chmod(0o700 if file.is_dir() else 0o600)
    print(f'Restored and verified. Previous files retained at {safety}.')
    print('Services remain stopped. Source: rerun deploy/install.sh with your original options. '
          'Docker: bash deploy/docker.sh (use the same Compose project).')


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('action', choices=['backup', 'verify', 'restore'])
    parser.add_argument('archive', type=Path, help='Archive path; store a copy off this server.')
    parser.add_argument('--mode', choices=['source', 'docker'], default='source')
    parser.add_argument('--prefix', default='/opt/contexthub')
    parser.add_argument('--service', default='contexthub')
    parser.add_argument('--skip-caddy', action='store_true', help='Source deployment with externally managed HTTPS.')
    parser.add_argument('--project', help='Docker Compose project, if different from contexthub.')
    parser.add_argument('--replace-existing', action='store_true', help='Retain existing files in a safety directory, then replace them.')
    args = parser.parse_args()
    os.umask(0o077)
    if args.action != 'verify' and (sys.platform != 'linux' or os.geteuid() != 0):
        parser.error('Run backup/restore with sudo on the Linux deployment host.')
    archive = args.archive.absolute()
    with tempfile.TemporaryDirectory(prefix='contexthub-verify-') as temp:
        staging = Path(temp)
        if args.action in ('verify', 'restore'):
            manifest = unpack(archive, staging)
            print(f'Archive verified: {len(manifest["files"])} files; {manifest["mode"]}.')
            if args.action == 'restore':
                restore(Instance(args), staging, manifest, args.replace_existing)
            return
        instance = Instance(args)
        for path in instance.paths.values():
            if not path.is_dir():
                raise ValueError(f'State directory missing: {path}')
            if archive.resolve().is_relative_to(path.resolve()):
                raise ValueError('Backup destination must be outside the state directories.')
        active = instance.active()
        try:
            instance.stop(active)
            pack(instance.paths, archive, args.mode)
            unpack(archive, staging)
        finally:
            instance.start(active)
        print(f'Backup verified: {archive}. Copy it to another machine before reinstalling.')


if __name__ == '__main__':
    try:
        main()
    except (ValueError, OSError, KeyError, tarfile.TarError, subprocess.CalledProcessError) as error:
        # Never echo subprocess output: it can contain runtime secrets.
        print(f'Backup operation failed: {error}', file=sys.stderr)
        sys.exit(1)