# 项目开发与 Agent 协作规范

本规范用于后续功能开发、缺陷修复与结构重构。默认保留已交付页面和业务行为，在当前单体应用中按职责迭代；新增能力以明确的验收条件为边界。仓库根 [AGENTS.md](../AGENTS.md) 是 Agent 的任务入口，本文件说明具体做法。

## 项目结构

```text
frontend/src/
  App.tsx                       登录外壳、导航、页面挂载
  api.ts                        保留现有导出的公共入口
  api/
    types.ts                    Entity、Page、CurrentUser
    client.ts                   HTTP、CSRF、错误、完整目录读取
    hooks.ts                    React Query、分页和轮询
  pages/
    Resources.tsx               资源页面状态及业务编排
    resources/                  资源字段、列及详情配置
    Services.tsx                服务申请、审批及关联编排
    services/                   服务字段及专属展示组件
    FlightWorkspace.tsx         任务放行及嵌入飞控生命周期
  components/                   表单、地图、任务弹窗等组件
  domain.ts                     状态标签、时间与单位转换
  geometry.ts 等                具体业务纯函数，测试与源码相邻
backend/src/main/java/com/oneflight/
  auth/                         身份、角色、授权范围、会话
  common/                       响应、分页、业务异常和通用值
  domain/                       本地持久化实体
  repository/                   本地业务库查询
  service/                      用例编排、状态流转与业务策略
  web/                          HTTP 参数、响应及列表组织
  integration/                  只读来源、导入、遥测及适配器
  flightcontrol/                任务入口策略、短期票据及凭证
backend/src/main/resources/db/migration/
                                Flyway 增量迁移
deploy/gateway/                 嵌入站身份适配、静态资产和 Nginx
scripts/                       开发、验证、打包与维护入口
docs/                          架构、接入、部署及验收说明
```

按已有职责放置代码。页面专属内容留在页面目录，稳定跨页面复用内容才进入 `components` 或公共模块；不建立无明确用途的 `utils` 集合。后端保持单个 Spring Boot 应用，不为当前规模额外拆 Maven 模块或微服务。

## 保持行为的重构方法

先记录请求、返回、校验顺序、状态变化、权限和失败行为，再移动代码。配置和 JSX 抽取应保留字段顺序、文案、默认值、组件 key、DOM 和 CSS 类名。纯函数和展示组件通过参数接收所需信息，页面继续持有原有状态与请求，避免拆分后出现重复订阅或副作用。

`api.ts` 作为兼容入口保留原有导出，页面与现有测试继续从这里引用；其内部模块直接引用 `types` 和 `client`，不能反向引用公共入口造成循环依赖。传输层不能引入 React，Hook 层不能另建请求协议。现有 `useList`、`useDevices`、`useCatalog` 的分页和完整目录语义不同，不可仅因代码相似而合并。

后端服务抽取保持调用方的事务边界、锁、审计和异常先后。新增 Spring Bean 时检查代理事务是否仍在调用链上；不把依赖代理的 `@Transactional` 方法改成同类内部调用。Controller 不新增业务权限规则；列表读取必须先按后端授权范围过滤，保持既有搜索、排序和分页语义。

文件变长时先检查是否存在第二种职责。字段配置、纯计算、外部适配和独立展示通常适合拆出；不要用硬性行数制造大量跳转。只有重复代码表达相同业务约束时才合并，错误提示或校验顺序不同的分支不能贸然统一。

## 前端实现规范

- 使用 TypeScript 严格模式，复用现有类型；边界未知数据使用 `unknown` 并校验，不用 `any` 绕过错误。外部 ID 保持字符串。`noUnusedLocals` 与 `noUnusedParameters` 已启用，未使用的局部声明、导入和参数会使构建失败；不通过关闭检查或虚假引用规避。
- Hook 在组件顶层调用，副作用处理释放与失效；地图、事件监听、iframe 消息和定时器必须随生命周期清理。保留消息来源 origin、source 和 namespace 校验。
- 服务端数据由 React Query 管理，表单草稿、弹窗与选中对象使用局部状态。缓存键和失效范围按现有业务定义，换账号清理敏感缓存。
- 请求通过 `api`、`write` 及现有 Hook；不在页面另写 fetch、CSRF 或错误解析。表单错误、空数据、加载中、来源不可用需保持区别。
- 复用 `components/UI.tsx`、`SelectControl`、现有表单和交互组件，保留标签、键盘操作及可访问性。测试自定义下拉时点击 combobox 后点击 option，不能对 button 使用原生 select 的 change 事件。
- 时间展示遵循 Asia/Shanghai，提交遵循已有 Instant/ISO 协议。米、秒、AGL/AMSL 和观测时间不可混用；不要以当前渲染时间补造来源观测。
- 新样式优先放页面或组件所属文件，选择器限定作用域；不在结构重构中顺带改全局主题和布局。
- 固定 locale/时区的格式化器可在模块内复用；列表查找、搜索归一化和汇总尽量一次完成。优化前确认首条/末条匹配、原顺序、重复项、空值与异常行为，不为减少遍历改变业务语义。

