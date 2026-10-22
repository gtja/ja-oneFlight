#!/usr/bin/env bash
# Place beside oneflight-image.tar.gz, then run: bash start.sh
set -euo pipefail
export PATH="${PATH:-/usr/bin:/bin}:/usr/local/bin:/usr/sbin:/sbin"

# 连接配置集中在此处；修改后重新执行 bash start.sh 即可应用。
__RUNTIME_SETTINGS__

readonly EXPECTED_SHA256='__ARCHIVE_SHA256__'
readonly EXPECTED_RELEASE_ID='__RELEASE_ID__'
readonly IMAGE='oneflight:server-amd64'
readonly CONTAINER='oneflight-server'
readonly LABEL_KEY='com.oneflight.bundle'
readonly LABEL_VALUE='server-amd64'
readonly ARCHIVE_NAME='oneflight-image.tar.gz'
SCRIPT_DIRECTORY="$(cd -- "$(dirname "${BASH_SOURCE[0]}")" && pwd -P)"
readonly SCRIPT_DIRECTORY
DOCKER_BIN=''
BACKUP_CONTAINER=''
NEW_CONTAINER_CREATED=false
CONFIG_HASH=''
RUNTIME_DOCKER_ARGS=()
GATEWAY_DOCKER_ARGS=()
GATEWAY_ENABLED=false
BUNDLED_GATEWAY_ENABLED=false
EXTRA_PUBLISH_ARGS=()
PUBLISH_ADDRESS=8088:8080

say() { printf '%s\n' "$*"; }

fail() {
    printf '未能完成：%s\n' "$*" >&2
    if [[ -n "$BACKUP_CONTAINER" ]]; then
        printf '旧服务已保留为 %s，原有数据未删除。\n' "$BACKUP_CONTAINER" >&2
    fi
    exit 1
}

