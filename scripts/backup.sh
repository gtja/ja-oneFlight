#!/usr/bin/env bash
set -euo pipefail
ROOT=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)
source "$ROOT/scripts/lib/env.sh"
load_oneflight_env "$ROOT/.env"
if [[ -f "$ROOT/.local/source.env" ]]; then load_oneflight_env "$ROOT/.local/source.env"; fi
DEST=${1:-"$ROOT/backups/$(date +%Y%m%d-%H%M%S)"}
COMPOSE_FILE=${COMPOSE_FILE:-"$ROOT/compose.yaml"}
[[ ! -e "$DEST/database.sql.gz" ]] || { printf 'Backup already exists: %s\n' "$DEST" >&2; exit 1; }
umask 077
mkdir -p "$DEST"
COMPOSE=(docker compose --project-directory "$ROOT" --env-file "$ROOT/.env" -f "$COMPOSE_FILE")
"${COMPOSE[@]}" exec -T mysql sh -c 'MYSQL_PWD="$MYSQL_ROOT_PASSWORD" exec mysqldump --single-transaction --routines --triggers --no-tablespaces -uroot "$MYSQL_DATABASE"' | gzip > "$DEST/database.sql.gz"
"${COMPOSE[@]}" exec -T backend tar czf - -C /app/uploads . > "$DEST/uploads.tar.gz"
cp "$ROOT/.env" "$DEST/configuration.env"
FILES=(database.sql.gz uploads.tar.gz configuration.env)
if [[ -f "$ROOT/.local/source.env" ]]; then
  cp "$ROOT/.local/source.env" "$DEST/source.env"
  FILES+=(source.env)
fi
(cd "$DEST" && oneflight_checksums "${FILES[@]}" > SHA256SUMS)
printf 'Backup completed: %s\nThis directory contains credentials; store it privately.\n' "$DEST"
