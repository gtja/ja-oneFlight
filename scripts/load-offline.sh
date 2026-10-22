#!/usr/bin/env bash
set -euo pipefail
OFFLINE_GATEWAY=0
case "${1:-}" in '') ;; --gateway) OFFLINE_GATEWAY=1 ;; *) printf 'Usage: load-offline.sh [--gateway]\n' >&2; exit 2 ;; esac
[[ $# -le 1 ]] || exit 2
ROOT=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)
source "$ROOT/scripts/lib/env.sh"
cd "$ROOT"
[[ -f images.tar.gz && -f SHA256SUMS ]] || { printf 'Run this script inside the extracted offline package.\n' >&2; exit 1; }
if command -v sha256sum >/dev/null; then sha256sum --check SHA256SUMS; else shasum -a 256 --check SHA256SUMS; fi
gzip -dc images.tar.gz | docker load
"$ROOT/scripts/init-env.sh"
load_oneflight_env "$ROOT/.env"
export COMPOSE_PROFILES=
COMPOSE=(docker compose --env-file "$ROOT/.env" -f "$ROOT/compose.yaml")
LOCAL_DATABASE=0
case "${DB_URL:-}" in
  ''|jdbc:mysql://mysql:3306/*)
    LOCAL_DATABASE=1
    COMPOSE+=(--profile local-database)
    ;;
esac
if [[ "$OFFLINE_GATEWAY" == 1 ]]; then
  COMPOSE+=(-f "$ROOT/compose.gateway.split.yaml")
fi
if [[ "$LOCAL_DATABASE" == 1 ]]; then
  "${COMPOSE[@]}" up -d --no-build --pull never --wait mysql
fi
"${COMPOSE[@]}" up -d --no-build --pull never --wait
printf 'Offline platform started. Configure WEB_PORT in .env to change the listening port.\n'
