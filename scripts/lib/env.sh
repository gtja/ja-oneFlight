#!/usr/bin/env bash
# Parse dotenv without eval/source, so credential values cannot execute shell code.
load_oneflight_env() {
  local env_file="$1" line key value
  [[ -f "$env_file" ]] || { printf 'Missing configuration: %s\n' "$env_file" >&2; return 1; }
  while IFS= read -r line || [[ -n "$line" ]]; do
    line=${line%$'\r'}
    [[ -z "$line" || "$line" == \#* ]] && continue
    [[ "$line" == *=* ]] || { printf 'Invalid dotenv entry.\n' >&2; return 1; }
    key=${line%%=*}
    value=${line#*=}
    [[ "$key" =~ ^[A-Z_][A-Z0-9_]*$ ]] || { printf 'Invalid dotenv key.\n' >&2; return 1; }
    if [[ "$value" == \"*\" || "$value" == \'*\' ]]; then
      value=${value:1:${#value}-2}
    fi
    export "$key=$value"
  done < "$env_file"
}

oneflight_checksums() {
  if command -v sha256sum >/dev/null; then sha256sum "$@"; else shasum -a 256 "$@"; fi
}

oneflight_host_platform() {
  local oneflight_daemon_arch
  oneflight_daemon_arch=$(docker info --format '{{.Architecture}}')
  case "$oneflight_daemon_arch" in
    arm64|aarch64) printf 'linux/arm64' ;;
    amd64|x86_64) printf 'linux/amd64' ;;
    *) printf 'Unsupported Docker architecture: %s\n' "$oneflight_daemon_arch" >&2; return 1 ;;
  esac
}

oneflight_service_running() {
  local selected_service="$1" active_service
  shift
  while IFS= read -r active_service; do
    if [[ "$active_service" == "$selected_service" ]]; then return 0; fi
  done < <("$@" ps --services --status running)
  return 1
}