valid_server_ipv4() {
    local octet
    local -a parts
    [[ "$1" =~ ^[0-9]+\.[0-9]+\.[0-9]+\.[0-9]+$ ]] || return 1
    IFS=. read -r -a parts <<< "$1"
    for octet in "${parts[@]}"; do
        [[ "$octet" =~ ^(0|[1-9][0-9]{0,2})$ ]] && (( 10#$octet <= 255 )) || return 1
    done
}

validate_runtime_settings() {
    local declaration key value seen='|' hash_output gateway_secret
    declaration="$(declare -p RUNTIME_KEYS 2>/dev/null)" \
        || fail '启动脚本缺少运行配置，请使用正式安装包中的 start.sh。'
    [[ "$declaration" == 'declare -a'* && ${#RUNTIME_KEYS[@]} -gt 0 ]] \
        || fail 'RUNTIME_KEYS 必须是非空配置项数组。'
    for key in "${RUNTIME_KEYS[@]}"; do
        [[ "$key" =~ ^[A-Z][A-Z0-9_]*$ ]] || fail '运行配置包含无效的变量名。'
        case "$seen" in *"|$key|"*) fail "配置项 ${key} 重复。" ;; esac
        seen="$seen$key|"
        declare -p "$key" >/dev/null 2>&1 || fail "缺少配置项 ${key}。"
        value="${!key}"
        [[ "$value" != *$'\n'* && "$value" != *$'\r'* ]] \
            || fail "配置项 ${key} 不能包含换行。"
        export "$key"
        RUNTIME_DOCKER_ARGS+=(--env "$key")
    done
    GATEWAY_ENABLED="${ONEFLIGHT_GATEWAY_ENABLED:-false}"
    BUNDLED_GATEWAY_ENABLED="${ONEFLIGHT_BUNDLED_GATEWAY_ENABLED:-false}"
    WEB_PORT="${WEB_PORT:-8088}"
    FLIGHT_CONTROL_HTTP_PORT="${FLIGHT_CONTROL_HTTP_PORT:-8089}"
    for key in WEB_PORT FLIGHT_CONTROL_HTTP_PORT; do
        value="${!key}"
        [[ "$value" =~ ^[1-9][0-9]{0,4}$ ]] && (( 10#$value <= 65535 )) \
            || fail "配置项 ${key} 必须为 1 至 65535 的端口。"
    done
    PUBLISH_ADDRESS="$WEB_PORT:8080"
    case "$BUNDLED_GATEWAY_ENABLED" in
        false) ;;
        true)
            [[ "$GATEWAY_ENABLED" == false ]] || fail '内置代理与外部网关不能同时启用。'
            [[ "${ONEFLIGHT_TRANSPORT_MODE:-https}" == http-ip ]] \
                || fail '单镜像内置代理请使用 http-ip 兼容模式；HTTPS 可继续使用外部网关。'
            [[ "$WEB_PORT" != "$FLIGHT_CONTROL_HTTP_PORT" ]] || fail '平台与飞控不能使用同一个端口。'
            valid_server_ipv4 "$SERVER_IP" || fail 'SERVER_IP 必须填写有效的 IPv4 地址。'
            valid_server_ipv4 "${PUBLIC_IP:-}" || fail 'PUBLIC_IP 必须填写浏览器可访问的 IPv4 地址。'
            [[ "${ONEFLIGHT_PUBLIC_ORIGIN:-}" == "http://${PUBLIC_IP}:${WEB_PORT}" \
                && "${FLIGHT_CONTROL_ORIGIN:-}" == "http://${PUBLIC_IP}:${FLIGHT_CONTROL_HTTP_PORT}" ]] \
                || fail '兼容模式地址必须与 PUBLIC_IP 及平台、飞控端口一致。'
            [[ "${SESSION_COOKIE_SECURE:-false}" == false ]] || fail 'HTTP 兼容模式不能设置 Secure Cookie。'
            gateway_secret="${FLIGHT_CONTROL_GATEWAY_SECRET:-}"
            [[ "${#gateway_secret}" -ge 32 && "$gateway_secret" =~ ^[A-Za-z0-9_-]+$ ]] \
                || fail '内置代理密钥缺失或格式错误，请重新打包。'
            EXTRA_PUBLISH_ARGS=(--publish "$FLIGHT_CONTROL_HTTP_PORT:8089")
            ;;
        *) fail 'ONEFLIGHT_BUNDLED_GATEWAY_ENABLED 必须为 true 或 false。' ;;
    esac
    case "$GATEWAY_ENABLED" in
        false) ;;
        true)
            [[ "${ONEFLIGHT_PUBLIC_ORIGIN:-}" == https://* && "${FLIGHT_CONTROL_ORIGIN:-}" == https://* ]] \
                || fail '网关模式必须配置平台和飞控独立 HTTPS 地址。'
            [[ -n "${FLIGHT_CONTROL_GATEWAY_SECRET:-}" ]] || fail '网关模式缺少启动票据通道密钥。'
            PUBLISH_ADDRESS="127.0.0.1:$WEB_PORT:8080"
            GATEWAY_DOCKER_ARGS=(--network oneflight-gateway)
            ;;
        *) fail 'ONEFLIGHT_GATEWAY_ENABLED 必须为 true 或 false。' ;;
    esac
    for key in DB_URL DB_USERNAME DB_PASSWORD; do
        case "$seen" in *"|$key|"*) ;; *) fail "运行配置缺少 ${key}。" ;; esac
        [[ -n "${!key}" ]] || fail "配置项 ${key} 不能为空。"
    done
    for key in DB_DATABASE MYSQL_HOST MYSQL_PORT GATEWAY_HOST GATEWAY_PORT MQTT_HOST MQTT_PORT ALGORITHM_HOST ALGORITHM_PORT; do
        declare -p "$key" >/dev/null 2>&1 || fail "缺少连接配置 ${key}。"
        value="${!key}"
        [[ -n "$value" && "$value" != *$'\n'* && "$value" != *$'\r'* ]] \
            || fail "连接配置 ${key} 不能为空或包含换行。"
    done
    [[ "$DB_DATABASE" == oneflight ]] || fail '业务数据库必须使用独立的 oneflight 库。'
    case "$DB_URL" in
        "jdbc:mysql://$MYSQL_HOST:$MYSQL_PORT/oneflight"|"jdbc:mysql://$MYSQL_HOST:$MYSQL_PORT/oneflight?"*) ;;
        *) fail 'DB_URL 与业务数据库连接配置不一致。' ;;
    esac
    for key in MYSQL_PORT GATEWAY_PORT MQTT_PORT ALGORITHM_PORT; do
        value="${!key}"
        [[ "$value" =~ ^[0-9]{1,5}$ ]] || fail "连接配置 ${key} 必须是有效端口。"
        (( 10#$value >= 1 && 10#$value <= 65535 )) || fail "连接配置 ${key} 必须在 1 至 65535 之间。"
    done
    if command -v sha256sum >/dev/null 2>&1; then
        hash_output="$(for key in "${RUNTIME_KEYS[@]}"; do printf '%s\0%s\0' "$key" "${!key}"; done | sha256sum)" \
            || fail '无法计算运行配置摘要。'
    elif command -v shasum >/dev/null 2>&1; then
        hash_output="$(for key in "${RUNTIME_KEYS[@]}"; do printf '%s\0%s\0' "$key" "${!key}"; done | shasum -a 256)" \
            || fail '无法计算运行配置摘要。'
    else
        fail '系统缺少 sha256sum 或 shasum，请安装 SHA-256 校验工具后重试。'
    fi
    CONFIG_HASH="${hash_output%% *}"
    [[ "$CONFIG_HASH" =~ ^[0-9a-f]{64}$ ]] || fail '无法计算运行配置摘要。'
}

require_docker() {
    local server
    DOCKER_BIN="$(command -v docker 2>/dev/null)" \
        || fail '没有找到 Docker，请先安装 Docker Engine。'
    if ! server="$("$DOCKER_BIN" info --format '{{.OSType}}|{{.Architecture}}' 2>&1)"; then
        case "$server" in
            *'permission denied'*|*'Permission denied'*)
                fail '当前账号没有 Docker 权限，请用 sudo bash start.sh 重试。' ;;
            *) fail '无法连接 Docker，请确认 Docker Engine 已运行；权限不足时请使用 sudo。' ;;
        esac
    fi
    case "$server" in
        'linux|amd64'|'linux|x86_64') ;;
        *) fail '这个安装包仅支持 Linux x86_64 / AMD64 Docker 服务器，当前架构不匹配。' ;;
    esac
}

