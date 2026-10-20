#!/usr/bin/env node
import { promises as fs } from "node:fs";
import path from "node:path";
import { createHash, randomBytes } from "node:crypto";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const NAMESPACE = "oneflight.business-initialization.v1";
const ORIGIN = "BUSINESS_INITIALIZATION";
const NOTE =
  "平台初始化登记：本地工作项，保留来源说明，不代表实际飞行、监管审批或资质认证。";
const ROLE_NAMES = {
  DISPATCH: "运营调度岗",
  DEPARTMENT: "需求受理岗",
  PILOT: "飞行排班岗",
};
const RESOURCE_FIELDS = [
  "title",
  "kind",
  "region",
  "organizationId",
  "status",
  "model",
  "sourceDeviceId",
  "productKey",
  "sn",
  "longitude",
  "latitude",
  "metadata",
];

export function provenanceKey(group, key) {
  return `${NAMESPACE}:${group}:${key}`;
}
function provenance(group, key, description = NOTE) {
  return { origin: ORIGIN, key: provenanceKey(group, key), description };
}
function recordOrigin(record) {
  return record.provenance || record.metadata?.provenance || {};
}
function imported(record) {
  return (
    ["SOURCE_IMPORT", "SOURCE_IMPORTED"].includes(record.provenance?.origin) ||
    ["SOURCE_IMPORT", "SOURCE_IMPORTED"].includes(
      record.metadata?.sourceImport?.origin,
    )
  );
}
function sortIds(rows) {
  return [...rows].sort((a, b) => String(a.id).localeCompare(String(b.id)));
}
export function selectTaskPlan(task, plans) {
  if (task.scene === "资料核对") return null;
  const taskStart = Date.parse(task.startAt),
    taskEnd = Date.parse(task.endAt);
  if (
    !Number.isFinite(taskStart) ||
    !Number.isFinite(taskEnd) ||
    taskEnd <= taskStart
  )
    return null;
  return (
    [...plans]
      .filter(
        (plan) =>
          plan &&
          ["DAILY", "LONG_TERM"].includes(plan.kind) &&
          ["DRAFT", "PENDING_REVIEW", "RETURNED", "APPROVED"].includes(
            plan.status,
          ) &&
          plan.organizationId === task.organizationId &&
          plan.region === task.region &&
          Date.parse(plan.startAt) <= taskStart &&
          Date.parse(plan.endAt) >= taskEnd,
      )
      .sort(
        (a, b) =>
          Number(b.status === "APPROVED") - Number(a.status === "APPROVED") ||
          Date.parse(a.endAt) -
            Date.parse(a.startAt) -
            (Date.parse(b.endAt) - Date.parse(b.startAt)),
      )[0]?.id || null
  );
}
function pickBody(record) {
  return Object.fromEntries(
    RESOURCE_FIELDS.map((key) => [key, record[key] ?? null]),
  );
}
function safeError(error) {
  return error instanceof Error ? error.message : "初始化未完成";
}
function nextShanghaiDay(now = new Date()) {
  const day = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);
  return new Date(new Date(`${day}T12:00:00+08:00`).getTime() + 86400000)
    .toISOString()
    .slice(0, 10);
}
function instant(day, offset, hour = 9) {
  return new Date(
    new Date(`${day}T${String(hour).padStart(2, "0")}:00:00+08:00`).getTime() +
      offset * 86400000,
  ).toISOString();
}
function dateOnly(value) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date(value));
}

