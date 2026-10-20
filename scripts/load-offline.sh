#!/usr/bin/env bash
set -euo pipefail
ROOT=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)
cd "$ROOT"
[[ -f images.tar.gz && -f SHA256SUMS ]] || { printf 'Run this script inside the extracted offline package.\n' >&2; exit 1; }
if command -v sha256sum >/dev/null; then sha256sum --check SHA256SUMS; else shasum -a 256 --check SHA256SUMS; fi
gzip -dc images.tar.gz | docker load
"$ROOT/scripts/init-env.sh"
docker compose --env-file "$ROOT/.env" -f "$ROOT/compose.yaml" up -d --pull never --wait
printf 'Offline platform started. Configure WEB_PORT in .env to change the listening port.\n'
