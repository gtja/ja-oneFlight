# Linux AMD64 服务器部署

交付目录为项目根目录的 `服务器部署包/`，只包含三个文件：

- `oneflight-image.tar.gz`：前端、后端合并的 Linux AMD64 镜像，包含当前附件，运行配置从启动脚本传入。
- `start.sh`：顶部集中存放数据库、设备接口、MQTT、算法和账号配置，自动校验、导入镜像并启动服务。
- `stop.sh`：正常停止服务，保留业务记录和附件。

默认 `SERVER_IP=172.27.95.227`，业务数据库为该地址的 `31306/oneflight`，业务记录沿用已有独立数据库。来源数据库、设备接口、MQTT 和算法默认共用 `SERVER_IP`；如分开部署，可修改顶部 `MYSQL_HOST`、`GATEWAY_HOST`、`MQTT_HOST`、`ALGORITHM_HOST` 及各自端口。设备 HTTPS 接口保留证书域名并在容器内解析到配置 IP。镜像仅运行 Java 应用，不包含运行凭据；运行时无需 `.env`、Compose、MySQL 容器或数据卷。

将这三个文件上传到已安装并运行 Docker Engine 的 Linux x86_64 / AMD64 服务器，放在同一个目录后执行：

```bash
bash start.sh
bash stop.sh
```

启动后访问 `http://服务器IP:8088`，登录账号沿用现有系统账号。再次执行启动或停止均可；业务数据保存在远端 MySQL，附件保存在应用容器内，停止脚本保留容器。升级镜像时启动脚本会停止并保留旧容器，复制其当前附件到新容器后再启动。

以后换 IP 或修改账号、密码：只修改 `start.sh` 顶部配置区，再执行 `bash start.sh`。脚本会识别配置变化，保留旧容器并迁移当前附件后重建；配置未变时直接复用容器。修改配置不需要重新打镜像。`start.sh` 含实际凭据，默认仅文件所有者可读取和执行。

开发者重新打包可运行 `python3 scripts/package-single-image.py`，读取本机私有 `.env` 并将配置写入交付的 `start.sh`；默认 IP 可用 `--server-ip` 指定。默认从现有应用容器导出附件；也可用 `--uploads-archive` 指定已有附件备份，用 `--app-jar` 复用已构建的前后端 JAR。构建代码与内部验证资料不属于服务器交付文件。
