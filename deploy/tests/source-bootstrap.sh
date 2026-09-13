#!/usr/bin/env bash
# Dependency bootstrap test only: a stock Ubuntu container has no systemd PID 1.
# Real service startup is verified separately on a systemd host.
set -euo pipefail
test -f /.dockerenv || { echo 'Run only inside a disposable Docker test container.' >&2; exit 1; }
[[ $EUID == 0 ]]
mkdir -p /usr/local/bin
cat >/usr/local/bin/systemctl <<'CONTROL'
#!/bin/sh
case "$1" in
  is-active) exit 3 ;;
  daemon-reload) exit 0 ;;
  *) echo "Unexpected service operation in --no-start test: $*" >&2; exit 1 ;;
esac
CONTROL
chmod 755 /usr/local/bin/systemctl
printf '#!/bin/sh\nexit 101\n' >/usr/sbin/policy-rc.d
chmod 755 /usr/sbin/policy-rc.d
bash deploy/install.sh --no-start
node -e 'if(process.versions.node.split(".")[0]!=="24")process.exit(1)'
pnpm --version
caddy version
python3 --version
test -f /opt/contexthub/demo/dist/server/index.js
test -f /etc/systemd/system/contexthub.service
test "$(stat -c %a /opt/contexthub/demo/.wrangler/server/initial-admin-password.txt)" = 600
printf '%s\n' 'PASS clean Ubuntu dependency installation, production build, DB migration and initial admin; no systemd startup simulated.'