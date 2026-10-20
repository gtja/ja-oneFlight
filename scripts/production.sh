#!/usr/bin/env bash
# Operate only this deployment's imported app/MySQL images and named volumes.
set +x
set -euo pipefail

PRODUCTION_ROOT=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)
PRODUCTION_COMPOSE_FILE="$PRODUCTION_ROOT/compose.production.yaml"
PRODUCTION_ENV_FILE="$PRODUCTION_ROOT/.env"
PRODUCTION_PROJECT_NAME=oneflight
PRODUCTION_COMPOSE=()

usage() {
  printf 'Usage: scripts/production.sh [--env-file PATH] up|status|backup PRIVATE_DIRECTORY\n'
  printf 'The backup directory must be new; backup briefly pauses a running app.\n'
}

fail() {
  printf '%s\n' "$1" >&2
  exit 1
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --env-file)
      [[ $# -ge 2 && -n "$2" ]] || { usage >&2; exit 2; }
      PRODUCTION_ENV_FILE=$2
      shift 2
      ;;
    --help|-h)
      usage
      exit 0
      ;;
    --*) usage >&2; exit 2 ;;
    *) break ;;
  esac
done
[[ $# -ge 1 ]] || { usage >&2; exit 2; }
PRODUCTION_ACTION=$1
shift
case "$PRODUCTION_ACTION" in
  up|status) [[ $# -eq 0 ]] || { usage >&2; exit 2; } ;;
  backup) [[ $# -eq 1 && -n "$1" ]] || { usage >&2; exit 2; } ;;
  *) usage >&2; exit 2 ;;
esac

[[ -f "$PRODUCTION_ENV_FILE" && -r "$PRODUCTION_ENV_FILE" ]] || fail 'Production environment file is missing or unreadable.'
[[ "$PRODUCTION_ENV_FILE" == /* ]] || PRODUCTION_ENV_FILE="$PWD/$PRODUCTION_ENV_FILE"
PRODUCTION_ENV_FILE=$(cd "$(dirname "$PRODUCTION_ENV_FILE")" && printf '%s/%s' "$PWD" "$(basename "$PRODUCTION_ENV_FILE")")
[[ -f "$PRODUCTION_COMPOSE_FILE" ]] || fail 'compose.production.yaml is missing from the deployment directory.'

# Only discover the project name here. Compose parses the actual values from the
# explicit dotenv file; no value is evaluated, sourced or passed via host argv.
production_line_number=0
while IFS= read -r production_line || [[ -n "$production_line" ]]; do
  production_line_number=$((production_line_number + 1))
  production_line=${production_line%$'\r'}
  [[ "$production_line" =~ ^[[:space:]]*(#.*)?$ ]] && continue
  [[ "$production_line" == *=* ]] || fail "Invalid dotenv entry at line $production_line_number."
  production_key=${production_line%%=*}
  production_key=${production_key#"${production_key%%[![:space:]]*}"}
  production_key=${production_key%"${production_key##*[![:space:]]}"}
  [[ "$production_key" =~ ^[A-Z_][A-Z0-9_]*$ ]] || fail "Invalid dotenv key at line $production_line_number."
  if [[ "$production_key" == COMPOSE_PROJECT_NAME ]]; then
    production_value=${production_line#*=}
    production_value=${production_value#"${production_value%%[![:space:]]*}"}
    production_value=${production_value%%[[:space:]]#*}
    production_value=${production_value%"${production_value##*[![:space:]]}"}
    if [[ "$production_value" == \"*\" || "$production_value" == \'*\' ]]; then
      production_value=${production_value:1:${#production_value}-2}
    fi
    PRODUCTION_PROJECT_NAME=${production_value:-oneflight}
  fi
done < "$PRODUCTION_ENV_FILE"
[[ "$PRODUCTION_PROJECT_NAME" =~ ^[a-z0-9][a-z0-9_-]*$ ]] || fail 'COMPOSE_PROJECT_NAME must be a lowercase Compose project name.'

command -v docker >/dev/null 2>&1 || fail 'Docker CLI is required.'
if production_version=$(docker compose version --short 2>/dev/null) && [[ "$production_version" =~ ^v?2\. ]]; then
  PRODUCTION_COMPOSE=(docker compose)
elif command -v docker-compose >/dev/null 2>&1 && production_version=$(docker-compose version --short 2>/dev/null) && [[ "$production_version" =~ ^v?2\. ]]; then
  PRODUCTION_COMPOSE=(docker-compose)
else
  fail 'Docker Compose v2 is required (docker compose or docker-compose).'
fi

production_compose() (
  # A private dotenv file is the single configuration source for this deployment.
  # Ambient credentials from a different project must not override its values.
  unset COMPOSE_FILE COMPOSE_PROJECT_NAME COMPOSE_PROFILES
  unset APP_VERSION TZ WEB_PORT MYSQL_DATABASE MYSQL_PORT MYSQL_ROOT_PASSWORD
  unset DB_URL DB_USERNAME DB_PASSWORD BOOTSTRAP_ADMIN_USERNAME BOOTSTRAP_ADMIN_PASSWORD BOOTSTRAP_ADMIN_DISPLAY_NAME
  unset UPLOAD_DIRECTORY SESSION_COOKIE_SECURE ALLOWED_ORIGINS MAP_STYLE_URL MAP_SATELLITE_URL MAP_TERRAIN_URL
  unset SOURCE_GATEWAY_ORIGIN SOURCE_GATEWAY_SYSTEM SOURCE_TARGET_HOST SOURCE_TOKEN SOURCE_USERNAME
  unset SOURCE_DUSHU_JDBC_URL SOURCE_DUSHU_USERNAME SOURCE_DUSHU_PASSWORD
  unset SOURCE_ICOS_JDBC_URL SOURCE_ICOS_USERNAME SOURCE_ICOS_PASSWORD
  unset SOURCE_IDENTITY_JDBC_URL SOURCE_IDENTITY_USERNAME SOURCE_IDENTITY_PASSWORD
  unset SOURCE_MQTT_URL SOURCE_MQTT_USERNAME SOURCE_MQTT_PASSWORD SOURCE_ALGORITHM_ORIGIN SOURCE_TIMEOUT_SECONDS
  "${PRODUCTION_COMPOSE[@]}" --project-directory "$PRODUCTION_ROOT" --env-file "$PRODUCTION_ENV_FILE" \
    --project-name "$PRODUCTION_PROJECT_NAME" -f "$PRODUCTION_COMPOSE_FILE" "$@"
)

production_compose config --quiet

production_require_loaded_images() {
  local production_images production_image
  production_images=$(production_compose config --images)
  [[ -n "$production_images" ]] || fail 'Production Compose does not declare images.'
  while IFS= read -r production_image; do
    [[ -n "$production_image" ]] || continue
    docker image inspect "$production_image" >/dev/null 2>&1 || fail 'A required production image is not loaded, or Docker is unavailable. Import the release images first.'
  done <<< "$production_images"
}

production_single_container() {
  local production_container_ids
  production_container_ids=$(production_compose ps --all --quiet "$1")
  [[ "$production_container_ids" =~ ^[a-f0-9]{12,64}$ ]] || fail "Expected exactly one existing $1 container in this production project."
  printf '%s' "$production_container_ids"
}

production_checksums() {
  if command -v sha256sum >/dev/null 2>&1; then sha256sum "$@"; else shasum -a 256 "$@"; fi
}

production_backup() {
  local production_destination=$1 production_parent production_name
  local production_app_id production_mysql_id production_app_state
  local production_app_running production_app_paused production_app_image production_mysql_image
  [[ "$production_destination" == /* ]] || production_destination="$PWD/$production_destination"
  [[ ! -e "$production_destination" && ! -L "$production_destination" ]] || fail 'Backup destination must be a new private directory; existing paths are never overwritten.'
  production_app_id=$(production_single_container app)
  production_mysql_id=$(production_single_container mysql)
  [[ $(docker inspect --format '{{.State.Running}} {{.State.Paused}} {{.State.Health.Status}}' "$production_mysql_id") == 'true false healthy' ]] || fail 'The production MySQL container must be running and healthy before backup.'
  production_app_state=$(docker inspect --format '{{.State.Running}} {{.State.Paused}} {{.Image}}' "$production_app_id")
  IFS=' ' read -r production_app_running production_app_paused production_app_image <<< "$production_app_state"
  [[ "$production_app_running" == true || "$production_app_running" == false ]] || fail 'Cannot determine the production app state.'
  [[ "$production_app_paused" == true || "$production_app_paused" == false ]] || fail 'Cannot determine whether the production app is paused.'
  [[ "$production_app_image" =~ ^sha256:[a-f0-9]{64}$ ]] || fail 'Cannot determine the running production app image.'
  production_mysql_image=$(docker inspect --format '{{.Image}}' "$production_mysql_id")

  umask 077
  production_parent=$(dirname "$production_destination")
  production_name=$(basename "$production_destination")
  mkdir -p "$production_parent"
  production_parent=$(cd "$production_parent" && pwd)
  production_destination="$production_parent/$production_name"
  mkdir -m 700 "$production_destination"

  # These globals survive a local function's EXIT trap after an interrupted dump.
  PRODUCTION_BACKUP_DIRECTORY=$production_destination
  PRODUCTION_RESUME_APP_ID=''
  PRODUCTION_BACKUP_COMPLETE=0
  production_backup_cleanup() {
    local production_exit_status=$?
    trap - EXIT INT TERM
    if [[ -n "$PRODUCTION_RESUME_APP_ID" ]]; then
      if ! docker unpause "$PRODUCTION_RESUME_APP_ID" >/dev/null 2>&1; then
        printf 'Could not resume the production app; inspect its state before continuing.\n' >&2
        production_exit_status=1
      fi
    fi
    if [[ "$PRODUCTION_BACKUP_COMPLETE" != 1 ]]; then
      printf 'Backup is incomplete; do not restore from: %s\n' "$PRODUCTION_BACKUP_DIRECTORY" >&2
    fi
    exit "$production_exit_status"
  }
  trap production_backup_cleanup EXIT
  trap 'exit 130' INT
  trap 'exit 143' TERM

  if [[ "$production_app_running" == true && "$production_app_paused" == false ]]; then
    PRODUCTION_RESUME_APP_ID=$production_app_id
    if ! docker pause "$production_app_id" >/dev/null; then
      PRODUCTION_RESUME_APP_ID=''
      fail 'Could not pause the production app; no database backup was started.'
    fi
  fi

  # The password expands only inside this project's MySQL container, never on the
  # host command line. The local socket targets only the production business DB.
  production_compose exec --interactive=false -T mysql sh -c \
    'MYSQL_PWD="$MYSQL_ROOT_PASSWORD" exec mysqldump --single-transaction --routines --triggers --no-tablespaces --column-statistics=0 --set-gtid-purged=OFF -uroot "$MYSQL_DATABASE"' \
    | gzip > "$production_destination/database.sql.gz.partial"
  docker run --rm --pull never --network none --read-only --no-healthcheck \
    --label "oneflight.backup.project=$PRODUCTION_PROJECT_NAME" \
    --volumes-from "$production_app_id:ro" --entrypoint tar "$production_app_image" \
    czf - -C /app/uploads . > "$production_destination/uploads.tar.gz.partial"

  cp "$PRODUCTION_ENV_FILE" "$production_destination/configuration.env"
  cp "$PRODUCTION_COMPOSE_FILE" "$production_destination/compose.production.yaml"
  printf 'app %s\nmysql %s\n' "$production_app_image" "$production_mysql_image" > "$production_destination/images.txt"
  mv "$production_destination/database.sql.gz.partial" "$production_destination/database.sql.gz"
  mv "$production_destination/uploads.tar.gz.partial" "$production_destination/uploads.tar.gz"
  chmod 600 "$production_destination/"*
  (cd "$production_destination" && production_checksums database.sql.gz uploads.tar.gz configuration.env compose.production.yaml images.txt > SHA256SUMS)
  if [[ -n "$PRODUCTION_RESUME_APP_ID" ]]; then
    docker unpause "$PRODUCTION_RESUME_APP_ID" >/dev/null || fail 'Could not resume the production app after backup.'
    PRODUCTION_RESUME_APP_ID=''
  fi
  printf 'project=%s\ncreated_at_utc=%s\n' "$PRODUCTION_PROJECT_NAME" "$(date -u +%Y-%m-%dT%H:%M:%SZ)" > "$production_destination/BACKUP_COMPLETE"
  chmod 600 "$production_destination/SHA256SUMS" "$production_destination/BACKUP_COMPLETE"
  PRODUCTION_BACKUP_COMPLETE=1
  printf 'Private production backup completed: %s\n' "$production_destination"
}

case "$PRODUCTION_ACTION" in
  up)
    production_require_loaded_images
    production_compose up -d --no-build --pull never --wait --wait-timeout 300 mysql app
    printf 'Production project is healthy: %s\n' "$PRODUCTION_PROJECT_NAME"
    ;;
  status) production_compose ps --all ;;
  backup) production_backup "$1" ;;
esac
