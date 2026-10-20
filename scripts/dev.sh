#!/usr/bin/env bash
set -euo pipefail
ROOT=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)
source "$ROOT/scripts/lib/env.sh"
"$ROOT/scripts/init-env.sh"
load_oneflight_env "$ROOT/.env"
if [[ -f "$ROOT/.local/source.env" ]]; then load_oneflight_env "$ROOT/.local/source.env"; fi
command -v node >/dev/null && command -v pnpm >/dev/null || { printf 'Install Node.js 24 and pnpm 10.33.0.\n' >&2; exit 1; }
MODE=${1:-'--h2'}
if [[ "$MODE" != '--container-api' ]]; then
  command -v java >/dev/null && command -v mvn >/dev/null || { printf 'Install Java 21 and Maven 3.9+.\n' >&2; exit 1; }
fi
case "$MODE" in
  --mysql)
    if oneflight_service_running backend docker compose --project-directory "$ROOT" --env-file "$ROOT/.env" -f "$ROOT/compose.yaml"; then
      printf 'The Docker backend already uses this business database. Use dev.sh --container-api, or stop frontend/backend containers before switching to native --mysql.\n' >&2
      exit 1
    fi
    docker pull --platform "$(oneflight_host_platform)" mysql:8.4
    docker compose --project-directory "$ROOT" --env-file "$ROOT/.env" -f "$ROOT/compose.yaml" up -d --wait mysql
    export DB_URL="jdbc:mysql://localhost:${MYSQL_PORT:-3307}/${MYSQL_DATABASE:-oneflight}?serverTimezone=Asia/Shanghai"
    export ONEFLIGHT_API_PROXY_URL=http://localhost:8080
    ;;
  --h2)
    export DB_URL='jdbc:h2:file:./data/oneflight;MODE=MySQL;DATABASE_TO_LOWER=TRUE'
    export DB_USERNAME=sa DB_PASSWORD=
    export ONEFLIGHT_API_PROXY_URL=http://localhost:8080
    ;;
  --container-api)
    curl --fail --silent "http://localhost:${WEB_PORT:-8088}/healthz" >/dev/null || { printf 'Start the Docker platform with scripts/up.sh first.\n' >&2; exit 1; }
    export ONEFLIGHT_API_PROXY_URL="http://localhost:${WEB_PORT:-8088}"
    ;;
  *) printf 'Usage: scripts/dev.sh [--h2|--mysql|--container-api]\n' >&2; exit 2 ;;
esac
if [[ "$MODE" == '--h2' ]]; then
  export UPLOAD_DIRECTORY="$ROOT/backend/data/h2-uploads"
else
  export UPLOAD_DIRECTORY="$ROOT/backend/uploads"
fi
if [[ ! -d "$ROOT/frontend/node_modules" ]]; then (cd "$ROOT/frontend" && pnpm install --frozen-lockfile); fi
PIDS=()
cleanup() {
  for task_pid in "${PIDS[@]}"; do kill "$task_pid" 2>/dev/null || true; done
}
trap cleanup EXIT INT TERM
if [[ "$MODE" != '--container-api' ]]; then
  (cd "$ROOT/backend" && exec mvn -B -ntp spring-boot:run) &
  PIDS+=("$!")
fi
(cd "$ROOT/frontend" && exec "$ROOT/frontend/node_modules/.bin/vite" --host 0.0.0.0 --port 5173 --strictPort) &
PIDS+=("$!")
printf 'Web: http://localhost:5173   API proxy: %s\n' "$ONEFLIGHT_API_PROXY_URL"
printf 'Use the username and initial password in .env. Ctrl-C stops both applications.\n'
while true; do
  for task_pid in "${PIDS[@]}"; do
    if ! kill -0 "$task_pid" 2>/dev/null; then
      set +e
      wait "$task_pid"
      EXIT_STATUS=$?
      set -e
      exit "$EXIT_STATUS"
    fi
  done
  sleep 1
done
