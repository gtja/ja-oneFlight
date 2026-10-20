# 真实来源只读核验

核验日期：2026-10-15。本文记录现有来源在核验时实际返回的数据和限制，数量是读取快照。来源认证只在私有配置和请求头中使用，不进入前端 URL、本文或附件清单。此次核验没有修改来源、写业务库、启动训练、部署算法或调用飞行控制，也没有执行 Maven。

## HTTP 业务能力

以下路径相对已配置的可信网关服务别名；统一响应必须同时满足 HTTP 200、业务 `code=SUCCESS` 和所需数据结构。接口存在、可读数据与本系统已审核或已验收是不同事实。

| 功能 | 已知只读操作 | 实际结果 | 必要字段与导入边界 |
| --- | --- | --- | --- |
| 来源设备、组织名称 | `controlServer` POST `/device/list/tree/v4` | 360 个设备树节点，按原始 ID 去重为 287 台；69 个具名组织分组 | 保留 `deviceId/productKey/orgCode/groupId/groupName` 及原生父子关系。组织分组不自动成为本地角色、人员资质或地理区域授权。 |
| 航线模板目录 | `controlServer` POST `/v3/dji/waylines/task/template/list` | 4 页完整读取 323 条，323 个唯一 `templateId` | 与源库有效模板及当前授权设备的精确关联取交集，得到 127 个模板、168 条设备关联，涉及 45 台设备。不得把 323 条全部导入。 |
| 航线详情、几何 | `controlServer` POST `/v3/dji/waylines/task/template/info` | 目录中一个样本成功，返回 8 个 WGS84 航点；安全交集内最新 10 个模板均返回业务错误 `failed to handle wpml file` | 成功样本的 `wayLines.document.folders[].placemarks[].point.coordinates` 与 `parameters.spaces[].positions[].pointX/pointY` 逐点相等。127 个安全模板中 114 个参数含至少两个合法位置，13 个不具备可用线几何；不能据单个样本宣称 114 个模板都已完成各自 KML 核验。缺原始文件时保留参数来源及未核验标识。 |
| 航线文件夹 | `controlServer` POST `/v3/dji/waylines/task/folder/list` | 查询成功，空数组 | 空结果来自成功查询，不补造文件夹。 |
| 外部计划 | `jingqiServer` POST `/action/plan/list` | 两页读取 34 条、34 个唯一 ID；SINGLE 17 / REPEAT 17；源状态 PENDING 23、TERMINATE 6、PROCESSING 5 | 34 条 `actionConfig.deviceIds` 均在当前授权设备集合内。保留原计划 ID、类型、时间、源状态及设备引用。源 `isValid/status` 不等于本地飞行服务审核、回执或需求验收。 |
| 外部计划执行 | `jingqiServer` POST `/action/plan/record/list` | 对一个确切外部计划读取到 3 条执行记录 | 仅为该查询样本，不宣称全部计划只有 3 条执行。保留原计划/行动/任务引用和原始状态，不把任务完成时间当物理落地时间。 |
| 外部行动任务 | `jingqiServer` POST `/action/list` | 来源账号查询总数 2198，抽取 20 条 | 只有关联设备及所有成员的当前授权均可证实后才能导入。不得把全局总数直接视为本地需求数量或已验收任务。 |
| 告警、识别事件 | `jingqiServer` POST `/event/list/v2`；GET `/event/type/list` | 来源账号事件总数 35282，类型 27；按类型查询明火 230、烟雾 243，各抽取 100 条，抽样全部属于当前授权设备 | 使用原 `eventId/deviceId/eventType/eventTime/processStatus`；两类抽样时间均为 2025 年，置信度均为 null。只可作为待人工复核的来源记录，不能改成今天发生、已确认火灾或已完成执法。其他类型存在异常源时间时须保留未知/异常，不用接收时间替代。 |
| 原生检测结果 | `jingqiServer` POST `/result/list` | 一个确切最新行动/执行查询成功，返回 0 条 | 仅说明该查询没有结果，不表示全库识别结果为空；数据库授权范围内的其他历史结果由独立源库审计记录。 |
| 飞手目录候选 | `jingqiServer` GET `/jinghang/pilots` | 业务查询成功，但 `rows=null`，未取得人员记录 | 不能由空目录生成飞手或资质。人员改由已指定的真实人员来源独立核验；此次 HTTP 审计未输出姓名、电话或证件字段。 |
| 训练目录 | `algorithmTrainApi` GET `/api/v1/algorithms` | HTTP 400，服务不存在 | 不存在可核验的训练目录、任务或结果，不能填训练成功、模型产物或评测指标。 |
| 独立视觉识别服务 | `allSightServer` GET `/api/v1/recognition/results` | 网关别名 HTTP 400，服务不存在；直接入口返回非 JSON 页面 | 不是成功空列表，也没有据此发起识别、标签生成或采样。 |

