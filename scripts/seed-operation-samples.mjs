#!/usr/bin/env node
import { promises as fs } from "node:fs";
import path from "node:path";
import { createHash, randomBytes } from "node:crypto";
import { fileURLToPath, pathToFileURL } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
export const NAMESPACE = "oneflight.operation-samples.v1:20261016";
export const REGION = "余杭区";
export const SAMPLE_DATE = "2026-10-16";
export const SAMPLE_NOTICE = "平台流程演练，不代表真实飞行、现场认定、监管批复或人员资质认证。";
const ORIGIN = "BUSINESS_INITIALIZATION";
const ROLES = { DISPATCH: "巡查调度演练岗", PILOT: "巡查执行演练岗", DEPARTMENT: "巡查需求验收演练岗" };
const GROUPS = ["resources", "users", "plans", "tasks", "cases"];
const RESOURCE_FIELDS = ["title", "kind", "region", "organizationId", "status", "model", "sourceDeviceId", "productKey", "sn", "longitude", "latitude", "metadata"];

export const sampleKey = (group, key) => `${NAMESPACE}:${group}:${key}`;
const provenance = (group, key) => ({ origin: ORIGIN, key: sampleKey(group, key), description: SAMPLE_NOTICE });
const originOf = (record) => record?.provenance || record?.metadata?.provenance || {};
const clone = (value) => structuredClone(value);
function stable(value) {
  if (Array.isArray(value)) return value.map(stable);
  if (value && typeof value === "object") return Object.fromEntries(Object.keys(value).sort().map((key) => [key, stable(value[key])]));
  return value;
}
const sha256 = (value) => createHash("sha256").update(typeof value === "string" || Buffer.isBuffer(value) ? value : JSON.stringify(stable(value))).digest("hex");
const INSTANT_PATTERN = /^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2})(?:\.(\d{1,9}))?(Z|[+-]\d{2}:\d{2})$/;
/** Match MySQL TIMESTAMP(6) rounding without floating-point loss, including second carry. */
export function canonicalTimestamp(value) {
  const match = typeof value === "string" && value.match(INSTANT_PATTERN);
  if (!match) throw new Error("批次时间戳格式不正确");
  const second = Date.parse(`${match[1]}${match[3]}`);
  if (!Number.isFinite(second)) throw new Error("批次时间戳无效");
  const microseconds = (BigInt((match[2] || "").padEnd(9, "0")) + 500n) / 1000n;
  const carried = new Date(second + Number(microseconds / 1_000_000n) * 1000).toISOString();
  return `${carried.slice(0, 19)}.${String(microseconds % 1_000_000n).padStart(6, "0")}Z`;
}
function comparable(value, key = "") {
  if (typeof value === "string" && INSTANT_PATTERN.test(value)) return canonicalTimestamp(value);
  if (Array.isArray(value)) { const items = value.map((item) => comparable(item)); return ["regions", "deviceIds", "organizationIds"].includes(key) ? items.sort() : items; }
  if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).filter(([field]) => key !== "provenance" || ["origin", "key", "description"].includes(field)).map(([field, item]) => [field, comparable(item, field)]));
  return value;
}
export function recordBusinessFingerprint(record) {
  const { createdAt, updatedAt, ...business } = record;
  return sha256(comparable(business));
}
function canonicalStamp(value) { return typeof value === "string" && INSTANT_PATTERN.test(value) ? canonicalTimestamp(value) : value; }
function stamp(record) {
  return record.updatedAt ? canonicalTimestamp(record.updatedAt) : sha256({ id: record.id, role: record.role, enabled: record.enabled, organizationId: record.organizationId, regions: [...(record.regions || [])].sort(), deviceIds: [...(record.deviceIds || [])].sort(), displayName: record.displayName });
}
export function checkpointMatches(record, checkpoint, definition) {
  if (!checkpoint.stamp || canonicalStamp(checkpoint.stamp) !== stamp(record)) return false;
  if (checkpoint.businessFingerprint) return checkpoint.businessFingerprint === recordBusinessFingerprint(record);
  // Legacy checkpoints have only a timestamp: establish the new fingerprint only after
  // checking the saved workflow status and the original, stable business input fields.
  if (checkpoint.status && checkpoint.status !== (record.status || (record.enabled ? "ENABLED" : "DISABLED"))) return false;
  return Object.entries(definition?.body || {}).every(([field, expected]) => {
    if (["password", "resultSummary", "conclusion"].includes(field)) return true;
    return sha256(comparable(record[field], field)) === sha256(comparable(expected, field));
  });
}
function instant(day, hour = 0, minute = 0) {
  return new Date(`${day}T${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}:00+08:00`).toISOString();
}

export function parseArguments(argv) {
  const options = { apply: false, baseUrl: "http://127.0.0.1:8088", envFile: path.join(ROOT, ".env"), stateDir: path.join(ROOT, ".local", "operation-samples-20261016") };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--apply") options.apply = true;
    else if (["--help", "-h"].includes(argv[i])) options.help = true;
    else {
      const key = { "--base-url": "baseUrl", "--env-file": "envFile", "--state-dir": "stateDir" }[argv[i]];
      if (!key || !argv[i + 1] || argv[i + 1].startsWith("--")) throw new Error("参数不正确；使用 --help 查看用法");
      options[key] = argv[++i];
    }
  }
  options.envFile = path.resolve(options.envFile);
  options.stateDir = path.resolve(options.stateDir);
  validateBaseUrl(options.baseUrl);
  return options;
}

export function validateBaseUrl(value) {
  const url = new URL(value);
  if (!["http:", "https:"].includes(url.protocol) || url.username || url.password || url.pathname !== "/" || url.search || url.hash) throw new Error("站点地址须为不含凭据、路径或查询参数的HTTP(S) origin");
  if (url.protocol === "http:" && !["127.0.0.1", "localhost", "[::1]"].includes(url.hostname)) throw new Error("禁止通过远程明文HTTP传输账号；请使用SSH回环隧道或HTTPS");
  return url.origin;
}

export function parseEnvironment(text) {
  const values = {};
  for (const line of text.replace(/^\uFEFF/, "").split(/\r?\n/)) {
    const match = line.match(/^\s*(?:export\s+)?([A-Z_][A-Z0-9_]*)=(.*)$/);
    if (!match) continue;
    let value = match[2];
    if (value.startsWith('"') && value.endsWith('"')) { try { value = JSON.parse(value); } catch { throw new Error("私有env文件引号格式不正确"); } }
    else if (value.startsWith("'") && value.endsWith("'")) value = value.slice(1, -1);
    values[match[1]] = value;
  }
  return values;
}

