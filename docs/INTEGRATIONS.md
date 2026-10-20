# 真实来源接入

来源端点仅用于数据契约和只读读取，业务流程由本项目独立实现。私有凭据放在根目录 `.env` 或服务端环境中；不要把来源密码写入前端配置、源代码或镜像。

| 来源 | 后端环境变量 | 用途 |
| --- | --- | --- |
| `https://dushu.jing-an.com:32716` | `SOURCE_GATEWAY_ORIGIN`、`SOURCE_GATEWAY_SYSTEM`、`SOURCE_TARGET_HOST`、`SOURCE_TOKEN` | 授权设备树、设备详情、航线模板；当前域名解析到 `118.31.104.96`，目标头为 `118.31.104.96:32716` |
| `118.31.104.96:31306/dushu` | `SOURCE_DUSHU_JDBC_URL`、`SOURCE_DUSHU_USERNAME`、`SOURCE_DUSHU_PASSWORD` | 设备档案、累计指标、单架次飞行记录 |
| `118.31.104.96:31306/chingchi-icos` | `SOURCE_ICOS_JDBC_URL`、`SOURCE_ICOS_USERNAME`、`SOURCE_ICOS_PASSWORD` | 外部计划和任务执行记录 |
| `118.31.104.96:31306/ja-4a` | 可选 `SOURCE_IDENTITY_JDBC_URL`、`SOURCE_IDENTITY_USERNAME`、`SOURCE_IDENTITY_PASSWORD` | 授权设备来源组织对应的人员和组织目录；留空时复用 dushu 只读凭据并只替换连接库名 |
| `tcp://118.31.104.96:31883` | `SOURCE_MQTT_URL`、`SOURCE_MQTT_USERNAME`、`SOURCE_MQTT_PASSWORD` | 设备位置、状态、电量、环境遥测 |
| `http://118.31.104.96:32052` | `SOURCE_ALGORITHM_ORIGIN`、`SOURCE_USERNAME` | 算法目录、分类统计、部署设备查询 |

`SOURCE_TOKEN` 填令牌值，适配器负责认证请求头。`SOURCE_USERNAME` 为上游算法部署查询使用的账号标识。`SOURCE_TIMEOUT_SECONDS` 默认 8 秒。提供方账号可见设备与本地用户范围取交集。

所有密码默认留空，尚未配置的设备、源库和 MQTT 来源在界面显示“未接入”。算法目录通过公开只读地址读取真实数据，部署设备查询另使用 `SOURCE_USERNAME`。源库应使用专用只读账号；读取采用独立数据源，不加入业务 Flyway 迁移。MQTT 使用新生成的客户端 ID，不复用历史项目 ID，不采用跨所有设备的通配订阅。

启动脚本保留对私有 `.local/source.env` 的兼容：该文件中重新添加的来源变量会覆盖根目录 `.env`。该目录被 Git 忽略，不进入 Docker 构建上下文及离线包。当前本机的实际配置统一维护在根目录 `.env`，详见下文。

## 更换来源服务器

2026-10-19 本机已将实际接入配置统一放在项目根目录 `.env`；`.local/source.env` 仅保留说明，不再定义覆盖项。后续修改本机地址或密码只编辑 `.env`，不要修改前端文件、Java 默认值或 `.env.example`。原私有配置备份位于 `.local/config-backups/`，不进入 Git 或镜像。

地址项应保留完整有效值；删除或清空后，Compose 会回退到模板默认地址，其中部分仍为旧环境地址。