### 页面体验模块

地图图标与设备详情使用 `devicePresentation.ts` 的明确来源类型分类；未知类型保持中性，不按名称或 `productKey` 猜测。`DeviceDetails` 仅为航空器和已提供有效飞行统计的机巢挂载飞行记录，来源身份与统计口径保持独立。区域定位只响应用户操作，不随轮询或底图切换重放。

需求助手及算法页的专属交互留在各自页面子目录；助手模板只生成可编辑的作业要求，不执行智能调度。`experience.css` 的窄屏外壳仅在本次更新的页面挂载时生效，不改变飞控和指挥大屏的视角或会话。空域文件导入、高度字段与保存约定见 [资源模块说明](../frontend/src/pages/resources/README.md) 和 [接口说明](API.md)。

## Java 实现规范

- 类名使用大驼峰，方法和变量使用小驼峰，常量使用大写下划线。使用构造器注入和 `private final` 依赖，优先表达领域含义而非抽象后缀。
- Controller 处理 HTTP 协议，Service 编排用例，Policy 承载复用规则，Repository 查询持久化，Integration 对接外部系统。不新增循环依赖。
- 入参复用 `Requests` 与 Jakarta Validation 的现有约定；权限及跨字段业务校验在服务端完成。返回继续采用现有响应对象，避免借整理字段改接口契约。
- 查询指定读事务，修改沿用完整业务事务。状态流转、数据保存和审计保持原子性；外部 I/O、身份刷新及并发处理遵守已有实现。
- `WorkflowService` 的 repository 访问器及 `visible` 纯可见性判断使用只读 `SUPPORTS`，避免列表逐条过滤时重复开启物理事务；已有外层事务继续参与，业务保存和审计仍沿用类级事务及回滚约定。不能用跨请求授权缓存替代账号、身份和业务权限复核。
- 对预期业务失败使用 `ApiException` 与稳定错误码，交由统一异常处理。不能捕获所有异常后返回成功、空数据或默认授权。
- 使用参数化 SQL；集合与流操作优先保证过滤顺序、空值和排序语义，不能在重构中改为并行流或依赖不稳定顺序。禁止用浮点数承载来源 ID。
- 新增迁移使用下一可用 Flyway 版本，检查当前分支已有文件后再编号。已执行迁移保持不变；单元测试与 H2 验证不替代 MySQL 兼容核验。
- 新代码采用显式 import 和项目邻近代码风格。阿里巴巴规范作为实现与审查原则，目前仓库没有自动执行的全量合规扫描，不能宣称静态扫描已通过。

## 业务规则与来源边界

任务分配页面和提交共同依赖 `TaskAssignmentPolicy` 的设备、飞手、组织、区域、授权和时段冲突规则。计划关联、保存及开始执行依赖 `FlightPlanTaskPolicy`。`Task.planId` 是一计划多任务的权威关系；保留已批计划复用、幂等请求内容检查、父计划锁和任务历史。

4A 校验个人身份及应用权限，本地账号保存岗位、组织、区域和设备业务授权。目录只读查询与本地投影分开；选中同一个外部用户不能重建业务编号或覆盖已有授权。来源服务账号不能替代当前用户身份进入飞控。

当前入口由 `App` 挂载 `FlightWorkspace`。嵌入模式签发和消费 60 秒一次性票据时都复核任务；网关文档进入使用 `entry`，已打开页面的接口、视频、静态资产和 WebSocket 使用 `continue`。任务到期或业务授权变化仅提示已打开页面，刷新/新开重新检查；身份失效、退出和换账号撤销凭证并清理子站身份。具体协议和验收见 [网关说明](../deploy/gateway/README.md)。

本地演示控件的“未发送设备指令”说明只适用于对应本地组件及尚未配置的命令适配器。嵌入原站保留其真实控制能力，自动化测试使用 mock，业务开发不能以演示说明为理由试点真实设备按钮。

