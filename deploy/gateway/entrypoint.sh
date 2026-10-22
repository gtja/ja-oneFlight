#!/bin/sh
set -eu
case "$#:${1:-}" in 0:|1:--check) ;; *) exit 64 ;; esac
fail() { printf 'Gateway configuration error: %s\n' "$1" >&2; exit 78; }
validate_host() {
    case "$1" in ''|*[!A-Za-z0-9.-]*|.*|*..*|*.) fail 'invalid hostname' ;; esac
}
validate_port() {
    case "$1" in ''|*[!0-9]*|0*) fail 'invalid port' ;; esac
    [ "${#1}" -le 5 ] && [ "$1" -le 65535 ] || fail 'invalid port'
}
validate_ipv4() {
    case "$1" in ''|*[!0-9.]*|.*|*..*|*.) fail 'HTTP compatibility requires a literal IPv4 address' ;; esac
    previous_ifs="$IFS"; IFS=.; set -- $1; IFS="$previous_ifs"
    [ "$#" -eq 4 ] || fail 'HTTP compatibility requires a literal IPv4 address'
    for octet do
        case "$octet" in ''|0[0-9]*) fail 'invalid IPv4 address' ;; esac
        [ "${#octet}" -le 3 ] && [ "$octet" -le 255 ] || fail 'invalid IPv4 address'
    done
}
validate_origin() {
    origin_value="${1%/}"
    origin_value="$(printf '%s' "$origin_value" | tr 'A-Z' 'a-z')"
    if [ "$ONEFLIGHT_TRANSPORT_MODE" = http-ip ]; then
        case "$origin_value" in http://*) authority="${origin_value#http://}" ;; *) fail 'http-ip origins must use HTTP' ;; esac
        case "$authority" in *:*) hostname="${authority%:*}"; port="${authority##*:}"; validate_port "$port" ;; *) hostname="$authority"; port=80 ;; esac
        validate_ipv4 "$hostname"
        # Canonical origins omit the default port, matching URL.origin and postMessage.
        if [ "$port" = 80 ]; then authority="$hostname"; fi
        normalized_origin="http://$authority"
    else
        case "$origin_value" in https://*) authority="${origin_value#https://}" ;; *) fail 'public origins must use HTTPS' ;; esac
        case "$authority" in *:*) hostname="${authority%:*}"; port="${authority##*:}"; validate_port "$port" ;; *) hostname="$authority"; port=443 ;; esac
        validate_host "$hostname"
        if [ "$port" = 443 ]; then authority="$hostname"; fi
        normalized_origin="https://$authority"
    fi
}
validate_upstream() {
    case "$1" in *:*) validate_host "${1%:*}"; validate_port "${1##*:}" ;; *) fail 'internal upstream must be host:port' ;; esac
}
: "${ONEFLIGHT_PUBLIC_ORIGIN:?Configure ONEFLIGHT_PUBLIC_ORIGIN}"
: "${FLIGHT_CONTROL_ORIGIN:?Configure FLIGHT_CONTROL_ORIGIN}"
: "${FLIGHT_CONTROL_GATEWAY_SECRET:?Configure FLIGHT_CONTROL_GATEWAY_SECRET}"
ONEFLIGHT_TRANSPORT_MODE="${ONEFLIGHT_TRANSPORT_MODE:-https}"
ONEFLIGHT_EMBED_VIEW="${ONEFLIGHT_EMBED_VIEW:-adapted}"
case "$ONEFLIGHT_EMBED_VIEW" in native|adapted) ;; *) fail 'invalid flight view' ;; esac
case "$ONEFLIGHT_TRANSPORT_MODE" in https|http-ip) ;; *) fail 'invalid transport mode' ;; esac
validate_origin "$ONEFLIGHT_PUBLIC_ORIGIN"
ONEFLIGHT_PUBLIC_HOST="$hostname"; ONEFLIGHT_PUBLIC_PORT="$port"; ONEFLIGHT_PUBLIC_AUTHORITY="$authority"; ONEFLIGHT_PUBLIC_ORIGIN="$normalized_origin"
validate_origin "$FLIGHT_CONTROL_ORIGIN"
FLIGHT_CONTROL_HOST="$hostname"; FLIGHT_CONTROL_PORT="$port"; FLIGHT_CONTROL_AUTHORITY="$authority"; FLIGHT_CONTROL_ORIGIN="$normalized_origin"
if [ "$ONEFLIGHT_TRANSPORT_MODE" = http-ip ]; then
    [ "$ONEFLIGHT_PUBLIC_HOST" = "$FLIGHT_CONTROL_HOST" ] || fail 'http-ip origins must use the same IPv4 address'
    [ "$ONEFLIGHT_PUBLIC_PORT" != "$FLIGHT_CONTROL_PORT" ] || fail 'http-ip origins require different ports'
else
    [ "$ONEFLIGHT_PUBLIC_HOST" != "$FLIGHT_CONTROL_HOST" ] || fail 'HTTPS parent and flight control require distinct hostnames'