container_exists() {
    "$DOCKER_BIN" container inspect --format '{{.Id}}' "$CONTAINER" >/dev/null 2>&1
}

check_container_owner() {
    local name="${1:-$CONTAINER}" configured_image label ports
    configured_image="$("$DOCKER_BIN" container inspect --format '{{.Config.Image}}' "$name")" \
        || fail '无法检查现有容器。'
    label="$("$DOCKER_BIN" container inspect --format '{{index .Config.Labels "com.oneflight.bundle"}}' "$name")" \
        || fail '无法检查现有容器的标识。'
    ports="$("$DOCKER_BIN" container inspect --format '{{range (index .HostConfig.PortBindings "8080/tcp")}}{{.HostPort}};{{end}}' "$name")" \
        || fail '无法检查现有容器的端口。'
    [[ "$configured_image" == "$IMAGE" && "$label" == "$LABEL_VALUE" && "$ports" =~ ^[0-9]{1,5}\;$ ]] \
        || fail "现有 ${name} 容器不属于这个安装包，本次没有操作。"
}

container_release() {
    "$DOCKER_BIN" container inspect --format '{{index .Config.Labels "com.oneflight.release-id"}}' "$CONTAINER"
}

preserve_previous_container() {
    local current_release current_config_hash state backup_candidate suffix=0
    current_release="$(container_release)" || fail '无法检查现有容器的镜像版本。'
    current_config_hash="$("$DOCKER_BIN" container inspect --format '{{index .Config.Labels "com.oneflight.config-sha256"}}' "$CONTAINER")" \
        || fail '无法检查现有服务的配置摘要。'
    [[ "$current_release" != "$EXPECTED_RELEASE_ID" || "$current_config_hash" != "$CONFIG_HASH" ]] || return 0
    state="$(container_state)" || fail '无法读取旧服务状态。'
    say '检测到版本或配置变化，正在保留旧容器并更新服务……'
    case "${state%%|*}" in
        exited|created|dead) ;;
        *) "$DOCKER_BIN" container stop -t 70 "$CONTAINER" >/dev/null \
            || fail '无法停止旧服务，旧容器已保留。' ;;
    esac
    backup_candidate="$CONTAINER-backup-$(date +%Y%m%d%H%M%S)"
    while "$DOCKER_BIN" container inspect "$backup_candidate" >/dev/null 2>&1; do
        suffix=$((suffix + 1))
        backup_candidate="$CONTAINER-backup-$(date +%Y%m%d%H%M%S)-$suffix"
    done
    "$DOCKER_BIN" container rename "$CONTAINER" "$backup_candidate" \
        || fail '无法保留旧容器，旧服务已停止，请检查 Docker 状态。'
    BACKUP_CONTAINER="$backup_candidate"
}

