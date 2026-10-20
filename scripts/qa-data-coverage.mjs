#!/usr/bin/env node
import { chooseSelect } from "./lib/select-ui.mjs";
/** Read-only acceptance against the deployed local application; login is the only POST. */
import { promises as fs } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import assert from "node:assert/strict";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(path.join(root, "frontend", "package.json"));
const { chromium } = require("@playwright/test");
const baseUrl = process.env.QA_LIVE_BASE_URL || "http://127.0.0.1:8088";
const origin = new URL(baseUrl);
if (!["localhost", "127.0.0.1"].includes(origin.hostname))
  throw new Error("Data coverage acceptance is limited to the local deployed app.");
const runId = new Date().toISOString().replace(/[:.]/g, "-");
const evidence = path.join(root, ".local", "qa-data-coverage", runId);
await fs.mkdir(evidence, { recursive: true, mode: 0o700 });
const report = {
  runId,
  baseUrl,
  readOnly: true,
  businessWrites: 0,
  api: {},
  checks: [],
  pageErrors: [],
  consoleErrors: [],
  failedApiRequests: [],
  blockedWrites: [],
};
let browser;
let page;
let sessionCookie;

function decode(value) {
  if (value.startsWith('"') && value.endsWith('"')) return JSON.parse(value);
  if (value.startsWith("'") && value.endsWith("'")) return value.slice(1, -1);
  return value;
}
async function login() {
  const env = {};
  for (const line of (await fs.readFile(path.join(root, ".env"), "utf8")).split(/\r?\n/)) {
    const match = line.match(/^(BOOTSTRAP_ADMIN_USERNAME|BOOTSTRAP_ADMIN_PASSWORD)=(.*)$/);
    if (match) env[match[1]] = decode(match[2]);
  }
  assert(env.BOOTSTRAP_ADMIN_USERNAME && env.BOOTSTRAP_ADMIN_PASSWORD, "Local admin configuration is missing.");
  const csrfResponse = await fetch(`${baseUrl}/api/v1/auth/csrf`);
  assert(csrfResponse.ok, "CSRF endpoint is unavailable.");
  const csrf = (await csrfResponse.json()).data;
  const cookies = csrfResponse.headers.getSetCookie().map((value) => value.split(";")[0]).join("; ");
  const response = await fetch(`${baseUrl}/api/v1/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Cookie: cookies, [csrf.headerName]: csrf.token },
    body: JSON.stringify({ username: env.BOOTSTRAP_ADMIN_USERNAME, password: env.BOOTSTRAP_ADMIN_PASSWORD }),
  });
  assert(response.ok, "Local admin login failed.");
  const session = [...response.headers.getSetCookie(), ...csrfResponse.headers.getSetCookie()]
    .find((value) => value.startsWith("JSESSIONID="));
  assert(session, "Local login did not return a session.");
  sessionCookie = session.split(";")[0];
}
async function get(endpoint) {
  const response = await fetch(`${baseUrl}/api/v1${endpoint}`, {
    headers: { Cookie: sessionCookie },
    signal: AbortSignal.timeout(90_000),
  });
  assert(response.ok, `GET ${endpoint.split("?")[0]} returned HTTP ${response.status}.`);
  const body = await response.json();
  assert.equal(body.code, "OK", `GET ${endpoint.split("?")[0]} did not succeed.`);
  return body.data;
}
async function check(name, action) {
  const started = Date.now();
  try {
    const detail = await action();
    report.checks.push({ name, pass: true, milliseconds: Date.now() - started, ...(detail || {}) });
    console.log(`PASS ${name}`);
  } catch (error) {
    report.checks.push({ name, pass: false, milliseconds: Date.now() - started, error: error.message });
    if (page && !page.isClosed()) {
      const file = `failure-${report.checks.length}.png`;
      await page.screenshot({ path: path.join(evidence, file), fullPage: true }).catch(() => {});
    }
    console.error(`FAIL ${name}: ${error.message}`);
  }
  await fs.writeFile(path.join(evidence, "results.json"), JSON.stringify(report, null, 2), { mode: 0o600 });
}
async function screenshot(name) {
  await page.screenshot({ path: path.join(evidence, `${name}.png`), fullPage: true });
}
async function visible(locator, message) {
  await locator.first().waitFor({ state: "visible", timeout: 45_000 });
  assert(await locator.first().isVisible(), message);
}
async function rows(scope = page) {
  const locator = scope.locator("tbody tr");
  await visible(locator, "Expected records are not visible.");
  return locator.count();
}
async function go(view, title) {
  await page.goto(`${baseUrl}/?view=${view}`, { waitUntil: "domcontentloaded" });
  await visible(page.getByRole("heading", { name: title, exact: true }));
}
async function closeModal() {
  const dialog = page.getByRole("dialog").last();
  if (await dialog.count()) {
    await dialog.getByRole("button", { name: "关闭", exact: true }).click();
    await dialog.waitFor({ state: "hidden" });
  }
}
async function resourceMenu(label) {
  await page.locator(".resource-catalog").getByRole("button", { name: label, exact: true }).click();
  await visible(page.locator(".resource-main").getByRole("heading", { name: label === "人员档案" ? "人员资源" : label, exact: true }));
  return rows(page.locator(".resource-main"));
}

try {
  await login();
  const cached = {};
  await check("API local business coverage", async () => {
    const paths = {
      tasks: "/tasks?pageSize=100", plans: "/plans?pageSize=100", cases: "/cases?pageSize=100",
      consultations: "/consultations?pageSize=100", attachments: "/attachments?pageSize=100",
      users: "/users?pageSize=100", organizations: "/organizations?pageSize=100", audit: "/audit?pageSize=1",
      settings: "/settings?pageSize=100",
    };
    for (const [key, endpoint] of Object.entries(paths)) {
      const data = await get(endpoint);
      cached[key] = data;
      report.api[key] = { total: data.total, shown: data.items?.length };
      assert(data.total > 0 && data.items?.length > 0, `${key} has no records.`);
    }
    for (const kind of ["DEVICE", "PERSON", "ROUTE", "AIRSPACE", "MAINTENANCE", "ALGORITHM_DATASET", "ALGORITHM_TRAINING"]) {
      const data = await get(`/resources?kind=${kind}&pageSize=100`);
      cached[kind] = data;
      report.api[kind] = { total: data.total, shown: data.items.length };
      assert(data.total > 0 && data.items.length > 0, `${kind} has no records.`);
    }
    const scenes = ["森林防火", "矿产监管", "非现执法"];
    for (const scene of scenes)
      assert(cached.cases.items.some((item) => item.scene === scene), `Scene ${scene} has no records.`);
    for (const kind of ["DAILY", "LONG_TERM", "DEVICE_ADMISSION", "PILOT_ADMISSION"])
      assert(cached.plans.items.some((item) => item.kind === kind), `Plan kind ${kind} has no records.`);
    for (const role of ["ADMIN", "DISPATCH", "DEPARTMENT", "PILOT"])
      assert(cached.users.items.some((item) => item.role === role), `Local role ${role} has no account.`);
  });
  await check("API genuine source catalogs and event filter", async () => {
    for (const kind of ["people", "groups", "routes", "airspaces", "plans", "tasks", "events", "media"]) {
      const data = await get(`/source-data/${kind}?pageSize=5`);
      report.api[`source-${kind}`] = { total: data.total, shown: data.items.length };
      assert(data.total > 0 && data.items.length > 0, `Source catalog ${kind} has no records.`);
      assert(data.items.every((item) => item.sourceSystem && item.sourceEntity), `Source catalog ${kind} is missing provenance.`);
      assert(data.items.every((item) => typeof item.id === "string" && typeof item.sourceId === "string"), `Source catalog ${kind} returned a numeric external identifier.`);
    }
    const fire = await get("/source-data/events?eventType=fire_detection&pageSize=5");
    report.api["source-fire"] = { total: fire.total, shown: fire.items.length };
    assert(fire.total > 0, "Genuine fire observations are missing.");
    assert(fire.items.every((item) => item.eventType === "fire_detection"), "Source event type filter was not applied.");
    const catalog = await get("/algorithms?pageSize=100");
    report.api.algorithms = { total: catalog.total, shown: catalog.items.length };
    assert(catalog.total > 0, "Source algorithm catalog is empty.");
    const flights = await get("/flights?pageSize=1");
    report.api.flights = { total: flights.total };
    assert(flights.total > 0, "Source flight history is empty.");
  });
  await check("API preparation records preserve honest states", async () => {
    assert(cached.ALGORITHM_TRAINING?.items.every((item) => item.status === "PENDING_CONFIGURATION"), "An unconnected training service has a completed run.");
    assert(cached.ALGORITHM_DATASET?.items.every((item) => item.status === "PENDING_LABELING"), "Dataset collection was treated as verified ground truth.");
    for (const kind of ["PERSON", "ROUTE", "AIRSPACE"])
      assert(cached[kind]?.items.some((item) => item.provenance?.origin === "SOURCE_IMPORTED" || item.metadata?.sourceImport), `${kind} lacks an imported source record.`);
    for (const kind of ["MAINTENANCE", "ALGORITHM_DATASET", "ALGORITHM_TRAINING"])
      assert(cached[kind]?.items.some((item) => item.provenance?.origin === "BUSINESS_INITIALIZATION"), `${kind} lacks initialization provenance.`);
  });
  await check("API attachment download is readable", async () => {
    const file = cached.attachments?.items?.[0];
    assert(file, "No attachment is available.");
    const response = await fetch(`${baseUrl}/api/v1/attachments/${encodeURIComponent(file.id)}/content`, { headers: { Cookie: sessionCookie } });
    assert(response.ok, "Stored attachment cannot be downloaded.");
    const bytes = new Uint8Array(await response.arrayBuffer());
    assert(bytes.length > 0, "Stored attachment is empty.");
    report.api.attachmentDownload = { bytes: bytes.length, contentType: response.headers.get("content-type") };
    const image = cached.attachments.items.find((item) => /image\//i.test(item.contentType || "") || /\.(?:png|jpe?g)$/i.test(item.fileName || item.filename || ""));
    assert(image, "No genuine observation image was attached.");
    const imageResponse = await fetch(`${baseUrl}/api/v1/attachments/${encodeURIComponent(image.id)}/content`, { headers: { Cookie: sessionCookie } });
    assert(imageResponse.ok, "Stored observation image cannot be downloaded.");
    const imageBytes = new Uint8Array(await imageResponse.arrayBuffer());
    const jpeg = imageBytes[0] === 0xff && imageBytes[1] === 0xd8 && imageBytes[2] === 0xff;
    const png = [137, 80, 78, 71, 13, 10, 26, 10].every((value, index) => imageBytes[index] === value);
    assert(jpeg || png, "Observation attachment is not an actual JPEG/PNG.");
    report.api.observationImage = { bytes: imageBytes.length, signature: jpeg ? "JPEG" : "PNG" };
  });

  browser = await chromium.launch({
    executablePath: process.env.QA_CHROME_PATH || "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    headless: true,
    args: ["--disable-dev-shm-usage"],
  });
  const context = await browser.newContext({ locale: "zh-CN", timezoneId: "Asia/Shanghai", viewport: { width: 1920, height: 1080 }, colorScheme: "dark" });
  await context.addCookies([{ name: "JSESSIONID", value: sessionCookie.slice("JSESSIONID=".length), domain: origin.hostname, path: "/", httpOnly: true, secure: origin.protocol === "https:", sameSite: "Lax" }]);
  await context.route("**/api/v1/**", async (route) => {
    const request = route.request();
    if (!["GET", "HEAD", "OPTIONS"].includes(request.method())) {
      report.blockedWrites.push({ method: request.method(), path: new URL(request.url()).pathname });
      await route.abort("blockedbyclient");
    } else await route.continue();
  });
  page = await context.newPage();
  page.on("pageerror", (error) => report.pageErrors.push(error.message));
  page.on("console", (message) => {
    if (message.type() === "error") report.consoleErrors.push(message.text().slice(0, 500));
  });
  page.on("response", (response) => {
    if (response.status() >= 400 && new URL(response.url()).pathname.startsWith("/api/v1/"))
      report.failedApiRequests.push({ path: new URL(response.url()).pathname, status: response.status() });
  });
  for (const viewport of [{ width: 1920, height: 1080 }, { width: 1024, height: 768 }]) {
    const size = `${viewport.width}x${viewport.height}`;
    await page.setViewportSize(viewport);
    await check(`${size} overview and command board`, async () => {
      await go("overview", "态势感知");
      await visible(page.locator(".map-metrics button strong"));
      const metrics = page.locator(".map-metrics button");
      assert.equal(await metrics.count(), 6, "Overview metrics are missing.");
      await page.waitForFunction(() => [...document.querySelectorAll(".map-metrics button strong")].length === 6 && [...document.querySelectorAll(".map-metrics button strong")].every((element) => /\d/.test(element.textContent || "")), undefined, { timeout: 45_000 });
      await visible(page.locator(".maplibregl-canvas"));
      await page.getByRole("button", { name: "指挥大屏", exact: true }).click();
      await visible(page.getByRole("button", { name: "返回工作台", exact: true }));
      const bounds = await page.locator(".main-workspace").boundingBox();
      assert(bounds && bounds.width > viewport.width * 0.7 && bounds.height > 300, "Command board workspace is blank or collapsed.");
      await visible(page.getByRole("heading", { name: "低空运行指挥", exact: true }));
      assert.equal(await page.locator(".command-kpi").count(), 3);
      assert.equal(await page.locator(".command-bottom-charts svg").count(), 2);
      await screenshot(`${size}-command-board`);
      await page.keyboard.press("Escape");
      await visible(page.getByRole("button", { name: "指挥大屏", exact: true }));
    });
    await check(`${size} resources and real source details`, async () => {
      await go("resources", "资源管理");
      await rows(page.locator(".resource-main"));
      await visible(page.getByLabel("设备累计飞行汇总"));
      for (const [label, initialized] of [["人员档案", false], ["航线资源", false], ["空域资源", false], ["设备维护", true]]) {
        await resourceMenu(label);
        const search = page.getByPlaceholder("搜索资源名称、编号或型号");
        await search.fill("");
        await page.locator(".resource-main tbody tr").first().click();
        const dialog = page.getByRole("dialog").last();
        await visible(dialog.getByRole("heading", { name: "来源信息", exact: true }));
        if (initialized) await visible(dialog.getByText("平台初始化录入", { exact: false }));
        else assert((await dialog.locator(".details").allTextContents()).some((text) => /来源|ja-4a|dushu|chingchi/.test(text)), "Imported resource is missing source information.");
        await dialog.getByRole("heading", { name: "来源信息", exact: true }).scrollIntoViewIfNeeded();
        await screenshot(`${size}-resource-${label}`);
        await closeModal();
      }
      await resourceMenu("飞行记录");
      await resourceMenu("成果媒体");
      await page.locator(".resource-main tbody tr").first().click();
      await visible(page.getByRole("dialog").getByRole("link", { name: "预览 / 下载文件" }));
      const downloadEvent = page.waitForEvent("download", { timeout: 30_000 });
      await page.getByRole("dialog").getByRole("link", { name: "预览 / 下载文件" }).click();
      const download = await downloadEvent;
      await download.saveAs(path.join(evidence, `${size}-downloaded-attachment.bin`));
      assert((await fs.stat(path.join(evidence, `${size}-downloaded-attachment.bin`))).size > 0, "Browser attachment download is empty.");
      await closeModal();
      await page.getByRole("button", { name: "来源媒体", exact: true }).click();
      await rows(page.locator(".resource-main"));
      await screenshot(`${size}-source-media`);
    });
    await check(`${size} local task stages and upstream actions`, async () => {
      await go("dispatch", "任务调度");
      await rows();
      await page.locator(".content-pad tbody tr").first().click();
      await visible(page.getByRole("dialog").getByRole("heading", { name: "来源信息", exact: true }));
      await closeModal();
      await page.getByRole("button", { name: "来源行动（只读）", exact: true }).click();
      await rows();
      await screenshot(`${size}-source-actions`);
    });
    await check(`${size} flight devices, history and task approval gating`, async () => {
      await go("flight", "飞行管控");
      await visible(page.locator(".queue-card"));
      // Entering the device catalog without a task has no approved task context.
      assert.equal(new URL(page.url()).searchParams.get("taskId"), null);
      for (const label of ["下发任务", "立即起飞", "暂停作业", "立即返航", "确认落地并结束"])
        assert(await page.getByRole("button", { name: label, exact: true }).isDisabled(), `Local control ${label} was enabled without a task approval.`);
      for (const label of ["发送云台指令", "发送喊话"])
        assert(await page.getByRole("button", { name: label, exact: true }).isDisabled(), `Local payload control ${label} was enabled without a task approval.`);
      await page.getByRole("button", { name: "查看观测与飞行记录", exact: true }).click();
      await visible(page.getByRole("dialog"));
      await closeModal();
      await screenshot(`${size}-flight-control`);
    });
    await check(`${size} plans, admissions, consultations and upstream plans`, async () => {
      await go("services", "飞行服务");
      await visible(page.locator(".queue-card"));
      const type = page.getByLabel("事项类型", { exact: true });
      for (const kind of ["DAILY", "LONG_TERM", "DEVICE_ADMISSION", "PILOT_ADMISSION"]) {
        await chooseSelect(type, kind);
        await visible(page.locator(".queue-card"));
      }
      await chooseSelect(type, "");
      await chooseSelect(page.getByLabel("工作内容", { exact: true }), "preflight");
      await rows();
      await screenshot(`${size}-consultations`);
      await chooseSelect(page.getByLabel("工作内容", { exact: true }), "source");
      await rows();
      await screenshot(`${size}-source-plans`);
    });
    await check(`${size} algorithms, observation filter and preparation collections`, async () => {
      await go("algorithms", "飞行算法");
      await visible(page.locator(".algorithm-card"));
      assert(await page.getByRole("button", { name: "部署算法", exact: true }).isDisabled());
      await chooseSelect(page.getByLabel("工作内容", { exact: true }), "review");
      await rows();
      const filter = page.getByLabel("识别类型", { exact: true });
      await chooseSelect(filter, "fire_detection");
      await rows();
      await screenshot(`${size}-source-recognition`);
      await chooseSelect(page.getByLabel("工作内容", { exact: true }), "training");
      await rows();
      await page.getByRole("button", { name: "查看训练事项", exact: true }).click();
      await rows();
      await page.locator("tbody tr").first().click();
      assert(await page.getByRole("dialog").getByRole("button", { name: "提交训练", exact: true }).isDisabled());
      await visible(page.getByRole("dialog").getByText("平台初始化录入", { exact: false }));
      await closeModal();
      await screenshot(`${size}-algorithm-training`);
    });
    await check(`${size} three industry scenes`, async () => {
      await go("scenes", "场景应用");
      for (const scene of ["森林防火", "矿产监管", "非现执法"]) {
        await chooseSelect(page.getByLabel("工作内容", { exact: true }), scene);
        await visible(page.locator(".queue-card"));
        await visible(page.getByRole("heading", { name: "证据研判", exact: true }));
      }
      await screenshot(`${size}-industry-scene`);
    });
    await check(`${size} settings source catalogs, accounts, audit and configuration`, async () => {
      await page.getByRole("button", { name: "平台设置", exact: true }).click();
      const dialog = page.getByRole("dialog");
      await visible(dialog.getByRole("heading", { name: "来源业务目录", exact: true }));
      await rows(dialog);
      await screenshot(`${size}-settings-source`);
      await dialog.getByRole("tab", { name: "组织与权限", exact: true }).click();
      await rows(dialog);
      await dialog.getByRole("tab", { name: "安全审计", exact: true }).click();
      await rows(dialog);
      await dialog.getByRole("tab", { name: "平台配置", exact: true }).click();
      await visible(dialog.getByRole("heading", { name: "平台基础配置", exact: true }));
      assert(await dialog.locator(".config-options button").count() >= 6);
      await closeModal();
    });
  }
  await check("Browser read-only and runtime errors", async () => {
    assert.equal(report.blockedWrites.length, 0, "A browser interaction attempted a business write.");
    assert.equal(report.pageErrors.length, 0, "Browser JavaScript errors occurred.");
    assert.equal(report.failedApiRequests.length, 0, "An application API request failed.");
    assert.equal(report.consoleErrors.length, 0, "Browser console errors occurred.");
  });
} catch (error) {
  report.checks.push({ name: "Acceptance setup", pass: false, error: error.message });
  console.error(error.message);
} finally {
  await browser?.close();
  report.passed = report.checks.filter((item) => item.pass).length;
  report.failed = report.checks.filter((item) => !item.pass).length;
  await fs.writeFile(path.join(evidence, "results.json"), JSON.stringify(report, null, 2), { mode: 0o600 });
  console.log(`Coverage acceptance: ${report.passed} passed, ${report.failed} failed; evidence ${evidence}`);
  process.exitCode = report.failed ? 1 : 0;
}