fi
[ "${#FLIGHT_CONTROL_GATEWAY_SECRET}" -ge 32 ] || fail 'gateway secret must have at least 32 characters'
case "$FLIGHT_CONTROL_GATEWAY_SECRET" in *[!A-Za-z0-9_-]*) fail 'gateway secret must contain only letters, digits, underscore and hyphen' ;; esac
ONEFLIGHT_APP_UPSTREAM="${ONEFLIGHT_APP_UPSTREAM:-app:8080}"
ONEFLIGHT_API_UPSTREAM="${ONEFLIGHT_API_UPSTREAM:-app:8080}"
DUSHU_UPSTREAM_HOST="${DUSHU_UPSTREAM_HOST:-dushu.jing-an.com}"
DUSHU_UPSTREAM_PORT="${DUSHU_UPSTREAM_PORT:-32716}"
DUSHU_TARGET_HOST="${DUSHU_TARGET_HOST:-${SOURCE_TARGET_HOST:-$DUSHU_UPSTREAM_HOST:$DUSHU_UPSTREAM_PORT}}"
validate_upstream "$ONEFLIGHT_APP_UPSTREAM"
validate_upstream "$ONEFLIGHT_API_UPSTREAM"
validate_host "$DUSHU_UPSTREAM_HOST"
validate_port "$DUSHU_UPSTREAM_PORT"
validate_upstream "$DUSHU_TARGET_HOST"
# Resolve the fixed source only when a flight request is made. Source DNS failure
# must not prevent the local Java application or its gateway from starting.
# A deployment pin changes only the connect address, never Host, SNI or TLS checks.
DUSHU_UPSTREAM_PINNED_IP="${DUSHU_UPSTREAM_PINNED_IP:-}"
if [ -z "$DUSHU_UPSTREAM_PINNED_IP" ] && [ -n "${SOURCE_GATEWAY_PINNED_IP:-}" ]; then
    if [ -z "${SOURCE_GATEWAY_PINNED_HOST:-}" ] || [ "$SOURCE_GATEWAY_PINNED_HOST" = "$DUSHU_UPSTREAM_HOST" ]; then
        DUSHU_UPSTREAM_PINNED_IP="$SOURCE_GATEWAY_PINNED_IP"
    fi
fi
if [ -n "$DUSHU_UPSTREAM_PINNED_IP" ]; then
    validate_ipv4 "$DUSHU_UPSTREAM_PINNED_IP"
    DUSHU_CONNECT_TARGET="$DUSHU_UPSTREAM_PINNED_IP:$DUSHU_UPSTREAM_PORT"
else
    DUSHU_CONNECT_TARGET="$DUSHU_UPSTREAM_HOST:$DUSHU_UPSTREAM_PORT"
fi
# Container DNS is normally 127.0.0.11. Honor its actual resolv.conf instead of
# embedding a public DNS service; unsupported IPv6-only entries fail per source
# request using Docker DNS and never disable the parent application.
ONEFLIGHT_NGINX_RESOLVERS="$(awk '$1 == "nameserver" && $2 ~ /^[0-9.]+$/ { print $2; if (++count == 3) exit }' /etc/resolv.conf | tr '\n' ' ')"
[ -n "$ONEFLIGHT_NGINX_RESOLVERS" ] || ONEFLIGHT_NGINX_RESOLVERS=127.0.0.11
for resolver_address in $ONEFLIGHT_NGINX_RESOLVERS; do validate_ipv4 "$resolver_address"; done
ONEFLIGHT_HTTP_LISTEN_PORT="${ONEFLIGHT_HTTP_LISTEN_PORT:-8080}"
FLIGHT_HTTP_LISTEN_PORT="${FLIGHT_HTTP_LISTEN_PORT:-8089}"
ONEFLIGHT_HTTPS_LISTEN_PORT="${ONEFLIGHT_HTTPS_LISTEN_PORT:-443}"
FLIGHT_HTTPS_LISTEN_PORT="${FLIGHT_HTTPS_LISTEN_PORT:-443}"
ONEFLIGHT_REDIRECT_LISTEN_PORT="${ONEFLIGHT_REDIRECT_LISTEN_PORT:-80}"
for listen_port in "$ONEFLIGHT_HTTP_LISTEN_PORT" "$FLIGHT_HTTP_LISTEN_PORT" "$ONEFLIGHT_HTTPS_LISTEN_PORT" "$FLIGHT_HTTPS_LISTEN_PORT" "$ONEFLIGHT_REDIRECT_LISTEN_PORT"; do validate_port "$listen_port"; done
if [ "$ONEFLIGHT_TRANSPORT_MODE" = http-ip ]; then
    [ "$ONEFLIGHT_HTTP_LISTEN_PORT" != "$FLIGHT_HTTP_LISTEN_PORT" ] || fail 'HTTP listener ports must differ'
