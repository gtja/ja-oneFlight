#!/bin/sh
set -eu

if [ "$#" -ne 0 ]; then
    printf '此镜像直接启动 OneFlight，无需传入启动参数。\n' >&2
    exit 64
fi

configuration_error() {
    printf '启动配置错误：%s\n' "$1" >&2
    exit 78
}

valid_ipv4() (
    case "$1" in ''|*[!0-9.]*|.*|*.) return 1 ;; esac
    set -f
    IFS=.
    set -- $1
    [ "$#" -eq 4 ] || return 1
    for octet do
        case "$octet" in ''|*[!0-9]*|0[0-9]*) return 1 ;; esac
        [ "${#octet}" -le 3 ] && [ "$octet" -le 255 ] || return 1
    done
)

valid_hostname() (
    [ "${#1}" -le 253 ] || return 1
    case "$1" in ''|*[!A-Za-z0-9.-]*|.*|*.) return 1 ;; esac
    set -f
    IFS=.
    set -- $1
    for label do
        case "$label" in ''|-*|*-) return 1 ;; esac
        [ "${#label}" -le 63 ] || return 1
    done
)

# Flyway and application writes must stay in the dedicated business schema.
# Source integrations use their separate, read-only SOURCE_* connections.
: "${DB_URL:?缺少 DB_URL，必须配置 oneflight 业务数据库地址}"
case "${DB_URL:-}" in
    *[[:space:]]*|*'#'*) configuration_error '业务数据库地址不能包含空白或片段标记。' ;;
esac
case "$DB_URL" in
    jdbc:mysql://*) ;;
    *) configuration_error '业务数据库必须使用 MySQL，不能使用本地回退数据库。' ;;
esac
db_location="${DB_URL#jdbc:mysql://}"
db_authority="${db_location%%/*}"
[ "$db_authority" != "$db_location" ] \
    || configuration_error '业务数据库地址必须指定 oneflight 库。'
db_resource="${db_location#*/}"
case "$db_resource" in
    oneflight|oneflight\?*) ;;
    *) configuration_error '仅允许 oneflight 独立业务库，不能写入来源库。' ;;
esac
case "$db_authority" in
    *:*) db_hostname="${db_authority%:*}"; db_port="${db_authority##*:}" ;;
    *) configuration_error '业务数据库地址必须指定主机和端口。' ;;
esac
case "$db_hostname" in
    *[!0-9.]*) valid_hostname "$db_hostname" \
        || configuration_error '业务数据库主机名格式无效。' ;;
    *) valid_ipv4 "$db_hostname" \
        || configuration_error '业务数据库 IPv4 地址格式无效。' ;;
esac
case "$db_port" in
    ''|*[!0-9]*|0*) configuration_error '业务数据库端口必须为 1 至 65535。' ;;
esac
[ "${#db_port}" -le 5 ] && [ "$db_port" -le 65535 ] \
    || configuration_error '业务数据库端口必须为 1 至 65535。'
unset db_location db_authority db_resource db_hostname db_port
: "${DB_USERNAME:?缺少业务数据库账号}"
: "${DB_PASSWORD:?缺少业务数据库密码}"

# Prevent inherited Spring/JVM overrides from redirecting the writable store.
unset SPRING_APPLICATION_JSON SPRING_CONFIG_LOCATION SPRING_CONFIG_ADDITIONAL_LOCATION \
    SPRING_CONFIG_IMPORT JAVA_TOOL_OPTIONS JDK_JAVA_OPTIONS _JAVA_OPTIONS
export SPRING_DATASOURCE_URL="$DB_URL"
export SPRING_DATASOURCE_USERNAME="$DB_USERNAME"
export SPRING_DATASOURCE_PASSWORD="$DB_PASSWORD"
export SPRING_DATASOURCE_HIKARI_JDBC_URL="$DB_URL"
export SPRING_DATASOURCE_HIKARI_USERNAME="$DB_USERNAME"
export SPRING_DATASOURCE_HIKARI_PASSWORD="$DB_PASSWORD"
export SPRING_FLYWAY_URL="$DB_URL"
export SPRING_FLYWAY_USER="$DB_USERNAME"
export SPRING_FLYWAY_PASSWORD="$DB_PASSWORD"
export SPRING_FLYWAY_DEFAULT_SCHEMA=oneflight
export SPRING_FLYWAY_SCHEMAS=oneflight
export SPRING_FLYWAY_CREATE_SCHEMAS=false
export SPRING_FLYWAY_ENABLED=true
export SPRING_JPA_HIBERNATE_DDL_AUTO=validate
export SERVER_PORT=8080
export UPLOAD_DIRECTORY=/app/uploads
export ONEFLIGHT_UPLOAD_DIRECTORY=/app/uploads

# Optional HTTPS routing keeps the hostname for certificate verification.
gateway_hostname="${SOURCE_GATEWAY_PINNED_HOST:-}"
gateway_address="${SOURCE_GATEWAY_PINNED_IP:-}"
if [ -n "$gateway_hostname" ] || [ -n "$gateway_address" ]; then
    [ -n "$gateway_hostname" ] && [ -n "$gateway_address" ] \
        || configuration_error '网关固定域名和 IP 必须同时配置，或同时留空。'
    valid_hostname "$gateway_hostname" \
        || configuration_error '网关固定域名格式无效。'
    valid_ipv4 "$gateway_address" \
        || configuration_error '网关固定 IP 必须为有效 IPv4 地址。'
    hosts_without_gateway="$(awk -v hostname="$gateway_hostname" '
        { for (i = 2; i <= NF; i++) if ($i == hostname) next; print }
    ' /etc/hosts)"
    printf '%s\n%s\t%s\n' "$hosts_without_gateway" "$gateway_address" "$gateway_hostname" > /etc/hosts
    unset hosts_without_gateway
fi
unset gateway_hostname gateway_address

printf '[OneFlight] 正在启动应用。\n'
# The runtime handles Java alone or the bundled proxy and forwards Docker TERM to both.
exec su-exec 10001:10001 /opt/oneflight/bundled-entrypoint.sh