find_previous_container() {
    local rows name
    [[ -z "$BACKUP_CONTAINER" ]] || return 0
    rows="$("$DOCKER_BIN" ps -a --filter "name=^/${CONTAINER}-backup-" \
        --filter "label=$LABEL_KEY=$LABEL_VALUE" --format '{{.Names}}')" \
        || fail '无法检查先前保留的服务容器。'
    while IFS= read -r name; do
        [[ "$name" =~ ^oneflight-server-backup-[0-9]{14}(-[0-9]+)?$ ]] || continue
        if [[ -z "$BACKUP_CONTAINER" || "$name" > "$BACKUP_CONTAINER" ]]; then
            BACKUP_CONTAINER="$name"
        fi
    done <<< "$rows"
    [[ -z "$BACKUP_CONTAINER" ]] || check_container_owner "$BACKUP_CONTAINER"
}

uploads_migration_failed() {
    if [[ "$NEW_CONTAINER_CREATED" == true ]]; then
        if ! "$DOCKER_BIN" container rm "$CONTAINER" >/dev/null; then
            fail '附件迁移失败，未启动新服务；无法清理未启动的新容器。修复 Docker 后重新执行 bash start.sh 会重试迁移。'
        fi
        if "$DOCKER_BIN" container rename "$BACKUP_CONTAINER" "$CONTAINER"; then
            BACKUP_CONTAINER=''
            fail '附件迁移失败，旧容器已恢复为 oneflight-server 并保持停止，旧数据已保留。修复后重新执行 bash start.sh 会重试迁移。'
        fi
        fail '附件迁移失败，新服务未启动；恢复旧容器名称失败。修复 Docker 后重新执行 bash start.sh 会重试迁移。'
    fi
    fail '附件迁移失败，新服务尚未启动。旧容器和附件已保留，修复后重新执行 bash start.sh 会重试迁移。'
}

migrate_previous_uploads() {
    local state previous_container
    state="$(container_state)" || fail '无法读取服务状态。'
    [[ "${state%%|*}" == created ]] || return 0
    previous_container="$("$DOCKER_BIN" container inspect --format '{{index .Config.Labels "com.oneflight.previous-container"}}' "$CONTAINER")" \
        || fail '无法读取附件迁移来源，未启动新服务。'
    case "$previous_container" in
        ''|'<no value>') return 0 ;;
        oneflight-server-backup-*) BACKUP_CONTAINER="$previous_container" ;;
        *) fail '附件迁移来源无效，未启动新服务。' ;;
    esac
    check_container_owner "$BACKUP_CONTAINER"
    say '正在迁移现有附件，请稍候……'
    if ! "$DOCKER_BIN" cp "$BACKUP_CONTAINER:/app/uploads/." - \
        | "$DOCKER_BIN" cp -a - "$CONTAINER:/app/uploads"; then
        uploads_migration_failed
    fi
}

container_state() {
    "$DOCKER_BIN" container inspect --format '{{.State.Status}}|{{if .State.Health}}{{.State.Health.Status}}{{else}}none{{end}}' "$CONTAINER"
}

verify_archive() {
    local archive="$SCRIPT_DIRECTORY/$ARCHIVE_NAME" output actual_hash
    [[ -r "$archive" ]] || fail "同目录缺少 ${ARCHIVE_NAME}，请将镜像包和 start.sh 放在同一个目录。"
    say '正在校验镜像文件……'
    if command -v sha256sum >/dev/null 2>&1; then
        output="$(sha256sum "$archive")" || fail '无法读取镜像文件。'
    elif command -v shasum >/dev/null 2>&1; then
        output="$(shasum -a 256 "$archive")" || fail '无法读取镜像文件。'
    else
        fail '系统缺少 sha256sum 或 shasum，请安装 SHA-256 校验工具后重试。'
    fi
    actual_hash="${output%% *}"
    [[ "$actual_hash" == "$EXPECTED_SHA256" ]] \
        || fail '镜像文件校验失败，请重新上传完整镜像包。'
}

