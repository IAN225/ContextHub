#!/usr/bin/env python3
"""Print deployment addresses and credential instructions, never credentials."""
import argparse
import ipaddress
import json
import subprocess
import urllib.request
from pathlib import Path


def run(*args):
    return subprocess.run(args, check=True, text=True, capture_output=True).stdout


def addresses():
    found = []
    # Cloud NAT addresses are usually absent from local network interfaces.
    try:
        with urllib.request.urlopen('https://api.ipify.org', timeout=3) as reply:
            value = reply.read(64).decode().strip()
        address = ipaddress.ip_address(value)
        if address.is_global:
            found.append(str(address))
    except (OSError, ValueError):
        pass
    try:
        for value in run('hostname', '-I').split():
            address = ipaddress.ip_address(value)
            if address.version == 4 and not address.is_loopback and not address.is_link_local and str(address) not in found:
                found.append(str(address))
    except (OSError, ValueError, subprocess.CalledProcessError):
        pass
    return found or ['127.0.0.1']


def details(mode, prefix):
    if mode == 'source':
        directory = Path(prefix) / 'app/.wrangler/server'
        state = json.loads((directory / 'access.json').read_text())
        port_file = directory / 'http-port'
        return ((state.get('access') or {}).get('origin'),
                port_file.read_text().strip() if port_file.exists() else '8080',
                (directory / 'admin-password.txt').exists(),
                f'sudo cat {directory}/admin-password.txt')
    config = json.loads(run('docker', 'compose', 'config', '--format', 'json'))
    port = next(str(p['published']) for p in config['services']['caddy']['ports'] if int(p['target']) == 8080)
    script = "const fs=require('node:fs');const dir='.wrangler/server/';const state=JSON.parse(fs.readFileSync(dir+'access.json'));console.log(JSON.stringify({origin:state.access?.origin,initial:fs.existsSync(dir+'admin-password.txt')}));"
    data = json.loads(run('docker', 'compose', 'exec', '-T', 'app', 'node', '-e', script))
    return (data.get('origin'), port, data['initial'],
            'sudo docker compose exec app cat .wrangler/server/admin-password.txt')


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('mode', choices=['source', 'docker'])
    parser.add_argument('--prefix', default='/opt/contexthub')
    parser.add_argument('--not-started', action='store_true')
    args = parser.parse_args()
    origin, port, initial, password_command = details(args.mode, args.prefix)
    print('\nAccess addresses' + (' (service not started)' if args.not_started else '') + ':')
    for address in addresses():
        host = f'[{address}]' if ':' in address else address
        print(f'  http://{host}:{port}')
    if origin:
        print(f'  {origin} (configured HTTPS; certificate issuance may still be in progress)')
    else:
        print('  HTTPS is optional for the website. Configure it in administrator settings to enable MCP.')
    print(f'Allow TCP {port} in the host/cloud firewall for HTTP; allow TCP 80 and 443 for HTTPS.')
    print('If this host is behind NAT or a proxy, use its public IP or configure port forwarding.')
    if initial:
        print('Built-in administrator username: admin')
        print('Read the current administrator password (run on this deployment host):')
        print('  ' + password_command)
        print('First administrator login activates the service. You may keep the current password.')
    else:
        print('Existing accounts and passwords preserved. Sign in with your current account.')
        print('No recovery file is available for this older instance yet; see README password recovery if needed.')


if __name__ == '__main__':
    main()
