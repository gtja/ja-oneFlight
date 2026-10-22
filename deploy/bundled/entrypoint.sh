#!/bin/sh
set -eu
case "${ONEFLIGHT_BUNDLED_GATEWAY_ENABLED:-false}" in
    false) exec java -XX:MaxRAMPercentage=75.0 -jar /app/app.jar "$@" ;;
    true) ;;
    *) printf 'ONEFLIGHT_BUNDLED_GATEWAY_ENABLED must be true or false\n' >&2; exit 78 ;;
esac
# The credential only authenticates this container's proxy-to-BFF hop. It is not
# persisted or printed; startup rotates it together with in-memory Java sessions.
if [ -z "${FLIGHT_CONTROL_GATEWAY_SECRET:-}" ]; then
    FLIGHT_CONTROL_GATEWAY_SECRET="$(od -An -N32 -tx1 /dev/urandom | tr -d ' \n')"
    export FLIGHT_CONTROL_GATEWAY_SECRET
fi
# The application port is private to this container. Only Nginx publishes 8080.
export SERVER_PORT=8081
export SERVER_ADDRESS=127.0.0.1
export ONEFLIGHT_APP_UPSTREAM=127.0.0.1:8081
export ONEFLIGHT_API_UPSTREAM=127.0.0.1:8081
export ONEFLIGHT_HTTP_LISTEN_PORT=8080
export FLIGHT_HTTP_LISTEN_PORT="${ONEFLIGHT_FLIGHT_LISTEN_PORT:-8089}"
export ONEFLIGHT_HTTPS_LISTEN_PORT=8080
export FLIGHT_HTTPS_LISTEN_PORT="$FLIGHT_HTTP_LISTEN_PORT"
export ONEFLIGHT_REDIRECT_LISTEN_PORT=8082
/opt/oneflight-gateway.sh --check
java -XX:MaxRAMPercentage=75.0 -jar /app/app.jar "$@" &
java_pid=$!
nginx -p /tmp/oneflight-nginx/ -c /tmp/oneflight-nginx/nginx.conf -g 'daemon off;' &
nginx_pid=$!
stop() {
    trap '' TERM INT
    kill -TERM "$nginx_pid" "$java_pid" 2>/dev/null || true
    wait "$nginx_pid" 2>/dev/null || true
    wait "$java_pid" 2>/dev/null || true
}
trap 'stop; exit 0' TERM INT
while kill -0 "$java_pid" 2>/dev/null && kill -0 "$nginx_pid" 2>/dev/null; do
    sleep 1 &
    wait "$!" || true
done
# Either process exiting makes the whole container fail, even a clean early exit.
# Docker restart policies can then restore both components together.
stop
exit 1
