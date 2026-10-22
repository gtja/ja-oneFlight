#!/bin/sh
set -eu
if [ "${ONEFLIGHT_BUNDLED_GATEWAY_ENABLED:-false}" != true ]; then
    exec curl --fail --silent --max-time 4 "http://127.0.0.1:${SERVER_PORT:-8080}/actuator/health"
fi
curl --fail --silent --max-time 2 http://127.0.0.1:8081/actuator/health >/dev/null
# Probe our own assets through the child listener without contacting the source.
origin="${FLIGHT_CONTROL_ORIGIN:?}"
case "${ONEFLIGHT_TRANSPORT_MODE:-https}" in
    http-ip)
        authority="${origin#http://}"; authority="${authority%/}"; authority="${authority%:80}"
        curl --fail --silent --max-time 2 -H "Host: $authority" "http://127.0.0.1:${ONEFLIGHT_FLIGHT_LISTEN_PORT:-8089}/__oneflight/assets/embed.css" >/dev/null
        ;;
    https)
        authority="${origin#https://}"; authority="${authority%/}"
        case "$authority" in *:*) hostname="${authority%:*}"; port="${authority##*:}" ;; *) hostname="$authority"; port=443 ;; esac
        # Local TLS probe verifies the same trusted certificate used by browsers.
        curl --fail --silent --max-time 2 --connect-to "$hostname:$port:127.0.0.1:${ONEFLIGHT_FLIGHT_LISTEN_PORT:-8089}" "$origin/__oneflight/assets/embed.css" >/dev/null
        ;;
    *) exit 1 ;;
esac