function argumentsFor(argv) {
  const options = {
    apply: false,
    activateDevices: false,
    attachSnapshots: false,
    region: "余杭区",
    date: nextShanghaiDay(),
    envFile: path.join(ROOT, ".env"),
    stateDir: path.join(ROOT, ".local", "business-initialization"),
    mediaManifest: path.join(
      ROOT,
      ".local",
      "real-data-audit",
      "verified-media-manifest.json",
    ),
  };
  const values = {
    "--base-url": "baseUrl",
    "--env-file": "envFile",
    "--state-dir": "stateDir",
    "--media-manifest": "mediaManifest",
    "--region": "region",
    "--date": "date",
  };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--apply") options.apply = true;
    else if (arg === "--activate-devices") options.activateDevices = true;
    else if (arg === "--attach-snapshots") options.attachSnapshots = true;
    else if (arg === "--help" || arg === "-h") options.help = true;
    else if (values[arg] && argv[i + 1] && !argv[i + 1].startsWith("--"))
      options[values[arg]] = argv[++i];
    else throw new Error(`参数不正确：${arg}`);
  }
  if (
    !/^\d{4}-\d{2}-\d{2}$/.test(options.date) ||
    Number.isNaN(Date.parse(`${options.date}T09:00:00+08:00`)) ||
    dateOnly(`${options.date}T09:00:00+08:00`) !== options.date
  )
    throw new Error("--date 须为有效的 YYYY-MM-DD 日期");
  if (!options.region.trim()) throw new Error("--region 不能为空");
  options.envFile = path.resolve(options.envFile);
  options.stateDir = path.resolve(options.stateDir);
  options.mediaManifest = path.resolve(options.mediaManifest);
  return options;
}
async function readEnvironment(filename) {
  const env = {};
  for (const line of (await fs.readFile(filename, "utf8")).split(/\r?\n/)) {
    const match = line.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/);
    if (!match) continue;
    let value = match[2];
    if (value.startsWith('"') && value.endsWith('"')) {
      try {
        value = JSON.parse(value);
      } catch {
        throw new Error("私有配置的引号格式不正确");
      }
    } else if (value.startsWith("'") && value.endsWith("'"))
      value = value.slice(1, -1);
    env[match[1]] = value;
  }
  return env;
}
class Client {
  cookies = new Map();
  constructor(baseUrl) {
    const url = new URL(baseUrl);
    if (
      !["http:", "https:"].includes(url.protocol) ||
      url.username ||
      url.password ||
      url.pathname !== "/" ||
      url.search ||
      url.hash
    )
      throw new Error("--base-url 须为不含凭据、路径和查询参数的站点地址");
    if (
      url.protocol === "http:" &&
      !["127.0.0.1", "localhost", "[::1]"].includes(url.hostname)
    )
      throw new Error("远程初始化地址须使用 HTTPS");
    this.baseUrl = url.origin;
  }
  async request(route, method = "GET", body) {
    const headers = {
      Cookie: [...this.cookies]
        .map(([key, value]) => `${key}=${value}`)
        .join("; "),
    };
    if (method !== "GET") {
      const csrf = await this.request("/api/v1/auth/csrf");
      headers[csrf.headerName] = csrf.token;
      headers.Cookie = [...this.cookies]
        .map(([key, value]) => `${key}=${value}`)
        .join("; ");
    }
    if (body && !(body instanceof FormData))
      headers["Content-Type"] = "application/json";
    const response = await fetch(`${this.baseUrl}${route}`, {
      method,
      headers,
      body: body
        ? body instanceof FormData
          ? body
          : JSON.stringify(body)
        : undefined,
      redirect: "error",
      signal: AbortSignal.timeout(30000),
    });
    for (const cookie of response.headers.getSetCookie()) {
      const pair = cookie.split(";", 1)[0],
        index = pair.indexOf("=");
      this.cookies.set(pair.slice(0, index), pair.slice(index + 1));
    }
    let payload;
    try {
      payload = await response.json();
    } catch {
      throw new Error(`${method} ${route.split("?")[0]}：响应格式不正确`);
    }
    if (!response.ok)
      throw new Error(
        `${method} ${route.split("?")[0]}：HTTP ${response.status}，${String(payload.code || "REQUEST_FAILED").replace(/[^A-Z0-9_-]/gi, "")}`,
      );
    return route === "/v3/api-docs" ? payload : payload.data;
  }
  get(route) {
    return this.request(route);
  }
  write(route, body, method = "POST") {
    return this.request(route, method, body);
  }
  async list(route) {
    const rows = [];
    let expected;
    for (let page = 1; page <= 10000; page++) {
      const separator = route.includes("?") ? "&" : "?";
      const data = await this.get(
        `${route}${separator}page=${page}&pageSize=100`,
      );
      if (
        !Array.isArray(data?.items) ||
        !Number.isSafeInteger(data.total) ||
        data.total < 0
      )
        throw new Error(`${route}：分页响应不正确`);
      expected ??= data.total;
      if (expected !== data.total)
        throw new Error(`${route}：读取期间数量变化，请重新预览`);
      rows.push(...data.items);
      if (rows.length >= expected) return rows;
      if (!data.items.length) break;
    }
    throw new Error(`${route}：未取得完整分页，停止初始化`);
  }
}