## 媒体原件与读取方式

发现并核验了现有 MinIO 只读契约：网关 `GET /proxyApi/minio/object-info?bucket&path`、`GET /proxyApi/minio/download?bucket&path`，以及 `list-objects` 的已知定义。实际核验只查询来自授权设备记录的精确对象；没有列举整个 bucket，没有申请上传签名或访问其他设备对象。

**单独的 HEAD 404 不能代表所有媒体不可读。** 两条历史明火、烟雾告警原图的 HEAD 返回 404；对同一事件 ID、同一对象引用进一步执行 GET Range，仍均为 404，这两个确切样本当前不可读。另对两条较新的授权事件原图执行不携带凭据的 GET Range，均返回 206，完整原件均实际取回。不能把前两条历史失效对象概括为整个平台图片失效，也不能因为其他图片成功就认定历史对象已经恢复。受保护的 MinIO 代理对两个较新事件对象返回 403，并不否定其原始对象 GET 已成功读取的事实。

对源库提供的 3 条最新授权媒体引用，MinIO 查询和下载结果为：1 条 HTTP 200 且实际返回图片，另外 2 条 HTTP 500，未取得文件。不能把元数据数量等同于可读取文件数量。

最终取得并验证 3 个完整图片文件，私有保存总计 **1,532,232 字节**：

| 读取方式 | 文件数 | 实际完整字节 | 校验 |
| --- | --- | --- | --- |
| 精确 MinIO 对象下载 | 1 | 118,370 | 完整响应体 SHA-256；保留原对象元数据及 ETag，ETag 不冒充 SHA-256。 |
| 授权事件原图 GET Range 全量读取 | 2 | 674,023 / 739,839 | 读取字节与 Content-Range 总量一致，JPEG 文件头确认，分别计算完整文件 SHA-256。请求未发送来源认证头。 |

事件/媒体 ID、设备 ID、精确对象引用、原始读取证据、文件路径及 SHA-256 仅写入忽略提交的私有清单，不出现在本文中。文件可作为其真实来源记录的附件；它们尚未证明属于本系统任意新任务、准确拍摄时间、某个飞行架次或已审核成果，上传时应保留这些边界。

## 私有证据索引

所有证据位于忽略提交的 `.local/real-data-audit/`：

- `requests.json`：固定只读接口、方法、参数、HTTP/业务码、字段结构和返回数量；没有认证头。
- `device-organization-outline.json`：设备、组织字段白名单概要。
- `route-catalogue.json`、`route-detail-structure.json`：完整目录及成功样本的 WGS84 几何证据。
- `safe-route-device-map.json`、`safe-http-route-geometry.json`：127 模板的授权交集、源参数几何、逐条详情抽验状态。
- `external-plans.json`、`external-plan-records.json`：外部原始计划及执行概要。
- `scoped-fire_detection-events.json`、`scoped-smoke-events.json`：设备授权范围内的事件抽样，不包含图片正文或人员字段。
- `media-object-read-verification.json`：精确对象查询、Range 读取、完整原件和失败事实。
- `media-head-get-comparison.json`：同一历史对象 HEAD 与 GET Range 均为 404 的精确复核。
- `verified-media-manifest.json`：3 个实际原件的私有路径、来源 ID、设备 ID、大小和完整 SHA-256。

核验只证明上述来源记录与实际读回文件，不证明本地业务审批已完成，也不补造维护、资质、咨询答复、行业处置结论或训练运行事实。
