# API 使用约定

统一前缀 `/api/v1`，响应格式：

```json
{"code":"OK","message":"操作成功","data":{}}
```

分页对象为 `{items,total,page,pageSize}`。外部 ID 和业务 ID 在调用端按字符串处理。错误包含明确业务 `code` 和可展示 `message`，不返回来源令牌或 JDBC 密码。

接口的实时定义以应用生成的 [OpenAPI](http://localhost:8088/v3/api-docs) 及 [Swagger UI](http://localhost:8088/swagger-ui/index.html) 为准。包括认证、任务、计划、资源、飞行记录、算法、线索、附件及设置接口。

## 认证

使用后端会话 Cookie。先读取 `/api/v1/auth/csrf`，写请求在 `X-CSRF-TOKEN` 请求头中传入令牌；登录及后续请求需携带 Cookie。权限不足返回 403，未登录返回 401。浏览器默认同源部署，开发服务器将 `/api` 代理到 Java 后端。

## 任务关联飞行计划

`POST /api/v1/tasks/{id}/actions` 支持业务动作：

```json
{"action":"LINK_PLAN","planId":"本地飞行计划ID","note":"关联计划办理说明"}
```

仅管理员、运营调度可办理，任务须为 `PENDING_ASSIGNMENT` 或 `PENDING_EXECUTION`。后端校验任务和计划的访问范围、非空且存在的 `planId`、同一组织和同一区域、计划类型为 `DAILY` 或 `LONG_TERM`，以及计划状态属于 `DRAFT/PENDING_REVIEW/RETURNED/APPROVED`；任务起止时间须完整且包含在计划起止时间内。成功后只替换 `planId`，保留任务阶段并登记办理履历；该动作不是审批，也不下发任务或改变设备状态。可先关联待审核计划，页面作业按钮仍须等到计划审批通过。

执行飞手可以只读查看通过本人指派任务的 `task.planId` 关联的计划，组织、区域范围仍须匹配；计划不必另填指向任务的 `taskId` 才能读取。该只读关系不授予编辑、提交或取消他人创建计划的权限，页面隐藏这些入口，后端也拒绝越权请求；飞手修改自己创建的计划仍受原有权限和阶段约束。来源目录中的外部计划仅为只读来源记录，不能用其 ID 代替本地计划审批。

## 从已批计划安排执行任务

- `GET /api/v1/plans/{id}/tasks?page=1&pageSize=20`：校验计划访问权限后，按 `Task.planId` 分页返回当前账号可见的关联任务，按创建时间倒序。采用通用分页对象。
- `POST /api/v1/plans/{id}/tasks`：管理员、运营调度、需求部门可从可访问的已 `APPROVED` 日常或长期计划安排一次任务；飞手无此创建权限。

```json
{
  "title": "本次执行任务名称",
  "scene": "日常巡查",
  "description": "本次执行要求",
  "priority": "NORMAL",
  "startAt": "2026-10-16T01:00:00Z",
  "endAt": "2026-10-16T02:00:00Z",
  "requestId": "8becb49a-9e53-42d1-97ba-2c4e6edbf831"
}
```

`title/scene` 必填且最多 180 字，说明最多 8000 字；优先级为 `NORMAL/HIGH/URGENT`，省略时为 `NORMAL`；时间和 UUID 格式的 `requestId` 必填。示例时间仅说明格式，实际任务必须在所选计划有效时段内。新任务继承计划的组织、区域和 `planId`，直接进入 `PENDING_ASSIGNMENT`，返回任务对象并留下 `CREATE_FROM_PLAN` 履历，不再审批同一计划。

一个计划可以安排多次任务。`Task.planId` 是关联及台账的权威依据；`Plan.taskId` 仅兼容旧主任务引用，不限制其他子任务，也不自动替换它们。`GET /api/v1/tasks?planId=...` 可分页筛选，任务关键词检索包含所属计划名称。修改计划时会核验全部关联任务；非管理员/调度不能通过旧主任务字段改变任务绑定。

安排接口锁定父计划，以不可变的来源计划 ID、`requestId` 及请求内容摘要处理双击、并发和重试。同一创建者用同一计划和请求键重复发送相同内容返回原任务，不重复创建；更换请求内容或操作者复用该键返回 HTTP 409 `IDEMPOTENCY_CONFLICT`。需要安排下一次任务时生成新的 UUID。

任务基础资料保存、提交、分配、换绑计划和开始执行共用计划类型、组织、区域、时段包含校验。`START` 还要求关联计划已审批；无计划或未审批时返回 HTTP 409 `PLAN_APPROVAL_REQUIRED`。仅未关联计划且场景为“资料核对”的本地资料工作保留无飞行计划例外；若填写计划，仍需匹配并审批。成果提交和需求部门验收继续使用 `FINISH/ACCEPT`。

## 任务分配候选与原因

`GET /api/v1/tasks/{id}/assignment-options` 供管理员、运营调度核对当前可见任务，可选 `deviceId` 为本地设备档案 ID。返回任务区域、组织、时段、全量可见设备及飞手、数量汇总和逐项不可用原因。设备列表保留待确认、停用、维护等档案并标记不可选；选择设备后，飞手列表继续核对该设备授权。数据不包含当前账号范围外的资源或人员。

`summary` 包括 `deviceCount/activeDeviceCount/pendingDeviceCount/availableDeviceCount/pilotCount/availablePilotCount`，其中可用设备数要求存在匹配的可用飞手。设备、飞手分别提供 `eligible/reasons`，原因项为 `{code,message}`；设备还提供 `compatiblePilotCount`。顶层 `reasons` 表示任务阶段或时间资料不满足分配条件。候选查询与实际 `ASSIGN` 使用同一校验规则，提交时仍锁定并重新检查，不能用旧查询结果绕过授权或时段冲突。

设备接入、设备调度状态、飞手账号区域和设备授权分别维护。来源档案导入不会自动设为可调度或授予飞手权限。前端显示不匹配的具体原因，并可进入资源管理完善调度资料、进入组织与权限维护执行账号；这些入口不自动保存或扩大权限。

## 页面作业交互与物理命令

飞行管控的五个作业按钮及云台、喊话在以下条件全部满足时解锁：当前设备对应任务分配的本地 `DEVICE` 档案，档案为 `ACTIVE` 且 `sourceDeviceId` 匹配；任务已分配执行人员，处于 `PENDING_EXECUTION/EXECUTING`；任务的 `planId` 对应已 `APPROVED` 的日常或长期计划；计划与任务须属于同一组织、同一区域，任务时段包含在计划时段内；关联以 `task.planId` 为准，旧 `plan.taskId` 不排斥同一计划的其他执行任务；账号为管理员、具备相应范围的运营调度，或本任务被指派的飞手，且组织、区域、设备范围通过检查。需求部门不具备该操作权限。未通过审批、取消或退回、任务结束、设备/计划不匹配、加载中及读取失败均锁定。

这些按钮只使用 React 本地状态和页面提示，不调用 `api/fetch` 或任何设备 API，不写任务、遥测、实际起降、执行记录或操作审计。页面的设备和遥测查询保持原有只读刷新；“最近页面操作”只说明本次点击，切换上下文后清除。任务的 `START/FINISH` 等业务动作仍独立办理。

`POST /api/v1/devices/{id}/commands` 继续作为独立的物理命令预留接口，命令枚举为 `DISPATCH_TASK/TAKEOFF/RETURN_HOME`。通过身份及设备范围校验的调用仍返回 HTTP 501、`code=PROVIDER_NOT_CONFIGURED`；未授权调用按权限规则拒绝。页面作业和载荷按钮没有连接此接口，也没有上游设备命令调用。

## 时间、上传和列表

使用 `Asia/Shanghai` 显示业务时间，按源数据的实际时间标记展示遥测和飞行记录。缺失时间及指标显示未知。附件上传由后端鉴权并持久化到上传卷；单文件上限 100 MB，Nginx 请求上限 101 MB（为 multipart 预留空间）。

来源成功且无记录时返回空列表；来源未配置、超时或权限失效时返回来源状态及原因，不能转换为成功的空列表。来源状态接口不泄露敏感配置。

## 本地空域高度与 GeoJSON 批量导入

空域继续使用 `/api/v1/resources` 和 `kind=AIRSPACE`。平面范围保存在 `metadata.geometry`；独立高度模型为 `metadata.airspaceProfile:{reference:"AGL"|"AMSL"|null,lowerHeightMeters:number|null,upperHeightMeters:number|null}`，单位米。AGL 为离地高度且不得为负；AMSL 为海拔高度，允许负数。填写任一数值必须明确基准，两值均有时下限不得高于上限，数值须有限。未填写保持未知，不从来源坐标 Z、来源高度字段或航线规划高度推导，不补零。高度、范围是本地档案，不下发电子围栏或设备限高，不改变飞控放行。

圆形和矩形编辑仍提交标准 Polygon，不新增圆形专属接口或后端几何类型。可选 `metadata.geometryContext.airspaceShape` 保存编辑参数：`{type:"CIRCLE",center:[longitude,latitude],radiusMeters}` 或 `{type:"RECTANGLE",west,south,east,north}`；所有位置使用 WGS84。该参数只辅助恢复编辑工具，地图、拓扑校验及业务范围以 `metadata.geometry` 为准，不采用参数替换已保存范围。新增圆形用64个外环采样点及闭合点表达，来源规则圆形缩放/平移保留原顶点数量、顺序和附加维度；切为多边形后清除形状参数。高度及来源 Z 保持独立语义。

新建或修改空域范围与文件导入共用后端 Polygon 校验，包括 WGS84 经度/纬度范围、有限坐标、全部维度首尾闭合、至少三个不同点、非退化、自交及内环合法性。JTS 仅使用 XY 副本做拓扑校验，文件、批次及空域 metadata 读写保持 BigDecimal，后端不额外舍入原坐标的 Z、额外维度和内环。HTTP 预览输出普通 Map 形式的标准 GeoJSON；浏览器绘图仍遵循 JavaScript 数值精度。普通空域保存会在相同几何结构的对应位置复用具有相同双精度表示的旧原始数值，避免只改名称或独立高度时反写浏览器舍入值；真正坐标变化和新结构照常校验及保存，高度字段不参与此恢复。没有改动的历史来源几何可继续归档，不自动转换未知坐标或清洗原值。单 Polygon 最多2000点，含内环和闭合点；单空域序列化 metadata 上限1MiB，预览按真实文件名、编号等来源字段一并核验，V8 将资源 metadata 扩为 MEDIUMTEXT。

仅管理员、运营调度可在当前业务组织和区域授权范围内导入，目标组织须已启用；组织和区域由表单统一选择，文件不能覆盖。区域取当前五个业务区域，并非对多边形行政边界的空间认证。

- `POST /api/v1/resources/airspace-imports/preview`：multipart `file` 和 `options` JSON Blob part（`Content-Type: application/json`）。`options` 为 `{organizationId,region,coordinateReference:"WGS84",defaultAirspaceProfile?}`，上限8KiB、JSON嵌套深度8；超限返回413 `AIRSPACE_OPTIONS_TOO_LARGE`，格式及必填校验失败返回400。文件须为 `.geojson/.json`，1字节至2MiB；接受 Polygon、Feature、FeatureCollection，每批1至100个 Polygon，总点数最多20000。仅接收已确认的 WGS84 经度、纬度；带非空 `crs` 声明的文件须先导出为标准 WGS84 GeoJSON。首期不支持 MultiPolygon、KML/KMZ、Excel/CSV，不自动拆分或转换。
- `properties.name/model/description/airspaceProfile` 分别映射名称、空域类型、备注和完整高度设置。没有名称时用文件名及条目序号；单个裸 Polygon 用文件名。省略高度设置使用文件统一默认值，显式 `airspaceProfile:null` 保持未设置。可选 `Feature.id` 接受字符串或整数，整数通过 JsonNode 的原始整数值精确转换为字符串归档，不经过浮点数；小数编号拒绝。其他 properties 给出未映射提示，不写入业务字段。
- 预览返回 `{batchId,expiresAt,canCommit,summary:{total,valid,invalid,duplicates,pointCount},rows}`。每行包含从1开始的 `index`、`title/model/description/geometry/airspaceProfile/pointCount/duplicate` 和 `errors/warnings:[{code,message}]`。高度缺失为警告，允许导入后补齐。可解析的逐条错误仍返回200报告，但任何错误都使 `canCommit=false`、`batchId/expiresAt=null`。非法 JSON/根格式返回400，文件超限返回413 `AIRSPACE_FILE_TOO_LARGE`。有效预览仅暂存不可变批次，15分钟有效，绑定创建者，不创建资源或成功导入审计。
- `POST /api/v1/resources/airspace-imports/{batchId}/commit`：无请求体，返回 `{batchId,status:"COMMITTED",imported,skipped,ids,importedAt}`。事务中锁定批次和目标组织，重新校验当前身份、创建者、岗位、组织及区域范围；所有资源、审计和完成结果一起提交，失败整批回滚。新资源状态始终 `PENDING_CONFIRMATION`，服务端标记 `FILE_IMPORTED`，不产生监管审批、账号授权或真实设备操作。

提交同一批次重试返回原结果且不重复写入；内容与组织/区域生成稳定资源ID，文件内及跨批次完全相同条目自动跳过，不覆盖现有档案。已有同源文件档案被手工更改时预览或提交返回冲突 `AIRSPACE_IMPORT_CONFLICT`，要求核对，不能以重复上传覆盖修改。过期/已清理批次返回409 `IMPORT_PREVIEW_EXPIRED`，需重新预览；换账号或权限缩减返回403。暂存过期批次每小时清理，完成结果保留供安全重试，完成后清除大体积暂存内容。所有写接口继续使用当前会话及 CSRF。


### 来源业务目录与初始化来源

- `GET /api/v1/source-data/{kind}`：`people/groups/routes/airspaces/plans/tasks/events/media`，分页参数 `page/pageSize`，可选 `keyword`，识别记录额外支持 `eventType`。仅管理员与运营调度，范围限定来源可见设备与本地设备授权的交集。
- `GET /api/v1/source-data/summary`：各目录计数和连接状态。读取失败的计数为未知，不写成零。
- `POST /api/v1/source-data/import`：仅管理员，`{kinds:["DEVICE","PERSON","ROUTE","AIRSPACE","ORGANIZATION"],limitPerKind:2000}`。按稳定来源键幂等归档，不创建来源人员的登录账号。导入资源默认为 `PENDING_CONFIRMATION`，保留来源组织、原始状态和时间。
- 任务、计划、线索、咨询及本地账号可由管理员在首次登记时传 `provenance:{origin:"BUSINESS_INITIALIZATION",key:"稳定业务键",description:"来源说明"}`。服务器记录实际登记时间与操作者；已登记来源不可覆盖，普通请求不能伪造 `SOURCE_IMPORTED`。
- 资源通过 `metadata.provenance`登记同样信息。`ALGORITHM_DATASET`仅允许 `PENDING_LABELING`，`ALGORITHM_TRAINING`仅允许 `PENDING_CONFIGURATION`；这些是本地准备事项，训练计算与发布命令仍返回未配置。