export function buildDefinitions({
  region,
  organizationId,
  date,
  devices,
  people,
  routes,
  algorithms,
  events,
  checks,
}) {
  const base = { region, organizationId };
  const linked = (record) => record?.id || null;
  const firstAlgorithm =
    algorithms.find((a) =>
      /火|烟|fire|smoke/i.test(
        `${a.name || ""} ${(a.categories || []).join(" ")}`,
      ),
    ) || algorithms[0];
  const secondAlgorithm =
    algorithms.find((a) =>
      /道路|车辆|占道|交通|vehicle|traffic/i.test(
        `${a.name || ""} ${(a.categories || []).join(" ")}`,
      ),
    ) ||
    algorithms.find((a) => a.id !== firstAlgorithm?.id) ||
    firstAlgorithm;
  const forestEvent =
    events.find((e) => e.eventType === "smoke") ||
    events.find((e) =>
      /火|烟|fire|smoke/i.test(`${e.title || ""} ${e.eventType || ""}`),
    );
  const roadEvent =
    events.find((e) => e.eventType === "car") ||
    events.find((e) =>
      /道路|车辆|占道|交通|vehicle|traffic/i.test(
        `${e.title || ""} ${e.eventType || ""}`,
      ),
    );
  const plans = [
    ["daily", "林缘巡查日常飞行计划", "DAILY", "APPROVED", devices[0], 0, 1],
    [
      "long-term",
      "重点巡查区域周期飞行计划",
      "LONG_TERM",
      "DRAFT",
      routes[0],
      0,
      30,
    ],
    [
      "device-admission",
      "巡查航空器设备准入材料登记",
      "DEVICE_ADMISSION",
      "PENDING_REVIEW",
      devices[1],
      0,
      7,
    ],
    [
      "pilot-admission",
      "飞行人员准入材料登记",
      "PILOT_ADMISSION",
      "DRAFT",
      people[0],
      0,
      7,
    ],
  ].map(([key, title, kind, target, resource, start, end]) => ({
    group: "plans",
    key,
    target,
    body: {
      ...base,
      title,
      kind,
      startAt: instant(date, start),
      endAt: instant(date, end, 18),
      height: null,
      scope: kind.endsWith("ADMISSION")
        ? `收集${region}巡查作业所需准入材料，核对关联档案、使用范围及资格材料。证照编号、有效期和外部回执待提供后登记。`
        : `安排${region}重点区域巡查准备，核对关联航线、工作时段、资料清单和协同人员，实际作业范围由运营人员进一步确认。`,
      resourceId: linked(resource),
      taskId: null,
      materialName: kind.endsWith("ADMISSION") ? "准入材料待收集与核验" : null,
      materialNumber: null,
      validFrom: null,
      validUntil: null,
      receiptNumber: null,
      receiptBasis: null,
      provenance: provenance("plans", key),
    },
  }));
  const tasks = [
    [
      "forest-preparation",
      "林缘重点区域巡查需求整理",
      "森林防火",
      "DRAFT",
      0,
      9,
    ],
    [
      "mineral-reception",
      "矿区边界巡查需求受理",
      "矿产监管",
      "PENDING_ASSIGNMENT",
      0,
      11,
    ],
    [
      "road-reception",
      "重点路段秩序巡查需求受理",
      "非现执法",
      "PENDING_ASSIGNMENT",
      1,
      9,
    ],
    ["scope-supplement", "重点区域巡查范围补充", "森林防火", "RETURNED", 1, 11],
    [
      "forest-scheduling",
      "林缘巡查资源排班",
      "森林防火",
      "PENDING_EXECUTION",
      2,
      9,
      0,
    ],
    [
      "mineral-scheduling",
      "矿区外围巡查资源排班",
      "矿产监管",
      "PENDING_EXECUTION",
      2,
      11,
      1,
    ],
  ].map(([key, title, scene, target, day, hour, deviceIndex]) => ({
    group: "tasks",
    key,
    target,
    deviceIndex,
    body: {
      ...base,
      title,
      scene,
      description: `整理${region}${scene}巡查需求，明确重点区域、工作时段、资料清单与成果格式，按需求受理情况安排资源。`,
      priority: "NORMAL",
      startAt: instant(date, day, hour),
      endAt: instant(date, day, hour + 1),
      planId: null,
      resultSummary: null,
      provenance: provenance("tasks", key),
    },
  }));
  if (checks)
    for (const [key, title, target, check, resultSummary] of [
      [
        "authorized-device-audit",
        "授权设备资料核对",
        "EXECUTING",
        checks.devices,
        `本次真实读取授权设备目录 ${checks.devices.count} 条，清单已读取，差异复核继续办理。`,
      ],
      [
        "route-index-audit",
        "航线索引核对",
        "PENDING_ACCEPTANCE",
        checks.routes,
        `本次真实读取航线索引 ${checks.routes.count} 条，其中可读几何 ${checks.routes.geometryCount} 条；几何可读不代表已批准飞行范围。`,
      ],
      [
        "media-integrity-audit",
        "媒体归档核验",
        "COMPLETED",
        checks.media,
        `本次校验 ${checks.media.count} 份真实原件，文件大小与 SHA256 均与来源清单相符。SHA256：${(checks.media.checksums || []).join("；")}。拍摄时间与真实架次关联待核实。`,
      ],
    ])
      tasks.push({
        group: "tasks",
        key,
        target,
        deviceIndex: key === "route-index-audit" ? 1 : 0,
        verification: true,
        resultSummary: `${resultSummary} 本系统资料核对工作已按当前读取结果登记。`,
        body: {
          ...base,
          title,
          scene: "资料核对",
          description:
            "核对当前授权目录、航线索引和归档原件，记录读取数量、几何可读性与文件完整性校验结果，供运营人员复核。",
          priority: "NORMAL",
          startAt: check.startedAt,
          endAt: check.finishedAt,
          planId: null,
          resultSummary: null,
          provenance: provenance("tasks", key),
        },
      });
  const maintenance = [
    ["aircraft-inspection", "航空器电池与桨叶例行检查安排", devices[0], 0],
    ["communication-inspection", "航空器定位与通信例行检查安排", devices[1], 1],
  ].map(([key, title, device, offset]) => ({
    group: "resources",
    key,
    target: "ACTIVE",
    body: {
      ...base,
      title,
      kind: "MAINTENANCE",
      status: "ACTIVE",
      metadata: {
        origin: ORIGIN,
        provenance: provenance("resources", key),
        deviceId: device?.sourceDeviceId || null,
        maintenanceAt: dateOnly(instant(date, offset)),
        description:
          key === "aircraft-inspection"
            ? "安排电池外观与充放电记录、桨叶连接和机身状态例行检查，待检查后登记结果。"
            : "安排定位、图传与通信链路例行检查，核对运行记录及异常项目，待实施后补充结论。",
      },
    },
  }));
  const cases = [
    ["forest-risk", "林缘用火风险核查", "森林防火"],
    ["mineral-boundary", "矿区边界与裸土变化核查", "矿产监管"],
    ["road-order", "来源观测资料核查", "非现执法"],
    ["insufficient-materials", "巡查资料补充核对", "森林防火", "ARCHIVED"],
  ].map(([key, title, scene, target]) => ({
    group: "cases",
    key,
    target: target || "PENDING_REVIEW",
    body: {
      ...base,
      title,
      scene,
      description:
        key === "road-order"
          ? "核对来源原始观测、出处与资料完整性，补充位置和观测时间后人工复核。人员识别仅作为待核查信息，原件拍摄时间及真实架次关联尚待核实。"
          : "整理巡查待核查事项，核对线索出处、工作范围和资料完整性，补充原始资料后提交人工复核。",
      taskId: null,
      conclusion: null,
      provenance: provenance("cases", key),
    },
  }));
  const consultations = [
    ["plan-materials", "日常巡查计划申报材料咨询", "CONSULTATION", "OPEN"],
    [
      "result-files",
      "巡查成果文件整理规范咨询",
      "CONSULTATION",
      "ANSWERED",
      "本平台任务可填写成果摘要并上传现场材料，由需求部门办理验收。请核对设备、日期、文件来源与实际执行情况；本答复仅为平台操作指引。",
    ],
    ["emergency-training", "设备操作与应急处置培训安排", "TRAINING", "OPEN"],
    [
      "route-training",
      "航线与飞行范围登记培训安排",
      "TRAINING",
      "ANSWERED",
      "可先核对真实航线档案与来源坐标说明；现场培训排期、授课人员和签到另行登记。本条仅答复准备事项，未记录培训完成或颁发证书。",
    ],
  ].map(([key, title, kind, target, reply]) => ({
    group: "consultations",
    key,
    target,
    reply,
    body: {
      ...base,
      title,
      kind,
      description:
        kind === "TRAINING"
          ? "请协助明确培训准备材料、场地和排期要求，授课安排及签到记录待组织后补充。"
          : "请说明平台业务办理所需资料、提交方式与核对要点，便于需求部门准备。",
      provenance: provenance("consultations", key),
    },
  }));
  const algorithmResources = [
    [
      "forest-dataset",
      "林缘火情识别样本待标注台账",
      "ALGORITHM_DATASET",
      "PENDING_LABELING",
      firstAlgorithm,
      forestEvent,
    ],
    [
      "road-dataset",
      "道路秩序识别样本待标注台账",
      "ALGORITHM_DATASET",
      "PENDING_LABELING",
      secondAlgorithm,
      roadEvent,
    ],
    [
      "forest-training",
      "林缘火情识别训练配置",
      "ALGORITHM_TRAINING",
      "PENDING_CONFIGURATION",
      firstAlgorithm,
      forestEvent,
    ],
    [
      "road-training",
      "道路秩序识别训练配置",
      "ALGORITHM_TRAINING",
      "PENDING_CONFIGURATION",
      secondAlgorithm,
      roadEvent,
    ],
  ].map(([key, title, kind, target, algorithm, event]) => ({
    group: "resources",
    key,
    target,
    body: {
      ...base,
      title,
      kind,
      status: target,
      metadata: {
        origin: ORIGIN,
        provenance: provenance("resources", key),
        description:
          kind === "ALGORITHM_DATASET"
            ? "收集并核对原始观测，准备标注规则和样本清单；当前标签未确认、样本数量待核验。"
            : "整理训练目标、标注要求与服务接入配置；训练服务未接通，等待配置后再提交。",
        algorithmId: linked(algorithm),
        sourceEventId: linked(event),
        labelState: "UNLABELED",
        trainingProvider: "NOT_CONFIGURED",
        sampleCount: null,
      },
    },
  }));
  return [
    ...plans,
    ...tasks,
    ...maintenance,
    ...cases,
    ...consultations,
    ...algorithmResources,
  ];
}

