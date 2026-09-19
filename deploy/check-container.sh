#!/usr/bin/env bash
set -Eeuo pipefail
name=contexthub-runtime-check
volume=contexthub-runtime-check-state
cleanup() { docker rm -f "$name" >/dev/null 2>&1 || true; docker volume rm "$volume" >/dev/null 2>&1 || true; }
trap cleanup EXIT
docker volume create "$volume" >/dev/null
docker run -d --name "$name" --network none --read-only --tmpfs /tmp -v "$volume:/app/.wrangler" -v "$PWD/deploy/runtime-smoke.mjs:/checks/runtime-smoke.mjs:ro" contexthub:check >/dev/null
ready=false
for ((i=0;i<60;i++)); do
  if docker exec "$name" node -e "fetch('http://127.0.0.1:4310/healthz').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"; then ready=true; break; fi
  if [[ $(docker inspect -f '{{.State.Running}}' "$name") != true ]]; then docker logs "$name"; exit 1; fi
  sleep 2
done
if [[ $ready != true ]]; then docker logs "$name"; exit 1; fi
docker exec "$name" node --no-experimental-strip-types /checks/runtime-smoke.mjs create
docker restart "$name" >/dev/null
ready=false
for ((i=0;i<60;i++)); do
  if docker exec "$name" node -e "fetch('http://127.0.0.1:4310/healthz').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"; then ready=true; break; fi
  if [[ $(docker inspect -f '{{.State.Running}}' "$name") != true ]]; then docker logs "$name"; exit 1; fi
  sleep 2
done
if [[ $ready != true ]]; then docker logs "$name"; exit 1; fi
docker exec "$name" node --no-experimental-strip-types /checks/runtime-smoke.mjs verify