| 要修改的内容 | `.env` 中的变量 |
| --- | --- |
| 两个来源数据库 IP、端口、库名 | `SOURCE_DUSHU_JDBC_URL`、`SOURCE_ICOS_JDBC_URL`；保留 URL 后面的时区和编码参数 |
| 来源数据库账号、密码 | 对应的 `SOURCE_DUSHU_USERNAME/PASSWORD`、`SOURCE_ICOS_USERNAME/PASSWORD` |
| 独立配置的人员库 | `SOURCE_IDENTITY_JDBC_URL`、`SOURCE_IDENTITY_USERNAME`、`SOURCE_IDENTITY_PASSWORD`；各项为空时分别继承对应 DUSHU 配置 |
| 设备接口目标 IP、端口 | `SOURCE_TARGET_HOST` |
| HTTPS 网关入口与授权 | `SOURCE_GATEWAY_ORIGIN`、`SOURCE_TOKEN` |
| 算法接口地址 | `SOURCE_ALGORITHM_ORIGIN` |
| 算法部署查询的账号标识 | `SOURCE_USERNAME` |
| EMQX 地址、账号、密码 | `SOURCE_MQTT_URL`、`SOURCE_MQTT_USERNAME`、`SOURCE_MQTT_PASSWORD` |

当前网关证书支持域名 `dushu.jing-an.com`，不支持直接访问 `https://118.31.104.96:32716`，因此 HTTPS 入口保留域名，目标头使用新 IP。再次迁移时需确认域名解析和证书；不要关闭 TLS 证书校验。新网关返回 `NOT LOGIN / Please login` 时，需要更新 `SOURCE_TOKEN`；数据库和 MQTT 连接成功不能代替设备目录授权，目录授权失败也会阻止设备范围内的飞行记录读取及遥测订阅。

第三方平台当前登录入口为 `https://4a.jing-an.com:32712/login?systemName=jingqi`。正常登录后，将返回的 `data.token` 填入 `SOURCE_TOKEN`（仅令牌内容，无 `Bearer ` 前缀），将 `data.user.username` 填入 `SOURCE_USERNAME`。本系统使用这两个配置访问第三方接口，平台登录密码无需保存到项目中。

本系统自身的业务库仍使用 Docker 内部的 `mysql:3306/oneflight`，与以上只读来源库分开配置。仅迁移来源服务时不用改 `DB_*`、`MYSQL_*`，也不用删除数据卷。

修改后，在项目根目录执行以下命令重新创建服务，使新环境变量生效；仅执行 `docker compose restart` 不会更新容器环境变量：

执行命令的终端中，已导出的同名变量优先于 `.env`；如果此前设置过 `SOURCE_*` 环境变量，应先清除这些覆盖项。

```bash
docker compose --env-file .env -f compose.yaml config --quiet
docker compose --env-file .env -f compose.yaml up -d --wait --wait-timeout 180
docker compose --env-file .env -f compose.yaml ps
```

本机访问地址为 `http://localhost:8088`。正式服务器仍在其部署目录 `/opt/oneflight/.env` 修改对应来源项，并执行 `./scripts/production.sh up`；本机文件不会自动同步到正式服务器。

## 接入范围与未接入能力

媒体、完整轨迹、识别结果、训练、部署及物理飞行控制需逐项核验真实来源，未接通能力保留未接入说明。人工上传成果、识别复核和线索办理使用本系统持久化记录。

审批后的作业按钮是纯页面交互，五个作业按钮及云台、喊话回调不发送网络请求，不调用设备 API、MQTT publish 或上游控制接口。任务与当前设备一致、关联日常/长期计划已审批、任务处于待执行/执行中且账号有执行权限时可点击；审批未通过或取消、资料读取异常、任务结束、设备/计划不匹配时锁定。点击只保留本页反馈，不改变来源观测或业务进度。物理命令适配器仍未配置，`POST /api/v1/devices/{id}/commands` 对授权调用保持 HTTP 501、`PROVIDER_NOT_CONFIGURED`，页面按钮没有连接它。

地图地址为公共信息，可通过 `MAP_STYLE_URL`、`MAP_SATELLITE_URL`、`MAP_TERRAIN_URL` 配置。默认杭州视角。地形及卫星未配置时界面保留明确提示；所有来源凭据均不属于可公开地图配置。
