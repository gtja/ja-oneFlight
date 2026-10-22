#!/usr/bin/env bash
set -euo pipefail
ROOT=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)
source "$ROOT/scripts/lib/env.sh"
MODE=${1:-'--mysql'}
if [[ $# -gt 1 ]]; then
  printf 'Usage: scripts/dev.sh [--mysql|--container-api]\n' >&2
  exit 2
fi
case "$MODE" in
  --mysql|--container-api) ;;
  --h2) printf 'H2 仅用于自动化测试；日常开发请在 .env 配置远端 MySQL，然后执行 scripts/dev.sh。\n' >&2; exit 2 ;;
  *) printf 'Usage: scripts/dev.sh [--mysql|--container-api]\n' >&2; exit 2 ;;
esac
"$ROOT/scripts/init-env.sh"
# The private project file is authoritative for the writable business database.
unset DB_URL DB_USERNAME DB_PASSWORD
load_oneflight_env "$ROOT/.env"
if [[ -f "$ROOT/.local/source.env" ]]; then load_oneflight_env "$ROOT/.local/source.env" SOURCE_; fi
command -v node >/dev/null && command -v pnpm >/dev/null || { printf 'Install Node.js 24 and pnpm 10.33.0.\n' >&2; exit 1; }
if [[ "$MODE" != '--container-api' ]]; then
  command -v java >/dev/null && command -v mvn >/dev/null || { printf 'Install Java 21 and Maven 3.9+.\n' >&2; exit 1; }
fi
case "$MODE" in
  --mysql)
    for database_key in DB_URL DB_USERNAME DB_PASSWORD; do
      [[ -n "${!database_key:-}" ]] || { printf 'Configure %s in .env before starting the remote MySQL application.\n' "$database_key" >&2; exit 1; }
    done
    [[ "$DB_URL" == jdbc:mysql://* ]] || { printf 'DB_URL in .env must use the remote business MySQL database; H2 is only for automated tests.\n' >&2; exit 1; }
    if command -v docker >/dev/null 2>&1 \
      && oneflight_service_running backend docker compose --project-directory "$ROOT" --env-file "$ROOT/.env" -f "$ROOT/compose.yaml" 2>/dev/null; then
      printf 'The Docker backend is already running. Use dev.sh --container-api, or stop frontend/backend containers before starting native Java.\n' >&2
      exit 1
    fi
    # Keep the application and Flyway on the same business connection, even
    # when an older shell configuration still exports H2-specific overrides.
    export SPRING_DATASOURCE_URL="$DB_URL"
    export SPRING_DATASOURCE_USERNAME="$DB_USERNAME"
    export SPRING_DATASOURCE_PASSWORD="$DB_PASSWORD"
    export SPRING_DATASOURCE_HIKARI_JDBC_URL="$DB_URL"
    export SPRING_DATASOURCE_HIKARI_USERNAME="$DB_USERNAME"
    export SPRING_DATASOURCE_HIKARI_PASSWORD="$DB_PASSWORD"
    export SPRING_FLYWAY_URL="$DB_URL"
    export SPRING_FLYWAY_USER="$DB_USERNAME"
    export SPRING_FLYWAY_PASSWORD="$DB_PASSWORD"
    export ONEFLIGHT_API_PROXY_URL=http://localhost:8080
    ;;
  --container-api)
    curl --fail --silent "http://localhost:${WEB_PORT:-8088}/healthz" >/dev/null || { printf 'Start the Docker platform with scripts/up.sh first.\n' >&2; exit 1; }
    export ONEFLIGHT_API_PROXY_URL="http://localhost:${WEB_PORT:-8088}"
    ;;
esac
export UPLOAD_DIRECTORY="${UPLOAD_DIRECTORY:-$ROOT/backend/uploads}"
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