class RequestFailure extends Error {
  constructor(method, route, status, code) {
    super(`${method} ${route.split("?")[0]}：${status ? `HTTP ${status}` : "网络结果未确认"}${code ? ` (${String(code).replace(/[^A-Z0-9_-]/gi, "")})` : ""}`);
    this.status = status;
    this.definitive = status >= 400 && status < 500;
  }
}

/** The write allowlist deliberately excludes commands, imports, settings and updates. */
export class SampleApiClient {
  cookies = new Map();
  constructor(baseUrl) { this.baseUrl = validateBaseUrl(baseUrl); }
  assertRoute(method, route) {
    const pathname = route.split("?", 1)[0];
    const read = /^\/api\/v1\/(auth\/(?:csrf|me)|devices|resources|users|plans|tasks|cases|attachments)(?:\/[a-zA-Z0-9_-]+(?:\/(?:history|assignment-options|content))?)?$/;
    const write = /^\/api\/v1\/(?:auth\/login|resources|users|plans|tasks|cases|attachments|(?:plans|tasks|cases)\/[a-zA-Z0-9_-]+\/actions)$/;
    if ((method === "GET" && read.test(pathname)) || (method === "POST" && write.test(pathname))) return;
    throw new Error("请求不在本次示例初始化接口白名单中");
  }
  async request(route, method = "GET", body, binary = false) {
    this.assertRoute(method, route);
    const headers = {};
    if (method !== "GET") {
      const csrf = await this.request("/api/v1/auth/csrf");
      if (csrf.headerName !== "X-CSRF-TOKEN" || typeof csrf.token !== "string") throw new Error("CSRF契约不正确");
      headers[csrf.headerName] = csrf.token;
    }
    headers.Cookie = [...this.cookies].map(([key, value]) => `${key}=${value}`).join("; ");
    if (body && !(body instanceof FormData)) headers["Content-Type"] = "application/json";
    let response;
    try {
      response = await fetch(`${this.baseUrl}${route}`, { method, headers, body: body ? body instanceof FormData ? body : JSON.stringify(body) : undefined, redirect: "error", signal: AbortSignal.timeout(30000) });
    } catch { throw new RequestFailure(method, route, 0, null); }
    const setCookies = response.headers.getSetCookie?.() || (response.headers.get("set-cookie") || "").split(/,(?=\s*[^;,]+=)/).filter(Boolean);
    for (const cookie of setCookies) {
      const pair = cookie.split(";", 1)[0], index = pair.indexOf("=");
      this.cookies.set(pair.slice(0, index), pair.slice(index + 1));
    }
    if (binary && response.ok) return Buffer.from(await response.arrayBuffer());
    let payload;
    try { payload = await response.json(); } catch { throw new RequestFailure(method, route, response.status >= 400 ? response.status : 0, "INVALID_RESPONSE"); }
    if (!response.ok || !["OK", "SUCCESS", "0"].includes(String(payload.code))) throw new RequestFailure(method, route, response.status, payload.code);
    return payload.data;
  }
  get(route) { return this.request(route); }
  write(route, body) { return this.request(route, "POST", body); }
  bytes(route) { return this.request(route, "GET", undefined, true); }
  async login(username, password) { return this.write("/api/v1/auth/login", { username, password }); }
  async list(route) {
    const rows = []; let expected;
    for (let page = 1; page <= 1000; page++) {
      const data = await this.get(`${route}${route.includes("?") ? "&" : "?"}page=${page}&pageSize=100`);
      if (!Array.isArray(data?.items) || !Number.isSafeInteger(data.total) || data.total < 0 || (expected !== undefined && expected !== data.total)) throw new Error("分页目录无效或读取期间发生变化");
      expected = data.total; rows.push(...data.items);
      if (rows.length === expected) return rows;
      if (!data.items.length || rows.length > expected) break;
    }
    throw new Error("未取得完整分页，停止初始化");
  }
}

function owned(rows, group, key) {
  const id = sampleKey(group, key), matches = rows.filter((row) => originOf(row).key === id);
  if (matches.length > 1) throw new Error(`批次来源键重复：${group}/${key}`);
  if (matches[0] && originOf(matches[0]).origin !== ORIGIN) throw new Error(`批次来源键冲突：${group}/${key}`);
  return matches[0];
}

