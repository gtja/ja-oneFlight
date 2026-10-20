# 一体镜像生产部署与维护

本文用于 `47.96.225.165` 的首次部署及后续维护，部署目录为 `/opt/oneflight`，应用端口为 `8088`。服务器环境为 Docker Engine `20.10.7`、`linux/amd64`，可使用独立的 Docker Compose `2.26`。当前已部署版本为 `oneflight-app:20261016-151750`；项目名固定为 `oneflight-prod`，独立业务库名为 `oneflight`。部署、五项来源读取、正式页面和生产备份均已核验，结果见文末；未开展恢复演练。

## 部署结构与配置

根目录 `Dockerfile` 将 React 静态资源打入 Spring Boot JAR，运行镜像为 `oneflight-app:<版本>`，同时提供页面和 `/api/v1`，容器监听 `8080`，宿主机映射 `8088`。运行时没有独立 Node.js 或 Nginx 服务。

`compose.production.yaml` 只启动 `app` 与 `mysql`：

| 项目 | 生产约定 |
| --- | --- |
| 应用镜像 | `oneflight-app:${APP_VERSION}`，使用唯一版本标签保留更新与回退依据 |
| 数据库镜像 | `mysql:8.4`，数据库端口不映射到宿主机 |
| 业务库 | 首次部署新建独立数据库，不迁入本机测试任务、账号或其他测试业务记录 |
| 数据卷 | `<项目名>_mysql-data` 保存 MySQL，`<项目名>_uploads` 保存 `/app/uploads`；应用镜像替换不删除这些卷 |
| 资源限制 | `app` 内存上限 2 GiB，`mysql` 上限 1 GiB；启动前为既有服务和系统保留资源 |
| 日志 | 两个服务均使用 Docker `json-file` 轮换，单文件 10 MiB，最多 3 份 |
| 健康检查 | MySQL 就绪后启动应用；`/actuator/health` 用于应用就绪检查，`/healthz` 保留页面存活兼容入口 |

固定使用同一 `COMPOSE_PROJECT_NAME`。改名会指向另一组命名卷，不能用改名解决日常启动故障。生产来源连接沿用当前已授权配置，只读设备、源库与 MQTT 范围保持原约定；业务库与来源数据库分开。

所有实际配置保存在服务器私有 `.env`，不写入镜像、发布归档或本文。Compose 通过 `--env-file` 读取并向 `app` 显式传入所需变量，MySQL root 密码不传给应用容器。服务器密码、来源密码和令牌不放入命令示例、聊天记录或公开日志。

## 构建与发布文件

在源码根目录构建。ARM64 构建机必须指定 `--platform linux/amd64`；下面导出 Docker 格式镜像归档，供旧版服务器执行 `docker load`，也避免覆盖构建机现有镜像标签。版本示例为 `20261016-151750`，每次发布使用新的时间或提交号后缀。

```bash
RELEASE=20261016-151750
RELEASE_DIR="artifacts/production/$RELEASE"
mkdir -p "$RELEASE_DIR/scripts/lib"

docker buildx build \
  --platform linux/amd64 \
  --file Dockerfile \
  --tag "oneflight-app:$RELEASE" \
  --output "type=docker,dest=$RELEASE_DIR/oneflight-app.tar" \
  .

docker buildx build \
  --platform linux/amd64 \
  --tag mysql:8.4 \
  --output "type=docker,dest=$RELEASE_DIR/mysql-8.4-amd64.tar" \
  - <<'DOCKERFILE'
FROM mysql:8.4
DOCKERFILE

gzip "$RELEASE_DIR/oneflight-app.tar"
gzip "$RELEASE_DIR/mysql-8.4-amd64.tar"
cp compose.production.yaml "$RELEASE_DIR/"
cp .env.example "$RELEASE_DIR/"
cp scripts/production.sh scripts/init-env.sh "$RELEASE_DIR/scripts/"
cp scripts/lib/env.sh "$RELEASE_DIR/scripts/lib/"
cp docs/PRODUCTION.md "$RELEASE_DIR/PRODUCTION.md"

(
  cd "$RELEASE_DIR"
  shasum -a 256 \
    oneflight-app.tar.gz mysql-8.4-amd64.tar.gz \
    compose.production.yaml .env.example PRODUCTION.md \
    scripts/production.sh scripts/init-env.sh scripts/lib/env.sh \
    > SHA256SUMS
)
tar -czf "artifacts/oneflight-production-$RELEASE-linux-amd64.tar.gz" -C "$RELEASE_DIR" .
(
  cd artifacts
  shasum -a 256 "oneflight-production-$RELEASE-linux-amd64.tar.gz" \
    > "oneflight-production-$RELEASE-linux-amd64.tar.gz.sha256"
)
```

