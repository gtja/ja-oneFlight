# 资源管理页面

`Resources.tsx` 编排本地业务档案和只读来源目录；本目录维护页面字段、列、详情及空域文件导入交互。设备类型及飞行记录适用范围复用 `devicePresentation.ts`，来源在线状态和本地调度状态分别展示。

## 航线查看与按需请求

“航线资源 → 本地业务档案 → 选中记录 → 编辑档案”保留原有地图、航点及 AGL 规划高度编辑。来源目录的详情使用 `SourceRoutePreview` 展示只读航线：明确声明 WGS84 且完整合法时显示平面地图；基准未说明时显示无底图的点序示意和分页航点表，不转换坐标，也不把来源 Z 当成 AGL。缺失或非法几何显示具体原因，原始几何字段按需展开。管理员和调度可从详情的“查看本地航线档案”切换至本地目录，按名称搜索；该操作不创建、导入或自动关联档案。

业务组织完整目录只在打开登记、编辑或导入表单时读取；组织加载或失败单独提示并保留草稿。人员、航线和空域表单不启动设备目录轮询；设备、飞行记录及维护表单按实际用途查询。列表的分页、查询键、全局缓存时长及权限失效规则保持原约定。

空间资源弹窗的组织加载容器及禁用字段集须继续传递受限高度，字段和绘图内容在表单内部滚动，保存、取消及校验提示保留在可见操作区。桌面与窄屏均不能随边界点增加而把操作栏挤出弹窗。

## 空域档案

在“资源管理 → 空域资源 → 本地业务档案”中，管理员和调度人员可选择“批量导入”。文件须为 WGS84 的 `.geojson` 或 `.json`；支持 Polygon、Feature 和每条几何均为 Polygon 的 FeatureCollection。页面提供示例文件，不转换坐标或自动判断高度基准。

流程为选择文件、组织、区域并确认坐标 → 校验与范围预览 → 确认导入。逐条错误会阻止整批导入；高度缺失保持“未明确”，不阻止保存待确认档案。文件或选项修改会清除旧预览。预览有效期由后端返回，过期需重新预览；提交响应失败可以重试同一批次，后端返回已保存结果，避免重复创建。成功后刷新本地档案并反馈新增、跳过数量。

高度范围独立保存于 `metadata.airspaceProfile`，由 `reference`（`AGL`、`AMSL` 或 `null`）、`lowerHeightMeters`、`upperHeightMeters` 组成。数值须有限；填写高度时必须选择基准，离地高度非负，下限不得大于上限。前端辅助校验，后端负责最终校验与授权。

空域编辑器统一使用“边界点”。编辑外环保留内环、来源 Z 和额外维度；地图按 XY 展示完整平面范围。高度不写入 `geometryContext.flightProfile`，也不从来源 Z 推导。航线仍使用已有航点及 AGL 规划高度。

空域绘制可选择多边形、圆形或矩形。圆形按圆心和半径（米）调整，矩形按西南、东北对角点或四侧坐标调整，并可设为正方形；两种形状均通过地图两次单击建立范围。已有规则圆形和轴向矩形会自动识别，打开编辑或只改高度不重建原坐标。形状编辑保留原外环点序及各点附加维度、保留内环；切回多边形可继续逐点编辑。跨极点或日期变更线的圆形暂不支持。新增圆形用64个点近似，保存为标准 Polygon；再次编辑无需逐个修改这些采样点。

`metadata.geometryContext.airspaceShape` 仅记录可编辑形状参数，`metadata.geometry` 仍是详情和态势地图共用的权威范围。参数与几何不一致时以几何为准。资源保存和导入后统一刷新查询缓存，态势首页停留期间每30秒刷新资源，已打开的详情也跟随当前授权目录更新；区域筛选和空域图层开关继续生效。

## 定向验证

```sh
pnpm exec vitest run src/pages/resources/AirspaceImport.test.tsx src/pages/Resources.airspace.test.tsx src/components/GeometryInput.test.tsx src/components/GeometryInput.shapes.test.tsx src/airspaceShapes.test.ts src/geometry.test.ts src/pages/Overview.interactions.test.tsx src/pages/Resources.identity.test.tsx src/pages/Resources.sources.test.tsx src/pages/Resources.requests.test.tsx src/components/SourceRoutePreview.test.tsx --maxWorkers=2
```

测试仅使用合成组织、文件和几何，不连接来源或调用真实设备。API 契约见仓库 `docs/API.md`；完整前端检查使用根目录 `./scripts/check.sh frontend`。

绘图保存操作栏的浏览器回归在本地前端运行后执行：`QA_SPATIAL_LAYOUT_REGRESSIONS=true QA_BASE_URL=http://127.0.0.1:8088 pnpm exec playwright test`（在 `frontend` 目录）。该组测试拦截全部业务 API，使用合成数据，验证三个点及八个点、校验错误后、桌面及窄屏的保存按钮可点击，并检查一次保存得到完整闭合范围。另覆盖已有圆形/矩形识别、连续参数输入焦点、直接保存、正方形按钮、保存后态势首页同步及再次编辑回读，不写实际业务库。