/** Times are fixed within the batch; no late retry can silently reschedule a task. */
export function buildOperationDefinitions({ organizationId, deviceIds = [null, null], routeId = null, planIds = {}, taskIds = {} }) {
  const base = { region: REGION, organizationId };
  const planDetails = {
    p1: { height: 120, scope: "余杭区林缘样区B与矿区外围样区的日常巡查准备：核对林缘道路、矿区出入口及边界参照物的巡查关注项，安排不重叠时段，提交照片目录模板、拍摄时间与位置索引核对表。申请高度用于内部排班资料，不是已执行高度。" },
    p2: { height: 120, scope: "余杭区重点路段样区的专项巡查准备：梳理道路出入口、易遮挡路段与观察盲区的资料需求，补充成果命名、时间位置索引及复核责任，待内部审核后再安排排班。申请高度不构成飞行放行。" },
    p3: { height: 180, scope: "余杭区林缘样区A、矿区外围边界及重点路段的周期巡查资料流转：按子任务核对关注项、时段与调度引用，成果以照片目录清单、时间位置索引要求和流程核对表办理；林缘样区A用于完成计划至线索归档的内部闭环。申请高度不代表已飞行高度。" },
    p4: { height: 150, scope: "余杭区林缘样区A/B的巡查需求完善：补充林缘道路与居民点交界、可燃物堆放观察项的资料需求，明确照片目录字段、时间位置索引和复核分工；样区边界材料待核对，当前不安排真实设备执行。" },
  };
  const taskDetails = {
    t1: "整理林缘样区A/B的需求清单，逐项确认林缘道路、居民点交界和可燃物观察项是否具备边界参照说明；输出待补材料列表、照片目录模板及时间位置索引字段，保留草稿等待需求确认。",
    t2: "受理林缘样区B的日常巡查准备需求，核对林缘道路与重点出入口关注项、工作时段和成果命名规则；提交需求核对表及照片目录/拍摄时间/位置索引模板，等待调度分配。",
    t3: "补充矿区外围边界与出入口的资料范围，明确边界参照物、观察盲区和相邻道路的区分方式；要求补齐样区边界说明及照片目录对应关系，本条以退回状态保留材料补充意见。",
    t4: "按已批内部计划登记矿区外围边界及出入口的巡查排班，关注边界参照物、进出通道与遮挡区域的材料完整性；后续成果需包含照片目录、拍摄时间位置索引和异常待核项清单，当前仅完成演练资源与岗位分配。",
    t5: "登记重点路段样区的巡查排班，逐项列出道路出入口、交叉口及观察盲区的关注要求；约定照片目录命名、时间位置索引及人工复核责任，当前保持待执行，不下发真实设备命令。",
    t6: "核对两条本地调度引用档案与只读来源设备的ID对应关系、型号字段及岗位授权范围；形成差异待核清单，检查演练排班时段是否冲突，仅办理平台资料核对，不登记起飞或现场成果。",
    t7: "核验巡查成果目录模板中的任务ID、文件名、拍摄时间、位置索引和复核人字段，检查缺项说明能否对应工作项；以CSV流程演练核对表提交本平台验收，不上传或认定真实现场照片，当前等待需求验收岗复核。",
    t8: "围绕林缘样区A完成一次计划关联、资源分配、开始、成果提交和验收的内部流程演练；逐项核对林缘道路及居民点交界关注项的目录要求，提交包含实际平台关联ID的CSV核对表，再将关联线索办理至归档，不声称发生真实飞行或发现现场隐患。",
    t9: "复核重点路段专项巡查准备的时段与资料需求，因演练安排调整取消该项排班准备；保留原计划关联、取消原因及办理履历，不占用执行资源，不产生现场成果。",
  };
  const caseDetails = {
    c1: "待核林缘样区B需求资料：边界参照说明与照片目录模板能否逐项对应，拍摄时间及位置索引字段是否齐全；先登记待核事项，尚未认定现场隐患。",
    c2: "待核矿区外围资料：边界参照物、出入口名称与成果目录的对应关系尚需补充说明，观察盲区的材料要求需由需求方确认；关联退回任务保留补充核查入口。",
    c3: "复核矿区外围巡查排班材料：核查边界段与出入口条目的目录编号、拟提交时间位置索引及人工复核责任是否一一对应；当前处置仅面向演练资料差异，不认定现场越界或违规。",
    c4: "复核重点路段成果目录要求：对任务ID、目录命名、拍摄时间与位置索引的缺项说明逐项检查，防止目录字段与关注路段脱节；关联资料核对任务等待后续处置，不认定道路现场事实。",
    c5: "核查林缘样区A演练闭环：检查已批内部计划、关联任务验收记录、实际平台ID和CSV流程核对表是否贯通，核实开始/成果/验收均标明演练边界；完成核对后归档流程记录，不据此认定真实火情或飞行成果。",
    c6: "核对重复或资料不足的专项巡查准备条目：检查其是否重复关联已取消的任务、是否缺少可独立核对的材料说明；演练中按不予采纳归档并保留原因，不形成现场认定。",
  };
  const plans = [
    ["p1", "重点区域日常巡查计划", "DAILY", "APPROVED", "2026-10-17", "2026-10-17"],
    ["p2", "重点路段专项巡查计划", "DAILY", "PENDING_REVIEW", "2026-10-18", "2026-10-18"],
    ["p3", "重点设施周期巡查服务计划", "LONG_TERM", "APPROVED", "2026-10-15", "2026-11-15"],
    ["p4", "林缘巡查范围完善计划", "LONG_TERM", "DRAFT", "2026-10-16", "2026-11-15"],
    ["p5", "巡查航空器准入材料登记", "DEVICE_ADMISSION", "PENDING_REVIEW", "2026-10-16", "2026-10-23"],
    ["p6", "巡查人员准入材料登记", "PILOT_ADMISSION", "DRAFT", "2026-10-16", "2026-10-23"],
  ].map(([key, title, kind, target, start, end]) => ({ group: "plans", key, target, body: { ...base, title, kind, startAt: instant(start), endAt: instant(end, 23, 59), height: planDetails[key]?.height ?? null, scope: `${planDetails[key]?.scope || (key === "p5" ? "登记本地演练调度引用航空器的材料待核清单，核对来源ID、型号、使用范围和责任岗位；材料编号、有效期及监管回执均不填造，等待人工补齐与核验。" : "登记演练执行岗位的准入资料待核清单，核对岗位职责、组织与区域授权边界；不登记来源实名人员资质、培训证书或监管批文，当前保留草稿。")} ${SAMPLE_NOTICE}`, resourceId: kind === "PILOT_ADMISSION" ? null : kind === "DEVICE_ADMISSION" ? deviceIds[1] : routeId || deviceIds[0], taskId: null, receiptNumber: null, receiptBasis: null, materialName: kind.endsWith("ADMISSION") ? "准入材料待核验清单" : null, materialNumber: null, validFrom: null, validUntil: null, provenance: provenance("plans", key) } }));
  const tasks = [
    ["t1", "林缘巡查需求整理", "森林防火", "DRAFT", "p4", "2026-10-19", 9, 0, 10, 0, 0],
    ["t2", "林区巡查需求受理", "森林防火", "PENDING_ASSIGNMENT", "p1", "2026-10-17", 11, 0, 12, 0, 0],
    ["t3", "矿区巡查范围补充", "矿产监管", "RETURNED", "p3", "2026-10-18", 11, 0, 12, 0, 0],
    ["t4", "矿区外围巡查排班", "矿产监管", "PENDING_EXECUTION", "p1", "2026-10-17", 9, 0, 9, 40, 0],
    ["t5", "重点路段巡查排班", "非现执法", "PENDING_EXECUTION", "p3", "2026-10-17", 10, 0, 10, 40, 1],
    ["t6", "来源设备资料核对", "资料核对", "EXECUTING", null, "2026-10-16", 14, 0, 14, 30, 0],
    ["t7", "巡查成果目录核验", "资料核对", "PENDING_ACCEPTANCE", null, "2026-10-16", 13, 0, 13, 30, 1],
    ["t8", "林缘样区A巡查闭环", "森林防火", "COMPLETED", "p3", "2026-10-16", 12, 0, 12, 40, 0],
    ["t9", "专项巡查安排调整", "非现执法", "CANCELLED", "p2", "2026-10-18", 9, 0, 9, 40, 0],
  ].map(([key, title, scene, target, planKey, day, h1, m1, h2, m2, deviceIndex]) => ({ group: "tasks", key, target, planKey, deviceIndex, body: { ...base, title, scene, priority: key === "t4" ? "HIGH" : "NORMAL", description: `${taskDetails[key]} ${SAMPLE_NOTICE}`, startAt: instant(day, h1, m1), endAt: instant(day, h2, m2), planId: planKey ? planIds[planKey] || null : null, resultSummary: null, provenance: provenance("tasks", key) } }));
  const cases = [
    ["c1", "林缘巡查资料待核事项", "森林防火", "PENDING_REVIEW", "t2"],
    ["c2", "矿区边界资料补充核查", "矿产监管", "PENDING_REVIEW", "t3"],
    ["c3", "矿区外围巡查范围复核", "矿产监管", "PENDING_DISPOSAL", "t4"],
    ["c4", "重点路段观测目录复核", "非现执法", "PENDING_DISPOSAL", "t7"],
    ["c5", "林缘样区A闭环成果核查", "森林防火", "ARCHIVED", "t8"],
    ["c6", "重复巡查资料核查", "非现执法", "ARCHIVED", "t9"],
  ].map(([key, title, scene, target, taskKey]) => ({ group: "cases", key, target, taskKey, body: { ...base, title, scene, taskId: taskIds[taskKey] || null, description: `${caseDetails[key]} ${SAMPLE_NOTICE}`, conclusion: null, provenance: provenance("cases", key) } }));
  return { plans, tasks, cases };
}