Linux 构建机可将 `shasum -a 256` 换成 `sha256sum`。源码构建与测试在发布前完成；镜像构建中的 Maven 打包跳过测试，不能代替测试流水线。根 `.dockerignore` 已排除私有 `.env`、密钥、本地证据、数据库、上传数据和构建缓存，不额外复制这些目录进发布目录。

传输归档和校验文件。以下示例使用 `root`，实际按已授权的运维账号登录：

```bash
PROD_LOGIN=root@47.96.225.165
ssh "$PROD_LOGIN" 'install -d -m 700 /opt/oneflight'
scp "artifacts/oneflight-production-$RELEASE-linux-amd64.tar.gz" \
  "artifacts/oneflight-production-$RELEASE-linux-amd64.tar.gz.sha256" \
  "$PROD_LOGIN:/opt/oneflight/"
```

## 首次导入与启动

在服务器上执行，版本与上传归档一致：

```bash
cd /opt/oneflight
RELEASE=20261016-151750
sha256sum -c "oneflight-production-$RELEASE-linux-amd64.tar.gz.sha256"
tar -xzf "oneflight-production-$RELEASE-linux-amd64.tar.gz"
sha256sum -c SHA256SUMS
chmod 700 scripts/production.sh scripts/init-env.sh

gzip -dc oneflight-app.tar.gz | docker load
gzip -dc mysql-8.4-amd64.tar.gz | docker load
docker image inspect "oneflight-app:$RELEASE" mysql:8.4 \
  --format '{{.RepoTags}} {{.Os}}/{{.Architecture}}'

./scripts/init-env.sh
chmod 600 .env
```

两张镜像均应显示 `linux/amd64`。`init-env.sh` 仅在 `.env` 不存在时生成独立数据库密码和初始管理员密码；已有文件不会覆盖。使用受控编辑器编辑 `.env`，将以下非敏感项设为生产值，密码与来源凭据在该文件中私下配置：

```dotenv
COMPOSE_PROJECT_NAME=oneflight-prod
APP_VERSION=20261016-151750
WEB_PORT=8088
MYSQL_DATABASE=oneflight
DB_USERNAME=oneflight
BOOTSTRAP_ADMIN_USERNAME=admin
TZ=Asia/Shanghai
ALLOWED_ORIGINS=http://47.96.225.165:8088
SESSION_COOKIE_SECURE=false
SOURCE_ALGORITHM_ORIGIN=http://172.27.95.216:32052
```

保留新生成的 `DB_PASSWORD`、`MYSQL_ROOT_PASSWORD` 与 `BOOTSTRAP_ADMIN_PASSWORD`，仅将已授权的 `SOURCE_*` 配置及需要的 `MAP_*` 配置写入生产 `.env`。包含 `$` 等特殊字符的值使用 dotenv 单引号保留原文，不通过 `source .env` 执行配置。不整份复制本机开发配置，不复制本机数据库或 uploads。HTTPS 接入后将 `ALLOWED_ORIGINS` 改为实际 HTTPS 来源，`SESSION_COOKIE_SECURE` 改为 `true`。

