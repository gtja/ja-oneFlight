# Linux AMD64 服务器部署

交付目录为项目根目录的 `服务器部署包/`，只包含三个文件：

- `oneflight-image.tar.gz`：前端、后端合并的 Linux AMD64 镜像，包含当前附件，运行配置从启动脚本传入。
- `start.sh`：顶部集中存放数据库、设备接口、MQTT、算法和账号配置，自动校验、导入镜像并启动服务。
- `stop.sh`：正常停止服务，保留业务记录和附件。

默认 `PUBLIC_IP=118.31.104.96` 用于浏览器访问，`SERVER_IP=172.27.95.227` 用于内部服务。业务数据库为内网地址的 `31306/oneflight`，业务记录沿用已有独立数据库。来源数据库、设备接口、MQTT 和算法默认共用内网 `SERVER_IP`；如分开部署，可修改顶部 `MYSQL_HOST`、`GATEWAY_HOST`、`MQTT_HOST`、`ALGORITHM_HOST` 及各自端口。平台及飞控公开地址按 `PUBLIC_IP` 生成，不改变数据库连接。设备 HTTPS 接口保留证书域名并在容器内解析到配置 IP；4A 官方 HTTPS 地址保持独立。镜像不包含运行凭据；运行时无需 `.env`、Compose、MySQL 容器或数据卷。

当前交付启用 `ONEFLIGHT_AUTH_MODE=4a`、`FLIGHT_CONTROL_MODE=embedded`、`ONEFLIGHT_EMBED_VIEW=native`，并保留飞控入口 `FLIGHT_CONTROL_ENTRY_PATH=/source/UAV_AIRPORT`。这些开关在 `start.sh` 中传入容器；仅启用内置代理不会自动开启 4A 或嵌入飞控。修正开关后重新运行启动脚本，再通过 4A 重新登录；已有平台岗位和业务授权仍按原规则校验。

本地开发与当前部署共用远端 `oneflight` MySQL：本地通过公网地址连接，服务器通过内网地址连接。原本地业务记录、4A 不可变身份关联、业务 UUID 和既有授权已核对并恢复到该库。后续重新打包只更新程序和附件快照，不导入 SQL、不初始化或清空业务库；H2 只保留测试和历史备份用途。旧会话在身份关联恢复后需重新登录。

将这三个文件上传到已安装并运行 Docker Engine 的 Linux x86_64 / AMD64 服务器，放在同一个目录后执行：

```bash
bash start.sh
bash stop.sh
```

启动后访问 `http://服务器IP:8088`，登录账号沿用现有系统账号。再次执行启动或停止均可；业务数据保存在远端 MySQL，附件保存在应用容器内，停止脚本保留容器。升级镜像时启动脚本会停止并保留旧容器，复制其当前附件到新容器后再启动。

以后换公网入口，修改 `start.sh` 顶部 `PUBLIC_IP`；换内部服务，修改 `SERVER_IP` 或各服务 HOST。账号、密码也在同一配置区。修改后执行 `bash start.sh`，脚本会识别配置变化，保留旧容器并迁移当前附件后重建；配置未变时直接复用容器。修改配置不需要重新打镜像。`start.sh` 含实际凭据，默认仅文件所有者可读取和执行。

开发者重新打包可运行 `python3 scripts/package-single-image.py`，读取本机私有 `.env` 并将配置写入交付的 `start.sh`；内部服务地址用 `--server-ip` 指定，对外入口用 `--public-ip` 指定。默认从现有应用容器导出附件；也可用 `--uploads-archive` 指定已有附件备份，用 `--app-jar` 复用已构建的前后端 JAR。构建代码与内部验证资料不属于服务器交付文件。

重新打包时，以私有 `.env` 中显式配置的认证、飞控模式、页面视图和入口路径为准；打包器保留 `ONEFLIGHT_*`、`FLIGHT_CONTROL_*` 和 `SESSION_*` 配置。缺省仍兼容本地模式，不根据来源账号推导 4A 管理员身份或授予业务权限。当前构建机已保存上述交付开关，后续构建会继续使用。