来源 HTTP/JDBC/MQTT 数据保持授权范围及只读边界；本地业务写入独立业务库。来源未知字段、离线或过期观测不能补造成正常值。几何编辑保留额外维度和 Polygon 内环；本地 AGL 规划高度独立保存，不覆盖来源坐标 Z。

## 环境与验证入口

使用 Node.js 24、pnpm 10.33.0、JDK 21 和 Maven 3.9+。网关沿用 npm 及自己的 `package-lock.json`；前端沿用 pnpm 及 `pnpm-lock.yaml`。按对应锁文件安装，不混用包管理器或顺带升级依赖。

```bash
cd frontend
pnpm install --frozen-lockfile
cd ../deploy/gateway
npm ci --ignore-scripts --no-audit --no-fund
cd ../..
./scripts/check.sh
```

统一检查不加载 `.env`，不启动服务或 Docker，不部署、不导入业务数据，也不启用真实来源测试。后端检查清除继承的来源、数据库、Spring、平台配置和 JVM/Maven 注入选项，保留 `JAVA_HOME` 及 `PATH`；网关检查强制关闭可选 Docker 集成测试。它会生成被 Git 忽略的构建产物和测试报告；依赖须事先安装。Maven 首次运行可能需要下载公开依赖。

| 改动范围 | 根目录命令 | 覆盖 |
| --- | --- | --- |
| 前端 | `./scripts/check.sh frontend` | 限制为 2 个 worker 的 Vitest、TypeScript 检查与 Vite 构建 |
| 后端 | `./scripts/check.sh backend` | Maven 测试，强制关闭真实来源测试 |
| 网关 | `./scripts/check.sh gateway` | Node 测试与资产构建 |
| 维护脚本 | `./scripts/check.sh scripts` | Shell 语法、Node 合成测试、Python 打包合成测试 |
| 跨模块 | `./scripts/check.sh` | 依次执行以上检查，失败即停 |

先跑受影响定向测试，再执行对应入口；测试全绿后不重复扩大测试，除非继续改动或有未解决问题。macOS 若 `java` 与 Maven 使用不同 JDK，可显式选择：

```bash
JAVA_HOME="$(/usr/libexec/java_home -v 21)" ./scripts/check.sh backend
# 其他系统设置 JAVA_HOME 为本机 JDK 21 目录
```

定向命令示例：

```bash
cd frontend
pnpm exec vitest run src/api.test.ts src/App.authentication.test.tsx --maxWorkers=2
cd ../backend
SOURCE_LIVE_VERIFY=false mvn -B -ntp -Dtest=WorkflowIntegrationTest,TaskAssignmentOptionsIntegrationTest test
```

真实来源测试由 `SOURCE_LIVE_VERIFY=true` 单独启用，属于明确授权的联调，不进入普通 Agent 检查。页面或交互变更按需追加 Playwright；见 `frontend/playwright.config.ts` 与 `scripts/qa-*.mjs`，先核对目标环境及写请求策略，不连接生产进行写操作。Vitest 和构建通过不等于浏览器布局、WSS、视频或物理设备操作已验收。

## Agent 任务流程

1. 明确目标与验收条件，读对应页面、接口、策略及现有测试，检查工作区已有修改。
2. 选择最小完整改动；可并行时按文件所有权分工，避免共同修改同一模块。共用 `target` 的 Maven 任务串行运行。
3. 对复杂或已有失败的路径记录基线。缺陷测试验证输入、输出或可见行为，不绑定内部函数名；纯配置抽取使用现有回归测试。
4. 实现后检查差异，确认未改文案、默认值、权限、校验时序、状态、外部调用及迁移。发现原有缺陷时区分基线和本次影响。
5. 运行受影响检查；涉及接口、目录或业务约束时同步本规范、架构或接口文档。测试断言过期时按当前交互修正，保留原业务断言。
6. 交付说明包含变更文件、实际行为、执行的检查和结果，以及未验证部分。发布与生产操作按用户授权及部署文档执行。

给 Agent 的任务可直接使用以下模板：

```text
目标：<需要解决的具体问题>
范围：<页面、接口、策略及相关模块>
保持：<必须兼容的页面行为、协议和数据>
验收：<正常、失败、权限及边界场景>
验证：<对应 scripts/check.sh 范围和补充测试>
请先读取 AGENTS.md 与 docs/DEVELOPMENT.md，保留工作区已有改动，完成实现、验证及相关文档更新。
```