export function validateDefinitions(definitions) {
  const problems = [], plans = new Map(definitions.plans.map((plan) => [plan.key, plan]));
  for (const task of definitions.tasks) {
    const start = Date.parse(task.body.startAt), end = Date.parse(task.body.endAt);
    if (!(end > start)) problems.push(`任务时段无效：${task.key}`);
    if (task.planKey) {
      const plan = plans.get(task.planKey);
      if (!plan || !["DAILY", "LONG_TERM"].includes(plan.body.kind) || plan.body.region !== task.body.region || plan.body.organizationId !== task.body.organizationId || start < Date.parse(plan.body.startAt) || end > Date.parse(plan.body.endAt)) problems.push(`任务与计划不兼容：${task.key}`);
      if (["EXECUTING", "PENDING_ACCEPTANCE", "COMPLETED"].includes(task.target) && plan.target !== "APPROVED") problems.push(`执行任务计划未批：${task.key}`);
    } else if (["EXECUTING", "PENDING_ACCEPTANCE", "COMPLETED"].includes(task.target) && task.body.scene !== "资料核对") problems.push(`执行任务缺少计划：${task.key}`);
  }
  const assigned = definitions.tasks.filter((task) => ["PENDING_EXECUTION", "EXECUTING", "PENDING_ACCEPTANCE", "COMPLETED"].includes(task.target));
  for (let i = 0; i < assigned.length; i++) for (let j = i + 1; j < assigned.length; j++) {
    if (Date.parse(assigned[i].body.startAt) < Date.parse(assigned[j].body.endAt) && Date.parse(assigned[i].body.endAt) > Date.parse(assigned[j].body.startAt)) problems.push(`同一飞手任务时段重叠：${assigned[i].key}/${assigned[j].key}`);
  }
  return problems;
}

async function readJson(filename, fallback) {
  try { return JSON.parse(await fs.readFile(filename, "utf8")); }
  catch (error) { if (error.code === "ENOENT") return fallback; throw new Error("私有状态文件不可读，停止初始化"); }
}
async function privateJson(filename, value) {
  const temporary = `${filename}.${process.pid}.tmp`;
  await fs.writeFile(temporary, JSON.stringify(value, null, 2), { mode: 0o600 });
  await fs.rename(temporary, filename); await fs.chmod(filename, 0o600);
}

function chooseSources(catalog, resources, state) {
  const uavs = catalog.filter((device) => String(device.type || device.deviceType).toUpperCase() === "UAV").sort((a, b) => Number(b.status === "ONLINE") - Number(a.status === "ONLINE") || String(a.id).localeCompare(String(b.id)));
  const existing = ["aircraft-1", "aircraft-2"].map((key) => owned(resources, "resources", key));
  const saved = state?.sourceDeviceIds?.length ? state.sourceDeviceIds : existing.filter(Boolean).map((record) => record.sourceDeviceId || record.metadata?.sourceReference?.deviceId);
  if (saved.length) {
    if (saved.length !== 2) throw new Error("批次设备引用不完整，停止而不自动替换");
    const selected = saved.map((id) => uavs.find((device) => device.id === id));
    if (selected.some((device) => !device)) throw new Error("已选真实UAV不再获授权，停止初始化");
    return selected;
  }
  const alreadyMapped = new Set(resources.filter((resource) => resource.kind === "DEVICE" && resource.sourceDeviceId).map((resource) => resource.sourceDeviceId));
  return [...uavs.filter((device) => !alreadyMapped.has(device.id)), ...uavs.filter((device) => alreadyMapped.has(device.id))].slice(0, 2);
}