```bash
./scripts/production.sh up
./scripts/production.sh status
curl --fail --silent http://127.0.0.1:8088/actuator/health
curl --fail --silent http://127.0.0.1:8088/healthz
```

脚本可从任意工作目录调用，默认读取部署根目录 `.env`；指定其他私有配置时，选项必须在动作前：

```bash
/opt/oneflight/scripts/production.sh --env-file /opt/oneflight/.env status
```

脚本优先使用 `docker compose` v2，不可用时使用 PATH 中的独立 `docker-compose` v2。`up` 使用已导入镜像，以 `--no-build --pull never --wait` 启动 `mysql` 和 `app`，等待上限 300 秒。JVM 首次启动时由 Flyway 创建独立业务库内的 V1–V5 结构；初始管理员只在空库初始化，重启不会重置已有管理员密码。

通过 `http://47.96.225.165:8088` 登录，检查页面、业务库和来源连接。应用 healthy 只证明应用就绪，来源授权及连接状态仍需在平台内核对。首次部署不运行本机业务初始化或测试数据导入脚本。

## 日常状态、日志与备份

```bash
cd /opt/oneflight
./scripts/production.sh status
docker-compose --project-directory /opt/oneflight --env-file /opt/oneflight/.env \
  -f /opt/oneflight/compose.production.yaml logs --tail 200 app
docker-compose --project-directory /opt/oneflight --env-file /opt/oneflight/.env \
  -f /opt/oneflight/compose.production.yaml logs --tail 100 mysql

./scripts/production.sh backup /opt/oneflight/backups/20261016-151750
```

备份目录必须是尚不存在的新目录，权限为 `0700`，文件权限为 `0600`。脚本为数据库与附件的一致性短暂暂停原本正在运行且未暂停的 `app`，执行事务型数据库导出及 uploads 卷只读归档，退出时通过 trap 恢复原暂停状态；原本已停止或暂停的应用保持原状。数据库导出使用 `exec --interactive=false -T`，不消费 SSH 会话的后续输入。备份期间请求会等待，安排在维护窗口执行。

成功目录包括：

| 文件 | 内容 |
| --- | --- |
| `database.sql.gz` | 本系统业务库 SQL，不包含来源数据库 |
| `uploads.tar.gz` | 同一维护窗口的上传附件 |
| `configuration.env` | 该次备份对应的私有配置与应用版本 |
| `compose.production.yaml` | 未展开环境值的原始部署配置快照 |
| `images.txt` | 实际运行的 app/MySQL 镜像 ID |
| `SHA256SUMS` | 备份内容校验清单 |
| `BACKUP_COMPLETE` | 全部步骤成功后的完成标记 |

备份后确认脚本正常退出、应用恢复到备份前的运行状态，并同时确认 `BACKUP_COMPLETE` 和 `sha256sum -c SHA256SUMS`；返回非零或缺少完成标记时先核对失败原因，不能将该目录直接作为恢复点。只备份其中一项不能作为完整回退点。备份含真实业务和凭据，存于受限目录并另行保存受控副本，不放入发布归档。磁盘维护时保留数据库、uploads、回退镜像和所需备份，不执行会删除卷的 `down -v` 或全局卷清理。

## 更新与快速回退

更新前保留当前镜像和私有 `.env`，记录当前 `APP_VERSION`，并在切换前执行一次完整备份：

```bash
cd /opt/oneflight
./scripts/production.sh backup /opt/oneflight/backups/before-20261016-1700
```

在构建机按前述流程生成新版本 `oneflight-app:20261016-1700`，传输后核对校验值并 `docker load`。编辑私有 `.env`，只把 `APP_VERSION` 改为新版本；日常更新保持项目名、数据库、数据库密码和数据卷不变。应用更新通常不需要替换 MySQL 镜像，也不要删除旧镜像标签。

```bash
cd /opt/oneflight
./scripts/production.sh up
./scripts/production.sh status
curl --fail --silent http://127.0.0.1:8088/actuator/health
```