async function privateJson(filename, value) {
  await fs.mkdir(path.dirname(filename), { recursive: true, mode: 0o700 });
  await fs.chmod(path.dirname(filename), 0o700);
  const temporary = `${filename}.${process.pid}.tmp`;
  await fs.writeFile(temporary, JSON.stringify(value, null, 2), {
    mode: 0o600,
  });
  await fs.chmod(temporary, 0o600);
  await fs.rename(temporary, filename);
}
async function readJson(filename, fallback) {
  try {
    return JSON.parse(await fs.readFile(filename, "utf8"));
  } catch (error) {
    if (error.code === "ENOENT") return fallback;
    throw new Error("私有初始化状态文件无法读取，未执行写入");
  }
}
async function verifiedMedia(filename) {
  const manifest = await readJson(filename, null);
  if (!manifest || !Array.isArray(manifest.items)) return [];
  const items = [];
  const auditRoot = path.resolve(ROOT, ".local", "real-data-audit");
  for (const item of manifest.items) {
    const file = path.resolve(ROOT, String(item.localFile || ""));
    if (
      !file.startsWith(`${auditRoot}${path.sep}`) ||
      !/^[a-f0-9]{64}$/i.test(item.sha256 || "")
    )
      throw new Error("原件清单路径或校验值不正确，未执行写入");
    const stat = await fs.lstat(file);
    if (
      !stat.isFile() ||
      stat.isSymbolicLink() ||
      stat.size !== item.sizeBytes ||
      stat.size > 100 * 1024 * 1024
    )
      throw new Error("原件文件类型或大小校验失败，未执行写入");
    const bytes = await fs.readFile(file);
    const jpeg = bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
    const png = bytes
      .subarray(0, 8)
      .equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
    if (
      (!jpeg && !png) ||
      createHash("sha256").update(bytes).digest("hex") !==
        item.sha256.toLowerCase()
    )
      throw new Error("原件签名或 SHA256 校验失败，未执行写入");
    items.push({
      ...item,
      file,
      contentType: jpeg ? "image/jpeg" : "image/png",
      suffix: jpeg ? "jpg" : "png",
    });
  }
  return items;
}
function findOwned(rows, group, key) {
  const matches = rows.filter(
    (row) => recordOrigin(row).key === provenanceKey(group, key),
  );
  if (matches.length > 1)
    throw new Error(`初始化键重复：${group}/${key}，请人工核对`);
  if (matches[0] && recordOrigin(matches[0]).origin !== ORIGIN)
    throw new Error(`初始化键来源冲突：${group}/${key}`);
  return matches[0];
}
async function contractProblems(api) {
  let document;
  try {
    document = await api.get("/v3/api-docs");
  } catch {
    return ["OpenAPI 文档不可用，无法确认来源字段契约"];
  }
  const problems = [];
  for (const group of ["tasks", "plans", "cases", "consultations", "users"]) {
    let schema =
      document.paths?.[`/api/v1/${group}`]?.post?.requestBody?.content?.[
        "application/json"
      ]?.schema;
    if (schema?.$ref)
      schema = schema.$ref
        .slice(2)
        .split("/")
        .reduce((value, key) => value?.[key], document);
    if (!schema?.properties?.provenance)
      problems.push(`${group} 尚未提供 provenance 输入契约`);
  }
  return problems;
}
function csvCell(value) {
  let text = value === null || value === undefined ? "" : String(value);
  if (/^[=+\-@]/.test(text)) text = `'${text}`;
  return `"${text.replaceAll('"', '""')}"`;
}
function snapshotCsv(resources, catalog, recordedAt) {
  const live = new Map(catalog.map((device) => [String(device.id), device]));
  const rows = [
    [
      "档案类型",
      "本地档案ID",
      "来源ID",
      "来源系统",
      "读取时间",
      "本地状态",
      "来源设备类型",
      "累计架次",
      "累计时长秒",
      "累计距离米",
      "航线几何状态",
      "说明",
    ],
  ];
  for (const r of resources.filter(
    (resource) =>
      imported(resource) && ["DEVICE", "ROUTE"].includes(resource.kind),
  )) {
    const metadata = r.metadata || {},
      source = r.provenance || metadata.sourceImport || {},
      device = live.get(String(r.sourceDeviceId)),
      totals = device?.flightTotals;
    rows.push([
      r.kind,
      r.id,
      r.sourceDeviceId || source.sourceId || source.id,
      source.sourceSystem || source.system,
      recordedAt,
      r.status,
      device?.type || metadata.sourceDeviceType,
      totals?.sorties ?? null,
      totals?.timeSeconds ?? null,
      totals?.distanceMeters ?? null,
      metadata.geometryStatus || null,
      "真实来源档案读取快照；未知值留空；不是现场执行成果或已确认执法证据",
    ]);
  }
  return "\uFEFF" + rows.map((row) => row.map(csvCell).join(",")).join("\r\n");
}

