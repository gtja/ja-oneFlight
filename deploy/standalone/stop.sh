#!/usr/bin/env bash
# Stop only this bundled service and preserve its container.
set -euo pipefail
export PATH="${PATH:-/usr/bin:/bin}:/usr/local/bin:/usr/sbin:/sbin"

readonly IMAGE='oneflight:server-amd64'
readonly CONTAINER='oneflight-server'
readonly LABEL_VALUE='server-amd64'
DOCKER_BIN=''

say() { printf '%s\n' "$*"; }

fail() { printf '未能完成：%s\n' "$*" >&2; exit 1; }

container_exists() {
    "$DOCKER_BIN" container inspect --format '{{.Id}}' "$CONTAINER" >/dev/null 2>&1
}

check_container_owner() {
    local configured_image label ports
    configured_image="$("$DOCKER_BIN" container inspect --format '{{.Config.Image}}' "$CONTAINER")" \
        || fail '无法检查现有容器。'
    label="$("$DOCKER_BIN" container inspect --format '{{index .Config.Labels "com.oneflight.bundle"}}' "$CONTAINER")" \
        || fail '无法检查现有容器的标识。'
    ports="$("$DOCKER_BIN" container inspect --format '{{range (index .HostConfig.PortBindings "8080/tcp")}}{{.HostPort}};{{end}}' "$CONTAINER")" \
        || fail '无法检查现有容器的端口。'
    [[ "$configured_image" == "$IMAGE" && "$label" == "$LABEL_VALUE" && "$ports" =~ ^[0-9]{1,5}\;$ ]] \
        || fail '同名 oneflight-server 容器不属于这个安装包，本次没有操作。'
}

container_state() {
    "$DOCKER_BIN" container inspect --format '{{.State.Status}}|{{if .State.Health}}{{.State.Health.Status}}{{else}}none{{end}}' "$CONTAINER"
}

stop_service() {
    local daemon_error state
    DOCKER_BIN="$(command -v docker 2>/dev/null)" \
        || fail '没有找到 Docker，请确认服务器已安装 Docker Engine。'
    if ! daemon_error="$("$DOCKER_BIN" info --format '{{.ServerVersion}}' 2>&1)"; then
        case "$daemon_error" in
            *'permission denied'*|*'Permission denied'*)
                fail '当前账号没有 Docker 权限，请用 sudo bash stop.sh 重试。' ;;
            *) fail '无法连接 Docker，请确认 Docker Engine 已运行；未确认服务是否停止。' ;;
        esac
    fi
    if ! container_exists; then
        say '服务尚未创建，无需停止。'
        return 0
    fi
    check_container_owner
    state="$(container_state)" || fail '无法读取服务状态。'
    case "${state%%|*}" in
        exited|created|dead) say '服务已停止，业务数据和附件已保留。'; return 0 ;;
    esac
    say '正在停止服务，请稍候……'
    "$DOCKER_BIN" container stop -t 70 "$CONTAINER" >/dev/null \
        || fail '停止服务失败，请检查 Docker 状态和权限。'
    say '服务已停止，业务数据和附件已保留。'
}

(( $# == 0 )) || fail '直接执行 bash stop.sh 即可，无需传入参数。'
stop_service
