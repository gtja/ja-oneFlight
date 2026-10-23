# 部署与运维

没有域名、证书且希望一份包启动时，按[HTTP IP 单镜像部署](SINGLE_IMAGE_IP.md)操作。镜像已包含平台及飞控代理，服务器无需单独配置 Nginx。本地开发和当前服务器部署使用同一套远端 MySQL 业务库；业务记录、4A 关联及平台授权不再分别保存在本机 H2 与服务器 MySQL 中。H2 仅用于自动化测试。

正式服务器 `47.96.225.165:8088` 已采用 Spring Boot 内置前端的一体应用镜像，加独立 MySQL，部署及维护按 [一体镜像生产说明](PRODUCTION.md) 执行，固定项目名为 `oneflight-prod`、业务库为 `oneflight`。本页以下保留本机开发、原 `frontend/backend/mysql` 三服务及既有离线包的操作流程；不要将其备份恢复脚本混用于一体镜像生产项目。

一体镜像生产已完成服务、五项来源、四尺寸页面与正式备份核验；恢复演练未执行。实际版本、交付包路径及证据见 [生产发布记录](PRODUCTION.md#2026-10-16-首次生产发布记录)。

## 在线部署与本机 ARM64

Docker Engine 24+ / Docker Desktop，Docker Compose v2.20+。推荐预留 4 GB 内存及 10 GB 磁盘。`compose.yaml` 不固定平台，在 Apple Silicon 上构建 ARM64，在 x86 Linux 上构建 AMD64。

```bash
./scripts/init-env.sh
# 编辑 .env：远端 DB_URL、DB_USERNAME、DB_PASSWORD，以及端口、地图和来源配置
./scripts/up.sh
docker compose ps
docker compose logs --tail=100 backend
```

配置显式 `DB_URL` 时，Java 后端直接连接远端 MySQL，默认启动不会创建本地 MySQL。对外端口默认 8088，Java 后端不发布宿主端口；附件仍按当前部署方式保存在文件卷 `${COMPOSE_PROJECT_NAME}_uploads`。旧配置不含 `DB_URL`，或显式填写 `jdbc:mysql://mysql:3306/...` 时，维护脚本才启用 `local-database` profile，保留原 `127.0.0.1:3307` 和 `${COMPOSE_PROJECT_NAME}_mysql-data`；直接执行旧本地 Compose 命令需带 `--profile local-database`。`docker compose down` 保留卷；正常更新不使用 `down -v`。

`.env` 必须填写已有远端业务库的 `DB_URL`、`DB_USERNAME`、`DB_PASSWORD`。模板提供远端 `oneflight` 连接示例，不包含账号密码；生成脚本不会为显式远端数据库编造密码。MySQL root 密码仅供旧本地 Compose 模式，初始化管理员密码仍使用 OpenSSL 生成并只写入私有文件。旧无 `DB_URL` 模板保留本地数据库密码生成语义。管理员只在不存在账号时初始化，修改环境变量不会重置已存在的账号。

## 本机前端与 Java 开发

未启用 4A 或嵌入飞控时，可保持 Docker 三服务运行，使用 `./scripts/dev.sh --container-api`。Vite 5173 通过 Nginx 8088 访问同一个 API、会话和附件卷，避免原生 Java 与容器使用同一数据库却使用不同附件目录。4A 和嵌入飞控需要固定平台入口，不能仅另开 5173 而继续使用另一地址的回调。

原生 Java 调试执行 `./scripts/dev.sh` 或 `./scripts/dev.sh --mysql`，两者都直接使用 `.env` 的远端 `DB_URL`、`DB_USERNAME`、`DB_PASSWORD`，不会启动 MySQL 容器或把连接改成 localhost。缺少任一业务库配置时停止启动；`--h2` 明确拒绝，普通 Spring 配置也不再默认创建 H2。`application-test.yml` 的 H2 仅供自动化测试。已有同项目 Docker 后端时仍拒绝启动第二个原生实例，优先使用 `--container-api`；切换运行端前先确认业务库与附件目录对应。

原生启动与单镜像打包统一读取根目录私有 `.env`；原生启动不加载 `.local/source.env` 或历史 `.local/run/*preview.env`，避免来源、账号或认证模式漂移。HTTP IP 模式下，只将平台、飞控公开地址分别本地化为 `http://127.0.0.1:${WEB_PORT:-8088}`、`http://127.0.0.1:${FLIGHT_CONTROL_HTTP_PORT:-8089}`，并同步允许来源与非 Secure Cookie；数据库、来源连接、凭据及 4A/飞控模式保留。Vite 直接提供统一平台入口，API 仍由 8080 处理。固定本机地址在发起 4A 登录前规范化，防止 `localhost` 与 `127.0.0.1` 的会话 Cookie 分离。HTTPS 配置不自动降级，继续通过匹配配置的 HTTPS 反向代理访问。

HTTP IP 嵌入飞控沿用已配置的本机代理，开发脚本不会替换或重启它；代理须监听对应飞控端口，且使用与 `.env` 相同的 `FLIGHT_CONTROL_GATEWAY_SECRET`。原生附件默认保存在 `backend/uploads`，可用 `.env` 的 `UPLOAD_DIRECTORY` 指向已恢复的附件目录。正常后端启动会应用尚未执行的 Flyway 迁移。旧 H2 文件不会自动删除或自动覆盖远端数据，已有业务数据迁移须单独备份、核对身份关联及授权后执行。

本机必须共享文件时，执行 `./scripts/up.sh --shared-uploads`。脚本合并已有容器文件和 `backend/uploads`（相同文件名、不同内容时拒绝覆盖），使用 `compose.dev.yaml` 把目录绑定至 `/app/uploads`，并按宿主 UID/GID 运行开发后端，保证两端可读写。单独执行 Compose override 时须设置 `LOCAL_UID=$(id -u) LOCAL_GID=$(id -g)`。切回默认命名卷前，先执行 `./scripts/sync-uploads.sh --shared-uploads` 合并文件，再执行 `./scripts/up.sh`。

`./scripts/sync-uploads.sh` 可把已有原生附件同步至当前默认命名卷，并把当前卷中的新增文件合并回本机，保持已有数据库附件记录可下载。同步不修改业务数据库，需要 Python 3，不复制符号链接，不覆盖不同内容的同名文件。只有单个业务后端写入；原生实例若仅用于只读来源排查，请勿通过它提交业务或上传文件。

## Linux AMD64 离线包

在能访问镜像仓库和依赖源的构建机执行：

```bash
./scripts/package-offline.sh 1.0.0
```

脚本使用 Buildx 构建 `linux/amd64` 前后端镜像，拉取该架构的 MySQL 8.4，以 `docker save --platform linux/amd64` 生成离线镜像。需 Docker API 1.49+（Engine 28.1+）。输出为 `artifacts/oneflight-1.0.0-linux-amd64.tar.gz` 及外层 SHA256，也保留同名目录。包中包含 `images.tar.gz`、SHA256、无 build 配置的 Compose、空凭据模板及运维脚本，不包含实际 `.env`、源码库凭据或测试数据。

把压缩包传到 Linux x86_64 服务器，解压后执行：

```bash
tar -xzf oneflight-1.0.0-linux-amd64.tar.gz
cd oneflight-1.0.0-linux-amd64
./scripts/load-offline.sh
```

导入脚本校验 SHA256，导入镜像，生成私有 `.env`，以 `--pull never` 启动。上游互联网服务/地图即使在离线部署下仍需可达；完全隔离网络应配置内网地图服务，数据源显示未接入。离线包为 AMD64；ARM64 服务器应从源码按本机架构构建，或自行采用同样步骤打 ARM64 镜像。

## 备份与恢复

远端统一业务库按该 MySQL 实例的备份与恢复流程维护，同时保存对应附件及私有配置；不要把旧 Compose 数据卷恢复命令用于远端库。下述 `backup.sh` / `restore.sh` 仅适用于仍明确使用本地 MySQL 服务的旧 Compose 项目，不能据此把本机旧数据覆盖到共享业务库。

旧模式备份目录包含 MySQL 单事务转储、上传文件和私有配置，默认权限只允许本机用户读取。

```bash
./scripts/backup.sh ./backups/before-upgrade
./scripts/restore.sh ./backups/before-upgrade --yes
```

恢复会替换当前业务库及上传文件，脚本先停止应用再导入并启动。应先做当前备份。备份前避免新增附件或进行批量业务写入，以保证数据库和文件的一致性。对于离线包，脚本使用包中不含 build 的 `compose.yaml`；源码工程可用 `COMPOSE_FILE=compose.offline.yaml` 选择已存在的镜像。

备份中的 `configuration.env` 和可选 `source.env` 含真实凭据，不能公开。恢复脚本使用当前 `.env` 连接当前数据库，不自动覆盖环境配置；如需恢复原配置，请在检查来源地址及密码后手工替换 `.env` / `.local/source.env`。

## 更新与回退

1. 更新前执行备份，并保存旧镜像标签和旧版本离线包。
2. 构建/导入新版本镜像，修改 `.env` 中 `APP_VERSION`，执行 `docker compose -f compose.offline.yaml up -d --pull never --wait`。业务库迁移由 Flyway 执行。
3. 只涉及兼容代码时，把 `APP_VERSION` 改回旧版本并重新启动。如数据库迁移不兼容，先恢复升级前备份，再启动旧版本；不要仅回退镜像后继续使用不兼容的库结构。
4. 检查登录、关键任务查询、附件下载、来源状态及 `docker compose ps`。无需清空持久卷。

生产入口可由现有网关提供 HTTPS。HTTPS 部署应设置 `SESSION_COOKIE_SECURE=true`；开发服务跨域访问时按实际地址配置 `ALLOWED_ORIGINS`，默认仅允许 `http://localhost:5173`。后端凭据只进入容器环境；构建上下文通过 `.dockerignore` 排除 `.env`、私钥、上传目录和本地数据。只读源库账号应由数据提供方授权 SELECT 范围，应用另行设置 JDBC 只读模式。

## 常见问题

- Docker daemon 未启动：启动已安装的 Docker Desktop 或 Linux Docker 服务，再执行脚本。
- 初次构建无法下载 npm/Maven 依赖或镜像：确认网络及企业镜像代理；离线生产服务器应使用已验证的离线包。
- MySQL 健康但后端未就绪：查看 `docker compose logs backend` 中的 Flyway/连接错误；核对现有持久卷原密码和 `.env`。修改 `.env` 不会更改已有 MySQL 用户密码。
- 上游数据为空或状态未知：检查来源状态和时间标记；只有查询成功且零记录才表示空数据，不通过生成样例掩盖接入错误。

## 可选 4A 与牍术双域名网关

HTTPS 网关配置、4A 身份与本地业务授权、生产/离线/单 Java 部署、回切及无实控验收见 [网关部署说明](../deploy/gateway/README.md)。该部署方式需要正式域名和有效证书；无证书环境使用上面的 HTTP IP 单镜像方式。两种方式都需要 4A `oneflight` 应用和现场账号验收。组合 Java 的外部 HTTPS 网关使用 `compose.production.yaml` 加 `compose.gateway.yaml`，不能仅修改前端开发 Nginx。
