# 牍术嵌入与 4A 上线

## 功能兼容入口（当前本地验证方式）

设置 `FLIGHT_CONTROL_MODE=embedded`、`ONEFLIGHT_EMBED_VIEW=native`。进入飞行管控后先选择本平台执行任务，检查计划审批、人员设备、业务权限和任务时段，再由服务端解析来源设备及原生入口。平台通过 60 秒一次性票据把当前个人 4A 身份交给飞控入口；原站页面、接口、视频与 WebSocket 继续访问固定的 118 来源，保留原站完整布局及控制逻辑。不能通过无任务启动、资源页面或旧飞控 Cookie 跳过这道入口检查。

本地平台与飞控入口使用同一 IP 的不同端口，解决原站 `SameSite=Lax` Cookie 在跨站 iframe 中无法参与实时 WebSocket 鉴权的问题。转发仅允许原站 `access_token`、`username` 两项 Cookie，平台 Session 和其他 Cookie 不发给上游；退出或换账号时清理原站身份。此模式不要求人员重复登录，也不把后台来源服务账号作为个人身份。

## 任务入口凭证

bootstrap 消费票据并再次检查业务条件后，后端设置独立的 `ONEFLIGHT_ENTRY` HttpOnly、SameSite=Lax、Path=/ Cookie；HTTPS 模式额外使用 Secure。凭证关联父会话、当前身份和任务，不按任务结束时间主动切断已有操作页。退出、换账号或身份失效仍撤销入口凭证及原生登录存储。

网关使用内部 `auth_request` 调用 Java `/api/v1/flight-control/gateway-check`：`X-Oneflight-Entry-Grant` 只取入口 Cookie，`X-Oneflight-Request-Kind` 只取网关计算结果。根路径、原生 SPA 深链接和 HTML 文档导航为 `entry`，重新检查任务业务条件；已打开页面的静态资源、API、视频和 WebSocket 为 `continue`，只检查关联会话和身份活性。内部端点不能由浏览器直接访问；后端异常直接拒绝，不降级转发源站。文档响应增加 `Cache-Control: no-store`，避免浏览器缓存跳过再次进入时的检查。

文档被拒时返回“返回平台选择任务”页面，保留 401/403 状态；接口、媒体和 WebSocket 被拒时只返回原始状态与空响应，不跳转登录 HTML。拒绝页面不清理 Cookie 或原生身份，以免影响另一个已经打开的操作页。只有我方 bootstrap/logout 可以设置或清理入口 Cookie；上游 Set-Cookie 继续被隐藏，入口凭证、平台 Session 和网关密钥均不发给源站。

受控入口仅支持 `embedded` 代理模式。`direct` 与旧演示模式明确提示不支持这道业务放行流程，不提供原站快捷入口作为回落。直接在平台外访问牍术，或进入牍术后切换设备，继续由牍术权限管理；本平台审批不表示牍术已收到放飞许可。

**没有域名和证书、需要一份镜像包启动时，使用[HTTP IP 单镜像部署](../../docs/SINGLE_IMAGE_IP.md)。** Java、前端和代理已可放在一个容器内，入口和配置由启动脚本处理。下文的双域名、证书和外部网关步骤是保留的 HTTPS 部署方式。

应用仍是单实例 Java；新增网关同时承接平台和独立飞控 HTTPS 域名。默认 `ONEFLIGHT_AUTH_MODE=local`、`FLIGHT_CONTROL_MODE=local`，现有部署可继续使用。新增代码与模板不代表已经完成真实账号、视频或实控验收。

## 上线输入

准备两个不同的域名，例如 `https://oneflight.example.com` 和 `https://flight.example.com`，DNS 指向同一网关。禁止共用主机名仅换端口；浏览器存储按 origin 隔离，而 Cookie 不按端口隔离。把有效证书及私钥放入私有目录，文件名分别为：

- `oneflight.fullchain.pem`、`oneflight.key`
- `flight-control.fullchain.pem`、`flight-control.key`

