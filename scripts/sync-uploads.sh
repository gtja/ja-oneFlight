#!/usr/bin/env bash
set -euo pipefail
ROOT=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)
source "$ROOT/scripts/lib/env.sh"
load_oneflight_env "$ROOT/.env"
command -v python3 >/dev/null || { printf 'Python 3 is required for attachment synchronization.\n' >&2; exit 1; }
# Keep macOS AppleDouble metadata out of the Linux upload directory.
export COPYFILE_DISABLE=1
COMPOSE=(docker compose --project-directory "$ROOT" --env-file "$ROOT/.env" -f "$ROOT/compose.yaml")
if [[ "${1:-}" == '--shared-uploads' ]]; then COMPOSE+=(-f "$ROOT/compose.dev.yaml"); fi
if ! oneflight_service_running backend "${COMPOSE[@]}"; then
  printf 'Start the backend container before synchronizing attachments.\n' >&2
  exit 1
fi
umask 077
SYNC_ROOT=$(mktemp -d "${TMPDIR:-/tmp}/oneflight-upload-sync.XXXXXX")
trap 'rm -rf "$SYNC_ROOT"' EXIT
mkdir -p "$ROOT/backend/uploads" "$SYNC_ROOT/container"
"${COMPOSE[@]}" exec -T backend tar czf - -C /app/uploads . | tar xzf - -C "$SYNC_ROOT/container"
python3 - "$SYNC_ROOT/container" "$ROOT/backend/uploads" <<'PY'
import filecmp, shutil, sys
from pathlib import Path
source, destination = map(Path, sys.argv[1:])
count = 0
for file in source.rglob('*'):
    if file.name.startswith('._'): continue
    if file.is_symlink():
        raise SystemExit('Attachment synchronization refuses symbolic links.')
    target = destination / file.relative_to(source)
    if file.is_dir():
        target.mkdir(parents=True, exist_ok=True)
    elif file.is_file():
        if target.exists() and (target.is_symlink() or not filecmp.cmp(file, target, shallow=False)):
            raise SystemExit('Attachment filename collision; existing content was not overwritten.')
        target.parent.mkdir(parents=True, exist_ok=True)
        if not target.exists(): shutil.copy2(file, target)
        count += 1
for file in destination.rglob('*'):
    if file.name.startswith('._'): continue
    if file.is_symlink(): raise SystemExit('Attachment synchronization refuses symbolic links.')
print('Local and container attachment files merged:', count)
PY
CONTAINER_UID=$("${COMPOSE[@]}" exec -T backend id -u | tr -d '\r')
CONTAINER_GID=$("${COMPOSE[@]}" exec -T backend id -g | tr -d '\r')
tar czf - -C "$ROOT/backend/uploads" . | "${COMPOSE[@]}" exec -T --user 0:0 backend tar xzf - -C /app/uploads
"${COMPOSE[@]}" exec -T --user 0:0 backend chown -R "$CONTAINER_UID:$CONTAINER_GID" /app/uploads
printf 'Attachment synchronization completed without changing the business database.\n'
