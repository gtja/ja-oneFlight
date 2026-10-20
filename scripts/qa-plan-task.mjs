#!/usr/bin/env node
import { chooseSelect, selectValue } from "./lib/select-ui.mjs";
/** Read-only browser acceptance. Task creation is fulfilled in-browser; only login reaches a write endpoint. */
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
assert(["localhost", "127.0.0.1"].includes(origin.hostname), "Plan/task acceptance is limited to the local application.");
const runId = new Date().toISOString().replace(/[:.]/g, "-");
const evidence = path.join(root, ".local", "qa-plan-task", runId);
await fs.mkdir(evidence, { recursive: true, mode: 0o700 });
const report = {
  runId, baseUrl, readOnly: true, businessWrites: 0, loginRequests: 0,
  responseOverrides: "Browser responses represent role/status scenarios and fixture task creation. No business or source write reaches the server.",
  checks: [], interceptedCreates: [], blockedWrites: [], commandRequests: [], pageErrors: [], consoleErrors: [], failedApiRequests: [],
};
let browser;
let page;
let adminCookie;
const sessions = new Map();
const decode = (value) => value.startsWith('"') && value.endsWith('"') ? JSON.parse(value)
  : value.startsWith("'") && value.endsWith("'") ? value.slice(1, -1) : value;
async function credentials() {
  const env = {};
  for (const line of (await fs.readFile(path.join(root, ".env"), "utf8")).split(/\r?\n/)) {
    const match = line.match(/^(BOOTSTRAP_ADMIN_USERNAME|BOOTSTRAP_ADMIN_PASSWORD)=(.*)$/);
    if (match) env[match[1]] = decode(match[2]);
  }
  const privateAccounts = JSON.parse(await fs.readFile(path.join(root, ".local", "business-initialization", "accounts.json"), "utf8"));
  const accounts = new Map([["ADMIN", { username: env.BOOTSTRAP_ADMIN_USERNAME, password: env.BOOTSTRAP_ADMIN_PASSWORD }]]);
  for (const role of ["DISPATCH", "PILOT", "DEPARTMENT"]) accounts.set(role, privateAccounts.accounts[role]);
  for (const [role, account] of accounts) assert(account?.username && account.password, `Private ${role} credentials are unavailable.`);
  return accounts;
}
async function login(account) {
  const csrfResponse = await fetch(`${baseUrl}/api/v1/auth/csrf`, { signal: AbortSignal.timeout(30_000) });
  assert(csrfResponse.ok, "CSRF endpoint is unavailable.");
  const csrf = (await csrfResponse.json()).data;
  const cookies = csrfResponse.headers.getSetCookie().map((value) => value.split(";")[0]).join("; ");
  const response = await fetch(`${baseUrl}/api/v1/auth/login`, {
    method: "POST", headers: { "Content-Type": "application/json", Cookie: cookies, [csrf.headerName]: csrf.token },
    body: JSON.stringify({ username: account.username, password: account.password }), signal: AbortSignal.timeout(30_000),
  });
  assert(response.ok, "A local role login failed.");
  report.loginRequests++;
  const session = [...response.headers.getSetCookie(), ...csrfResponse.headers.getSetCookie()].find((value) => value.startsWith("JSESSIONID="));
  assert(session, "Local login did not return a session.");
  return session.split(";")[0];
}
async function get(endpoint, cookie = adminCookie) {
  const response = await fetch(`${baseUrl}/api/v1${endpoint}`, { headers: { Cookie: cookie }, signal: AbortSignal.timeout(90_000) });
  assert(response.ok, `GET ${endpoint.split("?")[0]} returned HTTP ${response.status}.`);
  const body = await response.json();
  assert.equal(body.code, "OK", `GET ${endpoint.split("?")[0]} did not succeed.`);
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
  assert(items.length >= total, "A local catalog was not completely read.");
  return items;
}
async function check(name, action) {
  const started = Date.now();
  try {
    const detail = await action();
    report.checks.push({ name, pass: true, milliseconds: Date.now() - started, ...(detail || {}) });
    console.log(`PASS ${name}`);
  } catch (error) {
    report.checks.push({ name, pass: false, milliseconds: Date.now() - started, error: error.message });
    await page?.screenshot({ path: path.join(evidence, `failure-${report.checks.length}.png`), fullPage: true }).catch(() => {});
    console.error(`FAIL ${name}: ${error.message}`);
  }
  await fs.writeFile(path.join(evidence, "results.json"), JSON.stringify(report, null, 2), { mode: 0o600 });
}
async function visible(locator) { await locator.first().waitFor({ state: "visible", timeout: 30_000 }); }
const modal = () => page.getByRole("dialog", { name: "安排执行任务", exact: true });
const form = () => page.getByTestId("plan-task-form");
const submit = () => modal().getByRole("button", { name: "创建并进入任务调度", exact: true });
const localInput = (instant) => new Date(Date.parse(instant) + 8 * 3600_000).toISOString().slice(0, 16);
async function gotoServices(plan) {
  await page.goto(`${baseUrl}/?${new URLSearchParams({ view: "services", planId: plan.id })}`, { waitUntil: "domcontentloaded" });
  await visible(page.getByRole("heading", { name: "飞行服务", exact: true }));
  await visible(page.getByRole("heading", { name: plan.title, exact: true }));
}
async function openForm(plan) {
  await gotoServices(plan);
  await page.getByRole("button", { name: "安排执行任务", exact: true }).click();
  await visible(form());
}
async function fillForm(plan, title) {
  await form().getByLabel("任务名称", { exact: false }).fill(title);
  await chooseSelect(form().getByLabel("应用场景", { exact: false }), "森林防火");
  await form().getByLabel("作业要求", { exact: false }).fill("核对计划范围内巡查点位，完成现场检查并提交成果。");
  await chooseSelect(form().getByLabel("紧急程度", { exact: false }), "NORMAL");
  await form().getByLabel("作业开始时间", { exact: false }).fill(localInput(plan.startAt));
  const end = new Date(Math.min(Date.parse(plan.startAt) + 3600_000, Date.parse(plan.endAt))).toISOString();
  await form().getByLabel("作业结束时间", { exact: false }).fill(localInput(end));
}
async function screenshot(name) {
  await page.screenshot({ path: path.join(evidence, `${name}.png`), fullPage: true });
}
const emptyPage = (url, items = []) => ({ items, total: items.length, page: Number(url.searchParams.get("page") || 1), pageSize: Number(url.searchParams.get("pageSize") || 100) });
const ok = (data) => ({ code: "OK", message: "成功", data });

