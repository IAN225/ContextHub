#!/usr/bin/env bash
# Debian/Ubuntu source installation. Run from a checked-out repository.
set -Eeuo pipefail
umask 022
export DEBIAN_FRONTEND=noninteractive NEEDRESTART_MODE=a
SOURCE=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd -P)
PREFIX=/opt/contexthub
SERVICE=contexthub
DOMAIN=
MODE=automatic
TERMS=false
START=true
DEPENDENCIES=true
while (($#)); do
  case "$1" in
    --prefix) PREFIX=$2; shift 2 ;;
    --service) SERVICE=$2; shift 2 ;;
    --domain) DOMAIN=$2; shift 2 ;;
    --external-https) MODE=external; shift ;;
    --accept-acme-terms) TERMS=true; shift ;;
    --no-start) START=false; shift ;;
    --skip-dependencies) DEPENDENCIES=false; shift ;;
    --help) printf '%s\n' 'sudo bash deploy/install.sh [--domain hub.example.com --accept-acme-terms] [--external-https] [--prefix /opt/contexthub] [--service contexthub] [--no-start] [--skip-dependencies]'; exit 0 ;;
    *) printf 'Unknown argument: %s\n' "$1" >&2; exit 2 ;;
  esac
done
[[ $EUID == 0 ]] || { echo 'Run with sudo.' >&2; exit 1; }
[[ $PREFIX =~ ^/opt/contexthub(-[a-z0-9-]+)?$ && $SERVICE =~ ^contexthub(-[a-z0-9-]+)?$ ]] || { echo 'Invalid installation path or service name.' >&2; exit 1; }
[[ $(realpath -m "$PREFIX") == "$PREFIX" ]] || { echo 'Installation path must not traverse a symlink.' >&2; exit 1; }
[[ -z $DOMAIN || $DOMAIN =~ ^[a-zA-Z0-9.-]+$ ]] || { echo 'Domain must be a hostname without a URL path.' >&2; exit 1; }
[[ -z $DOMAIN || $MODE == external || $TERMS == true ]] || { echo 'Read the ACME terms and supply --accept-acme-terms.' >&2; exit 1; }
if [[ ${CONTEXT_HUB_UPGRADE_CHILD:-} != 1 ]]; then
  exec 8>/var/lock/contexthub-install.lock
  flock -n 8 || { echo 'Another deployment is running.' >&2; exit 1; }
fi
command -v systemctl >/dev/null
new_caddy=false
if $DEPENDENCIES; then
  apt-get update
  apt-get install -y ca-certificates curl xz-utils rsync gnupg sudo python3
  if ! command -v node >/dev/null || [[ $(node -p 'process.versions.node.split(".")[0]') != 24 ]]; then
    NODE_VERSION=24.21.0
    case "$(uname -m)" in x86_64) ARCH=x64 ;; aarch64) ARCH=arm64 ;; *) echo 'Unsupported CPU architecture.' >&2; exit 1 ;; esac
    download=$(mktemp -d /tmp/contexthub-node.XXXXXXXX)
    archive=node-v$NODE_VERSION-linux-$ARCH.tar.xz
    curl -fsSL "https://nodejs.org/dist/v$NODE_VERSION/$archive" -o "$download/$archive"
    curl -fsSL "https://nodejs.org/dist/v$NODE_VERSION/SHASUMS256.txt" -o "$download/SHASUMS256.txt"
    (cd "$download"; awk -v file="$archive" '$2 == file {print}' SHASUMS256.txt > selected.sha256; test -s selected.sha256; sha256sum --check selected.sha256)
    install -d /opt/contexthub-runtime
    tar -xJf "$download/$archive" -C /opt/contexthub-runtime
    for binary in node npm npx; do ln -sfn "/opt/contexthub-runtime/node-v$NODE_VERSION-linux-$ARCH/bin/$binary" "/usr/local/bin/$binary"; done
  fi
  npm install --global --prefix /usr/local pnpm@11.19.0
  if [[ $MODE == automatic ]] && ! command -v caddy >/dev/null; then
    apt-get install -y debian-keyring debian-archive-keyring apt-transport-https
    curl -fsSL https://dl.cloudsmith.io/public/caddy/stable/gpg.key | gpg --dearmor --yes -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
    curl -fsSL https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt -o /etc/apt/sources.list.d/caddy-stable.list
    chmod 644 /usr/share/keyrings/caddy-stable-archive-keyring.gpg /etc/apt/sources.list.d/caddy-stable.list
    apt-get update
    apt-get install -y caddy
    new_caddy=true
  fi
fi
if [[ $MODE == automatic && $START == true && $new_caddy == false ]] &&
   systemctl is-active --quiet caddy && [[ ! -f /etc/caddy/contexthub-bootstrap.json ]]; then
  echo 'An unrelated Caddy instance is running. Use --external-https or configure a dedicated instance first.' >&2
  exit 1
fi
NODE=$(command -v node)
PNPM=$(command -v pnpm)
[[ $("$NODE" -p 'process.versions.node.split(".")[0]') == 24 ]] || { echo 'Node.js 24 is required.' >&2; exit 1; }
id contexthub >/dev/null 2>&1 || useradd --system --home-dir /var/lib/contexthub --create-home --shell /usr/sbin/nologin contexthub
install -d -o contexthub -g contexthub -m 700 /var/lib/contexthub
if [[ -n ${CONTEXT_HUB_STAGED_APP:-} && ${CONTEXT_HUB_UPGRADE_CHILD:-} == 1 ]]; then
  stage=$(dirname -- "$CONTEXT_HUB_STAGED_APP")