检查新页面、登录、关键业务读取、来源状态和日志；维护记录写明新旧镜像 ID、Flyway 版本和备份目录。修改 `.env` 中的数据库密码不会同步修改已有 MySQL 卷中的账号密码，密码轮换需单独完成后再同步应用配置。

没有不兼容数据库迁移、且旧版本已确认支持当前 schema 时，编辑 `.env` 将 `APP_VERSION` 改回原版本，再执行 `production.sh up` 与状态检查；uploads 和业务库保持当前状态。若 Compose 配置也已变更，同步恢复对应版本的原始配置。不要直接用旧版本 `.env` 覆盖已经轮换过的凭据。

Flyway 只执行版本升级，不自动执行降级。若本次迁移与旧应用不兼容，应使用升级前完整备份恢复到旧 schema，并将数据库、uploads、配置和应用版本作为一组恢复；这会回到备份时刻，不能同时保留升级后的新增业务。先备份当前故障现场，再按下一节恢复。

## 数据库迁移后的成对恢复

`production.sh` 不提供 `restore`。原三容器方案的 `scripts/restore.sh` 面向 `backend/frontend` 服务，不能直接用于本方案。以下通过新恢复项目创建空卷，保留故障现场的原卷；命令仅操作本系统业务库，不操作来源库。

1. 选定升级前完整备份，并确保对应旧应用与 MySQL 镜像已经导入服务器，以 `images.txt` 核对实际镜像 ID。恢复期间停止业务访问，确认接受恢复点之后的业务回退。
2. 复制备份配置为私有恢复配置，设置未使用过的独立恢复项目名，保留该备份的数据库凭据、数据库名与 `APP_VERSION`；端口保持 `8088`。示例恢复项目名为 `oneflight-prod-restore-20261016`，执行前确认不存在其同名卷；再次恢复需使用新的项目名。

```bash
cd /opt/oneflight
BACKUP_DIR=/opt/oneflight/backups/before-20261016-1700
test -f "$BACKUP_DIR/BACKUP_COMPLETE"
(
  cd "$BACKUP_DIR"
  sha256sum -c SHA256SUMS
)
umask 077
cp "$BACKUP_DIR/configuration.env" /opt/oneflight/.env.restore
chmod 600 /opt/oneflight/.env.restore
```

编辑 `.env.restore` 的 `COMPOSE_PROJECT_NAME` 为上述新的恢复项目名。停用当前项目时不加 `-v`，旧卷继续保留：

```bash
docker-compose --project-directory /opt/oneflight --env-file /opt/oneflight/.env \
  -f /opt/oneflight/compose.production.yaml down

cp compose.production.yaml compose.production.yaml.failed-20261016
cp "$BACKUP_DIR/compose.production.yaml" compose.production.yaml

docker-compose --project-directory /opt/oneflight --env-file /opt/oneflight/.env.restore \
  -f /opt/oneflight/compose.production.yaml \
  up -d --no-build --pull never --wait --wait-timeout 300 mysql

gzip -dc "$BACKUP_DIR/database.sql.gz" | \
  docker-compose --project-directory /opt/oneflight --env-file /opt/oneflight/.env.restore \
  -f /opt/oneflight/compose.production.yaml exec -T mysql \
  sh -c 'MYSQL_PWD="$MYSQL_ROOT_PASSWORD" exec mysql -uroot "$MYSQL_DATABASE"'

docker-compose --project-directory /opt/oneflight --env-file /opt/oneflight/.env.restore \
  -f /opt/oneflight/compose.production.yaml \
  run --rm --no-deps -T --entrypoint sh app \
  -c 'tar xzf - -C /app/uploads' < "$BACKUP_DIR/uploads.tar.gz"

./scripts/production.sh --env-file /opt/oneflight/.env.restore up
./scripts/production.sh --env-file /opt/oneflight/.env.restore status
curl --fail --silent http://127.0.0.1:8088/actuator/health
```

