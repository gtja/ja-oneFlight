#!/usr/bin/env node
/** Read-only browser acceptance for approval-gated, local-only flight interactions. */
import { promises as fs } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import assert from "node:assert/strict";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(path.join(root, "frontend", "package.json"));
const { chromium } = require("@playwright/test");
const ts = require("typescript");
const baseUrl = process.env.QA_LIVE_BASE_URL || "http://127.0.0.1:8088";
const origin = new URL(baseUrl);
assert(["localhost", "127.0.0.1"].includes(origin.hostname), "Approval acceptance is limited to the local application.");
const runId = new Date().toISOString().replace(/[:.]/g, "-");
const evidence = path.join(root, ".local", "qa-approval-controls", runId);
await fs.mkdir(evidence, { recursive: true, mode: 0o700 });
const operations = [
  ["下发任务", "DISPATCH"], ["立即起飞", "TAKEOFF"], ["暂停作业", "PAUSE"],
  ["立即返航", "RETURN"], ["确认落地并结束", "LAND"],
];
const angleNames = [/云台.*方位角/, /俯仰角/];
const report = {
  runId, baseUrl, readOnly: true, businessWrites: 0, loginRequests: 0,
  responseOverrides: "Only GET response fields are overridden; source and business databases are unchanged.",
  checks: [], blockedWrites: [], commandRequests: [], pageErrors: [], consoleErrors: [], failedApiRequests: [],
};
let browser;
let page;
let adminCookie;
const sessions = new Map();

