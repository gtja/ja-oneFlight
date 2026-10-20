#!/usr/bin/env node
/** Read-only browser acceptance for the shared dark select. Login is the only server POST. */
import { promises as fs } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import assert from "node:assert/strict";
import { chooseSelect } from "./lib/select-ui.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(path.join(root, "frontend", "package.json"));
const { chromium } = require("@playwright/test");
const baseUrl = process.env.QA_LIVE_BASE_URL || "http://127.0.0.1:8088";
const origin = new URL(baseUrl);
assert(["127.0.0.1", "localhost"].includes(origin.hostname), "Select acceptance is limited to the local application.");
const runId = new Date().toISOString().replace(/[:.]/g, "-");
const evidence = path.join(root, ".local", "qa-select-ui", runId);
await fs.mkdir(evidence, { recursive: true, mode: 0o700 });
const report = { runId, baseUrl, readOnly: true, loginRequests: 0, businessWrites: 0,
  checks: [], blockedWrites: [], commandRequests: [], pageErrors: [], consoleErrors: [], failedApiRequests: [] };
let browser;
let page;
let cookie;
let size;
const decode = (value) => value.startsWith('"') && value.endsWith('"') ? JSON.parse(value)
  : value.startsWith("'") && value.endsWith("'") ? value.slice(1, -1) : value;
async function login() {
  const env = {};
  for (const line of (await fs.readFile(path.join(root, ".env"), "utf8")).split(/\r?\n/)) {
    const match = line.match(/^(BOOTSTRAP_ADMIN_USERNAME|BOOTSTRAP_ADMIN_PASSWORD)=(.*)$/);
    if (match) env[match[1]] = decode(match[2]);
  }
  assert(env.BOOTSTRAP_ADMIN_USERNAME && env.BOOTSTRAP_ADMIN_PASSWORD, "Private administrator credentials are unavailable.");
  const csrfResponse = await fetch(`${baseUrl}/api/v1/auth/csrf`, { signal: AbortSignal.timeout(30_000) });
  assert(csrfResponse.ok, "CSRF is unavailable.");
  const csrf = (await csrfResponse.json()).data;
  const cookies = csrfResponse.headers.getSetCookie().map((value) => value.split(";")[0]).join("; ");
  const response = await fetch(`${baseUrl}/api/v1/auth/login`, { method: "POST",
    headers: { "Content-Type": "application/json", Cookie: cookies, [csrf.headerName]: csrf.token },
    body: JSON.stringify({ username: env.BOOTSTRAP_ADMIN_USERNAME, password: env.BOOTSTRAP_ADMIN_PASSWORD }),
    signal: AbortSignal.timeout(30_000) });
  assert(response.ok, "Local administrator login failed.");
  report.loginRequests++;
  const session = [...response.headers.getSetCookie(), ...csrfResponse.headers.getSetCookie()]
    .find((value) => value.startsWith("JSESSIONID="));
  assert(session, "The login did not return a local session.");
  return session.split(";")[0];
}
async function get(endpoint) {
  const response = await fetch(`${baseUrl}/api/v1${endpoint}`, { headers: { Cookie: cookie }, signal: AbortSignal.timeout(90_000) });
  assert(response.ok, `GET ${endpoint.split("?")[0]} failed with HTTP ${response.status}.`);
  const body = await response.json();
  assert.equal(body.code, "OK");
  return body.data;
}
async function catalog(endpoint) {
  const items = [];
  let total;
  for (let number = 1; number <= 200; number++) {
    const data = await get(`${endpoint}${endpoint.includes("?") ? "&" : "?"}page=${number}&pageSize=100`);
    total ??= data.total;
    items.push(...data.items);
    if (items.length >= total || !data.items.length) break;
  }
  assert(items.length >= total, "A local catalog was truncated.");
  return items;
}
const visible = (locator) => locator.first().waitFor({ state: "visible", timeout: 30_000 });
const dropdown = () => page.getByRole("listbox");
const demand = () => page.getByRole("dialog", { name: "提报飞行需求", exact: true });
const field = (scope, name) => scope.getByRole("combobox", { name: new RegExp(`^${name}`) });
async function choose(control, value) {
  await chooseSelect(control, value);
  await dropdown().waitFor({ state: "hidden" });
  assert.equal(await control.getAttribute("data-value"), value);
}
async function screenshot(name) {
  await page.screenshot({ path: path.join(evidence, `${size}-${name}.png`), fullPage: true });
}
async function check(name, action) {
  const start = Date.now();
  try {
    const detail = await action();
    report.checks.push({ name, viewport: size, pass: true, milliseconds: Date.now() - start, ...(detail || {}) });
    console.log(`PASS ${size || "API"} ${name}`);
  } catch (error) {
    report.checks.push({ name, viewport: size, pass: false, milliseconds: Date.now() - start, error: error.message });
    await screenshot(`failure-${report.checks.length}`).catch(() => {});
    console.error(`FAIL ${size || "API"} ${name}: ${error.message}`);
  }
  await fs.writeFile(path.join(evidence, "results.json"), JSON.stringify(report, null, 2), { mode: 0o600 });
}
async function bounds(locator) {
  const box = await locator.boundingBox();
  assert(box, "The visible select or listbox has no bounds.");
  const viewport = page.viewportSize();
  assert(box.x >= -1 && box.y >= -1 && box.x + box.width <= viewport.width + 1 && box.y + box.height <= viewport.height + 1,
    "The dropdown escapes the viewport.");
  return box;
}
async function darkMenu() {
  await visible(dropdown());
  return dropdown().evaluate((element) => {
    let node = element;
    while (node && ["rgba(0, 0, 0, 0)", "transparent"].includes(getComputedStyle(node).backgroundColor)) node = node.parentElement;
    const background = node ? getComputedStyle(node).backgroundColor : "";
    const rgb = background.match(/[\d.]+/g)?.slice(0, 3).map(Number) || [];
    if (rgb.length !== 3 || Math.max(...rgb) > 110) throw new Error(`The popup is not dark: ${background}`);
    return { background };
  });
}
async function anchored(control) {
  const id = await control.getAttribute("id");
  await page.waitForFunction((triggerId) => {
    const trigger = document.getElementById(triggerId);
    const popup = document.querySelector(".select-control__popup");
    if (!trigger || !popup) return false;
    const t = trigger.getBoundingClientRect(), p = popup.getBoundingClientRect();
    return p.top >= -1 && p.bottom <= innerHeight + 1 && p.left >= -1 && p.right <= innerWidth + 1
      && Math.min(Math.abs(p.top - t.bottom), Math.abs(p.bottom - t.top)) < 24;
  }, id);
}
async function goto(view, parameters = {}) {
  await page.goto(`${baseUrl}/?${new URLSearchParams({ view, ...parameters })}`, { waitUntil: "domcontentloaded" });
}
async function openDemand() {
  await goto("dispatch");
  await page.getByRole("button", { name: "提报需求", exact: true }).click();
  await visible(demand());
}

