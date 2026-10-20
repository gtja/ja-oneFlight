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


### 来源业务目录与初始化来源

- `GET /api/v1/source-data/{kind}`：`people/groups/routes/airspaces/plans/tasks/events/media`，分页参数 `page/pageSize`，可选 `keyword`，识别记录额外支持 `eventType`。仅管理员与运营调度，范围限定来源可见设备与本地设备授权的交集。
- `GET /api/v1/source-data/summary`：各目录计数和连接状态。读取失败的计数为未知，不写成零。
- `POST /api/v1/source-data/import`：仅管理员，`{kinds:["DEVICE","PERSON","ROUTE","AIRSPACE","ORGANIZATION"],limitPerKind:2000}`。按稳定来源键幂等归档，不创建来源人员的登录账号。导入资源默认为 `PENDING_CONFIRMATION`，保留来源组织、原始状态和时间。
- 任务、计划、线索、咨询及本地账号可由管理员在首次登记时传 `provenance:{origin:"BUSINESS_INITIALIZATION",key:"稳定业务键",description:"来源说明"}`。服务器记录实际登记时间与操作者；已登记来源不可覆盖，普通请求不能伪造 `SOURCE_IMPORTED`。
- 资源通过 `metadata.provenance`登记同样信息。`ALGORITHM_DATASET`仅允许 `PENDING_LABELING`，`ALGORITHM_TRAINING`仅允许 `PENDING_CONFIGURATION`；这些是本地准备事项，训练计算与发布命令仍返回未配置。
