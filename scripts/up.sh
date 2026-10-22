#!/usr/bin/env bash
set -euo pipefail
ROOT=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)
source "$ROOT/scripts/lib/env.sh"
"$ROOT/scripts/init-env.sh"
load_oneflight_env "$ROOT/.env"
if [[ -f "$ROOT/.local/source.env" ]]; then load_oneflight_env "$ROOT/.local/source.env" SOURCE_; fi
# Select the database profile from this launch's business URL, not ambient flags.
export COMPOSE_PROFILES=
COMPOSE=(docker compose --project-directory "$ROOT" --env-file "$ROOT/.env" -f "$ROOT/compose.yaml")
LOCAL_DATABASE=0
case "${DB_URL:-}" in
  ''|jdbc:mysql://mysql:3306/*)
    LOCAL_DATABASE=1
    COMPOSE+=(--profile local-database)
    ;;
esac
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
if [[ "$LOCAL_DATABASE" == 1 ]]; then
  docker pull --platform "$(oneflight_host_platform)" mysql:8.4
  "${COMPOSE[@]}" up -d --wait mysql
fi
"${COMPOSE[@]}" up -d --build --wait
printf 'Platform is healthy. URL is http://localhost:<WEB_PORT> (default 8088).\n'