check_image() {
    local image_info
    image_info="$("$DOCKER_BIN" image inspect --format '{{index .Config.Labels "com.oneflight.release-id"}}|{{.Os}}|{{.Architecture}}' "$IMAGE" 2>/dev/null)" \
        || return 1
    case "$image_info" in
        *'|linux|amd64') ;;
        *) return 1 ;;
    esac
    [[ "$image_info" == "$EXPECTED_RELEASE_ID|linux|amd64" ]]
}

ensure_image() {
    if check_image; then
        return 0
    fi
    verify_archive
    say '正在导入 Linux AMD64 镜像，请稍候……'
    "$DOCKER_BIN" load --input "$SCRIPT_DIRECTORY/$ARCHIVE_NAME" >/dev/null 2>&1 \
        || fail '镜像导入失败，请检查 Docker 状态和服务器磁盘空间。'
    check_image || fail '导入后的镜像版本或架构不匹配，请重新获取完整安装包。'
    say '镜像导入完成。'
}

check_port_available() {
    local rows row name port
    local -a ports=("$WEB_PORT")
    if [[ "$BUNDLED_GATEWAY_ENABLED" == true ]]; then ports+=("$FLIGHT_CONTROL_HTTP_PORT"); fi
    rows="$("$DOCKER_BIN" ps --format '{{.Names}}|{{.Ports}}')" \
        || fail '无法检查端口占用。'
    for port in "${ports[@]}"; do
      while IFS= read -r row; do
        case "$row" in
            *":${port}->"*)
                name="${row%%|*}"
                [[ "$name" == "$CONTAINER" ]] \
                    || fail "端口 ${port} 已被容器 $name 占用，请自行调整占用服务后重试。"
                ;;
        esac
      done <<< "$rows"
      if command -v lsof >/dev/null 2>&1 \
          && lsof -nP -iTCP:"$port" -sTCP:LISTEN -t >/dev/null 2>&1; then
          fail "端口 ${port} 已被其他程序占用，请自行调整占用服务后重试。"
      fi
    done
}

startup_diagnostics() {
    say '启动诊断：' >&2
    "$DOCKER_BIN" container inspect --format '状态={{.State.Status}} 健康={{if .State.Health}}{{.State.Health.Status}}{{else}}none{{end}} RestartCount={{.RestartCount}} ExitCode={{.State.ExitCode}} OOMKilled={{.State.OOMKilled}}' "$CONTAINER" >&2 \
        || say '暂时无法读取容器状态。' >&2
    say '最近 80 行服务日志：' >&2
    "$DOCKER_BIN" logs --tail 80 "$CONTAINER" >&2 \
        || say '暂时无法读取容器日志。' >&2
}

startup_failed() {
    startup_diagnostics
    fail "$1"
}

wait_until_healthy() {
    local deadline=$((SECONDS + 360)) next_update=$((SECONDS + 15))
    local snapshot state restart_count initial_restart_count=''
    say '正在启动服务并连接数据库，请稍候……'
    while (( SECONDS < deadline )); do
        snapshot="$("$DOCKER_BIN" container inspect --format '{{.State.Status}}|{{if .State.Health}}{{.State.Health.Status}}{{else}}none{{end}}|{{.RestartCount}}' "$CONTAINER")" \
            || startup_failed '无法读取服务状态。'
        state="${snapshot%|*}"
        restart_count="${snapshot##*|}"
        [[ "$state" != 'running|healthy' ]] || return 0
        [[ "$restart_count" =~ ^[0-9]+$ ]] \
            || startup_failed '无法读取容器重启次数。'
        if [[ -z "$initial_restart_count" ]]; then
            initial_restart_count="$restart_count"
        fi
        if [[ "${state%%|*}" == restarting ]] \
            || (( restart_count > initial_restart_count )); then
            startup_failed '容器启动失败并发生重启，已停止等待，请根据上方日志排查。'
        fi
        case "$state" in
            'running|starting'|'created|'*) ;;
            'running|unhealthy') startup_failed '服务健康检查失败。' ;;
            'running|none') startup_failed '镜像缺少健康检查，请重新获取完整安装包。' ;;
            *) startup_failed '服务启动后已退出。' ;;
        esac
        if (( SECONDS >= next_update )); then
            say "服务仍在准备中（状态：${state%%|*}，健康：${state#*|}），请稍候……"
            next_update=$((SECONDS + 15))
        fi
        sleep 2
    done
    startup_failed '等待服务就绪超过 6 分钟。'
}

