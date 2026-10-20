#!/usr/bin/env bash
set -euo pipefail
ROOT=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)
DEST=${1:-"$ROOT/.env"}
if [[ -e "$DEST" ]]; then
  printf 'Configuration already exists: %s\n' "$DEST"
  exit 0
fi
command -v openssl >/dev/null || { printf 'openssl is required to generate passwords.\n' >&2; exit 1; }
umask 077
DB_SECRET=$(openssl rand -hex 24)
ROOT_SECRET=$(openssl rand -hex 24)
ADMIN_SECRET=$(openssl rand -hex 16)
while IFS= read -r line || [[ -n "$line" ]]; do
  case "$line" in
    DB_PASSWORD=*) printf 'DB_PASSWORD=%s\n' "$DB_SECRET" ;;
    MYSQL_ROOT_PASSWORD=*) printf 'MYSQL_ROOT_PASSWORD=%s\n' "$ROOT_SECRET" ;;
    BOOTSTRAP_ADMIN_PASSWORD=*) printf 'BOOTSTRAP_ADMIN_PASSWORD=%s\n' "$ADMIN_SECRET" ;;
    *) printf '%s\n' "$line" ;;
  esac
done < "$ROOT/.env.example" > "$DEST"
printf 'Created private configuration: %s\nRead BOOTSTRAP_ADMIN_PASSWORD from this file to sign in.\n' "$DEST"