function resourceDefinitions(me, sources, inventory) {
  const result = sources.map((source, index) => {
    const key = `aircraft-${index + 1}`, previous = owned(inventory.resources, "resources", key);
    const collision = inventory.resources.some((record) => record.kind === "DEVICE" && record.sourceDeviceId === source.id && record.id !== previous?.id);
    const metadataOnly = previous ? !previous.sourceDeviceId : collision;
    const body = previous ? Object.fromEntries(RESOURCE_FIELDS.map((field) => [field, clone(previous[field] ?? null)])) : { title: `${REGION}巡查排班${index + 1}号机`, kind: "DEVICE", region: REGION, organizationId: me.organizationId, status: "ACTIVE", model: source.model || "UAV", sourceDeviceId: metadataOnly ? null : source.id, productKey: source.productKey || null, sn: source.sn || null, longitude: metadataOnly ? null : source.longitude ?? null, latitude: metadataOnly ? null : source.latitude ?? null, metadata: { provenance: provenance("resources", key), description: `本地演练调度引用档案；仅引用授权设备信息，不修改来源设备。${SAMPLE_NOTICE}`, referenceOnly: true, sourceDeviceType: "UAV", sourceReference: { deviceId: source.id, deviceName: source.name || source.deviceName || null, productKey: source.productKey || null } } };
    // A response may enrich provenance with server audit fields; they are not creation input.
    body.metadata = { ...(body.metadata || {}), provenance: provenance("resources", key) };
    return { group: "resources", key, target: "ACTIVE", sourceLinkMode: metadataOnly ? "REFERENCE_METADATA_ONLY" : "SOURCE_DEVICE_ID", body };
  });
  const previousRoute = owned(inventory.resources, "resources", "route-reference");
  const realRoute = inventory.resources.find((resource) => resource.kind === "ROUTE" && ["SOURCE_IMPORTED", "SOURCE_IMPORT"].includes(originOf(resource).origin) && (resource.metadata?.geometry || resource.geometry));
  if (previousRoute || realRoute) {
    const source = previousRoute || realRoute;
    const metadata = previousRoute ? clone(source.metadata) : { ...clone(source.metadata || {}), geometry: clone(source.metadata?.geometry ?? source.geometry), provenance: provenance("resources", "route-reference"), referenceResourceId: source.id, referenceOnly: true, description: `来源航线几何及Z值原样引用，不作为已批准飞行范围。${SAMPLE_NOTICE}` };
    metadata.provenance = provenance("resources", "route-reference");
    if (Buffer.byteLength(JSON.stringify(metadata), "utf8") < 60_000) result.push({ group: "resources", key: "route-reference", target: "ACTIVE", body: { title: `${REGION}巡查航线参考档案`, kind: "ROUTE", region: REGION, organizationId: me.organizationId, status: "ACTIVE", model: source.model || null, sourceDeviceId: null, productKey: null, sn: null, longitude: source.longitude ?? null, latitude: source.latitude ?? null, metadata } });
  }
  return result;
}

function csvCell(value) { let text = value == null ? "" : String(value); if (/^[=+\-@]/.test(text)) text = `'${text}`; return `"${text.replaceAll('"', '""')}"`; }
export function buildChecklist({ group, key, record, task, localDevices, pilotId }) {
  const rows = [
    ["项目", "关联类型", "关联ID", "核对说明"],
    ["批次", "BUSINESS_INITIALIZATION", sampleKey(group, key), SAMPLE_NOTICE],
    ["当前工作项", group, record.id, record.title],
    ["关联计划", "PLAN", task?.planId || record.planId || "", "仅平台内部计划资料；无关联计划时留空，不构成监管批复"],
    ["关联任务", "TASK", task?.id || (group === "tasks" ? record.id : record.taskId) || "", "仅平台流程演练状态，不代表真实起飞或任务下发"],
    ["线索", "CASE", group === "cases" ? record.id : "", "未认定真实现场事件、违法事实或现场处置成果"],
    ...localDevices.map((device, index) => [`调度引用${index + 1}`, "LOCAL_DEVICE", device.id, "本地演练档案，真实来源设备只读引用"]),
    ["流程执行岗", "LOCAL_PILOT", pilotId, "演练岗位，不代表来源实名人员或已认证飞手"],
    ["核对结论", "PLATFORM_WORKFLOW", "", "已核对本批次关联ID、计划范围、排班与办理链条；未发生真实飞行/现场结果登记。"],
  ];
  return Buffer.from(`\uFEFF${rows.map((row) => row.map(csvCell).join(",")).join("\r\n")}\r\n`, "utf8");
}