目录由 `GATEWAY_TLS_DIRECTORY` 指定，只读挂载，不能提交 Git。网关保留上游 TLS 校验和 SNI；不要用关闭证书验证的方式解决连接问题。需要企业 CA 时，在受控镜像中安装 CA。生产域名、证书及 4A 配置由现场提供。

在 4A 注册独立应用 `oneflight`，允许固定回跳 `https://oneflight.example.com/api/v1/auth/4a/callback`，并授权实际平台用户。系统继续使用原来的官方登录页与验证码，平台不保管 4A 密码。对应角色的 `oneflight` 和 `jingqi` 单地登录策略必须相同；不要让两个系统因策略不同而撤销共享令牌。后台 `SOURCE_TOKEN` 和 `SOURCE_USERNAME` 使用独立来源服务账号，不能与人员登录共用。

私有 `.env` 至少设置以下配置，密钥建议用 `openssl rand -hex 32` 单独生成：

```dotenv
ONEFLIGHT_PUBLIC_ORIGIN=https://oneflight.example.com
FLIGHT_CONTROL_ORIGIN=https://flight.example.com
ONEFLIGHT_FOUR_A_ORIGIN=https://4a.jing-an.com:32712
FLIGHT_CONTROL_GATEWAY_SECRET=填写随机密钥
GATEWAY_TLS_DIRECTORY=/绝对路径/gateway-tls
ONEFLIGHT_AUTH_MODE=local
ONEFLIGHT_LOCAL_MAINTENANCE_ENABLED=false
FLIGHT_CONTROL_MODE=local
SESSION_COOKIE_SECURE=true
```

密钥由 Java 和网关共同使用，仅允许网关调用子域启动、清理和内部入口鉴权接口。个人令牌只写入子域默认 localforage 数据库 `localforage`、表 `keyvaluepairs`、键 `token`；不使用全局 `SOURCE_TOKEN`，也不导入上游应用模块来获取存储实例。网关不记录查询参数、Cookie、Authorization；Nginx 错误日志关闭，以免错误诊断带出完整回调或票据 URL。诊断使用无查询参数的访问状态和平台安全错误码。

访问日志保存在容器内 `/tmp/oneflight-nginx/logs/access.log`，由网关运行用户创建，避免降权后重新打开 Docker 的标准输出管道时发生权限错误。日志随容器可写层保存；`docker logs` 用于查看应用和进程启动日志，网关访问记录需读取上述文件。

`DUSHU_TARGET_HOST` 留空时，Compose 沿用现有 `SOURCE_TARGET_HOST`；来源目标迁移后不需要再维护一份旧 IP。只有飞控代理确实使用不同目标时才单独覆盖。单 Java 的 `gateway.env` 也应同步设置当前 `SOURCE_TARGET_HOST`。

## 4A 身份与平台业务权限

1. 设置 `ONEFLIGHT_AUTH_MODE=4a` 后，平台登录入口直接使用官方 4A 登录页与验证码。平台不维护另一套密码，普通用户无需手工绑定账号。
2. 管理员可在“组织与权限 → 关联 4A 账号”搜索 4A 只读目录，选择账号后配置本平台岗位、组织、区域和设备权限，无需等待该用户首次登录。目录使用 `SOURCE_IDENTITY_JDBC_URL`、`SOURCE_IDENTITY_USERNAME`、`SOURCE_IDENTITY_PASSWORD`；未单独配置时沿用现有 dushu 来源只读凭据并将库名切换为 `ja-4a`。目录读取不受设备来源组织或已登录账号列表限制，仅平台管理员可查看及关联；来源不可用时显示错误，可重试。
3. 账号按“4A 服务标识 + 不可变用户 ID”关联，不按同名用户名认领。首次关联默认等待平台业务授权；已有关联再次选择或登录时，业务编号、角色、组织、区域、设备授权和启停状态继续保留。业务权限只写本地，不会修改 4A 用户、角色或应用授权；4A 角色和组织也不会覆盖本地配置。未提前关联的用户仍可在首次验证个人令牌后自动建立待配置档案。
4. 首个管理员可通过 `ONEFLIGHT_BOOTSTRAP_FOUR_A_USER_ID` 配置经后端验证的不可变 4A 用户 ID；已有管理员身份关联也可继续使用。不会把首个登录者或 4A 同名管理员自动设为平台管理员。
5. 本地维护密码登录默认关闭，仅在明确维护需要时设置 `ONEFLIGHT_LOCAL_MAINTENANCE_ENABLED=true`，完成恢复后关闭。4A 停用或令牌失效仍拒绝会话；平台业务停用不修改上游账号。

