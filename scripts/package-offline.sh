#!/usr/bin/env bash
set -euo pipefail
ROOT=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)
source "$ROOT/scripts/lib/env.sh"
VERSION=${1:-1.0.0}
[[ "$VERSION" =~ ^[a-zA-Z0-9][a-zA-Z0-9._-]*$ ]] || { printf 'Invalid image version.\n' >&2; exit 1; }
FINAL_DIR="$ROOT/artifacts/oneflight-${VERSION}-linux-amd64"
mkdir -p "$ROOT/artifacts"
STAGING_ROOT=$(mktemp -d "$ROOT/artifacts/.oneflight-package.XXXXXX")
SAVED_COUNT=0
RESTORE_REQUIRED=0
SAVED_TAGS=()
SAVED_IDS=()
SAVED_PLATFORMS=()
SAVED_BACKUPS=()
restore_runtime_tags() {
  local failed=0 i actual
  [[ "$RESTORE_REQUIRED" = 1 ]] || return 0
  for ((i=0; i<SAVED_COUNT; i++)); do
    if ! docker image tag "${SAVED_BACKUPS[$i]}" "${SAVED_TAGS[$i]}"; then
      printf 'Cannot restore runtime image tag %s; preserved as %s.\n' "${SAVED_TAGS[$i]}" "${SAVED_BACKUPS[$i]}" >&2
      failed=1
      continue
    fi
    actual=$(docker image inspect "${SAVED_TAGS[$i]}" --format '{{.Id}} {{.Os}}/{{.Architecture}}') || { failed=1; continue; }
    if [[ "$actual" != "${SAVED_IDS[$i]} ${SAVED_PLATFORMS[$i]}" ]]; then
      printf 'Runtime image tag verification failed for %s; backup retained.\n' "${SAVED_TAGS[$i]}" >&2
      failed=1
    fi
  done
  if [[ "$failed" = 0 ]]; then
    RESTORE_REQUIRED=0
    for ((i=0; i<SAVED_COUNT; i++)); do
      docker image rm --no-prune "${SAVED_BACKUPS[$i]}" >/dev/null || \
        printf 'Runtime tag restored; optional backup tag remains: %s\n' "${SAVED_BACKUPS[$i]}" >&2
    done
  fi
  return "$failed"
}
cleanup() {
  local result=$?
  trap - EXIT
  if ! restore_runtime_tags; then result=1; fi
  rm -rf "$STAGING_ROOT"
  exit "$result"
}
trap cleanup EXIT
preserve_runtime_tag() {
  local tag=$1 label=$2 id platform backup
  if ! id=$(docker image inspect "$tag" --format '{{.Id}}' 2>/dev/null); then return 0; fi
  platform=$(docker image inspect "$tag" --format '{{.Os}}/{{.Architecture}}')
  backup="oneflight-package-preserve:${label}-${VERSION}-$$"
  docker image tag "$tag" "$backup"
  SAVED_TAGS[$SAVED_COUNT]=$tag
  SAVED_IDS[$SAVED_COUNT]=$id
  SAVED_PLATFORMS[$SAVED_COUNT]=$platform
  SAVED_BACKUPS[$SAVED_COUNT]=$backup
  SAVED_COUNT=$((SAVED_COUNT + 1))
  RESTORE_REQUIRED=1
}
DEST="$STAGING_ROOT/oneflight-${VERSION}-linux-amd64"
mkdir -p "$DEST/scripts/lib" "$DEST/docs"
docker info >/dev/null
preserve_runtime_tag "oneflight-api:$VERSION" api
preserve_runtime_tag "oneflight-web:$VERSION" web
preserve_runtime_tag mysql:8.4 mysql
docker buildx build --platform linux/amd64 --load --tag "oneflight-api:$VERSION" "$ROOT/backend"
docker buildx build --platform linux/amd64 --load --tag "oneflight-web:$VERSION" "$ROOT/frontend"
docker pull --platform linux/amd64 mysql:8.4
: > "$DEST/images.txt"
for image in "oneflight-api:$VERSION" "oneflight-web:$VERSION" mysql:8.4; do
  printf '%s ' "$image" >> "$DEST/images.txt"
  docker image inspect --platform linux/amd64 "$image" --format '{{.Os}}/{{.Architecture}} {{.Id}}' >> "$DEST/images.txt"
done
docker save --platform linux/amd64 "oneflight-api:$VERSION" "oneflight-web:$VERSION" mysql:8.4 | gzip > "$DEST/images.tar.gz"
# Repoint existing tags to their original platform immediately after export. No container is recreated.
restore_runtime_tags
cp "$ROOT/compose.offline.yaml" "$DEST/compose.yaml"
cp "$ROOT/.env.example" "$DEST/.env.example"
cp "$ROOT/scripts/init-env.sh" "$ROOT/scripts/load-offline.sh" "$ROOT/scripts/backup.sh" "$ROOT/scripts/restore.sh" \
  "$ROOT/scripts/seed-business.mjs" "$ROOT/scripts/qa-data-coverage.mjs" "$ROOT/scripts/qa-workflow.mjs" \
  "$ROOT/scripts/qa-approval-controls.mjs" "$ROOT/scripts/qa-assignment.mjs" "$ROOT/scripts/qa-plan-task.mjs" "$ROOT/scripts/qa-select-ui.mjs" \
  "$ROOT/scripts/qa-route-editor.mjs" "$ROOT/scripts/qa-route-3d.mjs" "$ROOT/scripts/qa-route-clarity.mjs" "$DEST/scripts/"