export async function runOperationSamples(options, admin, logger = console.log) {
  const me = await admin.get("/api/v1/auth/me");
  if (me.role !== "ADMIN") throw new Error("本次示例初始化需要管理员");
  const stateFile = path.join(options.stateDir, "manifest.json"), accountFile = path.join(options.stateDir, "accounts.json");
  const saved = await readJson(stateFile, null);
  if (saved && (saved.namespace !== NAMESPACE || saved.organizationId !== me.organizationId || saved.adminId !== me.id || saved.origin !== admin.baseUrl || saved.date !== SAMPLE_DATE || saved.region !== REGION)) throw new Error("私有manifest不属于当前站点、组织或批次");
  const inventory = {};
  for (const group of GROUPS) inventory[group] = await admin.list(`/api/v1/${group}`);
  const sources = chooseSources(await admin.list("/api/v1/devices"), inventory.resources, saved);
  const resources = resourceDefinitions(me, sources, inventory);
  const existingIds = (group, prefix, count) => Object.fromEntries(Array.from({ length: count }, (_, index) => { const key = `${prefix}${index + 1}`; return [key, owned(inventory[group], group, key)?.id || null]; }));
  const definitions = buildOperationDefinitions({ organizationId: me.organizationId, deviceIds: ["aircraft-1", "aircraft-2"].map((key) => owned(inventory.resources, "resources", key)?.id || null), routeId: owned(inventory.resources, "resources", "route-reference")?.id || null, planIds: existingIds("plans", "p", 6), taskIds: existingIds("tasks", "t", 9) });
  const blocked = validateDefinitions(definitions);
  if (sources.length !== 2) blocked.push("至少需要两台当前获授权的真实UAV用于只读引用");
  for (const definition of [...resources, ...Object.keys(ROLES).map((role) => ({ group: "users", key: role.toLowerCase() })), ...definitions.plans, ...definitions.tasks, ...definitions.cases]) {
    const existing = owned(inventory[definition.group], definition.group, definition.key);
    const checkpoint = saved?.records?.[sampleKey(definition.group, definition.key)];
    if (checkpoint?.id && (!existing || checkpoint.id !== existing.id)) blocked.push(`批次记录已删除或ID不一致：${definition.group}/${definition.key}`);
    if (existing && !checkpoint) blocked.push(`已有同批记录缺少私有checkpoint，保留并请人工核对：${definition.group}/${definition.key}`);
    if (existing && checkpoint?.stamp && !checkpoint.pendingAction && !checkpointMatches(existing, checkpoint, definition)) blocked.push(`批次记录已被其他操作修改，保留：${definition.group}/${definition.key}`);
  }
  for (const role of Object.keys(ROLES)) {
    const username = `ops_${role.toLowerCase()}_${sha256(`${NAMESPACE}:${me.organizationId}`).slice(0, 8)}`;
    if (!owned(inventory.users, "users", role.toLowerCase()) && inventory.users.some((user) => user.username === username)) blocked.push(`演练岗位登录名与其他账号冲突：${role}`);
  }
  const preview = { mode: options.apply ? "APPLY" : "PREVIEW", namespace: NAMESPACE, date: SAMPLE_DATE, region: REGION, sourceUavReferences: sources.length, sourceLinkModes: resources.filter((resource) => resource.body.kind === "DEVICE").map((resource) => resource.sourceLinkMode), optionalRouteReference: resources.some((resource) => resource.body.kind === "ROUTE"), accounts: Object.keys(ROLES), counts: { plans: 6, tasks: 9, cases: 6, csvAttachments: 3 }, records: [...definitions.plans, ...definitions.tasks, ...definitions.cases].map((definition) => ({ key: definition.key, group: definition.group, title: definition.body.title, target: definition.target, operation: owned(inventory[definition.group], definition.group, definition.key) ? "KEEP_OR_RESUME" : "CREATE" })), blocked };
  logger(JSON.stringify(preview, null, 2));
  if (!options.apply) return preview;
  if (blocked.length) throw new Error("预检未通过，未写入示例业务");
  await fs.mkdir(options.stateDir, { recursive: true, mode: 0o700 }); await fs.chmod(options.stateDir, 0o700);
  let lock;
  const lockFile = path.join(options.stateDir, ".lock");
  try { lock = await fs.open(lockFile, "wx", 0o600); } catch { throw new Error("存在初始化锁，停止并行写入"); }
  const state = saved || { namespace: NAMESPACE, origin: admin.baseUrl, adminId: me.id, organizationId: me.organizationId, date: SAMPLE_DATE, region: REGION, sourceDeviceIds: sources.map((source) => source.id), recordedAt: new Date().toISOString(), records: {}, attachments: {} };
  state.attachments ||= {};
  const persist = () => privateJson(stateFile, state);
  const summary = { created: {}, resumed: {}, actions: 0, attachments: 0, roleMode: "ROLE_CLIENTS" };
  const records = new Map();
  const clients = { ADMIN: admin };
  const actors = { ADMIN: me };
  async function getRecord(group, id) { return group === "users" ? (await admin.list("/api/v1/users")).find((record) => record.id === id) : admin.get(`/api/v1/${group}/${encodeURIComponent(id)}`); }
  async function updateCheckpoint(definition, record) {
    const checkpoint = state.records[sampleKey(definition.group, definition.key)];
    checkpoint.id = record.id; checkpoint.status = record.status || (record.enabled ? "ENABLED" : "DISABLED"); checkpoint.stamp = stamp(record); checkpoint.businessFingerprint = recordBusinessFingerprint(record); checkpoint.pendingCreate = false;
    records.set(`${definition.group}/${definition.key}`, record); await persist();
  }
  async function ensureRecord(definition) {
    const identity = sampleKey(definition.group, definition.key), hash = sha256(definition.body);
    let checkpoint = state.records[identity], record = owned(inventory[definition.group], definition.group, definition.key);
    if (checkpoint && checkpoint.requestHash !== hash) throw new Error(`批次请求内容已改变，停止覆盖：${definition.group}/${definition.key}`);
    if (record) {
      if (!checkpoint || checkpoint.id && checkpoint.id !== record.id) throw new Error("已有记录缺少一致checkpoint，停止覆盖");
      if (!checkpoint.pendingAction && checkpoint.stamp && !checkpointMatches(record, checkpoint, definition)) throw new Error(`已有记录被其他操作修改：${definition.group}/${definition.key}`);
      summary.resumed[definition.group] = (summary.resumed[definition.group] || 0) + 1;
    } else {
      if (checkpoint?.id || checkpoint?.pendingCreate) throw new Error("上次创建结果未确认或记录已被删除，请先核对来源键，禁止盲重建");
      checkpoint = state.records[identity] = { group: definition.group, key: definition.key, requestHash: hash, target: definition.target, pendingCreate: true };
      await persist();
      try { record = await admin.write(`/api/v1/${definition.group}`, definition.body); }
      catch (error) {
        const fresh = await admin.list(`/api/v1/${definition.group}`);
        record = owned(fresh, definition.group, definition.key);
        if (!record) throw error;
      }
      if (originOf(record).origin !== ORIGIN || originOf(record).key !== identity) throw new Error("后端未保留本批来源标记，停止写入");
      inventory[definition.group].push(record); summary.created[definition.group] = (summary.created[definition.group] || 0) + 1;
    }
    await updateCheckpoint(definition, record);
    return record;
  }
  async function recoverAction(definition, record) {
    const checkpoint = state.records[sampleKey(definition.group, definition.key)], pending = checkpoint.pendingAction;
    if (!pending) return record;
    const current = await getRecord(definition.group, record.id), history = await admin.list(`/api/v1/${definition.group}/${record.id}/history`);
    const completed = history.filter((event) => event.action === pending.action && String(event.note || "").includes(pending.marker));
    if (completed.length !== 1 || current.status !== pending.to) throw new Error(`上次动作结果尚未确认，已读取状态及历史但不自动重放：${definition.key}/${pending.action}`);
    delete checkpoint.pendingAction; await updateCheckpoint(definition, current); return current;
  }
  async function action(definition, record, actionName, target, role, extra = {}) {
    record = await recoverAction(definition, record);
    const identity = sampleKey(definition.group, definition.key), checkpoint = state.records[identity];
    const latest = await getRecord(definition.group, record.id);
    if (!checkpointMatches(latest, checkpoint, definition) || latest.status !== record.status) throw new Error(`办理前发现并行修改：${definition.key}`);
    const marker = `[${identity}:${actionName}]`;
    const payload = { action: actionName, ...extra, note: `${marker} ${extra.note || "本批次本地资料流程办理。"} ${SAMPLE_NOTICE}` };
    checkpoint.pendingAction = { action: actionName, from: record.status, to: target, marker }; await persist();
    try {
      const next = await (clients[role] || admin).write(`/api/v1/${definition.group}/${record.id}/actions`, payload);
      if (next.status !== target) throw new Error("动作响应状态不符合预期");
      delete checkpoint.pendingAction; summary.actions++; await updateCheckpoint(definition, next); return next;
    } catch (error) {
      if (error.definitive) { delete checkpoint.pendingAction; await persist(); throw error; }
      return recoverAction(definition, record);
    }
  }
  async function attachment(definition, record, task) {
    const identity = sampleKey(definition.group, definition.key), key = `${identity}:checklist`, filename = `流程演练核对表-20261016-${definition.key}.csv`;
    const bytes = buildChecklist({ group: definition.group, key: definition.key, record, task, localDevices: [records.get("resources/aircraft-1"), records.get("resources/aircraft-2")], pilotId: actors.PILOT.id });
    const digest = sha256(bytes), route = `/api/v1/attachments?${definition.group === "tasks" ? "taskId" : "caseId"}=${record.id}`;
    const inspect = async () => {
      const matches = (await admin.list(route)).filter((file) => (file.filename || file.fileName) === filename);
      if (matches.length > 1) throw new Error("同名演练附件重复，停止覆盖");
      if (!matches.length) return null;
      const file = matches[0], downloaded = await admin.bytes(`/api/v1/attachments/${file.id}/content`);
      if (sha256(downloaded) !== digest) throw new Error("已有演练附件内容不一致，保留并停止");
      return file;
    };
    let file = await inspect();
    if (!file) {
      if (state.attachments[key]?.pending) throw new Error("上次附件上传结果未确认，不盲目重复上传");
      if (["COMPLETED", "CANCELLED", "ARCHIVED"].includes(record.status)) throw new Error("已结束条目缺少演练附件，不能绕过业务规则补传");
      state.attachments[key] = { filename, sha256: digest, entityId: record.id, pending: true }; await persist();
      const form = new FormData(); form.set(definition.group === "tasks" ? "taskId" : "caseId", record.id); form.set("file", new Blob([bytes], { type: "text/csv;charset=utf-8" }), filename);
      try { file = await (clients[definition.group === "tasks" ? "PILOT" : "DEPARTMENT"] || admin).write("/api/v1/attachments", form); }
      catch (error) { file = await inspect(); if (!file) throw error; }
      file = await inspect();
      if (!file) throw new Error("附件上传后未取得已核验的保存结果，停止后续动作");
      summary.attachments++;
    }
    state.attachments[key] = { id: file.id, filename, sha256: digest, entityId: record.id, pending: false }; await persist();
  }
  try {
    const currentState = await readJson(stateFile, null);
    if (sha256(currentState) !== sha256(saved)) throw new Error("预检后manifest已被其他运行修改，请重新预览");
    await lock.writeFile(String(process.pid)); await persist();
    for (const definition of resources) await ensureRecord(definition);
    const localDevices = [records.get("resources/aircraft-1"), records.get("resources/aircraft-2")];
    if (localDevices.some((device) => device.status !== "ACTIVE" || device.organizationId !== me.organizationId || device.region !== REGION)) throw new Error("本批设备档案已改变，不自动重新启用");
    const secrets = await readJson(accountFile, { namespace: NAMESPACE, origin: admin.baseUrl, organizationId: me.organizationId, accounts: {} });
    if (secrets.namespace !== NAMESPACE || secrets.origin !== admin.baseUrl || secrets.organizationId !== me.organizationId) throw new Error("岗位私有文件不属于本次站点或组织");
    for (const [role, displayName] of Object.entries(ROLES)) {
      const key = role.toLowerCase(), username = `ops_${key}_${sha256(`${NAMESPACE}:${me.organizationId}`).slice(0, 8)}`;
      const existing = owned(inventory.users, "users", key);
      if (!existing && inventory.users.some((user) => user.username === username)) throw new Error("演练岗位登录名与其他账号冲突，不覆盖");
      secrets.accounts[role] ||= { username, password: randomBytes(24).toString("base64url") };
      await privateJson(accountFile, secrets);
      const definition = { group: "users", key, target: "ENABLED", body: { username, password: secrets.accounts[role].password, displayName, role, organizationId: me.organizationId, regions: [REGION], deviceIds: localDevices.map((device) => device.id), enabled: true, organizationIds: [], provenance: provenance("users", key) } };
      actors[role] = await ensureRecord(definition);
      if (actors[role].role !== role || !actors[role].enabled || actors[role].organizationId !== me.organizationId || !actors[role].regions?.includes(REGION) || localDevices.some((device) => !actors[role].deviceIds?.includes(device.id))) throw new Error("演练岗位范围或状态已改变，不修改既有账号");
      const client = new SampleApiClient(admin.baseUrl);
      await client.login(username, secrets.accounts[role].password); clients[role] = client;
    }
    const deviceIds = localDevices.map((device) => device.id), routeId = records.get("resources/route-reference")?.id || null;
    let built = buildOperationDefinitions({ organizationId: me.organizationId, deviceIds, routeId });
    for (const definition of built.plans) {
      let record = await ensureRecord(definition); record = await recoverAction(definition, record);
      if (["PENDING_REVIEW", "APPROVED"].includes(definition.target) && record.status === "DRAFT") record = await action(definition, record, "SUBMIT", "PENDING_REVIEW", "DISPATCH");
      if (definition.target === "APPROVED" && record.status === "PENDING_REVIEW") record = await action(definition, record, "APPROVE", "APPROVED", "DISPATCH", { note: "内部演练资料审核通过，不是监管审批或飞行放行。" });
      if (record.status !== definition.target) throw new Error(`计划状态偏离演练目标：${definition.key}`);
      state.records[sampleKey("plans", definition.key)].workflowComplete = true; await persist();
    }
    const planIds = Object.fromEntries(built.plans.map((definition) => [definition.key, records.get(`plans/${definition.key}`).id]));
    built = buildOperationDefinitions({ organizationId: me.organizationId, deviceIds, routeId, planIds });
    for (const definition of built.tasks) {
      let record = await ensureRecord(definition); record = await recoverAction(definition, record);
      if (definition.target !== "DRAFT" && record.status === "DRAFT") record = await action(definition, record, "SUBMIT", "PENDING_ASSIGNMENT", "DEPARTMENT");
      if (definition.target === "RETURNED" && record.status === "PENDING_ASSIGNMENT") record = await action(definition, record, "RETURN", "RETURNED", "DISPATCH", { note: "请补充样区边界与成果格式后重新提交。" });
      if (definition.target === "CANCELLED" && ["DRAFT", "PENDING_ASSIGNMENT"].includes(record.status)) record = await action(definition, record, "CANCEL", "CANCELLED", "DEPARTMENT", { note: "演练排班调整，取消该准备事项。" });
      if (["PENDING_EXECUTION", "EXECUTING", "PENDING_ACCEPTANCE", "COMPLETED"].includes(definition.target)) {
        if (record.status === "PENDING_ASSIGNMENT") {
          const device = localDevices[definition.deviceIndex], choices = await admin.get(`/api/v1/tasks/${record.id}/assignment-options?deviceId=${device.id}`);
          if (!choices.devices?.some((item) => item.id === device.id && item.eligible) || !choices.pilots?.some((item) => item.id === actors.PILOT.id && item.eligible)) throw new Error(`真实分配校验未通过：${definition.key}`);
          record = await action(definition, record, "ASSIGN", "PENDING_EXECUTION", "DISPATCH", { deviceId: device.id, pilotId: actors.PILOT.id, ...(record.planId ? { planId: record.planId } : {}), note: "仅登记本地演练资源排班，未调用真实设备命令。" });
        }
        if (["EXECUTING", "PENDING_ACCEPTANCE", "COMPLETED"].includes(definition.target) && record.status === "PENDING_EXECUTION") record = await action(definition, record, "START", "EXECUTING", "PILOT", { note: "开始平台流程演练，不代表真实航空器起飞。" });
        if (["t7", "t8"].includes(definition.key)) await attachment(definition, record, record);
        if (["PENDING_ACCEPTANCE", "COMPLETED"].includes(definition.target) && record.status === "EXECUTING") record = await action(definition, record, "FINISH", "PENDING_ACCEPTANCE", "PILOT", { resultSummary: `已完成本批关联计划、排班资源、成果核对表与办理链条的演练核对。${SAMPLE_NOTICE}`, note: "提交本平台演练成果摘要与CSV核对表验收。" });
        if (definition.target === "COMPLETED" && record.status === "PENDING_ACCEPTANCE") record = await action(definition, record, "ACCEPT", "COMPLETED", "DEPARTMENT", { note: "演练资料与关联ID核对通过，完成本地流程验收。" });
      }
      if (record.status !== definition.target) throw new Error(`任务状态偏离演练目标：${definition.key}`);
      state.records[sampleKey("tasks", definition.key)].workflowComplete = true; await persist();
    }
    const taskIds = Object.fromEntries(built.tasks.map((definition) => [definition.key, records.get(`tasks/${definition.key}`).id]));
    built = buildOperationDefinitions({ organizationId: me.organizationId, deviceIds, routeId, planIds, taskIds });
    for (const definition of built.cases) {
      let record = await ensureRecord(definition); record = await recoverAction(definition, record);
      if (["PENDING_DISPOSAL", "ARCHIVED"].includes(definition.target) && definition.key !== "c6" && record.status === "PENDING_REVIEW") record = await action(definition, record, "VERIFY", "PENDING_DISPOSAL", "DEPARTMENT", { conclusion: `已复核本批演练资料链条，转入本地办理。${SAMPLE_NOTICE}` });
      if (definition.key === "c5") await attachment(definition, record, records.get("tasks/t8"));
      if (definition.key === "c5" && record.status === "PENDING_DISPOSAL") record = await action(definition, record, "RESOLVE", "ARCHIVED", "DEPARTMENT", { conclusion: `林缘样区A演练计划、任务验收与核对表关联完整，流程闭环归档。${SAMPLE_NOTICE}` });
      if (definition.key === "c6" && record.status === "PENDING_REVIEW") record = await action(definition, record, "DISMISS", "ARCHIVED", "DEPARTMENT", { conclusion: `重复或资料不足的演练条目，归档保留办理记录。${SAMPLE_NOTICE}` });
      if (record.status !== definition.target) throw new Error(`线索状态偏离演练目标：${definition.key}`);
      state.records[sampleKey("cases", definition.key)].workflowComplete = true; await persist();
    }
    const evidence = { namespace: NAMESPACE, notice: SAMPLE_NOTICE, site: admin.baseUrl, date: SAMPLE_DATE, region: REGION, recordedAt: new Date().toISOString(), resources: [], users: [], plans: [], tasks: [], cases: [], attachments: Object.values(state.attachments), histories: {} };
    for (const [identity, value] of records) {
      const [group] = identity.split("/");
      const record = await getRecord(group, value.id);
      evidence[group].push(record);
      if (["plans", "tasks", "cases"].includes(group)) evidence.histories[identity] = await admin.list(`/api/v1/${group}/${record.id}/history`);
    }
    await privateJson(path.join(options.stateDir, "evidence.json"), evidence);
    const manual = { namespace: NAMESPACE, notice: SAMPLE_NOTICE, date: SAMPLE_DATE, region: REGION, recordedAt: evidence.recordedAt, resources: [], users: [], plans: [], tasks: [], cases: [], attachments: evidence.attachments };
    for (const [identity, value] of records) {
      const [group, key] = identity.split("/"), record = evidence[group].find((item) => item.id === value.id);
      const alias = /^(p|t|c)\d+$/.test(key) ? key.toUpperCase() : key;
      // Account API views have no credential fields; retain an explicit safe set in the handoff snapshot.
      const safeRecord = group === "users" ? Object.fromEntries(["id", "username", "displayName", "title", "role", "organizationId", "regions", "deviceIds", "organizationIds", "enabled", "createdAt", "provenance"].map((field) => [field, record[field]])) : record;
      manual[group].push({ alias, ...safeRecord, ...(["plans", "tasks", "cases"].includes(group) ? { history: evidence.histories[identity], attachments: evidence.attachments.filter((file) => file.entityId === record.id) } : {}) });
    }
    await privateJson(path.join(options.stateDir, "manual-data.json"), manual);
    state.completedAt = new Date().toISOString(); await persist();
    logger(JSON.stringify({ mode: "COMPLETE", namespace: NAMESPACE, ...summary, verified: { plans: evidence.plans.length, tasks: evidence.tasks.length, cases: evidence.cases.length, csvAttachments: evidence.attachments.length }, stateDirectory: options.stateDir }, null, 2));
    return { summary, evidence };
  } finally { await lock.close(); await fs.unlink(lockFile).catch(() => {}); }
}

async function main() {
  const options = parseArguments(process.argv.slice(2));
  if (options.help) { console.log("用法：node scripts/seed-operation-samples.mjs [--apply] [--base-url http://127.0.0.1:隧道端口] [--env-file 私有env] [--state-dir 私有状态目录]\n默认仅预览。固定2026-10-16/余杭区，创建6计划、9任务、6线索与3份流程演练CSV；不写真实飞行/来源系统。随机岗位密码仅存私有accounts.json。"); return; }
  const env = parseEnvironment(await fs.readFile(options.envFile, "utf8"));
  const username = env.BOOTSTRAP_ADMIN_USERNAME || "admin", password = env.BOOTSTRAP_ADMIN_PASSWORD;
  if (!password) throw new Error("私有env缺少BOOTSTRAP_ADMIN_PASSWORD");
  const admin = new SampleApiClient(options.baseUrl); await admin.login(username, password);
  await runOperationSamples(options, admin);
}
if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) main().catch((error) => { console.error(`业务演练示例未完成：${error.message}`); process.exitCode = 1; });
