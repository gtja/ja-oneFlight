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
# Match packaging: the root private file owns database, source and identity
# settings. An older preview shell must not inject a second configuration.
while IFS= read -r oneflight_config_key; do
  case "$oneflight_config_key" in
    DB_*|SOURCE_*|ONEFLIGHT_*|FLIGHT_CONTROL_*|SESSION_*|SPRING_*|BOOTSTRAP_*|MAP_*|ALLOWED_ORIGINS|UPLOAD_DIRECTORY|SERVER_PORT|SERVER_ADDRESS|WEB_PORT)
      unset "$oneflight_config_key"
      ;;
  esac
done < <(compgen -e)
load_oneflight_env "$ROOT/.env"
# Local origins are deployment settings only; service addresses stay unchanged.
if [[ -z "${ONEFLIGHT_TRANSPORT_MODE:-}" && ( "${ONEFLIGHT_AUTH_MODE:-local}" == 4a || "${FLIGHT_CONTROL_MODE:-local}" == embedded ) ]]; then
  export ONEFLIGHT_TRANSPORT_MODE=http-ip
fi
if [[ -n "${ONEFLIGHT_TRANSPORT_MODE:-}" && "$ONEFLIGHT_TRANSPORT_MODE" != http-ip && "$ONEFLIGHT_TRANSPORT_MODE" != https ]]; then
  printf 'ONEFLIGHT_TRANSPORT_MODE must be http-ip or https.\n' >&2
  exit 2
fi
WEB_PORT=${WEB_PORT:-8088}
FLIGHT_CONTROL_HTTP_PORT=${FLIGHT_CONTROL_HTTP_PORT:-8089}
for oneflight_port_key in WEB_PORT FLIGHT_CONTROL_HTTP_PORT; do
  oneflight_port_value=${!oneflight_port_key}
  if [[ ! "$oneflight_port_value" =~ ^[1-9][0-9]{0,4}$ ]] || (( oneflight_port_value > 65535 )); then
    printf 'Invalid local port: %s\n' "$oneflight_port_key" >&2
    exit 2
  fi
done
if [[ "${ONEFLIGHT_TRANSPORT_MODE:-}" == http-ip && ( "$WEB_PORT" == "$FLIGHT_CONTROL_HTTP_PORT" || "$WEB_PORT" == 8080 || "$FLIGHT_CONTROL_HTTP_PORT" == 8080 ) ]]; then
  printf 'The frontend, backend (8080) and flight proxy need separate local ports.\n' >&2
  exit 2
fi
# The existing Docker flight proxy may reach Java through host.docker.internal;
# keep the root-configured/default bind address instead of forcing loopback.
export SERVER_PORT=8080
ONEFLIGHT_FRONTEND_PORT=5173
ONEFLIGHT_BROWSER_ENTRY=http://127.0.0.1:5173
unset ONEFLIGHT_DEV_PUBLIC_ORIGIN
if [[ "${ONEFLIGHT_TRANSPORT_MODE:-}" == http-ip ]]; then
  export ONEFLIGHT_PUBLIC_ORIGIN="http://127.0.0.1:${WEB_PORT}"
  export FLIGHT_CONTROL_ORIGIN="http://127.0.0.1:${FLIGHT_CONTROL_HTTP_PORT}"
  export ALLOWED_ORIGINS="$ONEFLIGHT_PUBLIC_ORIGIN"
  export SESSION_COOKIE_SECURE=false
  ONEFLIGHT_FRONTEND_PORT="$WEB_PORT"
  ONEFLIGHT_BROWSER_ENTRY="$ONEFLIGHT_PUBLIC_ORIGIN"
  export ONEFLIGHT_DEV_PUBLIC_ORIGIN="$ONEFLIGHT_PUBLIC_ORIGIN"
elif [[ "${ONEFLIGHT_TRANSPORT_MODE:-}" == https ]]; then
  ONEFLIGHT_BROWSER_ENTRY="${ONEFLIGHT_PUBLIC_ORIGIN:-http://127.0.0.1:5173}"
else
  export ALLOWED_ORIGINS="${ALLOWED_ORIGINS:-http://localhost:5173,http://127.0.0.1:5173}"
fi
oneflight_flight_secret=${FLIGHT_CONTROL_GATEWAY_SECRET:-}
if [[ "${FLIGHT_CONTROL_MODE:-local}" == embedded && ${#oneflight_flight_secret} -lt 32 ]]; then
  printf 'Embedded flight requires FLIGHT_CONTROL_GATEWAY_SECRET in the root .env, matching the existing proxy; this script does not generate or replace it.\n' >&2
  exit 2
fi
unset oneflight_flight_secret
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
    export ONEFLIGHT_API_PROXY_URL=http://127.0.0.1:8080
    ;;
  --container-api)
    if [[ "${ONEFLIGHT_TRANSPORT_MODE:-}" == http-ip && ( "${ONEFLIGHT_AUTH_MODE:-local}" == 4a || "${FLIGHT_CONTROL_MODE:-local}" == embedded ) ]]; then
      printf '4A and embedded flight development require the unified entry. Use scripts/dev.sh with the local HTTP IP backend instead of --container-api.\n' >&2
      exit 2
    fi
    curl --fail --silent "http://127.0.0.1:${WEB_PORT}/healthz" >/dev/null || { printf 'Start the Docker platform with scripts/up.sh first.\n' >&2; exit 1; }
    export ONEFLIGHT_API_PROXY_URL="http://127.0.0.1:${WEB_PORT}"
    ONEFLIGHT_FRONTEND_PORT=5173
    unset ONEFLIGHT_DEV_PUBLIC_ORIGIN
    if [[ "${ONEFLIGHT_TRANSPORT_MODE:-}" != https ]]; then ONEFLIGHT_BROWSER_ENTRY=http://127.0.0.1:5173; fi
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
(cd "$ROOT/frontend" && exec "$ROOT/frontend/node_modules/.bin/vite" --host 127.0.0.1 --port "$ONEFLIGHT_FRONTEND_PORT" --strictPort) &
PIDS+=("$!")
printf 'Web: %s   API proxy: %s\n' "$ONEFLIGHT_BROWSER_ENTRY" "$ONEFLIGHT_API_PROXY_URL"
if [[ "${ONEFLIGHT_TRANSPORT_MODE:-}" == https ]]; then
  printf 'HTTPS origins and cookies are preserved. Vite listens on 127.0.0.1:5173; use the matching fixed HTTPS gateway for 4A login.\n'
else
  printf 'Use this exact 127.0.0.1 entry for login.\n'
fi
printf 'Database, sources and authentication mode come from the root .env. Ctrl-C stops only this script\047s development processes.\n'
if [[ "${FLIGHT_CONTROL_MODE:-local}" == embedded ]]; then printf 'The existing flight proxy is kept at %s.\n' "$FLIGHT_CONTROL_ORIGIN"; fi
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