try {
  cookie = await login();
  const [tasks, plans, organizations] = await Promise.all([catalog("/tasks"), catalog("/plans"), catalog("/organizations")]);
  const baseline = tasks.map(({ id, status, updatedAt, deviceId, pilotId, planId }) => ({ id, status, updatedAt, deviceId, pilotId, planId }));
  let assignmentTask = tasks.find((item) => item.status === "PENDING_ASSIGNMENT");
  const approvedPlan = plans.find((item) => item.kind === "LONG_TERM" && item.status === "APPROVED");
  assert(assignmentTask && approvedPlan, "Existing assignment and approved long-term records are required.");
  let assignmentOptions = await get(`/tasks/${assignmentTask.id}/assignment-options`);
  for (const candidate of tasks.filter((item) => item.status === "PENDING_ASSIGNMENT" && item.id !== assignmentTask.id)) {
    if (assignmentOptions.devices.some((item) => item.eligible)) break;
    const options = await get(`/tasks/${candidate.id}/assignment-options`);
    if (options.devices.some((item) => item.eligible)) {
      assignmentTask = candidate;
      assignmentOptions = options;
      break;
    }
  }
  const unavailable = assignmentOptions.devices.find((item) => !item.eligible && item.reasons?.length);
  assert(unavailable, "A real unavailable device with its reason is required.");
  browser = await chromium.launch({ executablePath: process.env.QA_CHROME_PATH || "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    headless: true, args: ["--disable-dev-shm-usage"] });
  for (const viewport of [{ width: 1920, height: 1080 }, { width: 1280, height: 720 }]) {
    size = `${viewport.width}x${viewport.height}`;
    const context = await browser.newContext({ viewport, locale: "zh-CN", timezoneId: "Asia/Shanghai", colorScheme: "dark" });
    await context.addCookies([{ name: "JSESSIONID", value: cookie.slice("JSESSIONID=".length), domain: origin.hostname,
      path: "/", httpOnly: true, secure: origin.protocol === "https:", sameSite: "Lax" }]);
    await context.route("**/api/v1/**", async (route) => {
      const request = route.request();
      const endpoint = new URL(request.url()).pathname;
      if (/\/commands(?:\/|$)/.test(endpoint)) {
        report.commandRequests.push({ viewport: size, method: request.method(), path: endpoint });
        await route.abort("blockedbyclient"); return;
      }
      if (!["GET", "HEAD", "OPTIONS"].includes(request.method())) {
        report.blockedWrites.push({ viewport: size, method: request.method(), path: endpoint });
        await route.abort("blockedbyclient"); return;
      }
      await route.continue();
    });
    page = await context.newPage();
    page.setDefaultTimeout(15_000);
    page.on("pageerror", (error) => report.pageErrors.push({ viewport: size, message: error.message }));
    page.on("console", (message) => {
      if (message.type() === "error") report.consoleErrors.push({ viewport: size, message: message.text().slice(0, 500) });
    });
    page.on("response", (response) => {
      const url = new URL(response.url());
      if (url.origin === origin.origin && url.pathname.startsWith("/api/v1/") && response.status() >= 400)
        report.failedApiRequests.push({ viewport: size, path: url.pathname, status: response.status() });
    });

    await check("Demand form uses labeled custom selects and a dark checked selection", async () => {
      await openDemand();
      for (const label of ["应用场景", "作业区域", "紧急程度", "需求部门"]) {
        const control = field(demand(), label);
        await visible(control);
        assert.equal(await control.getAttribute("role"), "combobox");
      }
      assert.equal(await page.locator("select").count(), 0, "An OS native select remains on the page.");
      const priority = field(demand(), "紧急程度");
      assert.equal(await priority.getAttribute("data-value"), "NORMAL");
      await priority.click();
      await darkMenu();
      const selected = dropdown().getByRole("option", { name: "常规", exact: true });
      assert.equal(await selected.getAttribute("aria-selected"), "true");
      assert(await selected.locator("svg").count() > 0, "The selected option has no checkmark.");
      await bounds(dropdown());
      await screenshot("demand-priority-dark");
      await page.keyboard.press("Escape");
      await visible(demand());
    });

    await check("Arrow keys and Enter choose an option; Escape closes only the dropdown", async () => {
      await openDemand();
      const priority = field(demand(), "紧急程度");
      await priority.focus();
      await page.keyboard.press("ArrowDown");
      await visible(dropdown());
      await page.keyboard.press("End");
      await page.keyboard.press("Enter");
      assert.equal(await priority.getAttribute("data-value"), "URGENT");
      await priority.click();
      await page.keyboard.press("Escape");
      assert.equal(await dropdown().count(), 0);
      await visible(demand());
      assert(await priority.evaluate((node) => document.activeElement === node), "Escape did not restore trigger focus.");
      await priority.click();
      await page.keyboard.press("Tab");
      assert.equal(await dropdown().count(), 0);
      assert(await demand().getByLabel("作业要求", { exact: false }).evaluate((node) => document.activeElement === node),
        "Tab did not move to the next form control.");
    });

    await check("Required empty region prevents submission without a business request", async () => {
      await openDemand();
      await demand().getByLabel("任务名称", { exact: false }).fill("下拉选择校验");
      await demand().getByLabel("作业要求", { exact: false }).fill("仅在浏览器中核对必填选择交互，不保存记录。");
      await demand().getByLabel("期望开始时间", { exact: false }).fill("2026-10-17T09:00");
      await demand().getByLabel("期望结束时间", { exact: false }).fill("2026-10-17T10:00");
      const before = report.blockedWrites.length;
      await demand().getByRole("button", { name: "提交需求", exact: true }).click();
      assert.equal(await field(demand(), "作业区域").getAttribute("data-value"), "");
      await visible(demand());
      await visible(demand().getByText("请选择作业区域", { exact: true }));
      assert.equal(report.blockedWrites.length, before, "The empty required selection attempted a business write.");
      return { requiredRegionRetained: true, submittedRequests: 0 };
    });

    await check("Organization search filters the full catalog and accepts a local selection", async () => {
      await openDemand();
      const organization = field(demand(), "需求部门");
      await organization.click();
      await visible(dropdown());
      await page.waitForFunction((expected) => document.querySelectorAll('[role="listbox"] [role="option"]').length >= expected,
        organizations.length);
      const optionCount = await dropdown().getByRole("option").count();
      assert(optionCount >= organizations.length, "Organization choices were truncated.");
      const currentOrganization = await organization.getAttribute("data-value");
      const target = organizations.find((item) => String(item.title || "").length > 3 && item.id !== currentOrganization) || organizations.at(-1);
      const search = page.getByRole("searchbox", { name: "搜索选项", exact: true });
      await visible(search);
      await search.fill(String(target.title));
      const targetOption = dropdown().locator(`[role="option"][data-value=${JSON.stringify(target.id)}]`);
      await visible(targetOption);
      assert((await dropdown().getByRole("option").count()) < optionCount, "Search did not reduce choices.");
      await screenshot("organization-search");
      await targetOption.click();
      assert.equal(await organization.getAttribute("data-value"), target.id);
      await organization.click();
      await search.fill("__无匹配选择__");
      await visible(page.getByText("未找到匹配选项", { exact: true }));
      assert.equal(await dropdown().getByRole("option").count(), 0);
      assert.equal(await organization.getAttribute("data-value"), target.id);
      await page.keyboard.press("Escape");
      return { organizationCount: organizations.length, searchable: true };
    });

    await check("Portal menu remains in the viewport at the form bottom and closes on outside click", async () => {
      await openDemand();
      const organization = field(demand(), "需求部门");
      await organization.scrollIntoViewIfNeeded();
      await organization.click();
      await darkMenu();
      await bounds(dropdown());
      const before = await organization.boundingBox();
      await screenshot("organization-placement");
      await demand().getByRole("heading", { name: "提报飞行需求", exact: true }).click();
      assert.equal(await dropdown().count(), 0);
      await visible(demand());
      await organization.click();
      await page.setViewportSize({ width: viewport.width, height: viewport.height - 50 });
      await anchored(organization);
      await bounds(dropdown());
      await demand().locator(".modal-body").evaluate((node) => node.scrollBy(0, -35));
      await anchored(organization);
      await page.keyboard.press("Escape");
      await page.setViewportSize(viewport);
      return { originalTriggerTop: before.y, placementInBounds: true };
    });

    await check("Assignment menu shows all real devices with searchable disabled reasons", async () => {
      await goto("dispatch", { taskId: assignmentTask.id });
      await page.getByRole("dialog").last().getByRole("button", { name: "分配资源", exact: true }).click();
      const modal = page.getByRole("dialog", { name: "分配执行资源", exact: true });
      const control = field(modal, "执行设备");
      await visible(control);
      await page.waitForFunction(() => !document.querySelector("#assignment-deviceId")?.disabled);
      await control.click();
      await visible(dropdown());
      assert.equal(await dropdown().getByRole("option").count(), assignmentOptions.devices.length + 1,
        "The assignment menu omitted visible devices.");
      const disabledCount = await dropdown().locator('[role="option"][aria-disabled="true"]').count();
      assert.equal(disabledCount, assignmentOptions.devices.filter((item) => !item.eligible).length);
      await page.getByRole("searchbox", { name: "搜索选项", exact: true }).fill(unavailable.title);
      const disabled = dropdown().locator(`[role="option"][data-value=${JSON.stringify(unavailable.id)}]`);
      await visible(disabled);
      assert.equal(await disabled.getAttribute("aria-disabled"), "true");
      assert((await disabled.textContent()).includes(unavailable.reasons[0].message), "An unavailable device lost its reason.");
      await disabled.click({ force: true });
      assert.equal(await control.getAttribute("data-value"), "");
      await visible(dropdown());
      await bounds(dropdown());
      await screenshot("assignment-device-disabled");
      await page.keyboard.press("Escape");
      await visible(modal);
      const pilot = field(modal, "执行飞手");
      assert(await pilot.isDisabled(), "Pilot selection was enabled before a device was chosen.");
      const available = assignmentOptions.devices.find((item) => item.eligible);
      if (available) {
        await choose(control, available.id);
        await page.waitForFunction(() => !document.querySelector("#assignment-pilotId")?.disabled);
        await pilot.click();
        await darkMenu();
        await bounds(dropdown());
        assert((await dropdown().getByRole("option").count()) >= 1);
        await page.keyboard.press("Escape");
      }
      await field(modal, "关联飞行计划").click();
      await darkMenu();
      await bounds(dropdown());
      await page.keyboard.press("Escape");
      assert.equal(await page.locator("select").count(), 0);
      return { devices: assignmentOptions.devices.length, disabledDevices: disabledCount };
    });

    await check("Filter selects share the dark menu across five modules", async () => {
      const modules = [
        { view: "dispatch", label: "任务阶段", value: "PENDING_ASSIGNMENT" },
        { view: "services", label: "事项类型", value: "LONG_TERM" },
        { view: "resources", label: "设备类型", value: "UAV_AIRPORT" },
        { view: "flight", label: "管控设备类型", value: "UAV_AIRPORT" },
        { view: "algorithms", label: "工作内容", value: "training" },
      ];
      for (const item of modules) {
        await goto(item.view);
        const control = page.getByRole("combobox", { name: item.label, exact: true });
        await visible(control);
        await control.click();
        await darkMenu();
        await bounds(dropdown());
        await dropdown().locator(`[role="option"][data-value=${JSON.stringify(item.value)}]`).click();
        assert.equal(await control.getAttribute("data-value"), item.value);
        assert.equal(await page.locator("select").count(), 0, `${item.view} retains an OS native select.`);
      }
      return { modules: modules.map((item) => item.view) };
    });

    await check("Settings account form shares custom status, role and organization selects", async () => {
      await goto("dispatch");
      await page.getByRole("button", { name: "平台设置", exact: true }).click();
      await page.getByRole("tab", { name: "组织与权限", exact: true }).click();
      await page.getByRole("button", { name: "新增账号", exact: true }).click();
      const modal = page.getByRole("dialog", { name: "新增本地账号", exact: true });
      await visible(modal);
      for (const label of ["账号状态", "岗位角色", "所属组织"]) {
        const control = field(modal, label);
        await control.click();
        await darkMenu();
        await bounds(dropdown());
        await page.keyboard.press("Escape");
        await visible(modal);
      }
      await choose(field(modal, "岗位角色"), "PILOT");
      await screenshot("settings-account-form");
      assert.equal(await page.locator("select").count(), 0);
    });

    await check("Approved-plan task form shares scene and priority selects without submitting", async () => {
      await goto("services", { planId: approvedPlan.id });
      await page.getByRole("button", { name: "安排执行任务", exact: true }).click();
      const modal = page.getByRole("dialog", { name: "安排执行任务", exact: true });
      await visible(modal);
      await choose(field(modal, "应用场景"), "河道巡查");
      await choose(field(modal, "紧急程度"), "URGENT");
      await field(modal, "紧急程度").click();
      await darkMenu();
      await screenshot("plan-task-priority");
      await page.keyboard.press("Escape");
      await visible(modal);
      assert.equal(await page.locator("select").count(), 0);
      assert((await modal.evaluate((node) => node.scrollWidth - node.clientWidth)) <= 2,
        "The task form overflows horizontally.");
    });

    await check("No horizontal page overflow or native select remains", async () => {
      const dimensions = await page.evaluate(() => ({ width: document.documentElement.clientWidth,
        scroll: document.documentElement.scrollWidth }));
      assert(dimensions.scroll <= dimensions.width + 2);
      assert.equal(await page.locator("select").count(), 0);
    });
    await context.close();
  }
  size = undefined;
  await check("All task records remain unchanged and no command or business request was attempted", async () => {
    const after = (await catalog("/tasks")).map(({ id, status, updatedAt, deviceId, pilotId, planId }) => ({ id, status, updatedAt, deviceId, pilotId, planId }));
    assert.deepEqual(after, baseline, "Acceptance changed a production task.");
    assert.equal(report.blockedWrites.length, 0, "A business write was attempted and blocked.");
    assert.equal(report.commandRequests.length, 0, "A command request was attempted and blocked.");
    assert.equal(report.pageErrors.length, 0, "Unexpected JavaScript errors were reported.");
    assert.equal(report.failedApiRequests.length, 0, "Unexpected API errors were reported.");
    assert.equal(report.consoleErrors.length, 0, "Unexpected browser console errors were reported.");
    return { taskCount: baseline.length, businessWrites: 0, commandRequests: 0 };
  });
} catch (error) {
  report.fatal = error.message;
  console.error(`FAIL setup: ${error.message}`);
} finally {
  await browser?.close();
  report.finishedAt = new Date().toISOString();
  report.passed = report.checks.filter((item) => item.pass).length;
  report.failed = report.checks.filter((item) => !item.pass).length + Number(!!report.fatal);
  await fs.writeFile(path.join(evidence, "results.json"), JSON.stringify(report, null, 2), { mode: 0o600 });
  console.log(JSON.stringify({ passed: report.passed, failed: report.failed, businessWrites: report.businessWrites,
    blockedWrites: report.blockedWrites.length, commandRequests: report.commandRequests.length,
    pageErrors: report.pageErrors.length, consoleErrors: report.consoleErrors.length, failedApiRequests: report.failedApiRequests.length, evidence }));
  if (report.failed) process.exitCode = 1;
}