else
stage=$(mktemp -d /opt/contexthub-build.XXXXXXXX)
chmod 755 "$stage"
rsync -a --exclude=.git --exclude=node_modules --exclude=dist --exclude=.wrangler --exclude='.env*' --exclude=outputs "$SOURCE/app/" "$stage/app/"
chown -R contexthub:contexthub "$stage"
sudo -u contexthub env HOME=/var/lib/contexthub PATH="$(dirname "$NODE"):$(dirname "$PNPM"):/usr/bin:/bin" bash -c 'set -e; cd "$1"; "$2" install --frozen-lockfile; "$2" build' _ "$stage/app" "$PNPM"
fi
if [[ -f $PREFIX/app/.wrangler/server/accounts.sqlite && ${CONTEXT_HUB_UPGRADE_CHILD:-} != 1 ]]; then
  $START || { echo 'An existing instance must be upgraded with startup verification; omit --no-start.' >&2; exit 1; }
  upgrade_args=(source --stage "$stage/app" --prefix "$PREFIX" --service "$SERVICE" --domain "$DOMAIN")
  [[ $MODE != external ]] || upgrade_args+=(--skip-caddy)
  [[ $TERMS != true ]] || upgrade_args+=(--accept-acme-terms)
  exec python3 "$SOURCE/deploy/upgrade.py" "${upgrade_args[@]}"
fi
# Compilation happens before stopping the old instance. Preserve all private state.
if systemctl is-active --quiet "$SERVICE"; then systemctl stop "$SERVICE"; fi
if [[ -d $PREFIX/app/.wrangler && ${CONTEXT_HUB_UPGRADE_CHILD:-} != 1 ]]; then
  install -d -m 700 /var/backups/contexthub
  backup=/var/backups/contexthub/$SERVICE-$(date -u +%Y%m%d-%H%M%S).tar.gz
  (umask 077; tar -czf "$backup" -C "$PREFIX/app" .wrangler)
  printf 'State backup: %s\n' "$backup"
fi
install -d -m 755 "$PREFIX/app"
rsync -a --delete --no-perms --no-owner --no-group --exclude=.wrangler --exclude=".env*" --exclude=node_modules/.mf "$stage/app/" "$PREFIX/app/"
install -d -o contexthub -g contexthub -m 700 "$PREFIX/app/.wrangler" "$PREFIX/app/dist/server/.wrangler" "$PREFIX/app/node_modules/.mf"
sudo -u contexthub env HOME=/var/lib/contexthub PATH="$(dirname "$NODE"):$(dirname "$PNPM"):/usr/bin:/bin" bash -c 'set -e; cd "$1"; "$6" scripts/schema-check.mjs; "$6" --import ./scripts/local-runtime.mjs ./node_modules/wrangler/bin/wrangler.js d1 migrations apply DB --local --config dist/server/wrangler.json --persist-to .wrangler/state; CONTEXT_HUB_DOMAIN="$3" CONTEXT_HUB_HTTPS_MODE="$4" CONTEXT_HUB_ACCEPT_ACME_TERMS="$5" "$6" scripts/initialize-server.mjs' _ "$PREFIX/app" "$PNPM" "$DOMAIN" "$MODE" "$TERMS" "$NODE"
if [[ $MODE == automatic && $START == true ]]; then
  install -m 644 "$SOURCE/deploy/ubuntu/caddy-bootstrap.json" /etc/caddy/contexthub-bootstrap.json
  install -d /etc/systemd/system/caddy-api.service.d
  install -m 644 "$SOURCE/deploy/ubuntu/caddy-api-override.conf" /etc/systemd/system/caddy-api.service.d/contexthub.conf
  systemctl disable --now caddy
  systemctl daemon-reload
  systemctl enable --now caddy-api
fi
sed -e "s|/opt/contexthub|$PREFIX|g" -e "s|/usr/local/bin/node|$NODE|g" "$SOURCE/deploy/ubuntu/contexthub.service" > "/etc/systemd/system/$SERVICE.service"
systemctl daemon-reload
if $START; then
  systemctl enable "$SERVICE"
  systemctl restart "$SERVICE"
  ready=false
  for ((i=0;i<60;i++)); do if curl -fsS http://127.0.0.1:4310/healthz >/dev/null; then ready=true; break; fi; sleep 2; done
  $ready || { echo "Service not ready. Inspect journalctl -u $SERVICE." >&2; exit 1; }
fi
printf 'Installed %s.\n' "$SERVICE"
if [[ -f $PREFIX/app/.wrangler/server/initial-admin-password.txt ]]; then
  printf 'Initial password: sudo cat %s/app/.wrangler/server/initial-admin-password.txt\n' "$PREFIX"
else
  printf '%s\n' 'Existing account state preserved. Sign in with your account password.'
fi
printf 'SSH setup: ssh -N -L 4310:127.0.0.1:4310 user@server, then open http://127.0.0.1:4310/login\n'
printf 'Public domain: %s\n' "${DOMAIN:-configure HTTPS after activation}"
