#!/usr/bin/env node
/** Read-only workflow acceptance. Login is the only permitted POST. */
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
assert(["localhost", "127.0.0.1"].includes(origin.hostname), "Workflow acceptance is limited to the local application.");
const runId = new Date().toISOString().replace(/[:.]/g, "-");
const evidence = path.join(root, ".local", "qa-workflow", runId);
await fs.mkdir(evidence, { recursive: true, mode: 0o700 });
const report = {
  runId, baseUrl, readOnly: true, businessWrites: 0,
  api: {}, checks: [], pageErrors: [], consoleErrors: [], failedApiRequests: [], blockedWrites: [],
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
  const credentials = {};
  for (const line of (await fs.readFile(path.join(root, ".env"), "utf8")).split(/\r?\n/)) {
    const match = line.match(/^(BOOTSTRAP_ADMIN_USERNAME|BOOTSTRAP_ADMIN_PASSWORD)=(.*)$/);
    if (match) credentials[match[1]] = decode(match[2]);
  }
  assert(credentials.BOOTSTRAP_ADMIN_USERNAME && credentials.BOOTSTRAP_ADMIN_PASSWORD, "Local admin configuration is missing.");
  const csrfResponse = await fetch(`${baseUrl}/api/v1/auth/csrf`, { signal: AbortSignal.timeout(30_000) });
  assert(csrfResponse.ok, "CSRF endpoint is unavailable.");
  const csrf = (await csrfResponse.json()).data;
  const cookies = csrfResponse.headers.getSetCookie().map((value) => value.split(";")[0]).join("; ");
  const response = await fetch(`${baseUrl}/api/v1/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Cookie: cookies, [csrf.headerName]: csrf.token },
    body: JSON.stringify({ username: credentials.BOOTSTRAP_ADMIN_USERNAME, password: credentials.BOOTSTRAP_ADMIN_PASSWORD }),
    signal: AbortSignal.timeout(30_000),
  });
  assert(response.ok, "Local admin login failed.");
  const session = [...response.headers.getSetCookie(), ...csrfResponse.headers.getSetCookie()]
    .find((value) => value.startsWith("JSESSIONID="));
  assert(session, "Local login did not return a session.");
  sessionCookie = session.split(";")[0];
}
async function get(endpoint) {
  const response = await fetch(`${baseUrl}/api/v1${endpoint}`, {
    headers: { Cookie: sessionCookie }, signal: AbortSignal.timeout(90_000),
  });
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
  assert(items.length >= total, `GET ${endpoint.split("?")[0]} did not return the complete catalog.`);
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
    if (page && !page.isClosed())
      await page.screenshot({ path: path.join(evidence, `failure-${report.checks.length}.png`), fullPage: true }).catch(() => {});
    console.error(`FAIL ${name}: ${error.message}`);
  }
  await fs.writeFile(path.join(evidence, "results.json"), JSON.stringify(report, null, 2), { mode: 0o600 });
}
async function visible(locator) {
  await locator.first().waitFor({ state: "visible", timeout: 45_000 });
  assert(await locator.first().isVisible(), "An expected interface element is not visible.");
}
async function go(view, title, context = {}) {
  await page.goto(`${baseUrl}/?${new URLSearchParams({ view, ...context })}`, { waitUntil: "domcontentloaded" });
  await visible(page.getByRole("heading", { name: title, exact: true }));
}
async function screenshot(name) {
  await page.screenshot({ path: path.join(evidence, `${name}.png`), fullPage: true });
}
async function closeModal() {
  const dialog = page.getByRole("dialog").last();
  const element = await dialog.elementHandle();
  await dialog.getByRole("button", { name: "关闭", exact: true }).click();
  await element.waitForElementState("hidden");
}
async function assertNoHorizontalOverflow(scope) {
  const dimensions = await scope.evaluate((element) => ({ width: element.clientWidth, content: element.scrollWidth }));
  assert(dimensions.content <= dimensions.width + 2, "The workflow content overflows horizontally.");
}

const taskStates = {
  DRAFT: { next: "提交需求", action: "提交需求" },
  RETURNED: { next: "修改并重新提交", action: "重新提交" },
  PENDING_ASSIGNMENT: { next: "分配设备和飞手", action: "分配资源", tab: "待分配" },
  PENDING_EXECUTION: { next: "登记开始执行", action: "登记开始执行", tab: "待执行" },
  EXECUTING: { next: "上传成果并提交", action: "提交成果", tab: "执行中" },
  PENDING_ACCEPTANCE: { next: "核对成果并验收", action: "验收通过", tab: "待验收" },
  COMPLETED: { next: "查看成果", tab: "已完成" },
  CANCELLED: { next: "查看取消说明" },
};
const stages = ["待分配", "待执行", "执行中", "待验收", "已完成"];

try {
  await login();
  const tasks = await catalog("/tasks");
  const resources = await catalog("/resources?kind=DEVICE");
  const plans = await catalog("/plans");
  const byPlan = new Map(plans.map((plan) => [plan.id, plan]));
  const byResource = new Map(resources.map((resource) => [resource.id, resource]));
  const byStatus = new Map(Object.keys(taskStates).map((status) => [status, tasks.find((task) => task.status === status)]));
  const assignedTask = tasks.find((task) => byResource.get(task.deviceId)?.sourceDeviceId);
  assert(assignedTask, "No existing task is assigned to a connected device.");
  const archive = byResource.get(assignedTask.deviceId);
  const sourceDevice = await get(`/devices/${encodeURIComponent(archive.sourceDeviceId)}`);
  await check("API existing workflow states and one archive per source device", async () => {
    for (const [status, config] of Object.entries(taskStates))
      if (config.tab) assert(byStatus.get(status), `No existing task covers ${status}.`);
    assert.equal(resources.filter((resource) => resource.sourceDeviceId === archive.sourceDeviceId).length, 1,
      "The selected source device already has duplicate scheduling archives.");
    report.api = {
      taskCount: tasks.length, schedulingArchiveCount: resources.length,
      coveredStates: [...byStatus].filter(([, task]) => !!task).map(([status]) => status),
      selectedArchiveIsUnique: true,
    };
  });

  browser = await chromium.launch({
    executablePath: process.env.QA_CHROME_PATH || "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    headless: true, args: ["--disable-dev-shm-usage"],
  });
  const context = await browser.newContext({ locale: "zh-CN", timezoneId: "Asia/Shanghai", colorScheme: "dark" });
  await context.addCookies([{ name: "JSESSIONID", value: sessionCookie.slice("JSESSIONID=".length), domain: origin.hostname,
    path: "/", httpOnly: true, secure: origin.protocol === "https:", sameSite: "Lax" }]);
  await context.route("**/api/v1/**", async (route) => {
    const request = route.request();
    if (!["GET", "HEAD", "OPTIONS"].includes(request.method())) {
      report.blockedWrites.push({ method: request.method(), path: new URL(request.url()).pathname });
      await route.abort("blockedbyclient");
    } else await route.continue();
  });
  page = await context.newPage();
  page.setDefaultTimeout(30_000);
  page.on("pageerror", (error) => report.pageErrors.push(error.message));
  page.on("console", (message) => {
    if (message.type() === "error") report.consoleErrors.push(message.text().slice(0, 500));
  });
  page.on("response", (response) => {
    const url = new URL(response.url());
    if (response.status() >= 400 && url.origin === origin.origin && url.pathname.startsWith("/api/v1/"))
      report.failedApiRequests.push({ path: url.pathname, status: response.status() });
  });

  for (const viewport of [{ width: 1920, height: 1080 }, { width: 1280, height: 720 }]) {
    const size = `${viewport.width}x${viewport.height}`;
    await page.setViewportSize(viewport);
    await check(`${size} one visible task flow and actual state tabs`, async () => {
      await go("dispatch", "任务调度");
      const guide = page.getByLabel("任务办理流程", { exact: true });
      await visible(guide);
      assert.equal(await guide.locator("ol > li").count(), 5, "The main task flow does not have five steps.");
      for (const stage of stages) {
        const tab = page.getByRole("tab", { name: new RegExp(`^${stage}`) });
        await visible(tab);
        await tab.click();
        const status = Object.entries(taskStates).find(([, config]) => config.tab === stage)?.[0];
        const task = byStatus.get(status);
        await visible(page.locator("tbody tr").filter({ hasText: task.title }));
        assert.equal(await page.getByLabel("任务阶段", { exact: true }).inputValue(), status);
      }
      await page.getByRole("tab", { name: /^全部任务/ }).click();
      await visible(page.locator("tbody tr"));
      const assignedRow = page.locator("tbody tr").filter({ hasText: assignedTask.id });
      await visible(assignedRow.locator("td").filter({ hasText: archive.title }));
      await assertNoHorizontalOverflow(guide);
      await screenshot(`${size}-task-flow`);
    });

    for (const [status, task] of byStatus) {
      if (!task) continue;
      await check(`${size} task ${status} explains the next action`, async () => {
        await go("dispatch", "任务调度", { taskId: task.id });
        const dialog = page.getByRole("dialog").last();
        const expected = { ...taskStates[status] };
        if (status === "PENDING_EXECUTION" && task.scene !== "资料核对") {
          const relatedPlan = byPlan.get(task.planId);
          expected.next = !task.planId ? "关联飞行计划" : relatedPlan?.status === "APPROVED" ? "进入飞行管控" : "办理计划审批";
          expected.action = !task.planId ? "关联飞行计划" : relatedPlan?.status === "APPROVED" ? "查看设备运行" : "查看 / 办理审批";
        }
        await visible(dialog.locator(".task-next-step strong").filter({ hasText: expected.next }));
        assert.equal((await dialog.locator(".task-next-step strong").textContent()).trim(), expected.next);
        assert((await dialog.locator(".task-next-step p").textContent()).trim().length > 10,
          "The task next step lacks an explanation.");
        if (byResource.has(task.deviceId))
          await visible(dialog.locator(".details dd").getByText(byResource.get(task.deviceId).title, { exact: true }));
        if (expected.action) await visible(dialog.getByRole("button", { name: expected.action, exact: true }));
        if (status === "PENDING_EXECUTION" && expected.action === "登记开始执行") {
          await dialog.getByRole("button", { name: expected.action, exact: true }).click();
          const actionDialog = page.getByRole("dialog").last();
          await visible(actionDialog.getByText("登记本次作业已开始；不会向设备发送起飞指令。", { exact: true }));
          await closeModal();
        }
        if (status === "PENDING_ASSIGNMENT") {
          await dialog.getByRole("button", { name: expected.action, exact: true }).click();
          const actionDialog = page.getByRole("dialog").last();
          await visible(actionDialog.getByLabel("关联飞行计划", { exact: false }));
          await closeModal();
        }
        if (status === "PENDING_EXECUTION" || status === "PENDING_ACCEPTANCE")
          await screenshot(`${size}-task-${status.toLowerCase()}`);
        await closeModal();
      });
    }

    await check(`${size} task opens its assigned device and retains task context`, async () => {
      await go("dispatch", "任务调度", { taskId: assignedTask.id });
      const dialog = page.getByRole("dialog").last();
      const openDevice = dialog.getByRole("button", { name: "查看设备运行", exact: true });
      await visible(openDevice);
      await openDevice.waitFor({ state: "visible" });
      await page.waitForFunction(() => {
        const button = [...document.querySelectorAll('[role="dialog"] button')]
          .find((element) => element.textContent?.trim() === "查看设备运行");
        return button && !button.disabled;
      });
      await openDevice.click();
      await visible(page.getByRole("heading", { name: "飞行管控", exact: true }));
      await visible(page.locator(".queue-card.selected"));
      const url = new URL(page.url());
      assert.equal(url.searchParams.get("deviceId"), String(archive.sourceDeviceId), "Flight opened a different source device.");
      assert.equal(url.searchParams.get("taskId"), assignedTask.id, "Flight lost the originating task.");
      const card = page.locator(".queue-card.selected");
      const expectedName = String(sourceDevice.title || sourceDevice.name || sourceDevice.id);
      assert((await card.textContent()).includes(expectedName), "A different device is selected in the flight queue.");
      await visible(page.locator(".flight-control").getByRole("heading", { name: expectedName, exact: true }));
      const plan = byPlan.get(assignedTask.planId);
      const approvedForLocalInteraction = ["PENDING_EXECUTION", "EXECUTING"].includes(assignedTask.status)
        && plan?.status === "APPROVED" && ["DAILY", "LONG_TERM"].includes(plan.kind)
        && plan.id === assignedTask.planId && (!plan.taskId || plan.taskId === assignedTask.id)
        && archive.kind === "DEVICE" && archive.status === "ACTIVE"
        && String(archive.sourceDeviceId) === sourceDevice.id;
      await page.waitForFunction((enabled) => {
        const labels = ["下发任务", "立即起飞", "暂停作业", "立即返航", "确认落地并结束"];
        const buttons = [...document.querySelectorAll(".flight-control button")]
          .filter((button) => labels.includes(button.textContent.trim()));
        return buttons.length === 5 && buttons.every((button) => button.disabled === !enabled);
      }, approvedForLocalInteraction);
      for (const label of ["下发任务", "立即起飞", "暂停作业", "立即返航", "确认落地并结束"])
        assert.equal(await page.getByRole("button", { name: label, exact: true }).isDisabled(), !approvedForLocalInteraction,
          `Local control ${label} does not match task approval eligibility.`);
      for (const label of ["发送云台指令", "发送喊话"])
        assert.equal(await page.getByRole("button", { name: label, exact: true }).isDisabled(), !approvedForLocalInteraction,
          `Local payload control ${label} does not match task approval eligibility.`);
      await screenshot(`${size}-assigned-device`);
      const back = page.getByRole("button", { name: /返回.*任务/ }).first();
      await back.click();
      await visible(page.getByRole("heading", { name: "任务调度", exact: true }));
      assert.equal(new URL(page.url()).searchParams.get("taskId"), assignedTask.id, "Returning from device view lost the task context.");
      await visible(page.getByRole("dialog").last().locator(".task-next-step"));
      await closeModal();
    });

    await check(`${size} connected device edits the existing scheduling archive`, async () => {
      await go("resources", "资源管理");
      await visible(page.getByLabel("设备接入与调度说明", { exact: true }));
      await page.getByPlaceholder("搜索资源名称、编号或型号").fill(String(sourceDevice.sn || sourceDevice.name || sourceDevice.title));
      const row = page.locator(".resource-main tbody tr").filter({
        has: page.locator(".name-cell small").getByText(String(archive.sourceDeviceId), { exact: true }),
      });
      await visible(row);
      await row.click();
      const dialog = page.getByRole("dialog").last();
      await visible(dialog.getByRole("heading", { name: "调度资料", exact: true }));
      const edit = dialog.getByRole("button", { name: "完善调度资料", exact: true });
      await visible(edit);
      assert.equal(await dialog.getByRole("button", { name: "登记调度资料", exact: true }).count(), 0,
        "An already registered device is offered a duplicate registration.");
      await page.waitForFunction(() => {
        const button = [...document.querySelectorAll('[role="dialog"] button')]
          .find((element) => element.textContent?.trim() === "完善调度资料");
        return button && !button.disabled;
      });
      await edit.click();
      const form = page.getByRole("dialog", { name: /^完善(?:设备)?调度资料$/ });
      await visible(form);
      const recordMarker = form.locator("[data-resource-id]");
      assert.equal(await recordMarker.count(), 1, "The scheduling form does not expose its existing archive identity.");
      assert.equal(await recordMarker.getAttribute("data-resource-id"), archive.id, "The form did not reuse the existing archive ID.");
      assert.equal(await form.getByLabel("资源名称", { exact: false }).inputValue(), archive.title);
      assert.equal(await form.getByLabel("关联来源设备", { exact: false }).inputValue(), String(archive.sourceDeviceId));
      assert.equal(await form.getByLabel("所属组织", { exact: false }).inputValue(), archive.organizationId);
      assert.equal(await form.getByLabel("调度状态", { exact: false }).inputValue(), archive.status);
      await screenshot(`${size}-existing-dispatch-archive`);
      await form.getByRole("button", { name: "取消", exact: true }).click();
      await form.waitFor({ state: "hidden" });
      return { reusedExistingArchive: true, formSubmitted: false };
    });

    await check(`${size} unavailable device never falls back to an unrelated device`, async () => {
      const unavailableId = "qa-workflow-unavailable-device";
      await go("flight", "飞行管控", { deviceId: unavailableId });
      await visible(page.getByText("关联设备不存在或不在当前账号可见范围内，请返回任务核对设备分配。", { exact: true }));
      assert.equal(await page.locator(".queue-card.selected").count(), 0, "An unavailable device silently selected another device.");
      await visible(page.locator(".flight-control").getByRole("heading", { name: "选择设备", exact: true }));
      assert.equal(new URL(page.url()).searchParams.get("deviceId"), unavailableId);
      return { unrelatedDeviceSelected: false };
    });
  }

  await check("Read-only interactions and clean browser runtime", async () => {
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
  console.log(`Workflow acceptance: ${report.passed} passed, ${report.failed} failed; evidence ${evidence}`);
  process.exitCode = report.failed ? 1 : 0;
}