export async function runSeed(options, api, logger = console.log) {
  const me = await api.get("/api/v1/auth/me");
  if (me.role !== "ADMIN") throw new Error("初始化需要本地管理员账号");
  const inventory = {};
  for (const group of [
    "tasks",
    "plans",
    "resources",
    "cases",
    "consultations",
    "users",
  ])
    inventory[group] = await api.list(`/api/v1/${group}`);
  const checks = {},
    beginDevices = new Date();
  const catalog = await api.list("/api/v1/devices");
  checks.devices = {
    count: catalog.length,
    startedAt: beginDevices.toISOString(),
    finishedAt: new Date(
      Math.max(Date.now(), beginDevices.getTime() + 1),
    ).toISOString(),
  };
  const beginRoutes = new Date();
  let sourceRoutes = [],
    routeAvailability = "AVAILABLE";
  try {
    sourceRoutes = await api.list("/api/v1/source-data/routes");
  } catch {
    routeAvailability = "UNAVAILABLE";
  }
  checks.routes = {
    count: sourceRoutes.length,
    geometryCount: sourceRoutes.filter(
      (r) => r.geometry && r.geometryStatus === "AVAILABLE",
    ).length,
    startedAt: beginRoutes.toISOString(),
    finishedAt: new Date(
      Math.max(Date.now(), beginRoutes.getTime() + 1),
    ).toISOString(),
  };
  const algorithms = await api.list("/api/v1/algorithms");
  const config = await api.get("/api/v1/config"),
    settings = await api.list("/api/v1/settings");
  const settingKeys = new Set(settings.map((s) => s.id || s.key));
  const missingSettings = Object.fromEntries(
    [
      "platformName",
      "defaultRegion",
      "mapStyleUrl",
      "mapSatelliteUrl",
      "mapTerrainUrl",
    ]
      .filter(
        (key) =>
          !settingKeys.has(key) &&
          typeof config[key] === "string" &&
          config[key].trim(),
      )
      .map((key) => [key, config[key]]),
  );
  const beginMedia = new Date(),
    media = await verifiedMedia(options.mediaManifest);
  checks.media = {
    count: media.length,
    checksums: media.map((item) => item.sha256),
    startedAt: beginMedia.toISOString(),
    finishedAt: new Date(
      Math.max(Date.now(), beginMedia.getTime() + 1),
    ).toISOString(),
  };
  const events = [];
  let eventAvailability = "AVAILABLE";
  for (const eventType of ["fire_detection", "smoke", "car"]) {
    try {
      const data = await api.get(
        `/api/v1/source-data/events?eventType=${eventType}&page=1&pageSize=1`,
      );
      if (!Array.isArray(data?.items)) throw new Error();
      events.push(
        ...data.items.filter((event) => event.eventType === eventType),
      );
    } catch {
      eventAvailability = "PARTIALLY_UNAVAILABLE";
    }
  }
  const localSource = inventory.resources.filter(
    (r) => imported(r) && r.organizationId === me.organizationId,
  );
  const liveIds = new Map(catalog.map((r) => [String(r.id), r]));
  const aircraft = sortIds(
    localSource.filter(
      (r) =>
        r.kind === "DEVICE" &&
        liveIds.get(String(r.sourceDeviceId))?.type === "UAV",
    ),
  );
  const people = sortIds(localSource.filter((r) => r.kind === "PERSON")),
    routes = sortIds(localSource.filter((r) => r.kind === "ROUTE"));
  const stateFile = path.join(options.stateDir, "state.json"),
    accountFile = path.join(options.stateDir, "accounts.json");
  const state = await readJson(stateFile, {
    namespace: NAMESPACE,
    origin: api.baseUrl,
    organizationId: me.organizationId,
    date: options.date,
    deviceIds: [],
    records: {},
  });
  if (
    state.namespace !== NAMESPACE ||
    state.origin !== api.baseUrl ||
    state.organizationId !== me.organizationId
  )
    throw new Error("状态目录属于其他站点或组织，请指定独立 --state-dir");
  if (state.region && state.region !== options.region)
    throw new Error(
      "初始化工作区域与首次运行不一致，保留已有记录；请使用相同 --region",
    );
  const devices = state.deviceIds.length
    ? state.deviceIds
        .map((id) => aircraft.find((r) => r.id === id))
        .filter(Boolean)
    : aircraft.slice(0, 2);
  if (state.deviceIds.length && devices.length !== state.deviceIds.length)
    throw new Error("已选设备不再可见，停止初始化，不自动替换设备");
  const definitions = buildDefinitions({
    ...options,
    date: state.date,
    organizationId: me.organizationId,
    devices,
    people,
    routes,
    algorithms,
    events,
    checks,
  });
  const blocked = await contractProblems(api);
  if (devices.length < 2)
    blocked.push("须先导入当前组织至少两台仍获来源授权的真实 UAV 调度档案");
  if (!people.length)
    blocked.push(
      "须先导入当前组织至少一条真实 PERSON 档案；保留已有手工人员档案",
    );
  if (!routes.length) blocked.push("须先导入当前组织至少一条真实 ROUTE 档案");
  if (!algorithms.length)
    blocked.push("真实算法目录不可为空，不能凭空创建算法关联");
  if (routeAvailability !== "AVAILABLE" || !sourceRoutes.length)
    blocked.push("真实来源航线索引不可用，不能记录航线核对已完成");
  if (!media.length)
    blocked.push(
      "未取得经大小及 SHA256 验证的真实原件，不能记录媒体核验已完成",
    );
  const preview = {
    mode: options.apply ? "APPLY" : "PREVIEW",
    region: options.region,
    scheduleDate: state.date,
    importedAssociations: {
      aircraft: devices.length,
      people: people.length,
      routes: routes.length,
      algorithms: algorithms.length,
    },
    sourceEvents: eventAvailability,
    verifiedCounts: {
      devices: checks.devices.count,
      routes: checks.routes.count,
      routeGeometry: checks.routes.geometryCount,
      originalMedia: checks.media.count,
    },
    missingSettingKeys: Object.keys(missingSettings),
    activateAtMostTwoDevices: options.activateDevices,
    attachReadOnlySnapshots: options.attachSnapshots,
    roles: Object.values(ROLE_NAMES),
    records: definitions.map((d) => ({
      group: d.group,
      key: provenanceKey(d.group, d.key),
      title: d.body.title,
      kind: d.body.kind || d.body.scene,
      targetStatus: d.target,
      operation: findOwned(inventory[d.group], d.group, d.key)
        ? "KEEP_EXISTING"
        : "CREATE",
    })),
    blocked,
  };
  logger(JSON.stringify(preview, null, 2));
  if (!options.apply) return preview;
  if (blocked.length)
    throw new Error(
      "预检未通过，未写入业务数据；请按预览中的 blocked 补齐接口或真实来源导入",
    );
  await fs.mkdir(options.stateDir, { recursive: true, mode: 0o700 });
  await fs.chmod(options.stateDir, 0o700);
  const lockFile = path.join(options.stateDir, ".lock");
  let lock;
  try {
    lock = await fs.open(lockFile, "wx", 0o600);
  } catch {
    throw new Error("已有初始化锁，请先确认没有并行运行；未执行写入");
  }
  const summary = {
    created: {},
    kept: {},
    resumed: {},
    activatedDevices: 0,
    actions: 0,
    attachments: 0,
    settingsCreated: 0,
    deferred: [],
  };
  const persist = async () => privateJson(stateFile, state);
  try {
    await lock.writeFile(String(process.pid));
    state.deviceIds = devices.map((d) => d.id);
    state.region ??= options.region;
    await persist();
    const currentSettings = new Set(
      (await api.list("/api/v1/settings")).map((s) => s.id || s.key),
    );
    for (const [key, value] of Object.entries(missingSettings))
      if (!currentSettings.has(key)) {
        await api.write(
          `/api/v1/settings/${encodeURIComponent(key)}`,
          { value },
          "PUT",
        );
        summary.settingsCreated++;
      }
    const secrets = await readJson(accountFile, {
      namespace: NAMESPACE,
      origin: api.baseUrl,
      organizationId: me.organizationId,
      accounts: {},
    });
    if (
      secrets.origin !== api.baseUrl ||
      secrets.organizationId !== me.organizationId
    )
      throw new Error("私有岗位账号文件不属于当前站点或组织");
    const accounts = {};
    for (const [role, displayName] of Object.entries(ROLE_NAMES)) {
      const key = role.toLowerCase(),
        existing = findOwned(inventory.users, "users", key);
      if (existing) {
        if (
          existing.role !== role ||
          existing.organizationId !== me.organizationId
        )
          throw new Error(
            "已有初始化岗位角色或组织已改变，保留该账号并停止分配",
          );
        accounts[role] = existing;
        continue;
      }
      const username = `biz_${key}_${createHash("sha256").update(`${NAMESPACE}:${me.organizationId}`).digest("hex").slice(0, 8)}`;
      if (inventory.users.some((u) => u.username === username))
        throw new Error("岗位登录名已被其他账号使用，不覆盖既有账号");
      secrets.accounts[role] ||= {
        username,
        password: randomBytes(24).toString("base64url"),
        displayName,
        purpose: "本地流程岗位，非实名认证人员，未核验飞行资质",
      };
      await privateJson(accountFile, secrets);
      const account = await api.write("/api/v1/users", {
        username,
        password: secrets.accounts[role].password,
        displayName,
        role,
        organizationId: me.organizationId,
        regions: [options.region],
        deviceIds: devices.map((d) => d.id),
        enabled: true,
        organizationIds: [],
        provenance: provenance(
          "users",
          key,
          "平台初始化登记的本地流程岗位；不是来源人员实名账号、认证飞手或监管授权。仅限本组织、指定区域和两台本地设备。",
        ),
      });
      if (recordOrigin(account).key !== provenanceKey("users", key))
        throw new Error("后端未返回岗位来源键，停止后续创建");
      accounts[role] = account;
      inventory.users.push(account);
      secrets.accounts[role].id = account.id;
      await privateJson(accountFile, secrets);
    }
    if (options.activateDevices)
      for (let i = 0; i < devices.length; i++) {
        const current = await api.get(
          `/api/v1/resources/${encodeURIComponent(devices[i].id)}`,
        );
        if (current.status === "ACTIVE") {
          devices[i] = current;
          continue;
        }
        if (current.status !== "PENDING_CONFIRMATION") {
          summary.deferred.push("保留已选设备现有状态，未自动激活");
          devices[i] = current;
          continue;
        }
        const body = pickBody(current);
        body.status = "ACTIVE";
        body.region = options.region;
        body.metadata = {
          ...(current.metadata || {}),
          description: `${current.metadata?.description || ""}\n平台初始化登记：本地排班区域设为${options.region}，不是来源行政区认定；仅用于本地资料办理与排班准备。`,
        };
        devices[i] = await api.write(
          `/api/v1/resources/${encodeURIComponent(current.id)}`,
          body,
          "PUT",
        );
        summary.activatedDevices++;
        inventory.resources = inventory.resources.map((resource) =>
          resource.id === current.id ? devices[i] : resource,
        );
      }
    const created = new Map();
    const uploadMedia = async (record) => {
      const attachments = await api.list(
        `/api/v1/attachments?taskId=${encodeURIComponent(record.id)}`,
      );
      for (const item of media) {
        const filename = `来源原始观测-${item.sha256.slice(0, 16)}.${item.suffix}`;
        if (attachments.some((a) => (a.filename || a.fileName) === filename))
          continue;
        const bytes = await fs.readFile(item.file);
        if (
          createHash("sha256").update(bytes).digest("hex") !==
          item.sha256.toLowerCase()
        )
          throw new Error("上传前原件发生变化，停止办理归档核验");
        const data = new FormData();
        data.set("taskId", record.id);
        data.set(
          "file",
          new Blob([bytes], { type: item.contentType }),
          filename,
        );
        await api.write("/api/v1/attachments", data);
        summary.attachments++;
      }
    };
    for (const definition of definitions) {
      const { group, key } = definition,
        existing = findOwned(inventory[group], group, key);
      const identity = provenanceKey(group, key),
        checkpoint = state.records[identity];
      let resumable = Boolean(
        existing &&
        checkpoint &&
        !checkpoint.workflowComplete &&
        checkpoint.id === existing.id &&
        checkpoint.updatedAt === existing.updatedAt &&
        checkpoint.status === existing.status,
      );
      if (resumable) {
        const latest = await api.get(
          `/api/v1/${group}/${encodeURIComponent(existing.id)}`,
        );
        resumable =
          latest.updatedAt === checkpoint.updatedAt &&
          latest.status === checkpoint.status;
      }
      if (existing && !resumable) {
        summary.kept[group] = (summary.kept[group] || 0) + 1;
        created.set(`${group}/${key}`, existing);
        continue;
      }
      const body = structuredClone(definition.body);
      if (group === "tasks")
        body.planId = selectTaskPlan(body, [
          created.get("plans/daily"),
          created.get("plans/long-term"),
        ]);
      if (group === "cases")
        body.taskId =
          created.get(
            `tasks/${key === "forest-risk" ? "forest-preparation" : key === "mineral-boundary" ? "mineral-reception" : "road-reception"}`,
          )?.id || null;
      let record = existing || (await api.write(`/api/v1/${group}`, body));
      if (recordOrigin(record).key !== provenanceKey(group, key))
        throw new Error("后端未保留初始化来源键，停止后续创建");
      if (existing) summary.resumed[group] = (summary.resumed[group] || 0) + 1;
      else {
        inventory[group].push(record);
        summary.created[group] = (summary.created[group] || 0) + 1;
      }
      state.records[identity] = {
        id: record.id,
        group,
        status: record.status,
        target: definition.target,
        createdAt: record.createdAt,
        updatedAt: record.updatedAt,
        workflowComplete: false,
      };
      await persist();
      const action = async (payload) => {
        record = await api.write(
          `/api/v1/${group}/${encodeURIComponent(record.id)}/actions`,
          {
            ...payload,
            note: `平台初始化登记：${payload.note || "办理本地准备事项，不代表上游执行或外部审批结果。"}`,
          },
        );
        summary.actions++;
        state.records[identity].status = record.status;
        state.records[identity].updatedAt = record.updatedAt;
        await persist();
      };
      if (
        group === "plans" &&
        ["PENDING_REVIEW", "APPROVED"].includes(definition.target)
      ) {
        if (record.status === "DRAFT") await action({ action: "SUBMIT" });
        if (
          definition.target === "APPROVED" &&
          record.status === "PENDING_REVIEW"
        )
          await action({
            action: "APPROVE",
            note: "仅审核本地初始化准备事项与关联资料，不登记监管审批或外部回执，不构成实际飞行放行。",
          });
      }
      if (group === "tasks" && definition.target !== "DRAFT") {
        if (record.status === "DRAFT") await action({ action: "SUBMIT" });
        if (
          definition.target === "RETURNED" &&
          record.status === "PENDING_ASSIGNMENT"
        )
          await action({
            action: "RETURN",
            note: "请补充巡查边界与成果格式，完善后重新提交；未记录现场执行。",
          });
        if (
          [
            "PENDING_EXECUTION",
            "EXECUTING",
            "PENDING_ACCEPTANCE",
            "COMPLETED",
          ].includes(definition.target)
        ) {
          const device = devices[definition.deviceIndex],
            pilot = accounts.PILOT;
          if (
            device?.status !== "ACTIVE" ||
            !pilot.enabled ||
            !pilot.deviceIds?.includes(device.id) ||
            !pilot.regions?.includes(options.region)
          )
            summary.deferred.push(
              `${definition.body.title}保留待分配：设备或本地排班岗位范围尚未确认`,
            );
          else {
            if (record.status === "PENDING_ASSIGNMENT")
              await action({
                action: "ASSIGN",
                deviceId: device.id,
                pilotId: pilot.id,
                planId: body.planId,
                note: "关联真实设备和本地飞行排班岗位，仅登记本地办理安排；未下发飞行任务、未起飞、未确认人员资质。",
              });
            if (definition.verification) {
              if (record.status === "PENDING_EXECUTION")
                await action({
                  action: "START",
                  note: "办理已实际开展的资料读取与原件完整性核对，仅记录本系统资料工作进度，不是实际飞行。",
                });
              if (key === "media-integrity-audit") await uploadMedia(record);
              if (
                ["PENDING_ACCEPTANCE", "COMPLETED"].includes(
                  definition.target,
                ) &&
                record.status === "EXECUTING"
              )
                await action({
                  action: "FINISH",
                  resultSummary: definition.resultSummary,
                  note: "实际读取和校验结果已填写，提交本地资料核对工作验收；无实际飞行完成声明。",
                });
              if (
                definition.target === "COMPLETED" &&
                record.status === "PENDING_ACCEPTANCE"
              )
                await action({
                  action: "ACCEPT",
                  note: "核验真实原件大小与 SHA256 相符，完成本地归档完整性核对；未认定拍摄时间、真实架次或现场违法事实。",
                });
            }
          }
        }
      }
      if (
        group === "consultations" &&
        definition.target === "ANSWERED" &&
        record.status === "OPEN"
      )
        await action({
          action: "REPLY",
          reply: definition.reply,
          note: "答复本平台操作与准备事项，未记录培训完成、资质认证或外部审批。",
        });
      if (
        group === "cases" &&
        definition.target === "ARCHIVED" &&
        record.status === "PENDING_REVIEW"
      )
        await action({
          action: "DISMISS",
          conclusion: "现有资料不足，待新增来源后重新登记",
          note: "现有资料不足，待新增来源后重新登记；未认定现场已处置或违法事实。",
        });
      state.records[identity].workflowComplete =
        record.status === definition.target;
      await persist();
      created.set(`${group}/${key}`, record);
    }
    const mediaTask = created.get("tasks/media-integrity-audit");
    if (mediaTask && !["COMPLETED", "CANCELLED"].includes(mediaTask.status))
      await uploadMedia(mediaTask);
    if (options.attachSnapshots) {
      const csv = snapshotCsv(
        inventory.resources,
        catalog,
        new Date().toISOString(),
      );
      for (const [type, record] of [
        ["taskId", created.get("tasks/forest-preparation")],
        ["caseId", created.get("cases/forest-risk")],
      ]) {
        if (!record) continue;
        const filename = `设备与航线档案快照-${createHash("sha256").update(`${NAMESPACE}:${record.id}`).digest("hex").slice(0, 12)}.csv`;
        const attachments = await api.list(
          `/api/v1/attachments?${type}=${encodeURIComponent(record.id)}`,
        );
        if (attachments.some((a) => (a.filename || a.fileName) === filename))
          continue;
        const data = new FormData();
        data.set(type, record.id);
        data.set(
          "file",
          new Blob([csv], { type: "text/csv;charset=utf-8" }),
          filename,
        );
        await api.write("/api/v1/attachments", data);
        summary.attachments++;
      }
    }
    state.lastRunAt = new Date().toISOString();
    await persist();
    logger(
      JSON.stringify(
        {
          result: "COMPLETED",
          ...summary,
          credentialsFile: accountFile,
          stateFile,
          note: "复跑保留已有记录和人工办理结果；未启动飞行、训练或外部审批。",
        },
        null,
        2,
      ),
    );
    return summary;
  } finally {
    await lock.close();
    await fs.unlink(lockFile).catch(() => {});
  }
}

