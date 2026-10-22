#!/usr/bin/env bash
# Local regression checks only: no dotenv, services, containers, or deployment.
set -euo pipefail

ONEFLIGHT_ROOT=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)
ONEFLIGHT_CHECK_SCOPE=${1:-all}

usage() {
  printf 'Usage: scripts/check.sh [all|frontend|backend|gateway|scripts]\n'
}

if [[ $# -gt 1 ]]; then usage >&2; exit 2; fi
case "$ONEFLIGHT_CHECK_SCOPE" in
  all|frontend|backend|gateway|scripts) ;;
  --help|-h) usage; exit 0 ;;
  *) usage >&2; exit 2 ;;
esac

require_command() {
  command -v "$1" >/dev/null || {
    printf 'Missing command: %s\n' "$1" >&2
    exit 1
  }
}

require_node() {
  require_command node
  node -e 'if (Number(process.versions.node.split(".")[0]) < 24) {
    console.error("Use Node.js 24 or newer; current: " + process.version);
    process.exit(1);
  }'
}

isolate_backend_environment() {
  local oneflight_variable
  while IFS= read -r oneflight_variable; do
    case "$oneflight_variable" in
      SOURCE_*|DB_*|BOOTSTRAP_*|SPRING_*|ONEFLIGHT_*|FLIGHT_CONTROL_*|SESSION_*|MQTT_*|JAVA_TOOL_OPTIONS|_JAVA_OPTIONS|JDK_JAVA_OPTIONS|MAVEN_OPTS|MAVEN_ARGS)
        unset "$oneflight_variable"
        ;;
    esac
  done < <(compgen -e)
}

check_frontend() (
  require_node
  require_command pnpm
  cd "$ONEFLIGHT_ROOT/frontend"
  printf '\nChecking frontend tests and production build\n'
  pnpm exec vitest run --maxWorkers=2
  pnpm run build
)

check_backend() (
  require_command mvn
  cd "$ONEFLIGHT_ROOT/backend"
  printf '\nChecking backend (real-source tests disabled)\n'
  isolate_backend_environment
  SOURCE_LIVE_VERIFY=false mvn -B -ntp test
)

check_gateway() (
  require_node
  require_command npm
  cd "$ONEFLIGHT_ROOT/deploy/gateway"
  printf '\nChecking gateway tests and assets\n'
  ONEFLIGHT_GATEWAY_NGINX_TEST=0 npm test
  npm run build
)

check_scripts() (
  require_node
  require_command python3
  cd "$ONEFLIGHT_ROOT"
  printf '\nChecking shell syntax and synthetic script tests\n'
  while IFS= read -r -d '' oneflight_script; do
    bash -n "$oneflight_script"
  done < <(find scripts deploy -type d -name node_modules -prune -o -type f -name '*.sh' -print0)
  node --test scripts/*.test.mjs
  python3 -m unittest discover -s scripts -p 'test_*.py'
)

case "$ONEFLIGHT_CHECK_SCOPE" in
  frontend) check_frontend ;;
  backend) check_backend ;;
  gateway) check_gateway ;;
  scripts) check_scripts ;;
  all)
    check_frontend
    check_backend
    check_gateway
    check_scripts
    ;;
esac

printf '\nChecks passed: %s\n' "$ONEFLIGHT_CHECK_SCOPE"
