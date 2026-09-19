#!/usr/bin/env bash
set -Eeuo pipefail
name=contexthub-browser-check
volume=contexthub-browser-check-state
cleanup() { docker rm -f "$name" >/dev/null 2>&1 || true; docker volume rm "$volume" >/dev/null 2>&1 || true; }
trap cleanup EXIT
docker volume create "$volume" >/dev/null
docker run -d --name "$name" --read-only --tmpfs /tmp -p 127.0.0.1:8080:8080 -v "$volume:/app/.wrangler" contexthub:check >/dev/null
ready=false
for ((i=0;i<60;i++)); do
  if curl -fsS http://127.0.0.1:8080/login >/dev/null; then ready=true; break; fi
  if [[ $(docker inspect -f '{{.State.Running}}' "$name") != true ]]; then docker logs "$name"; exit 1; fi
  sleep 1
done
if [[ $ready != true ]]; then docker logs "$name"; exit 1; fi
cd app
CONTEXT_HUB_BROWSER_TEST_URL=http://127.0.0.1:8080 pnpm exec playwright test