3. 核对登录、业务记录、附件、来源状态和旧版本页面。成功后将恢复配置作为今后的固定配置：保留原 `.env` 的受限副本，再用 `.env.restore` 替换 `.env`，保持权限 `0600`。恢复项目名此后固定使用，不再改回原项目名。
4. 原项目数据卷保留到恢复验收和保留期结束；清理前按实际卷名逐一确认，不用全局卷清理。不要在故障旧卷上手动删除 Flyway 履历或执行 `repair` 来绕过不兼容迁移。

## 2026-10-16 首次生产发布记录

正式地址为 `http://47.96.225.165:8088`，目录 `/opt/oneflight`，Compose 项目 `oneflight-prod`，业务库 `oneflight`。应用与 MySQL 均 healthy，数据库和 uploads 使用独立卷，没有迁入本机测试业务。

| 检查 | 已核验结果 |
| --- | --- |
| 应用镜像 | `oneflight-app:20261016-151750`，ID 为 `sha256:2385eb6aa44384641687508f1babb87a25f1ccb71f2055ee8894884a5e8547cf`；`linux/amd64`，非 root 单 JVM 同时提供页面与 API |
| 自动测试 | 后端共 157 项，155 项通过、2 项私有 live 用例跳过；前端未修改，沿用 205 项单测和 16 项浏览器回归通过的结果 |
| 镜像与传输 | JAR 共 354 项，8 个实际敏感字段扫描 0 命中，未包含测试静态 fixture；应用及 MySQL 两份实际传输 tar 的 SHA256 核验通过 |
| HTTP | 一体镜像本地 10 项及最终公网 10 项 HTTP 检查通过，证据为 `.local/prod-deploy/local-http-verification.json` 与 `production-http-verification.json` |
| 正式浏览器 | 1920×1080、2560×1440、1366×768、1024×768 四尺寸与算法页截图通过，`.local/prod-deploy/browser-final/results.json` 中页面错误和业务写请求均为空；四架飞机各有 42 个报告，跨度 41 秒，首点仍保留，显示时间不超过最新报告；算法页显示 25 张卡片 |
| 来源读取 | 设备授权目录、飞行来源库、任务执行来源库、实时遥测、算法目录五项均 HEALTHY；读取设备 287 台、飞行记录 514 条、执行记录 2,925 条、算法 25 条、来源航线 127 条，本系统 tasks/resources 均为 0 |
| 算法来源选择 | 已按用户明确选择使用 `http://47.96.225.165:32052` 的本机 25 条算法目录；生产容器通过等价内网 `http://172.27.95.216:32052` 访问，API 与算法页均已核验 |
| 容器与本机保护 | app/MySQL 均 healthy、重启次数为 0，生产 MySQL 始终未重建；原本机三个容器的 ID 和镜像逐项保持不变 |
| 正式备份 | `/opt/oneflight/backups/released-20261016-151750` 实际生成七文件，五项 SHA256 与两个 gzip 校验通过，目录权限 0700、文件 0600；app 恢复 healthy，关闭交互 stdin 后 SSH 后续 sentinel 正常执行 |

生产中两个来源 JDBC 地址的主机改为等价内网 `172.27.95.216`，以绕过同机 EIP 回环；这两个连接对应的来源库、账号权限及授权范围没有变更。算法目录另按用户选择切换为本机服务，容器同样走内网地址。生产地址与凭据配置保存在服务器私有 `.env`，不将私有凭据写入发布包。

最终汇总证据为 `.local/prod-deploy/production-proof.json`，正式截图和算法页证据位于 `.local/prod-deploy/browser-final/`。生产备份已实测，尚未执行数据库及 uploads 的恢复演练；本文恢复命令为操作说明，不作为恢复已验证的证明。

一体镜像交付包路径为 `artifacts/oneflight-production-20261016-151750-linux-amd64.tar.gz`，SHA256 校验文件放在包旁。私有配置、会话、业务数据、备份与 `.local` 证据不进入公开发布包。
