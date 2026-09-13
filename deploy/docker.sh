#!/usr/bin/env bash
set -euo pipefail
cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.."
command -v docker >/dev/null || { echo 'Install Docker Engine and Compose first: https://docs.docker.com/engine/install/'; exit 1; }
docker compose version >/dev/null
docker compose up -d --build --wait --wait-timeout 180
printf '%s\n' 'Read the initial password: docker compose exec app cat .wrangler/server/initial-admin-password.txt' 'First login requires a password change. Check status: docker compose ps'