try {
  for (const [role, account] of await credentials()) sessions.set(role, await login(account));
  adminCookie = sessions.get("ADMIN");
  const [plans, tasks, resources] = await Promise.all([catalog("/plans"), catalog("/tasks"), catalog("/resources?kind=DEVICE")]);
  const plan = plans.find((item) => item.kind === "LONG_TERM" && item.status === "APPROVED" && item.title === "重点巡查区域周期飞行计划")
    || plans.find((item) => item.kind === "LONG_TERM" && item.status === "APPROVED");
  assert(plan, "The existing approved long-term plan is unavailable.");
  const baselinePlan = await get(`/plans/${plan.id}`);
  const linked = await catalog(`/plans/${plan.id}/tasks`);
  const baselineTasks = await catalog("/tasks");
  const approvedTask = tasks.find((task) => task.status === "PENDING_EXECUTION" && task.planId && task.pilotId
    && plans.some((candidate) => candidate.id === task.planId && candidate.status === "APPROVED"
      && ["DAILY", "LONG_TERM"].includes(candidate.kind) && candidate.organizationId === task.organizationId && candidate.region === task.region
      && Date.parse(task.startAt) >= Date.parse(candidate.startAt) && Date.parse(task.endAt) <= Date.parse(candidate.endAt))
    && resources.some((resource) => resource.id === task.deviceId && resource.status === "ACTIVE" && resource.sourceDeviceId));
  assert(approvedTask, "An existing approved assigned task is unavailable for local control regression.");
  const approvedResource = resources.find((item) => item.id === approvedTask.deviceId);

  await check("API plan-to-task and task planId filtering agree without creating a task", async () => {
    const filtered = await catalog(`/tasks?planId=${encodeURIComponent(plan.id)}`);
    assert.deepEqual(filtered.map((task) => task.id).sort(), linked.map((task) => task.id).sort());
    assert(filtered.every((task) => task.planId === plan.id));
    return { linkedTaskCount: linked.length, automaticTaskCreation: false };
  });
  await check("API task keyword search includes the associated plan title", async () => {
    const candidate = tasks.find((item) => item.planId === plan.id)
      || tasks.find((item) => item.planId && plans.some((p) => p.id === item.planId));
    assert(candidate, "No existing linked task can exercise plan-name search.");
    const parent = plans.find((p) => p.id === candidate.planId);
    const keywords = [parent.title, ...(parent.title.includes("周期") ? ["周期"] : [])];
    for (const keyword of keywords) {
      const result = await catalog(`/tasks?keyword=${encodeURIComponent(keyword)}`);
      assert(result.some((item) => item.id === candidate.id), "Searching the plan title did not find its task.");
      assert(result.every((item) => plans.find((p) => p.id === item.planId)?.title.includes(keyword)
        || `${item.title || ""} ${item.description || ""} ${item.number || ""}`.includes(keyword)));
      if (parent.id === plan.id) assert(linked.every((task) => result.some((item) => item.id === task.id)),
        "Searching the long-term plan omitted a linked real task.");
    }
    return { keywords, linkedTasksFound: linked.length };
  });

  browser = await chromium.launch({ executablePath: process.env.QA_CHROME_PATH || "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    headless: true, args: ["--disable-dev-shm-usage"] });
  for (const viewport of [{ width: 1920, height: 1080 }, { width: 1280, height: 720 }]) {
    const size = `${viewport.width}x${viewport.height}`;
    const context = await browser.newContext({ locale: "zh-CN", timezoneId: "Asia/Shanghai", colorScheme: "dark", viewport });
    await context.addCookies([{ name: "JSESSIONID", value: adminCookie.slice("JSESSIONID=".length), domain: origin.hostname,
      path: "/", httpOnly: true, secure: origin.protocol === "https:", sameSite: "Lax" }]);
    const fixtureId = `b159e97c-7188-4ce3-9e95-${viewport.width === 1920 ? "000000001920" : "000000001280"}`;
    let scenario = { planPatch: {}, role: "ADMIN", failNext: false, created: null, delayCreate: false };
    let createAttempts = [];
    const expectedFailures = [];
    await context.route("**/api/v1/**", async (route) => {
      const request = route.request();
      const url = new URL(request.url());
      const endpoint = url.pathname.slice("/api/v1".length);
      if (/\/commands(?:\/|$)/.test(endpoint)) {
        report.commandRequests.push({ method: request.method(), path: endpoint });
        await route.abort("blockedbyclient"); return;
      }
      if (!['GET', 'HEAD', 'OPTIONS'].includes(request.method())) {
        if (request.method() === "POST" && endpoint === `/plans/${plan.id}/tasks`) {
          const body = request.postDataJSON();
          createAttempts.push(body);
          report.interceptedCreates.push({ viewport: size, requestId: body.requestId, status: scenario.failNext ? 503 : 200 });
          if (scenario.failNext) {
            scenario.failNext = false;
            expectedFailures.push({ path: url.pathname, status: 503 });
            await route.fulfill({ status: 503, json: { code: "PROVIDER_UNAVAILABLE", message: "请求未完成，请重试" } }); return;
          }
          if (scenario.delayCreate) await new Promise((resolve) => setTimeout(resolve, 800));
          scenario.created = { ...tasks[0], id: fixtureId, title: body.title, scene: body.scene, description: body.description,
            priority: body.priority, startAt: body.startAt, endAt: body.endAt, status: "PENDING_ASSIGNMENT",
            planId: plan.id, organizationId: plan.organizationId, region: plan.region, deviceId: null, pilotId: null,
            resultSummary: null, provenance: null,
            createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() };
          await route.fulfill({ status: 200, json: ok(scenario.created) }); return;
        }
        report.blockedWrites.push({ method: request.method(), path: endpoint });
        await route.abort("blockedbyclient"); return;
      }
      if (endpoint === "/auth/me" && scenario.role !== "ADMIN") {
        const response = await route.fetch();
        const body = await response.json();
        Object.assign(body.data, { role: scenario.role });
        await route.fulfill({ response, json: body }); return;
      }
      if (endpoint === `/plans/${plan.id}`) {
        await route.fulfill({ json: ok({ ...baselinePlan, ...scenario.planPatch }) }); return;
      }
      if (endpoint === `/plans/${plan.id}/tasks`) {
        await route.fulfill({ json: ok(emptyPage(url, [...linked, ...(scenario.created ? [scenario.created] : [])])) }); return;
      }
      if (endpoint === `/tasks/${fixtureId}` && scenario.created) {
        await route.fulfill({ json: ok(scenario.created) }); return;
      }
      if (endpoint === `/tasks/${fixtureId}/history` || (endpoint === "/attachments" && url.searchParams.get("taskId") === fixtureId)) {
        await route.fulfill({ json: ok(emptyPage(url)) }); return;
      }
      if (endpoint === "/tasks" && scenario.created) {
        const response = await route.fetch();
        const body = await response.json();
        let items = [...body.data.items.filter((item) => item.id !== fixtureId), scenario.created];
        const planFilter = url.searchParams.get("planId");
        const keyword = url.searchParams.get("keyword");
        if (planFilter) items = items.filter((item) => item.planId === planFilter);
        if (keyword) items = items.filter((item) => `${item.title || ""} ${item.description || ""} ${plans.find((p) => p.id === item.planId)?.title || ""}`.includes(keyword));
        body.data = emptyPage(url, items);
        await route.fulfill({ response, json: body }); return;
      }
      await route.continue();
    });
    page = await context.newPage();
    page.setDefaultTimeout(30_000);
    page.on("pageerror", (error) => report.pageErrors.push(error.message));
    page.on("console", (message) => {
      if (message.type() === "error" && !message.text().includes("503")) report.consoleErrors.push(message.text().slice(0, 500));
    });
    page.on("response", (response) => {
      const url = new URL(response.url());
      if (url.origin === origin.origin && url.pathname.startsWith("/api/v1/") && response.status() >= 400
        && !expectedFailures.some((item) => item.path === url.pathname && item.status === response.status()))
        report.failedApiRequests.push({ path: url.pathname, status: response.status(), viewport: size });
    });

    await check(`${size} approved long-term plan exposes task arrangement and related tasks`, async () => {
      await gotoServices(plan);
      const arrange = page.getByRole("button", { name: "安排执行任务", exact: true });
      await visible(arrange);
      assert.equal(await arrange.isDisabled(), false);
      await visible(page.getByRole("heading", { name: /关联.*任务|执行任务/ }));
      for (const task of linked.filter((item) => item.deviceId)) {
        const device = resources.find((item) => item.id === task.deviceId);
        assert(device, "A linked task's local device archive is unavailable to the administrator.");
        await visible(page.getByTestId("plan-execution-tasks").getByText(String(device.title || device.name), { exact: true }));
      }
      await screenshot(`${size}-approved-long-term`);
    });
    await check(`${size} arrangement inherits plan scope and validates out-of-range times locally`, async () => {
      await openForm(plan);
      await fillForm(plan, "重点巡查区域第1次执行任务");
      assert((await form().innerText()).includes(plan.region), "Inherited region is not visible in the form.");
      await form().getByLabel("作业结束时间", { exact: false }).fill(localInput(new Date(Date.parse(plan.endAt) + 3600_000).toISOString()));
      if (!await submit().isDisabled()) await submit().click();
      assert.equal(createAttempts.length, 0, "An out-of-plan occurrence reached task creation.");
      assert(await form().isVisible());
      const dims = await modal().evaluate((el) => ({ client: el.clientWidth, scroll: el.scrollWidth }));
      assert(dims.scroll <= dims.client + 2, "The arrangement form has horizontal overflow.");
      await screenshot(`${size}-out-of-range`);
    });
    await check(`${size} failed arrangement retries with the same idempotency key`, async () => {
      await fillForm(plan, "重点巡查区域第1次执行任务");
      scenario.failNext = true;
      await submit().click();
      await visible(form().getByText("请求未完成，请重试", { exact: false }));
      assert.equal(createAttempts.length, 1);
      assert.match(createAttempts[0].requestId, /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i);
      for (const key of ["status", "organizationId", "region", "deviceId", "pilotId"])
        assert.equal(Object.hasOwn(createAttempts[0], key), false, `The client supplied inherited or assignment field ${key}.`);
      assert.equal(createAttempts[0].title, "重点巡查区域第1次执行任务");
      scenario.delayCreate = true;
      await submit().click();
      assert(await submit().isDisabled(), "A pending arrangement allows duplicate submission.");
      await page.waitForURL((url) => url.searchParams.get("view") === "dispatch" && url.searchParams.get("taskId") === fixtureId
        && url.searchParams.get("planId") === plan.id);
      assert.equal(createAttempts.length, 2);
      assert.deepEqual(createAttempts[1], createAttempts[0], "Retry changed the idempotency key or unchanged task fields.");
    });
    await check(`${size} created occurrence opens its precise task with shared approval and plan traceability`, async () => {
      const dialog = page.getByRole("dialog").last();
      await visible(dialog.getByRole("heading", { name: "重点巡查区域第1次执行任务", exact: true }));
      assert((await dialog.innerText()).includes(plan.title), "The task omits its parent plan title.");
      assert((await dialog.innerText()).includes("已通过"), "The task omits its parent's approval result.");
      assert.equal(await dialog.getByRole("button", { name: "核验通过", exact: true }).count(), 0, "The task repeats plan approval.");
      await screenshot(`${size}-created-task-with-plan`);
      const back = dialog.getByRole("button", { name: /查看.*计划|查看.*审批|返回.*计划/ }).first();
      await back.click();
      await page.waitForURL((url) => url.searchParams.get("view") === "services" && url.searchParams.get("planId") === plan.id);
      await visible(page.getByRole("heading", { name: plan.title, exact: true }));
      await visible(page.getByText("重点巡查区域第1次执行任务", { exact: true }));
      assert.equal(await page.getByRole("button", { name: "安排执行任务", exact: true }).isDisabled(), false,
        "A long-term plan cannot arrange another occurrence after its first task.");
      assert((await page.getByTestId("plan-execution-tasks").innerText()).includes("沿用审批结果"),
        "The linked task section does not explain shared approval.");
      await page.getByTestId("plan-execution-tasks").scrollIntoViewIfNeeded();
      await screenshot(`${size}-plan-related-task`);
    });
    await check(`${size} planId filter and plan-title search retain the occurrence`, async () => {
      await page.goto(`${baseUrl}/?${new URLSearchParams({ view: "dispatch", planId: plan.id })}`, { waitUntil: "domcontentloaded" });
      const filter = page.getByLabel("所属飞行计划", { exact: false });
      await visible(filter);
      await page.waitForFunction((id) => [...document.querySelectorAll('[role="combobox"]')].some((select) => select.getAttribute("data-value") === id), plan.id);
      assert.equal(await selectValue(filter), plan.id);
      await visible(page.getByText("重点巡查区域第1次执行任务", { exact: true }));
      assert.equal(await page.getByRole("button", { name: "提报需求", exact: true }).count(), 0,
        "The plan-filtered task list can create an unlinked demand.");
      const arrangeFromPlan = page.getByRole("button", { name: "从原计划安排任务", exact: true });
      await visible(arrangeFromPlan);
      const search = page.getByPlaceholder(/搜索.*计划/).first();
      await search.fill(plan.title.includes("周期") ? "周期" : plan.title);
      await visible(page.getByText("重点巡查区域第1次执行任务", { exact: true }));
      await page.waitForFunction(() => !document.querySelector("table")?.innerText.includes("设备资料加载中"));
      await screenshot(`${size}-plan-filter-search`);
      await page.getByRole("button", { name: "清除计划筛选", exact: true }).click();
      await page.waitForURL((url) => url.searchParams.get("view") === "dispatch" && !url.searchParams.has("planId"));
      await page.waitForFunction(() => document.querySelector('[role="combobox"][aria-label="所属飞行计划"]')?.getAttribute("data-value") === "");
      assert.equal(await selectValue(filter), "");
      await page.goto(`${baseUrl}/?${new URLSearchParams({ view: "dispatch", planId: plan.id })}`, { waitUntil: "domcontentloaded" });
      await page.getByRole("button", { name: "从原计划安排任务", exact: true }).click();
      await page.waitForURL((url) => url.searchParams.get("view") === "services" && url.searchParams.get("planId") === plan.id);
      await visible(page.getByRole("heading", { name: plan.title, exact: true }));
    });
    await check(`${size} unapproved or admission plans cannot arrange flight tasks`, async () => {
      for (const patch of [{ status: "PENDING_REVIEW" }, { status: "RETURNED" }, { kind: "DEVICE_ADMISSION" }, { kind: "PILOT_ADMISSION" }]) {
        scenario.planPatch = patch;
        await gotoServices(plan);
        const arrange = page.getByRole("button", { name: "安排执行任务", exact: true });
        assert.equal(await arrange.count() ? await arrange.isDisabled() : true, true,
          "An unapproved or admission plan allows occurrence arrangement.");
      }
      scenario.planPatch = {};
    });
    await check(`${size} dispatch and department may arrange while pilots remain read-only`, async () => {
      for (const role of ["DISPATCH", "DEPARTMENT", "PILOT"]) {
        scenario.role = role;
        await gotoServices(plan);
        const arrange = page.getByRole("button", { name: "安排执行任务", exact: true });
        if (role === "PILOT") assert.equal(await arrange.count() ? await arrange.isDisabled() : true, true);
        else { await visible(arrange); assert.equal(await arrange.isDisabled(), false); }
      }
      scenario.role = "ADMIN";
    });
    await check(`${size} approved device interactions remain local and do not send commands`, async () => {
      await page.goto(`${baseUrl}/?${new URLSearchParams({ view: "flight", taskId: approvedTask.id, deviceId: approvedResource.sourceDeviceId })}`,
        { waitUntil: "domcontentloaded" });
      const controls = page.getByTestId("flight-operation-controls");
      await visible(controls);
      await page.waitForFunction(() => document.querySelector('[data-testid="flight-operation-controls"]')?.getAttribute("data-control-enabled") === "true");
      const count = report.interceptedCreates.length;
      await controls.getByRole("button", { name: "立即起飞", exact: true }).click();
      await visible(page.getByText(/未发送设备指令/).first());
      assert.equal(report.interceptedCreates.length, count);
      assert.equal(report.commandRequests.length, 0);
      assert.equal(report.blockedWrites.length, 0);
    });
    await context.close();
  }
  await check("Acceptance leaves source/business state unchanged and contains no runtime error", async () => {
    assert.deepEqual(await get(`/plans/${plan.id}`), baselinePlan, "Read-only acceptance changed a real plan.");
    assert.deepEqual(await catalog("/tasks"), baselineTasks, "Read-only acceptance created or changed a real task.");
    assert.deepEqual(await catalog(`/plans/${plan.id}/tasks`), linked, "Fixture creation reached the real plan task list.");
    assert.equal(report.blockedWrites.length, 0, "An unexpected business write was attempted.");
    assert.equal(report.commandRequests.length, 0, "A device command was attempted.");
    assert.equal(report.pageErrors.length, 0, "Browser JavaScript errors occurred.");
    assert.equal(report.failedApiRequests.length, 0, "An unexpected API error occurred.");
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
  console.log(`Plan/task acceptance: ${report.passed} passed, ${report.failed} failed; evidence ${evidence}`);
  process.exitCode = report.failed ? 1 : 0;
}