fi
NGINX_RUNTIME_DIR=/tmp/oneflight-nginx
mkdir -p "$NGINX_RUNTIME_DIR/public" "$NGINX_RUNTIME_DIR/logs" "$NGINX_RUNTIME_DIR/client_temp" "$NGINX_RUNTIME_DIR/proxy_temp" "$NGINX_RUNTIME_DIR/fastcgi_temp" "$NGINX_RUNTIME_DIR/uwsgi_temp" "$NGINX_RUNTIME_DIR/scgi_temp"
cp -R /usr/share/nginx/oneflight/. "$NGINX_RUNTIME_DIR/public/"
export ONEFLIGHT_TRANSPORT_MODE ONEFLIGHT_PUBLIC_ORIGIN FLIGHT_CONTROL_ORIGIN ONEFLIGHT_PUBLIC_HOST FLIGHT_CONTROL_HOST ONEFLIGHT_PUBLIC_AUTHORITY FLIGHT_CONTROL_AUTHORITY ONEFLIGHT_APP_UPSTREAM ONEFLIGHT_API_UPSTREAM DUSHU_UPSTREAM_HOST DUSHU_UPSTREAM_PORT DUSHU_TARGET_HOST DUSHU_CONNECT_TARGET ONEFLIGHT_NGINX_RESOLVERS ONEFLIGHT_HTTP_LISTEN_PORT FLIGHT_HTTP_LISTEN_PORT ONEFLIGHT_HTTPS_LISTEN_PORT FLIGHT_HTTPS_LISTEN_PORT ONEFLIGHT_REDIRECT_LISTEN_PORT NGINX_RUNTIME_DIR
variables='${ONEFLIGHT_PUBLIC_ORIGIN} ${ONEFLIGHT_PUBLIC_HOST} ${ONEFLIGHT_PUBLIC_AUTHORITY} ${FLIGHT_CONTROL_ORIGIN} ${FLIGHT_CONTROL_HOST} ${FLIGHT_CONTROL_AUTHORITY} ${FLIGHT_CONTROL_GATEWAY_SECRET} ${ONEFLIGHT_APP_UPSTREAM} ${ONEFLIGHT_API_UPSTREAM} ${DUSHU_UPSTREAM_HOST} ${DUSHU_UPSTREAM_PORT} ${DUSHU_TARGET_HOST} ${DUSHU_CONNECT_TARGET} ${ONEFLIGHT_HTTP_LISTEN_PORT} ${FLIGHT_HTTP_LISTEN_PORT} ${ONEFLIGHT_HTTPS_LISTEN_PORT} ${FLIGHT_HTTPS_LISTEN_PORT} ${ONEFLIGHT_REDIRECT_LISTEN_PORT} ${NGINX_RUNTIME_DIR}'
template=gateway.conf.template
[ "$ONEFLIGHT_TRANSPORT_MODE" != http-ip ] || template=gateway-http.conf.template
for pair in "$template:gateway.conf" entry-maps.conf.template:entry-maps.conf bff.conf.template:oneflight-bff.conf app-locations.conf.template:app-locations.conf flight-locations.conf.template:flight-locations.conf; do
    envsubst "$variables" < "/etc/nginx/oneflight/${pair%:*}" > "$NGINX_RUNTIME_DIR/${pair#*:}"
done
chmod 0600 "$NGINX_RUNTIME_DIR/"*.conf
printf 'window.__ONEFLIGHT_EMBED_CONFIG__={"parentOrigin":"%s","transportMode":"%s","view":"%s"};\n' "$ONEFLIGHT_PUBLIC_ORIGIN" "$ONEFLIGHT_TRANSPORT_MODE" "$ONEFLIGHT_EMBED_VIEW" > "$NGINX_RUNTIME_DIR/public/config.js"
cat > "$NGINX_RUNTIME_DIR/nginx.conf" <<EOF
worker_processes auto;
pid $NGINX_RUNTIME_DIR/nginx.pid;
error_log /dev/null;
events { worker_connections 1024; }
http {
    include /etc/nginx/mime.types;
    default_type application/octet-stream;
    sendfile on;
    resolver $ONEFLIGHT_NGINX_RESOLVERS valid=30s ipv6=off;
    resolver_timeout 2s;
    client_body_temp_path $NGINX_RUNTIME_DIR/client_temp;
    proxy_temp_path $NGINX_RUNTIME_DIR/proxy_temp;
    fastcgi_temp_path $NGINX_RUNTIME_DIR/fastcgi_temp;
    uwsgi_temp_path $NGINX_RUNTIME_DIR/uwsgi_temp;
    scgi_temp_path $NGINX_RUNTIME_DIR/scgi_temp;
    include $NGINX_RUNTIME_DIR/gateway.conf;
}
EOF
nginx -p "$NGINX_RUNTIME_DIR/" -c "$NGINX_RUNTIME_DIR/nginx.conf" -t
[ "${1:-}" != --check ] || exit 0
exec nginx -p "$NGINX_RUNTIME_DIR/" -c "$NGINX_RUNTIME_DIR/nginx.conf" -g 'daemon off;'
