#!/usr/bin/env node
import { chooseSelect, selectValue } from "./lib/select-ui.mjs";
/** Read-only acceptance for scoped device and pilot assignment. Login is the only POST. */
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
assert(["localhost", "127.0.0.1"].includes(origin.hostname), "Assignment acceptance is limited to the local application.");
const runId = new Date().toISOString().replace(/[:.]/g, "-");
const evidence = path.join(root, ".local", "qa-assignment", runId);
await fs.mkdir(evidence, { recursive: true, mode: 0o700 });
const report = {
  runId, baseUrl, readOnly: true, businessWrites: 0, loginRequests: 0,
  responseOverrides: "Only browser GET responses are overridden; source and business databases are unchanged.",
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
async function rawGet(endpoint, cookie = adminCookie) {
  const response = await fetch(`${baseUrl}/api/v1${endpoint}`, { headers: { Cookie: cookie }, signal: AbortSignal.timeout(90_000) });
  const body = await response.json();
  return { status: response.status, body };
}
async function get(endpoint, cookie = adminCookie) {
  const { status, body } = await rawGet(endpoint, cookie);
  assert.equal(status, 200, `GET ${endpoint.split("?")[0]} returned HTTP ${status}.`);
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
function modal() { return page.getByRole("dialog", { name: "分配执行资源", exact: true }); }
function deviceSelect() { return modal().getByLabel("执行设备", { exact: false }); }
function pilotSelect() { return modal().getByLabel("执行飞手", { exact: false }); }
function submit() { return modal().getByRole("button", { name: "分配执行资源", exact: true }); }
async function openAssignment(task) {
  await page.goto(`${baseUrl}/?${new URLSearchParams({ view: "dispatch", taskId: task.id })}`, { waitUntil: "domcontentloaded" });
  await visible(page.getByRole("heading", { name: "任务调度", exact: true }));
  const taskDialog = page.getByRole("dialog").last();
  await visible(taskDialog.getByRole("button", { name: "分配资源", exact: true }));
  await taskDialog.getByRole("button", { name: "分配资源", exact: true }).click();
  await visible(modal());
  await visible(deviceSelect());
  await visible(pilotSelect());
  await page.getByTestId("task-assignment-form").locator(".assignment-summary").waitFor({ state: "visible" });
  await page.waitForFunction(() => !document.querySelector("#assignment-deviceId")?.disabled);
}
async function screenshot(name) {
  await page.screenshot({ path: path.join(evidence, `${name}.png`), fullPage: true });
  await modal().screenshot({ path: path.join(evidence, `${name}-modal.png`) });
}
async function noOverflow() {
  const dimensions = await modal().evaluate((element) => ({ client: element.clientWidth, scroll: element.scrollWidth }));
  assert(dimensions.scroll <= dimensions.client + 2, "Assignment modal overflows horizontally.");
}

try {
  for (const [role, account] of await credentials()) sessions.set(role, await login(account));
  adminCookie = sessions.get("ADMIN");
  const [tasks, resources, users] = await Promise.all([catalog("/tasks"), catalog("/resources?kind=DEVICE"), catalog("/users")]);
  const westTask = tasks.find((task) => task.id === "703c31ea-968c-4468-a426-e4dd4d1eb816")
    || tasks.find((task) => task.status === "PENDING_ASSIGNMENT" && task.region === "西湖区");
  assert(westTask?.status === "PENDING_ASSIGNMENT", "The existing West Lake assignment task is unavailable.");
  const westOptions = await get(`/tasks/${westTask.id}/assignment-options`);
  let validTask;
  let validOptions;
  for (const task of tasks.filter((item) => item.status === "PENDING_ASSIGNMENT" && item.region === "余杭区")) {
    const options = await get(`/tasks/${task.id}/assignment-options`);
    if (options.summary.availableDeviceCount > 0 && options.summary.availablePilotCount > 0) { validTask = task; validOptions = options; break; }
  }
  assert(validTask, "No existing Yuhang task has compatible assignment resources.");
  const device = validOptions.devices.find((item) => item.eligible && item.compatiblePilotCount > 0);
  assert(device, "No compatible scheduling device was returned.");
  const selectedOptions = await get(`/tasks/${validTask.id}/assignment-options?deviceId=${encodeURIComponent(device.id)}`);
  const pilot = selectedOptions.pilots.find((item) => item.eligible);
  assert(pilot, "The compatible device returned no compatible pilot.");
  const baseline = new Map([[westTask.id, await get(`/tasks/${westTask.id}`)], [validTask.id, await get(`/tasks/${validTask.id}`)]]);

  await check("API catalog counts explain imported devices and scheduling readiness", async () => {
    assert.equal(westOptions.summary.deviceCount, resources.length);
    assert.equal(westOptions.summary.activeDeviceCount, resources.filter((item) => item.status === "ACTIVE").length);
    assert.equal(westOptions.summary.pendingDeviceCount, resources.filter((item) => item.status === "PENDING_CONFIRMATION").length);
    assert.equal(westOptions.devices.length, resources.length);
    assert(westOptions.summary.pendingDeviceCount > 0);
    assert(westOptions.summary.deviceCount > westOptions.summary.activeDeviceCount);
    return { deviceCount: westOptions.summary.deviceCount, activeDeviceCount: westOptions.summary.activeDeviceCount,
      pendingDeviceCount: westOptions.summary.pendingDeviceCount };
  });
  await check("API West Lake mismatch exposes actual pilot region before submission", async () => {
    const mismatch = westOptions.pilots.flatMap((item) => item.reasons).find((reason) => reason.code === "PILOT_REGION");
    assert(mismatch, "The API did not explain the pilot region mismatch.");
    assert(mismatch.message.includes("西湖区") && mismatch.message.includes("余杭区"), "The mismatch omits the requested or authorized region.");
    assert.equal(westOptions.summary.availablePilotCount, 0);
    assert.equal(westOptions.summary.availableDeviceCount, 0);
    assert(westOptions.pilots.every((item) => !item.eligible));
  });
  await check("API assignment options use compatible device and pilot pairs", async () => {
    assert.equal(selectedOptions.selectedDeviceId, device.id);
    assert(selectedOptions.devices.find((item) => item.id === device.id)?.eligible);
    assert(selectedOptions.pilots.find((item) => item.id === pilot.id)?.eligible);
    assert.equal(selectedOptions.summary.availableDeviceCount, selectedOptions.devices.filter((item) => item.eligible && item.compatiblePilotCount > 0).length);
    assert.equal(selectedOptions.summary.availablePilotCount, selectedOptions.pilots.filter((item) => item.eligible).length);
    const pending = selectedOptions.devices.filter((item) => item.status === "PENDING_CONFIRMATION");
    assert(pending.every((item) => !item.eligible && item.reasons.some((reason) => reason.code === "DEVICE_PENDING_CONFIRMATION")));
  });
  await check("API assignment options reject non-operator roles", async () => {
    for (const role of ["PILOT", "DEPARTMENT"]) {
      const result = await rawGet(`/tasks/${validTask.id}/assignment-options`, sessions.get(role));
      assert.equal(result.status, 403, `${role} can read operator-only assignment options.`);
    }
    await get(`/tasks/${validTask.id}/assignment-options`, sessions.get("DISPATCH"));
  });

  browser = await chromium.launch({ executablePath: process.env.QA_CHROME_PATH || "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    headless: true, args: ["--disable-dev-shm-usage"] });
  for (const viewport of [{ width: 1920, height: 1080 }, { width: 1280, height: 720 }]) {
    const size = `${viewport.width}x${viewport.height}`;
    const context = await browser.newContext({ locale: "zh-CN", timezoneId: "Asia/Shanghai", colorScheme: "dark", viewport });
    await context.addCookies([{ name: "JSESSIONID", value: adminCookie.slice("JSESSIONID=".length), domain: origin.hostname,
      path: "/", httpOnly: true, secure: origin.protocol === "https:", sameSite: "Lax" }]);
    let optionsOverride;
    await context.route("**/api/v1/**", async (route) => {
      const request = route.request();
      const url = new URL(request.url());
      if (/\/commands(?:\/|$)/.test(url.pathname)) {
        report.commandRequests.push({ method: request.method(), path: url.pathname });
        await route.abort("blockedbyclient"); return;
      }
      if (!["GET", "HEAD", "OPTIONS"].includes(request.method())) {
        report.blockedWrites.push({ method: request.method(), path: url.pathname });
        await route.abort("blockedbyclient"); return;
      }
      if (optionsOverride && url.pathname === `/api/v1/tasks/${validTask.id}/assignment-options`) {
        const response = await route.fetch();
        const body = await response.json();
        body.data = structuredClone(optionsOverride);
        body.data.selectedDeviceId = url.searchParams.get("deviceId");
        await route.fulfill({ response, json: body });
      } else await route.continue();
    });
    page = await context.newPage();
    page.setDefaultTimeout(30_000);
    page.on("pageerror", (error) => report.pageErrors.push(error.message));
    page.on("console", (message) => { if (message.type() === "error") report.consoleErrors.push(message.text().slice(0, 500)); });
    page.on("response", (response) => {
      const url = new URL(response.url());
      if (url.origin === origin.origin && url.pathname.startsWith("/api/v1/") && response.status() >= 400)
        report.failedApiRequests.push({ path: url.pathname, status: response.status() });
    });

    await check(`${size} West Lake assignment explains region mismatch and blocks submission`, async () => {
      await openAssignment(westTask);
      await visible(modal().getByLabel("飞手不可分配原因", { exact: true }).locator("p").filter({ hasText: /西湖区.*余杭区|余杭区.*西湖区/ }));
      assert(await submit().isDisabled(), "The incompatible West Lake assignment can be submitted.");
      await noOverflow();
      await screenshot(`${size}-west-lake-region-mismatch`);
    });

    await check(`${size} scheduling device counts and readiness explanation are visible`, async () => {
      const text = await modal().innerText();
      for (const value of [westOptions.summary.deviceCount, westOptions.summary.activeDeviceCount, westOptions.summary.pendingDeviceCount])
        assert(text.includes(String(value)), `The device explanation omits count ${value}.`);
      assert(/待确认/.test(text), "Imported devices needing confirmation are not explained.");
      assert(/调度/.test(text), "Source device access and scheduling readiness are not explained.");
      await deviceSelect().click();
      const menu = page.getByRole("listbox");
      assert.equal(await menu.getByRole("option").count(), westOptions.devices.length + 1,
        "The device selector omits imported devices instead of explaining them.");
      assert.equal(await menu.locator('[role="option"][aria-disabled="true"]').count(), westOptions.devices.filter((item) => !item.eligible).length);
      await deviceSelect().press("Escape");
    });

    await check(`${size} pilot permission link opens the exact existing account without saving`, async () => {
      const blockedPilot = westOptions.pilots.find((item) => item.reasons.some((reason) => reason.code === "PILOT_REGION"));
      const block = modal().getByLabel("飞手不可分配原因", { exact: true }).locator(".assignment-blocker").filter({ hasText: blockedPilot.title });
      await block.getByRole("button", { name: "查看飞手权限", exact: true }).click();
      await visible(page.getByRole("heading", { name: "组织与岗位权限", exact: true }));
      await visible(page.getByRole("dialog", { name: "平台设置", exact: true }));
      const editor = page.getByRole("dialog", { name: "编辑账号与范围", exact: true });
      await visible(editor.getByLabel("可见 / 执行区域（逗号分隔）", { exact: false }));
      const expectedUser = users.find((user) => user.id === blockedPilot.id);
      assert(expectedUser, "The blocked pilot's existing local account is unavailable.");
      assert.equal(await editor.getByLabel("登录账号", { exact: false }).inputValue(), expectedUser.username,
        "The permission link opened another local account.");
      assert.equal(await editor.getByLabel("姓名", { exact: false }).inputValue(), expectedUser.displayName);
      assert((await editor.getByLabel("可见 / 执行区域（逗号分隔）", { exact: false }).inputValue()).includes("余杭区"));
      await page.screenshot({ path: path.join(evidence, `${size}-exact-pilot-permissions.png`), fullPage: true });
      await editor.getByRole("button", { name: "取消", exact: true }).click();
    });

    await check(`${size} scheduling archive link opens connected resources without changing status`, async () => {
      await openAssignment(westTask);
      await modal().getByRole("button", { name: "完善设备调度资料", exact: true }).click();
      await visible(page.getByRole("heading", { name: "资源管理", exact: true }));
      assert.equal(new URL(page.url()).searchParams.get("view"), "resources");
      await visible(page.getByLabel("设备接入与调度说明", { exact: true }));
    });

    await check(`${size} compatible Yuhang pair becomes ready only after valid selections`, async () => {
      await openAssignment(validTask);
      assert(await submit().isDisabled(), "Assignment is submittable without selecting its resources.");
      await Promise.all([
        page.waitForResponse((response) => new URL(response.url()).pathname === `/api/v1/tasks/${validTask.id}/assignment-options`
          && new URL(response.url()).searchParams.get("deviceId") === device.id && response.ok()),
        chooseSelect(deviceSelect(), device.id),
      ]);
      await page.waitForFunction(() => {
        const select = document.querySelector("#assignment-pilotId");
        return select && !select.disabled;
      });
      await chooseSelect(pilotSelect(), pilot.id);
      await page.waitForFunction(() => {
        return document.querySelector('[data-testid="task-assignment-form"] [data-assignment-ready]')?.getAttribute("data-assignment-ready") === "true";
      });
      assert.equal(await selectValue(deviceSelect()), device.id);
      assert.equal(await selectValue(pilotSelect()), pilot.id);
      await noOverflow();
      await screenshot(`${size}-yuhang-compatible-pair`);
    });

    await check(`${size} clearing a selected device clears readiness without a write`, async () => {
      await chooseSelect(deviceSelect(), "");
      assert(await submit().isDisabled(), "Clearing the device kept assignment ready.");
      assert.equal(await selectValue(pilotSelect()), "", "Changing device retained an unchecked pilot selection.");
    });

    await check(`${size} time conflicts are explained before submission`, async () => {
      optionsOverride = structuredClone(validOptions);
      optionsOverride.summary.availableDeviceCount = 0;
      optionsOverride.summary.availablePilotCount = 0;
      const deviceReason = { code: "DEVICE_CONFLICT", message: "设备在该任务时段已有排班，请调整作业时间或选择其他设备。" };
      const pilotReason = { code: "PILOT_CONFLICT", message: "飞手在该任务时段已有排班，请调整作业时间或选择其他飞手。" };
      optionsOverride.devices = optionsOverride.devices.map((item) => ({ ...item, eligible: false, compatiblePilotCount: 0,
        reasons: item.status === "ACTIVE" ? [deviceReason] : item.reasons }));
      optionsOverride.pilots = optionsOverride.pilots.map((item) => ({ ...item, eligible: false, reasons: [pilotReason] }));
      optionsOverride.reasons = [deviceReason, pilotReason];
      await openAssignment(validTask);
      await visible(modal().getByLabel("飞手不可分配原因", { exact: true }).locator("p").filter({ hasText: /已有排班/ }));
      assert(await submit().isDisabled(), "A conflicting assignment can be submitted.");
      await screenshot(`${size}-time-conflict`);
      optionsOverride = undefined;
    });
    await context.close();
  }

  await check("Assignment inspection preserves existing tasks and sends no control or business requests", async () => {
    for (const [id, expected] of baseline) assert.deepEqual(await get(`/tasks/${id}`), expected, "A read-only assignment check changed a task.");
    assert.deepEqual(await catalog("/users"), users, "Inspecting pilot permissions changed a local account.");
    assert.equal(report.blockedWrites.length, 0, "A browser interaction attempted a business write.");
    assert.equal(report.commandRequests.length, 0, "A browser interaction attempted a device command.");
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
  console.log(`Assignment acceptance: ${report.passed} passed, ${report.failed} failed; evidence ${evidence}`);
  process.exitCode = report.failed ? 1 : 0;
}
