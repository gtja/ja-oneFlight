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
EXPLICIT_DATABASE=false
while IFS= read -r line || [[ -n "$line" ]]; do
  case "$line" in
    DB_URL=*)
      database_url=${line#*=}
      if [[ "$database_url" == \"*\" || "$database_url" == \'*\' ]]; then
        database_url=${database_url:1:${#database_url}-2}
      fi
      [[ -z "$database_url" ]] || EXPLICIT_DATABASE=true
      ;;
  esac
done < "$ROOT/.env.example"
DB_SECRET=''
if [[ "$EXPLICIT_DATABASE" == false ]]; then DB_SECRET=$(openssl rand -hex 24); fi
ROOT_SECRET=$(openssl rand -hex 24)
ADMIN_SECRET=$(openssl rand -hex 16)
while IFS= read -r line || [[ -n "$line" ]]; do
  case "$line" in
    DB_PASSWORD=*)
      if [[ "$EXPLICIT_DATABASE" == true ]]; then printf '%s\n' "$line"; else printf 'DB_PASSWORD=%s\n' "$DB_SECRET"; fi
      ;;
    MYSQL_ROOT_PASSWORD=*) printf 'MYSQL_ROOT_PASSWORD=%s\n' "$ROOT_SECRET" ;;
    BOOTSTRAP_ADMIN_PASSWORD=*) printf 'BOOTSTRAP_ADMIN_PASSWORD=%s\n' "$ADMIN_SECRET" ;;
    *) printf '%s\n' "$line" ;;
  esac
done < "$ROOT/.env.example" > "$DEST"
printf 'Created private configuration: %s\nRead BOOTSTRAP_ADMIN_PASSWORD from this file to sign in.\n' "$DEST"
if [[ "$EXPLICIT_DATABASE" == true ]]; then
  printf 'Configure DB_USERNAME and DB_PASSWORD for the existing database before starting the application.\n'
fi