async function main() {
  if (Number(process.versions.node.split(".")[0]) < 20)
    throw new Error("请使用 Node.js 20 或更新版本运行初始化脚本");
  const options = argumentsFor(process.argv.slice(2));
  if (options.help) {
    console.log(
      "用法：node scripts/seed-business.mjs [--apply] [--activate-devices] [--attach-snapshots] [--base-url URL] [--env-file FILE] [--state-dir DIR] [--media-manifest FILE] [--region 区域] [--date YYYY-MM-DD]\n默认仅预览；--apply 显式创建本地初始化记录。岗位密码仅保存私有目录，不输出。",
    );
    return;
  }
  const env = await readEnvironment(options.envFile);
  if (!env.BOOTSTRAP_ADMIN_USERNAME || !env.BOOTSTRAP_ADMIN_PASSWORD)
    throw new Error("私有配置缺少本地管理员账号或密码");
  const api = new Client(
    options.baseUrl || `http://127.0.0.1:${env.WEB_PORT || 8088}`,
  );
  await api.write("/api/v1/auth/login", {
    username: env.BOOTSTRAP_ADMIN_USERNAME,
    password: env.BOOTSTRAP_ADMIN_PASSWORD,
  });
  await runSeed(options, api);
}
if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
)
  main().catch((error) => {
    console.error(safeError(error));
    process.exitCode = 1;
  });