start_service() {
    local state start_error
    validate_runtime_settings
    require_docker
    if [[ "$GATEWAY_ENABLED" == true ]]; then
        if ! "$DOCKER_BIN" network inspect oneflight-gateway >/dev/null 2>&1; then
            "$DOCKER_BIN" network create --label com.oneflight.gateway=true oneflight-gateway >/dev/null \
                || fail '无法创建 HTTPS 网关网络。'
        fi
        [[ "$("$DOCKER_BIN" network inspect --format '{{index .Labels "com.oneflight.gateway"}}' oneflight-gateway)" == true ]] \
            || fail '同名网络未标记为一网统飞网关网络，请检查后重试。'
    fi
    [[ "$EXPECTED_SHA256" =~ ^[0-9a-f]{64}$ && "$EXPECTED_RELEASE_ID" =~ ^[0-9a-f]{64}$ ]] \
        || fail '启动脚本尚未完成打包，请使用正式安装包中的 start.sh。'
    if container_exists; then
        check_container_owner
    fi
    ensure_image
    if container_exists; then
        preserve_previous_container
    fi
    if ! container_exists; then
        find_previous_container
        check_port_available
        say '正在创建服务……'
        "$DOCKER_BIN" container create --pull=never --platform linux/amd64 \
            --name "$CONTAINER" --label "$LABEL_KEY=$LABEL_VALUE" \
            --label "com.oneflight.previous-container=$BACKUP_CONTAINER" \
            --label "com.oneflight.config-sha256=$CONFIG_HASH" \
            --restart unless-stopped --stop-timeout 70 --publish "$PUBLISH_ADDRESS" \
            ${EXTRA_PUBLISH_ARGS[@]+"${EXTRA_PUBLISH_ARGS[@]}"} \
            ${GATEWAY_DOCKER_ARGS[@]+"${GATEWAY_DOCKER_ARGS[@]}"} \
            "${RUNTIME_DOCKER_ARGS[@]}" "$IMAGE" >/dev/null \
            || fail '创建服务失败，请检查 Docker 状态和服务器磁盘空间。'
        NEW_CONTAINER_CREATED=true
    fi
    migrate_previous_uploads
    state="$(container_state)" || fail '无法读取服务状态。'
    case "${state%%|*}" in
        running|restarting) ;;
        *)
            check_port_available
            if ! start_error="$("$DOCKER_BIN" container start "$CONTAINER" 2>&1)"; then
                case "$start_error" in
                    *'port is already allocated'*|*'address already in use'*|*'Ports are not available'*|*'failed to bind'*)
                        startup_failed '平台或飞控端口已被其他程序占用，请自行调整占用服务后重试。' ;;
                    *) startup_failed '服务启动失败，请根据上方日志排查。' ;;
                esac
            fi
            ;;
    esac
    wait_until_healthy
    if [[ "$BUNDLED_GATEWAY_ENABLED" == true ]]; then
        say "服务已启动，访问 ${ONEFLIGHT_PUBLIC_ORIGIN}；飞控入口已包含在同一个镜像中。"
    elif [[ "$GATEWAY_ENABLED" == true ]]; then
        say "应用已启动；启动独立 HTTPS 网关后访问 ${ONEFLIGHT_PUBLIC_ORIGIN}。"
    else
        say "服务已启动，请在浏览器访问 http://服务器IP:${WEB_PORT}。"
    fi
    [[ -z "$BACKUP_CONTAINER" ]] || say "旧容器已保留：${BACKUP_CONTAINER}。"
}

(( $# == 0 )) || fail '直接执行 bash start.sh 即可，无需传入参数。'
start_service
