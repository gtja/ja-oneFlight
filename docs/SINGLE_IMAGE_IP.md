# 无域名、无证书的单镜像发布

目标是一份镜像包、一次启动。镜像内已经包含 Java、平台前端和飞控代理，不需要在服务器另外安装 Nginx、配置证书或启动第二个应用容器。业务数据库和来源服务继续使用现有地址。

## 服务器操作

1. 将打包好的 `oneflight-image.tar.gz`、`start.sh`、`stop.sh` 放在同一个目录。
2. 打开 `start.sh`，分别确认顶部的 `PUBLIC_IP`（浏览器入口，当前 `118.31.104.96`）和 `SERVER_IP`（内部服务，当前 `172.27.95.227`）。数据库、设备接口、MQTT、算法默认使用内网地址，平台与飞控的公开地址使用公网 IP。
3. 执行：

   ```sh
   bash start.sh
   ```

浏览器访问 `http://服务器IP:8088`。飞控代理使用同一 IP 的 `8089` 端口，由“飞行管控”页面自动嵌入，无需再打开一个网站。浏览器到服务器的这两个端口均需可达。调整端口时只改 `WEB_PORT` 和 `FLIGHT_CONTROL_HTTP_PORT`；平台、飞控地址以及端口映射会一起更新。

停止时执行 `bash stop.sh`。升级仍是替换这三个文件后执行 `bash start.sh`；脚本保留旧容器并迁移附件，不重建现有业务库。对外地址变化时修改 `PUBLIC_IP`，内部服务变化时修改 `SERVER_IP` 或各服务的独立 HOST，再重新运行。公开入口与内部连接分别生成，互不覆盖；4A 官方 HTTPS 登录地址继续单独配置。

应用与代理的启动日志通过 `docker logs oneflight-server` 查看。代理访问日志保存在容器内 `/tmp/oneflight-nginx/logs/access.log`，由降权后的运行用户写入，保留原有脱敏格式，不依赖对 `/dev/stdout` 的重新打开权限。

## 首次接入 4A

网络和打包兼容不替代 4A 应用授权。在 4A 登记 `oneflight` 并确认接受固定回调 `http://服务器IP:8088/api/v1/auth/4a/callback`。4A 官方登录站点及后端身份验证仍使用原来的 HTTPS。

启用 `ONEFLIGHT_AUTH_MODE=4a` 和 `FLIGHT_CONTROL_MODE=embedded` 后，用户通过官方 4A 登录。管理员可在“组织与权限 → 关联 4A 账号”直接查询来源目录，提前关联账号并配置平台岗位、组织、区域与设备权限，无需目标用户先登录，也无需另建密码账号。未提前关联的用户仍可在首次登录后进入待配置列表；再次关联或登录保留已有业务编号和权限，4A 角色不会覆盖本地配置。首次管理员可以用已验证的不可变 4A 用户 ID 显式配置。具体规则及只读目录连接配置见 [4A 接入说明](../deploy/gateway/README.md#4a-身份与平台业务权限)。

正式启用前需要用实际授权账号验证官方 4A 的 HTTP IP 回跳、WS 连接和视频。自动化测试覆盖固定回跳、票据及页面交接，不能替代真实账号验收。飞控单独校验个人令牌的 `jingqi` 权限；平台业务授权不会改变 4A 或飞控权限。

## 兼容范围

HTTP IP 模式显式开启，限定平台与飞控使用同一规范 IPv4 的不同端口；不会自动把 HTTPS 部署降级。平台 Cookie 使用独立名称及 `/api` 路径，飞控代理不向来源转发浏览器 Cookie，也不将来源的 Set-Cookie 写回浏览器。个人令牌仍通过 60 秒一次性票据在飞控端建立登录态。

HTTP 网络传输不加密，应部署在受控网络。HTTP 页面中的麦克风、喊话等需要安全上下文的功能不启用；控制室页面、视频播放和其他操作仍需现场逐项验收。升级为可信 HTTPS 后可恢复对应权限入口。页面会显示限制提示，不会把这些能力标成已验证可用。自动化测试不发送起飞、返航或云台等设备命令。

## 构建机打包

沿用原私有配置和附件打包流程，只增加 `--http-ip`：

```sh
python3 scripts/package-single-image.py --http-ip --server-ip 172.27.95.227 --public-ip 118.31.104.96
```

输出仍是 `服务器部署包` 中的三个文件。内部代理密钥自动生成，只保存在私有启动配置中，用户不需要填写；镜像层不包含该密钥或运行账号配置。已有 JAR 和附件归档可继续通过 `--app-jar`、`--uploads-archive` 复用；包含代理资源的运行基础层会同步构建，避免只替换 JAR 后漏掉代理。

`--http-ip` 只选择传输方式和内置代理，不决定身份认证和飞控接入方式。已有 4A、原生嵌入飞控的部署，应在构建机私有 `.env` 中保留 `ONEFLIGHT_AUTH_MODE=4a`、`FLIGHT_CONTROL_MODE=embedded`、`ONEFLIGHT_EMBED_VIEW=native` 以及现有 `FLIGHT_CONTROL_ENTRY_PATH`；这些配置会原样写入 `start.sh` 并传给容器，不会因重新打包退回本地模式。

开发或已有 Compose 环境也可使用 `compose.production.yaml` 加 `compose.single-ip.yaml`；私有 `.env` 填写 `SERVER_IP` 后执行 `bash scripts/production.sh --single-ip up`。这仍只使用一个应用镜像，原 Compose 数据库服务保持原样。服务器三文件安装包不依赖 Compose。
