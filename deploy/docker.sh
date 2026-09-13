#!/usr/bin/env bash
set -euo pipefail
cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.."
command -v docker >/dev/null || { echo 'Install Docker Engine and Compose first: https://docs.docker.com/engine/install/'; exit 1; }
[[ $EUID == 0 ]] || { echo 'Run sudo bash deploy/docker.sh.' >&2; exit 1; }
command -v python3 >/dev/null || { echo 'Install python3 before deploying.' >&2; exit 1; }
exec 8>/var/lock/contexthub-install.lock
flock -n 8 || { echo 'Another deployment is running.' >&2; exit 1; }
docker compose version >/dev/null
project=$(docker compose config --format json | python3 -c 'import json,sys; print(json.load(sys.stdin)["name"])')
if [[ -n $(docker compose ps -aq app) ]]; then
  [[ $EUID == 0 ]] || { echo 'Existing instances require sudo bash deploy/docker.sh for offline volume recovery.' >&2; exit 1; }
  command -v python3 >/dev/null || { echo 'Install python3 before upgrading.' >&2; exit 1; }
  exec python3 deploy/upgrade.py docker --project "$project"
fi
docker compose up -d --build --wait --wait-timeout 180
python3 deploy/upgrade.py docker --project "$project" --record-compose
python3 deploy/access-info.py docker
printf '%s\n' 'Check status: docker compose ps'