平台登录校验 `oneflight`；启动飞控单独校验 `jingqi`。缺少飞控权限只拒绝飞控入口，平台需求、审批等业务仍可使用。平台审批管理业务流程，不能限制牍术内部真实操作。

## 部署命令

使用 Docker Compose **2.24.4 或更新版本**，覆盖文件通过 `!reset` 撤销旧的公网端口，确保生产请求实际经过新增网关。下面命令仅供部署人员在配置完成后执行。

组合 Java 生产部署：

```sh
docker compose --env-file .env -f compose.production.yaml -f compose.gateway.yaml build app gateway
# 或先在构建机 build/save 镜像，再在目标机导入。
bash scripts/production.sh --gateway up
```

开发分离栈使用真实 HTTPS 测试域名和可信开发证书；在 hosts/DNS 配置两个域名，不使用 HTTP iframe：

```sh
docker compose --env-file .env -f compose.yaml -f compose.gateway.split.yaml up -d --build
```

离线构建机使用 `WITH_FLIGHT_CONTROL_GATEWAY=1 bash scripts/package-offline.sh 版本号`，包里额外包含 `oneflight-gateway` 镜像与覆盖文件。目标机先准备私有 `.env` 和证书，再执行 `bash scripts/load-offline.sh --gateway`。默认离线包仍携带原来的三张镜像；没有网关镜像时不要使用 `--gateway`。

单 Java 安装包：更新应用 JAR，打包时私有 `.env` 中配置上面的认证/飞控变量，以及 `ONEFLIGHT_GATEWAY_ENABLED=true`。`scripts/package-single-image.py` 会将它们保留在私有 `start.sh`，不放进镜像层。已生成的 `start.sh` 也可在“可修改配置”中修改这些项，但必须把新增项一并加入 `RUNTIME_KEYS`。启用此开关后重跑 `bash start.sh`，应用只发布 `127.0.0.1:8088` 并接入带所有权标签的 `oneflight-gateway` 网络。启动脚本重建应用时也会重新加入网络。

单 Java 的网关镜像独立构建/导入，不改写原 Java 镜像：

```sh
docker build -f deploy/gateway/Dockerfile -t oneflight-gateway:1.0.0 .
# 离线目标机使用 docker save / docker load 导入同一架构镜像。
docker compose --env-file /私有目录/gateway.env -f deploy/gateway/compose.standalone.yaml up -d --no-build --pull never
```

`gateway.env` 中的父/子域名和密钥必须与 `start.sh` 中一致，并设置证书目录绝对路径。不要再将旧 8088 端口开放公网。网关启动会验证独立 HTTPS 主机名、固定上游、密钥格式及 Nginx 配置。模板整站代理牍术 32716，包括 `/assets`、`/js`、`/cesium`、`/proxyApi`、`/proxyWsApi` 和来源已提供的视频路径，不提供按请求参数指定目的地址的代理。

## 启用与验收

完成 4A 登录和平台业务授权后，先验证其他平台业务，再在测试环境启用 `embedded`。飞控页面完全替换旧组件，旧设备轮询和演示按钮不挂载；保留平台品牌、左侧菜单和返回任务入口。已验证的航空器路径为 `/control-room/uav/{来源设备编号}`；任务先解析真实来源设备。机巢等未验证类型进入 `/source/UAV_AIRPORT` 并提示手动选择，不猜测设备编号映射。