cp "$ROOT/scripts/lib/env.sh" "$ROOT/scripts/lib/select-ui.mjs" "$DEST/scripts/lib/"
cp "$ROOT/docs/DEPLOYMENT.md" "$ROOT/docs/INTEGRATIONS.md" "$ROOT/docs/API.md" "$ROOT/docs/DEPLOYMENT-CHECKS.md" \
  "$ROOT/docs/DATA-INITIALIZATION.md" "$ROOT/docs/REAL-SOURCE-VERIFICATION.md" "$ROOT/docs/ARCHITECTURE.md" "$DEST/docs/"
if [[ -f "$ROOT/docs/ACCEPTANCE.md" ]]; then cp "$ROOT/docs/ACCEPTANCE.md" "$DEST/docs/"; fi
cat > "$DEST/README.md" <<'DOC'
# 一网统飞 Linux AMD64 离线部署包

需要 x86_64 Linux、Docker Engine 和 Compose v2。运行 `./scripts/load-offline.sh`，脚本校验并导入三张镜像，生成私有 `.env`，然后启动服务。

默认入口 `http://localhost:8088`。管理员账号和初始密码在 `.env` 中，来源凭据需要由授权数据提供方配置。包内不含实际凭据、业务数据库、人员档案、附件或已导入数据。

详细操作见 [部署与运维](docs/DEPLOYMENT.md)、[数据接入](docs/INTEGRATIONS.md)、[真实来源核验](docs/REAL-SOURCE-VERIFICATION.md)、[来源导入与业务初始化](docs/DATA-INITIALIZATION.md) 和 [API](docs/API.md)。

已批日常或长期计划可在“飞行服务”安排单次执行任务，一计划可安排多次；任务继承计划组织、区域并限定在计划时段内。安排后进入“任务调度”：分配设备和飞手 → 登记执行 → 提交成果 → 需求部门验收。也可先提报需求，再关联匹配计划；实际开始执行前必须取得计划审批。查看设备运行会保留本单和设备上下文，返回后仍是原任务；已导入的设备档案可直接完善调度资料。

审批通过且同任务、同设备、执行权限匹配后，作业及载荷按钮可作纯页面交互；点击只提示未发送设备指令，不调用设备 API，也不改变任务进度或遥测。物理命令接口仍未配置。

航线与空域提供加宽编辑窗口、全屏绘制、清楚的编号与描边、拖动航点和点选定位。编辑来源几何时保留高程与 Polygon 内环；OpenFreeMap 的真实 OpenStreetMap 楼宇可关联航点，未知高度保持 null，关联仅作位置参照，不代表完成净空校验。飞行管控优先排列有效在线设备，轮询保留当前查看对象，任务和指定设备入口仍优先对应设备。

3D 航线显示绿色空中连线、三角航点和白色垂地虚线。独立 AGL 规划高度默认 100 米，支持单点修改及统一应用，新增航点继承统一默认值；源坐标 Z 与未知基准的来源高度原值保留。地形 DEM 未就绪时明确显示零高程基面预览，不作为真实海拔。

真实来源长航线默认局部高度视图，“全线总览”用于范围，“立体近览”观察当前航点及局部相邻航段。地面投影、高度幕帘、真实规划高度标签可分别开关；编辑卫星影像提高亮度与对比，不改写或夸大实际 AGL 数据。

来源导入和业务初始化必须在目标站点由管理员按实际授权执行；离线包只携带脚本逻辑。初始化脚本需要目标主机安装 Node.js 20 或更新版本。`qa-data-coverage.mjs`、`qa-workflow.mjs`、`qa-approval-controls.mjs`、`qa-assignment.mjs`、`qa-plan-task.mjs`、`qa-select-ui.mjs`、`qa-route-editor.mjs`、`qa-route-3d.mjs`、`qa-route-clarity.mjs` 为可选的只读浏览器验收工具，需要完整项目源码、`frontend` 开发依赖与可用 Chrome；此精简部署包不含这些开发依赖。工具共用的 `scripts/lib/select-ui.mjs` 支持页面中的统一深色下拉控件；航线工具在浏览器阻止业务写请求，不保存本次绘制、规划高度或关联。
DOC
sed "s/^APP_VERSION=.*/APP_VERSION=$VERSION/" "$DEST/.env.example" > "$DEST/.env.example.tmp"
mv "$DEST/.env.example.tmp" "$DEST/.env.example"
(cd "$DEST" && oneflight_checksums images.tar.gz > SHA256SUMS)
BUNDLE="$ROOT/artifacts/oneflight-${VERSION}-linux-amd64.tar.gz"
COPYFILE_DISABLE=1 tar -czf "$BUNDLE" -C "$STAGING_ROOT" "$(basename "$DEST")"
(cd "$ROOT/artifacts" && oneflight_checksums "$(basename "$BUNDLE")" > "$(basename "$BUNDLE").sha256")
mkdir -p "$FINAL_DIR"
cp -R "$DEST/." "$FINAL_DIR/"
printf 'Offline package created: %s\nIncludes linux/amd64 images and no private .env or credentials.\n' "$BUNDLE"
