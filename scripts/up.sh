#!/usr/bin/env bash
set -euo pipefail
ROOT=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)
source "$ROOT/scripts/lib/env.sh"
"$ROOT/scripts/init-env.sh"
load_oneflight_env "$ROOT/.env"
if [[ -f "$ROOT/.local/source.env" ]]; then load_oneflight_env "$ROOT/.local/source.env"; fi
COMPOSE=(docker compose --project-directory "$ROOT" --env-file "$ROOT/.env" -f "$ROOT/compose.yaml")
case "${1:-}" in
  '') ;;
  --shared-uploads)
    if oneflight_service_running backend "${COMPOSE[@]}"; then "$ROOT/scripts/sync-uploads.sh"; fi
    mkdir -p "$ROOT/backend/uploads"
    export LOCAL_UID=$(id -u) LOCAL_GID=$(id -g)
    COMPOSE+=(-f "$ROOT/compose.dev.yaml")
    ;;
  *) printf 'Usage: scripts/up.sh [--shared-uploads]\n' >&2; exit 2 ;;
esac
docker pull --platform "$(oneflight_host_platform)" mysql:8.4
"${COMPOSE[@]}" up -d --build --wait
printf 'Platform is healthy. URL is http://localhost:<WEB_PORT> (default 8088).\n'