网关只对 HTML 注入我方 CSS/适配脚本。脚本通过唯一 `#app-header-center` 找到全局标题栏，并隐藏同一外壳内与 `main` 并列的全局导航，保留 `main` 内原生设备选择、视频、控制面板。使用正常弹性布局和 resize/fullscreen 事件，不按固定像素裁剪。未找到锚点、结构改变、认证过期或加载超时应显示明确错误。上游版本升级后必须重跑页面验收，不根据猜测扩大隐藏范围。

按以下顺序验收，前半部分只读、不发送设备指令：

- 验证验证码登录、已有 4A 会话恢复、回调 state 错误/过期/重放、新身份待业务授权、停用账号拒绝；核对重新登录后本地角色和业务编号保留。
- 以有 `oneflight`、无 `jingqi` 的账号操作平台需求/审批，再确认仅飞控入口拒绝。
- 验证启动票据 60 秒过期、消费一次、父会话失效/解绑后不能消费；地址与消息中无个人令牌。
- 验证未授权、未审批、未分配、跨组织、设备停用及任务时段边界都拒绝进入；签票后变更分配或权限，消费也必须拒绝。只有旧牍术 Cookie 而无入口凭证时，直接请求代理文档、接口及 WebSocket 均不能通过。
- 已打开任务到期或业务授权变化时，仅提示业务状态，不重新建立 iframe 或切断接口、视频和实时连接；刷新或新开操作页重新检查业务条件。登录身份失效、退出或换账号仍使凭证失效。
- A 退出后 B 登录，核对飞控实际身份为 B。模拟浏览器存储失败应停留在错误页，不能进入 A 的控制室。平台退出应清理子域存储、撤销票据和本地会话，4A 注销失败要显示状态。
- 确认只有一套平台导航；指定来源设备定位正确；手动选择提示清楚；调整尺寸、全屏、弹窗和视频工具条无裁剪/遮挡。
- 在浏览器网络面板确认 `wss://飞控域名/proxyWsApi` 的 101 升级、心跳和重连；确认视频真实画面、播放/停止、音频/麦克风授权、WHEP/FLV 请求和证书。来源返回的外部 HTTPS 媒体端点及 WebRTC ICE/TURN 连通性需要现场核验；Nginx HTTP/WSS 代理不能代替 UDP/TURN 网络配置。不要为解决媒体问题增加任意目标代理或关闭 TLS 校验。
- 最后由现场人员在受控环境人工验收起飞、返航、云台等真实控制；自动化测试和部署脚本不发送这些指令。

退出时父页面按精确 origin/source 通知子域清理，并可通过独立清理页面等待确认。下一次启动总是先删除旧 token，再写入新用户 token；写入失败不进入上游页面。

配置回切：保留已有身份关联和业务权限数据；需要停用代理嵌入时可切换飞控模式，平台会提示该模式不支持受控入口，不恢复无审批的演示操作。需要回切登录时把 `ONEFLIGHT_AUTH_MODE=local`。网关和 HTTPS 可继续保留。若还要移除网关，应先安排域名入口和 Cookie secure 配置切换，避免直接恢复旧公网端口造成登录中断。

## 本地检查

```sh
cd deploy/gateway
npm ci --ignore-scripts
npm test
npm run build
```

这里的测试验证存储隔离交接、失败不导航、消息来源、标题/全局导航适配及认证状态。网关镜像支持 `--check`，在注入测试域名、密钥、证书后仅执行 `nginx -t`，不联系设备。真实登录、WSS 和视频须用实际授权账号在上线环境完成。

有本地现成 Nginx 镜像时，可运行 `ONEFLIGHT_GATEWAY_NGINX_TEST=1 npm test`，默认复用 `oneflight:http-ip-compat`，也可用 `ONEFLIGHT_GATEWAY_TEST_IMAGE` 指定已有镜像。测试创建网络关闭、仅 loopback 假后端的临时容器，验证文档和续流分类、伪造头过滤、Cookie 隔离、401/403 与后端故障拒绝，结束后删除容器；不制作镜像、不连接真实设备、不重启现有服务。
