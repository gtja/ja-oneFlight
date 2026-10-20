#!/usr/bin/env bash
set -euo pipefail
ROOT=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)
source "$ROOT/scripts/lib/env.sh"
load_oneflight_env "$ROOT/.env"
if [[ -f "$ROOT/.local/source.env" ]]; then load_oneflight_env "$ROOT/.local/source.env"; fi
DEST=${1:-}
[[ -n "$DEST" && "${2:-}" == '--yes' ]] || { printf 'Usage: scripts/restore.sh <backup-directory> --yes\nThis replaces database and uploads. First take a current backup.\n' >&2; exit 1; }
DEST=$(cd "$DEST" && pwd)
COMPOSE_FILE=${COMPOSE_FILE:-"$ROOT/compose.yaml"}
(cd "$DEST" && if command -v sha256sum >/dev/null; then sha256sum --check SHA256SUMS; else shasum -a 256 --check SHA256SUMS; fi)
COMPOSE=(docker compose --project-directory "$ROOT" --env-file "$ROOT/.env" -f "$COMPOSE_FILE")
APP_SERVICES=()
while IFS= read -r service; do
  if [[ "$service" == backend || "$service" == frontend ]]; then APP_SERVICES+=("$service"); fi
done < <("${COMPOSE[@]}" ps --services --status running)
if [[ ${#APP_SERVICES[@]} -gt 0 ]]; then "${COMPOSE[@]}" stop "${APP_SERVICES[@]}"; fi
gzip -dc "$DEST/database.sql.gz" | "${COMPOSE[@]}" exec -T mysql sh -c 'MYSQL_PWD="$MYSQL_ROOT_PASSWORD" exec mysql -uroot "$MYSQL_DATABASE"'
# Run with the service's existing upload volume. Do not touch any other volumes.
"${COMPOSE[@]}" run --rm --no-deps -T --entrypoint sh backend -c 'find /app/uploads -mindepth 1 -delete; tar xzf - -C /app/uploads' < "$DEST/uploads.tar.gz"
if [[ ${#APP_SERVICES[@]} -gt 0 ]]; then "${COMPOSE[@]}" up -d --wait "${APP_SERVICES[@]}"; fi
printf 'Database and uploads restored from %s\n' "$DEST"