function decode(value) {
  if (value.startsWith('"') && value.endsWith('"')) return JSON.parse(value);
  if (value.startsWith("'") && value.endsWith("'")) return value.slice(1, -1);
  return value;
}
async function credentials() {
  const env = {};
  for (const line of (await fs.readFile(path.join(root, ".env"), "utf8")).split(/\r?\n/)) {
    const match = line.match(/^(BOOTSTRAP_ADMIN_USERNAME|BOOTSTRAP_ADMIN_PASSWORD)=(.*)$/);
    if (match) env[match[1]] = decode(match[2]);
  }
  const privateAccounts = JSON.parse(await fs.readFile(path.join(root, ".local", "business-initialization", "accounts.json"), "utf8"));
  const result = new Map([["ADMIN", { username: env.BOOTSTRAP_ADMIN_USERNAME, password: env.BOOTSTRAP_ADMIN_PASSWORD }]]);
  for (const role of ["DISPATCH", "PILOT", "DEPARTMENT"]) result.set(role, privateAccounts.accounts[role]);
  for (const [role, account] of result)
    assert(account?.username && account.password, `Private credentials for ${role} are unavailable.`);
  return result;
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
  const session = [...response.headers.getSetCookie(), ...csrfResponse.headers.getSetCookie()]
    .find((value) => value.startsWith("JSESSIONID="));
  assert(session, "Local login did not return a session.");
  return session.split(";")[0];
}
async function get(endpoint, cookie = adminCookie) {
  const response = await fetch(`${baseUrl}/api/v1${endpoint}`, {
    headers: { Cookie: cookie }, signal: AbortSignal.timeout(90_000),
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
async function visible(locator) {
  await locator.first().waitFor({ state: "visible", timeout: 30_000 });
}
function controls() { return page.getByTestId("flight-operation-controls"); }
async function waitGate(enabled, expectedCode) {
  await visible(controls());
  await page.waitForFunction(({ expected, code }) => {
    const element = document.querySelector('[data-testid="flight-operation-controls"]');
    const actualCode = element?.getAttribute("data-gate-code");
    return element?.getAttribute("data-control-enabled") === String(expected)
      && actualCode && !["LOADING", "LOAD_ERROR"].includes(actualCode)
      && (!code || (Array.isArray(code) ? code.includes(actualCode) : actualCode === code));
  }, { expected: enabled, code: expectedCode || (enabled ? "APPROVED" : undefined) }, { timeout: 30_000 });
  for (const [label] of operations)
    assert.equal(await controls().getByRole("button", { name: label, exact: true }).isDisabled(), !enabled,
      `Local interaction ${label} does not match approval eligibility.`);
  for (const label of ["发送云台指令", "发送喊话"])
    assert.equal(await page.getByRole("button", { name: label, exact: true }).isDisabled(), !enabled,
      `Local payload interaction ${label} does not match approval eligibility.`);
  for (const name of angleNames)
    assert.equal(await page.getByRole("slider", { name }).isDisabled(), !enabled,
      "A local payload target angle does not match approval eligibility.");
}
async function screenshot(name) {
  await controls().scrollIntoViewIfNeeded();
  await page.screenshot({ path: path.join(evidence, `${name}.png`), fullPage: true });
  await controls().screenshot({ path: path.join(evidence, `${name}-controls.png`) });
}
function telemetryValues(data) {
  const value = data?.data || data?.telemetry || data || {};
  return [value.altitudeMeters ?? value.height ?? value.altitude,
    value.batteryPercent ?? value.battery ?? value.electricity, value.speed ?? value.horizontalSpeed];
}
async function assertTelemetryMatchesObservation(lastObserved) {
  assert(lastObserved, "The current device did not return a real telemetry response.");
  const values = telemetryValues(lastObserved);
  const displayed = await page.locator(".telemetry-strip strong").allTextContents();
  assert(displayed.length >= 3, "Telemetry fields are missing.");
  for (let index = 0; index < 3; index++)
    assert(displayed[index].trim().startsWith(values[index] == null ? "—" : String(values[index])),
      "A local interaction changed a telemetry field without a matching source observation.");
}

try {
  const accounts = await credentials();
  for (const [role, account] of accounts) sessions.set(role, await login(account));
  adminCookie = sessions.get("ADMIN");
  const me = new Map();
  for (const [role, cookie] of sessions) {
    const user = await get("/auth/me", cookie);
    assert.equal(user.role, role, "A local session has an unexpected role.");
    me.set(role, user);
  }
  const [tasks, plans, resources] = await Promise.all([catalog("/tasks"), catalog("/plans"), catalog("/resources?kind=DEVICE")]);
  const byPlan = new Map(plans.map((plan) => [plan.id, plan]));
  const byResource = new Map(resources.map((resource) => [resource.id, resource]));
  const eligible = tasks.filter((task) => task.status === "PENDING_EXECUTION" && task.pilotId === me.get("PILOT").id
    && byResource.get(task.deviceId)?.status === "ACTIVE" && byResource.get(task.deviceId)?.sourceDeviceId
    && byPlan.get(task.planId)?.status === "APPROVED" && ["DAILY", "LONG_TERM"].includes(byPlan.get(task.planId)?.kind)
    && task.region === byPlan.get(task.planId)?.region
    && task.organizationId === byPlan.get(task.planId)?.organizationId
    && Date.parse(task.startAt) >= Date.parse(byPlan.get(task.planId)?.startAt)
    && Date.parse(task.endAt) <= Date.parse(byPlan.get(task.planId)?.endAt));
  const task = eligible.find((candidate) => byPlan.get(candidate.planId).resourceId === candidate.deviceId) || eligible[0];
  assert(task, "No existing task satisfies the approved local interaction preconditions.");
  const plan = byPlan.get(task.planId);
  const resource = byResource.get(task.deviceId);
  const otherResource = resources.find((candidate) => candidate.id !== resource.id && candidate.status === "ACTIVE"
    && candidate.sourceDeviceId && me.get("PILOT").deviceIds.includes(candidate.id));
  assert(otherResource, "A second permitted device is unavailable for mismatch acceptance.");
  const endedTask = tasks.find((candidate) => ["COMPLETED", "CANCELLED"].includes(candidate.status)
    && byResource.get(candidate.deviceId)?.sourceDeviceId);
  assert(endedTask, "A completed task is unavailable for locked-state acceptance.");
  const baseline = {
    task: await get(`/tasks/${task.id}`), plan: await get(`/plans/${plan.id}`),
    endedTask: await get(`/tasks/${endedTask.id}`),
  };

  await check("Local interaction component has no command or network client", async () => {
    const source = await fs.readFile(path.join(root, "frontend", "src", "components", "FlightOperationControls.tsx"), "utf8");
    const parsed = ts.createSourceFile("FlightOperationControls.tsx", source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
    const violations = [];
    const inspect = (node) => {
      if (ts.isImportDeclaration(node) && !node.importClause?.isTypeOnly && /(?:^|\/)api(?:\.[a-z]+)?$/.test(node.moduleSpecifier.text))
        violations.push("runtime API import");
      if (ts.isCallExpression(node)) {
        const callee = node.expression;
        const name = ts.isIdentifier(callee) ? callee.text : ts.isPropertyAccessExpression(callee) ? callee.name.text : "";
        if (["fetch", "api", "write", "sendBeacon"].includes(name)) violations.push("network client call");
      }
      if (ts.isNewExpression(node) && ts.isIdentifier(node.expression)
        && ["XMLHttpRequest", "WebSocket", "EventSource"].includes(node.expression.text)) violations.push("network connection");
      ts.forEachChild(node, inspect);
    };
    inspect(parsed);
    assert.equal(violations.length, 0, "The local interaction component imports or calls a network/command client.");
    return { pureLocalInteraction: true };
  });
  browser = await chromium.launch({ executablePath: process.env.QA_CHROME_PATH
    || "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", headless: true, args: ["--disable-dev-shm-usage"] });

  for (const viewport of [{ width: 1920, height: 1080 }, { width: 1280, height: 720 }]) {
    const size = `${viewport.width}x${viewport.height}`;
    for (const role of ["ADMIN", "DISPATCH", "PILOT", "DEPARTMENT"]) {
      const context = await browser.newContext({ locale: "zh-CN", timezoneId: "Asia/Shanghai", colorScheme: "dark", viewport });
      const cookie = sessions.get(role);
      await context.addCookies([{ name: "JSESSIONID", value: cookie.slice("JSESSIONID=".length), domain: origin.hostname,
        path: "/", httpOnly: true, secure: origin.protocol === "https:", sameSite: "Lax" }]);
      let scenario = {};
      let telemetryCount = 0;
      let lastTelemetry;
      await context.route("**/api/v1/**", async (route) => {
        const request = route.request();
        const url = new URL(request.url());
        if (/\/commands(?:\/|$)/.test(url.pathname)) {
          report.commandRequests.push({ method: request.method(), path: url.pathname });
          await route.abort("blockedbyclient");
          return;
        }
        if (!["GET", "HEAD", "OPTIONS"].includes(request.method())) {
          report.blockedWrites.push({ method: request.method(), path: url.pathname });
          await route.abort("blockedbyclient");
          return;
        }
        const patch = url.pathname === `/api/v1/plans/${plan.id}` ? scenario.planPatch
          : url.pathname === `/api/v1/tasks/${task.id}` ? scenario.taskPatch : null;
        if (patch) {
          const response = await route.fetch();
          const body = await response.json();
          if (response.ok() && body.data) Object.assign(body.data, patch);
          await route.fulfill({ response, json: body });
        } else await route.continue();
      });
      page = await context.newPage();
      page.setDefaultTimeout(30_000);
      page.on("pageerror", (error) => report.pageErrors.push(error.message));
      page.on("console", (message) => { if (message.type() === "error") report.consoleErrors.push(message.text().slice(0, 500)); });
      page.on("response", async (response) => {
        const url = new URL(response.url());
        if (url.origin !== origin.origin || !url.pathname.startsWith("/api/v1/")) return;
        if (response.status() >= 400) report.failedApiRequests.push({ path: url.pathname, status: response.status(), role });
        if (url.pathname === `/api/v1/devices/${resource.sourceDeviceId}/telemetry` && response.ok()) {
          try { lastTelemetry = (await response.json()).data; telemetryCount++; } catch { /* Navigation may replace a response. */ }
        }
      });
      async function open({ currentTask = task, deviceId = resource.sourceDeviceId, ...overrides } = {}) {
        scenario = overrides;
        const query = new URLSearchParams({ view: "flight", taskId: currentTask.id, deviceId });
        await page.goto(`${baseUrl}/?${query}`, { waitUntil: "domcontentloaded" });
        await visible(page.getByRole("heading", { name: "飞行管控", exact: true }));
        await visible(controls());
      }
      const allowed = role !== "DEPARTMENT";
      await check(`${size} ${role} approved task gates all five controls`, async () => {
        await open();
        await waitGate(allowed, allowed ? "APPROVED" : "ROLE_FORBIDDEN");
        await screenshot(`${size}-${role.toLowerCase()}-approved`);
        return { role, expectedEnabled: allowed };
      });
      if (allowed) {
        await check(`${size} ${role} five clicks remain local and preserve observations`, async () => {
          const pollingDeadline = Date.now() + 15_000;
          while (telemetryCount < 2) {
            assert(Date.now() < pollingDeadline, "Normal telemetry GET polling did not continue.");
            const response = await page.waitForResponse((candidate) => new URL(candidate.url()).pathname
              === `/api/v1/devices/${resource.sourceDeviceId}/telemetry` && candidate.ok(), { timeout: 12_000 });
            await response.finished();
          }
          await assertTelemetryMatchesObservation(lastTelemetry);
          for (const [label, state] of operations) {
            await controls().getByRole("button", { name: label, exact: true }).click();
            await page.waitForFunction((expected) => document.querySelector('[data-testid="flight-operation-controls"]')
              ?.getAttribute("data-local-state") === expected, state);
            await waitGate(true);
            await assertTelemetryMatchesObservation(lastTelemetry);
          }
          for (const name of angleNames) {
            const slider = page.getByRole("slider", { name });
            const before = await slider.inputValue();
            const maximum = Number(await slider.getAttribute("max") || "100");
            await slider.press(Number(before) < maximum ? "ArrowRight" : "ArrowLeft");
            assert.notEqual(await slider.inputValue(), before, "An approved local target angle could not be adjusted.");
          }
          for (const label of ["发送云台指令", "发送喊话"]) {
            await page.getByRole("button", { name: label, exact: true }).click();
            const feedback = page.locator(".toast");
            await visible(feedback);
            const feedbackText = await feedback.textContent();
            assert(feedbackText.includes(label === "发送喊话" ? "喊话" : "云台")
              && /未发送|不发送|页面|本地/.test(feedbackText), "A payload button did not show a local-only interaction result.");
            await assertTelemetryMatchesObservation(lastTelemetry);
          }
          const taskAfter = await get(`/tasks/${task.id}`);
          assert.equal(taskAfter.status, baseline.task.status, "A local button changed the actual task state.");
          assert.equal(taskAfter.updatedAt, baseline.task.updatedAt, "A local button wrote to the actual task.");
          assert.equal(report.blockedWrites.length, 0, "A local button attempted a business write.");
          assert.equal(report.commandRequests.length, 0, "A local button attempted a device command.");
          assert(telemetryCount >= 2, "Normal telemetry GET polling did not continue.");
          await screenshot(`${size}-${role.toLowerCase()}-local-land`);
          return { buttonsClicked: 7, localAnglesChanged: 2, telemetryPollingObserved: true, taskUnchanged: true };
        });
      }
      if (role === "ADMIN") {
        await check(`${size} device approval opens the exact plan and returns to its task`, async () => {
          await page.getByRole("button", { name: "查看 / 办理审批", exact: true }).click();
          await visible(page.getByRole("heading", { name: "飞行服务", exact: true }));
          assert.equal(new URL(page.url()).searchParams.get("planId"), plan.id, "Approval navigation opened a different plan.");
          assert.equal(new URL(page.url()).searchParams.get("taskId"), task.id, "Approval navigation lost the current task.");
          await visible(page.locator(".workspace-detail").getByRole("heading", { name: plan.title, exact: true }));
          await page.screenshot({ path: path.join(evidence, `${size}-exact-plan-approval.png`), fullPage: true });
          await page.getByRole("button", { name: "返回关联任务", exact: true }).click();
          await visible(page.getByRole("dialog").getByLabel("飞行计划审批", { exact: true }));
          assert.equal(new URL(page.url()).searchParams.get("taskId"), task.id, "Returning from approval lost the task context.");
          await page.getByRole("dialog").getByRole("button", { name: "查看设备运行", exact: true }).click();
          await waitGate(true);
        });
        await check(`${size} pending review locks then approved response unlocks`, async () => {
          await open({ planPatch: { status: "PENDING_REVIEW" } });
          await waitGate(false, "APPROVAL_REQUIRED");
          await screenshot(`${size}-pending-review-locked`);
          scenario.planPatch = { status: "APPROVED" };
          await waitGate(true);
          assert.equal(await controls().getAttribute("data-local-state"), "IDLE", "A different approval context retained a completed local action.");
          await screenshot(`${size}-approved-unlocked`);
          await controls().getByRole("button", { name: "立即起飞", exact: true }).click();
          scenario.planPatch = { status: "RETURNED" };
          await waitGate(false, "APPROVAL_REQUIRED");
          assert.equal(await controls().getAttribute("data-local-state"), "IDLE", "Revoked approval retained an active local interaction.");
          await screenshot(`${size}-approval-returned-locked`);
          return { sourcePlanStatusChanged: false, automaticApprovalRefresh: true, revokedApprovalClearsLocalState: true };
        });
        for (const [name, settings, code] of [
          ["no associated plan", { taskPatch: { planId: null } }, "NO_PLAN"],
          ["no assigned pilot", { taskPatch: { pilotId: null } }, "NO_PILOT"],
          ["admission approval is not a flight plan", { planPatch: { kind: "DEVICE_ADMISSION" } }, "INVALID_PLAN_KIND"],
          ["task and plan association mismatch", { planPatch: { id: "qa-unrelated-plan" } }, "PLAN_MISMATCH"],
          ["different selected device", { deviceId: otherResource.sourceDeviceId }, "DEVICE_MISMATCH"],
          ["completed task", { currentTask: endedTask, deviceId: byResource.get(endedTask.deviceId).sourceDeviceId }, ["NO_PLAN", "TASK_NOT_EXECUTABLE"]],
        ]) await check(`${size} ${name} stays locked`, async () => {
          await open(settings);
          await waitGate(false, code);
        });
      }
      if (role === "PILOT") await check(`${size} unassigned pilot stays locked`, async () => {
        await open({ taskPatch: { pilotId: "qa-another-pilot" } });
        await waitGate(false, "ROLE_FORBIDDEN");
      });
      if (role === "PILOT") await check(`${size} pilot can read an assigned plan without editing another applicant's draft`, async () => {
        await open({ planPatch: { status: "DRAFT" } });
        await waitGate(false, "APPROVAL_REQUIRED");
        await page.getByRole("button", { name: "查看 / 办理审批", exact: true }).click();
        await visible(page.getByRole("heading", { name: "飞行服务", exact: true }));
        const detail = page.locator(".workspace-detail");
        await visible(detail.getByRole("heading", { name: plan.title, exact: true }));
        await visible(detail.locator(".handling-card").getByText("草稿", { exact: true }));
        for (const label of ["编辑申请", "重新提交", "取消申请", "核验通过", "退回补正", "登记外部回执"])
          assert.equal(await detail.getByRole("button", { name: label, exact: true }).count(), 0,
            "A pilot can modify or approve another applicant's linked plan.");
        await page.screenshot({ path: path.join(evidence, `${size}-pilot-read-only-plan.png`), fullPage: true });
        return { assignedPlanReadable: true, otherApplicantPlanReadOnly: true, sourcePlanStatusChanged: false };
      });
      await context.close();
      page = undefined;
    }
  }
  await check("Actual task, plan and completed task records remain unchanged", async () => {
    for (const [key, endpoint] of [["task", `/tasks/${task.id}`], ["plan", `/plans/${plan.id}`], ["endedTask", `/tasks/${endedTask.id}`]]) {
      const current = await get(endpoint);
      assert.equal(current.status, baseline[key].status, "An acceptance record changed its actual status.");
      assert.equal(current.updatedAt, baseline[key].updatedAt, "An acceptance record was written to.");
      assert.equal(current.planId, baseline[key].planId, "An acceptance task changed its actual plan binding.");
    }
  });
  await check("Zero commands, business writes and browser runtime failures", async () => {
    for (const key of ["blockedWrites", "commandRequests", "pageErrors", "consoleErrors", "failedApiRequests"])
      assert.equal(report[key].length, 0, `${key} were recorded.`);
  });
} catch (error) {
  report.checks.push({ name: "Acceptance setup", pass: false, error: error.message });
  console.error(error.message);
} finally {
  await browser?.close();
  report.passed = report.checks.filter((item) => item.pass).length;
  report.failed = report.checks.filter((item) => !item.pass).length;
  await fs.writeFile(path.join(evidence, "results.json"), JSON.stringify(report, null, 2), { mode: 0o600 });
  console.log(`Approval controls acceptance: ${report.passed} passed, ${report.failed} failed; evidence ${evidence}`);
  process.exitCode = report.failed ? 1 : 0;
}
