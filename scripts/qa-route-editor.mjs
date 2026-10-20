#!/usr/bin/env node
/** Local, read-only acceptance: edits stay in React memory; every business write is blocked. */
import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(path.join(root, "frontend", "package.json"));
const { chromium } = require("@playwright/test");
const baseUrl = process.env.QA_LIVE_BASE_URL || "http://127.0.0.1:8088";
const origin = new URL(baseUrl);
assert(["localhost", "127.0.0.1"].includes(origin.hostname), "Only the local application may be inspected.");
const runId = new Date().toISOString().replace(/[:.]/g, "-");
const evidence = path.join(root, ".local", "qa-route-editor", runId);
await fs.mkdir(evidence, { recursive: true, mode: 0o700 });
const report = { runId, baseUrl, readOnly: true, checks: [], blockedWrites: [], commandRequests: [], pageErrors: [], consoleErrors: [], failedApiRequests: [], buildingCoverage: [], sourceWrites: 0 };
let cookie, browser, page, size;
async function persist() { await fs.writeFile(path.join(evidence, "results.json"), JSON.stringify(report, null, 2), { mode: 0o600 }); }
const decode = (value) => value.startsWith('"') && value.endsWith('"') ? JSON.parse(value) : value.startsWith("'") && value.endsWith("'") ? value.slice(1, -1) : value;
async function login() {
  const env = {};
  for (const line of (await fs.readFile(path.join(root, ".env"), "utf8")).split(/\r?\n/)) {
    const match = line.match(/^(BOOTSTRAP_ADMIN_USERNAME|BOOTSTRAP_ADMIN_PASSWORD)=(.*)$/);
    if (match) env[match[1]] = decode(match[2]);
  }
  assert(env.BOOTSTRAP_ADMIN_USERNAME && env.BOOTSTRAP_ADMIN_PASSWORD, "Private local login configuration is unavailable.");
  const csrfResponse = await fetch(`${baseUrl}/api/v1/auth/csrf`, { signal: AbortSignal.timeout(30_000) });
  assert(csrfResponse.ok, "CSRF unavailable");
  const csrf = (await csrfResponse.json()).data;
  const response = await fetch(`${baseUrl}/api/v1/auth/login`, { method: "POST", headers: { "Content-Type": "application/json", Cookie: csrfResponse.headers.getSetCookie().map((value) => value.split(";")[0]).join("; "), [csrf.headerName]: csrf.token }, body: JSON.stringify({ username: env.BOOTSTRAP_ADMIN_USERNAME, password: env.BOOTSTRAP_ADMIN_PASSWORD }), signal: AbortSignal.timeout(30_000) });
  assert(response.ok, "Local login failed");
  const session = [...response.headers.getSetCookie(), ...csrfResponse.headers.getSetCookie()].find((value) => value.startsWith("JSESSIONID="));
  assert(session, "Missing local session"); return session.split(";")[0];
}
async function get(endpoint) {
  const response = await fetch(`${baseUrl}/api/v1${endpoint}`, { headers: { Cookie: cookie }, signal: AbortSignal.timeout(90_000) });
  assert(response.ok, `Read failed: ${endpoint.split("?")[0]} HTTP ${response.status}`);
  const body = await response.json(); assert.equal(body.code, "OK"); return body.data;
}
async function catalog(endpoint) {
  const items = []; let total;
  for (let number = 1; number < 201; number++) {
    const data = await get(`${endpoint}${endpoint.includes("?") ? "&" : "?"}page=${number}&pageSize=100`);
    total ??= data.total; items.push(...data.items);
    if (!data.items.length || items.length >= total) break;
  }
  assert(items.length >= total, "Catalog truncated"); return items;
}
async function check(name, action) {
  const start = Date.now();
  try { const detail = await action(); report.checks.push({ name, viewport: size, pass: true, milliseconds: Date.now() - start, ...detail }); console.log(`PASS ${size || "API"} ${name}`); }
  catch (error) { report.checks.push({ name, viewport: size, pass: false, error: error.message }); console.error(`FAIL ${size || "API"} ${name}: ${error.message}`); await screenshot(`failure-${report.checks.length}`).catch(() => {}); }
  await persist();
}
async function screenshot(name) { await page.screenshot({ path: path.join(evidence, `${size}-${name}.png`), fullPage: true }); }
async function goto(view, parameters = {}) { await page.goto(`${baseUrl}/?${new URLSearchParams({ view, ...parameters })}`, { waitUntil: "domcontentloaded" }); }
const resourceModal = () => page.getByRole("dialog", { name: "编辑资源档案", exact: true });
const editor = () => page.locator(".geometry-workspace").last();
const pointCount = () => editor().locator(".geometry-waypoints > li > button").count();
async function pointsSnapshot() { return editor().locator(".geometry-waypoints small").allTextContents(); }
async function openRoute(route) {
  await goto("resources");
  await page.locator(".resource-catalog").getByRole("button", { name: "航线资源", exact: true }).click();
  await page.getByPlaceholder("搜索资源名称、编号或型号").fill(route.title);
  const row = page.getByRole("row").filter({ has: page.getByText(route.id, { exact: true }) });
  await row.click();
  await page.getByRole("dialog").getByRole("button", { name: "编辑档案", exact: true }).click();
  await resourceModal().waitFor({ state: "visible" });
  await editor().locator("canvas").waitFor({ state: "visible" });
  await page.waitForFunction(() => document.querySelectorAll(".drawing-waypoint,.route-elevated-waypoint").length > 0);
  // This legacy ground-geometry suite intentionally starts in 2D. Elevated
  // routing and altitude-aware rendering are covered by qa-route-3d.mjs.
  await editor().getByRole("button", { name: "2D", exact: true }).click();
  await page.waitForFunction(() => document.querySelectorAll(".drawing-waypoint").length > 0);
}
async function fittingMarkers() {
  await page.waitForFunction(() => {
    const stage = [...document.querySelectorAll(".geometry-stage")].at(-1)?.getBoundingClientRect();
    const markers = [...document.querySelectorAll(".drawing-waypoint")];
    return stage && markers.length && markers.every((node) => { const box = node.getBoundingClientRect(); return box.left >= stage.left && box.right <= stage.right && box.top >= stage.top && box.bottom <= stage.bottom; });
  });
}
// Read the existing React map ref solely for real rendered-feature inspection. No production debug API is added.
async function mapSnapshot(mode = "ready") {
  return editor().locator(".map-canvas").evaluate((node, mode) => {
    const key = Object.keys(node).find((key) => key.startsWith("__reactFiber$"));
    let fiber = key ? node[key] : undefined, map;
    for (let depth = 0; fiber && depth < 40 && !map; depth++, fiber = fiber.return) {
      let hook = fiber.memoizedState;
      for (let index = 0; hook && index < 80; index++, hook = hook.next) {
        const value = hook.memoizedState?.current;
        if (value && typeof value.queryRenderedFeatures === "function" && typeof value.project === "function") { map = value; break; }
      }
    }
    if (!map) return { available: false };
    if (mode === "ready") return { available: true, ready: map.isStyleLoaded() && map.areTilesLoaded(), zoom: map.getZoom(), pitch: map.getPitch() };
    if (mode === "selection") return map.getSource("selected-building")?.serialize()?.data || null;
    const layers = ["context-buildings-2d", "context-buildings-3d"].filter((id) => map.getLayer(id));
    const features = layers.length ? map.queryRenderedFeatures({ layers }) : [];
    features.sort((a, b) => Number(b.geometry.type === "MultiPolygon") - Number(a.geometry.type === "MultiPolygon"));
    const canvas = map.getCanvas(), canvasBox = canvas.getBoundingClientRect();
    for (const feature of features) {
      const rings = [];
      const walk = (value) => {
        if (!Array.isArray(value)) return;
        if (Array.isArray(value[0]) && typeof value[0][0] === "number" && typeof value[0][1] === "number") rings.push(value);
        else value.forEach(walk);
      };
      walk(feature.geometry.coordinates);
      for (const positions of rings) {
        const center = [(Math.min(...positions.map((p) => p[0])) + Math.max(...positions.map((p) => p[0]))) / 2, (Math.min(...positions.map((p) => p[1])) + Math.max(...positions.map((p) => p[1]))) / 2];
        const pixel = map.project(center);
        if (pixel.x < 40 || pixel.y < 110 || pixel.x > canvasBox.width - 40 || pixel.y > canvasBox.height - 75) continue;
        const hit = map.queryRenderedFeatures(pixel, { layers })[0];
        if (!hit || String(hit.id) !== String(feature.id)) continue;
        return { available: true, features: features.length, geometryType: feature.geometry.type, rings: rings.length, x: canvasBox.x + pixel.x, y: canvasBox.y + pixel.y, location: center, outlineBounds: [Math.min(...positions.map((p) => p[0])), Math.min(...positions.map((p) => p[1])), Math.max(...positions.map((p) => p[0])), Math.max(...positions.map((p) => p[1]))], sourceFeatureId: feature.id == null ? null : String(feature.id) };
      }
    }
    return { available: true, features: features.length, x: null, y: null };
  }, mode);
}
async function waitForTiles() {
  const deadline = Date.now() + 15_000; let state;
  do { state = await mapSnapshot(); if (state.available && state.ready) return state; await page.waitForTimeout(200); } while (Date.now() < deadline);
  return { ...state, limitation: "Some external map tiles were still loading at the screenshot deadline." };
}
async function canvasClick(fractionX = 0.42, fractionY = 0.61) {
  const canvas = editor().locator("canvas"), box = await canvas.boundingBox(); assert(box);
  await page.mouse.click(box.x + box.width * fractionX, box.y + box.height * fractionY);
}
function taskSnapshot(items) { return items.map(({ id, status, updatedAt, deviceId, pilotId, planId }) => ({ id, status, updatedAt, deviceId, pilotId, planId })); }
try {
  cookie = await login();
  const [routes, tasks, devices, archives] = await Promise.all([catalog("/resources?kind=ROUTE"), catalog("/tasks"), catalog("/devices"), catalog("/resources?kind=DEVICE")]);
  const route = routes.find((item) => item.title === "shiyang-way" && item.metadata?.geometry?.type === "LineString") || routes.find((item) => item.metadata?.geometry?.type === "LineString" && item.metadata.geometry.coordinates.length >= 2);
  assert(route, "A genuine existing route is required.");
  const baseline = { routes, tasks: taskSnapshot(tasks) };
  report.realRoute = { id: route.id, title: route.title, points: route.metadata.geometry.coordinates.length, sourceAltitudePoints: route.metadata.geometry.coordinates.filter((point) => point.length > 2).length };
  const task = tasks.find((item) => archives.some((archive) => archive.id === item.deviceId && devices.some((device) => device.id === archive.sourceDeviceId)));
  browser = await chromium.launch({ executablePath: process.env.QA_CHROME_PATH || "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", headless: true, args: ["--disable-dev-shm-usage"] });
  for (const viewport of [{ width: 1920, height: 1080 }, { width: 1280, height: 720 }, { width: 1024, height: 768 }]) {
    size = `${viewport.width}x${viewport.height}`;
    const context = await browser.newContext({ viewport, locale: "zh-CN", timezoneId: "Asia/Shanghai", colorScheme: "dark" });
    await context.addCookies([{ name: "JSESSIONID", value: cookie.slice("JSESSIONID=".length), domain: origin.hostname, path: "/", httpOnly: true, secure: origin.protocol === "https:", sameSite: "Lax" }]);
    await context.route("**/api/v1/**", async (route) => {
      const request = route.request(), endpoint = new URL(request.url()).pathname;
      if (/\/commands(?:\/|$)/.test(endpoint)) { report.commandRequests.push({ viewport: size, method: request.method(), path: endpoint }); return route.abort("blockedbyclient"); }
      if (!["GET", "HEAD", "OPTIONS"].includes(request.method())) { report.blockedWrites.push({ viewport: size, method: request.method(), path: endpoint }); return route.abort("blockedbyclient"); }
      return route.continue();
    });
    page = await context.newPage(); page.setDefaultTimeout(25_000);
    page.on("pageerror", (error) => report.pageErrors.push({ viewport: size, message: error.message }));
    page.on("console", (message) => { if (message.type() === "error") report.consoleErrors.push({ viewport: size, message: message.text().slice(0, 500) }); });
    page.on("response", (response) => { const url = new URL(response.url()); if (url.origin === origin.origin && url.pathname.startsWith("/api/v1/") && response.status() >= 400) report.failedApiRequests.push({ viewport: size, path: url.pathname, status: response.status() }); });
    await check("Wide editor, real route auto-fit, readable waypoint controls", async () => {
      await openRoute(route); await fittingMarkers(); await waitForTiles();
      const modal = await resourceModal().boundingBox(), stage = await editor().locator(".geometry-stage").boundingBox();
      assert(modal && modal.width >= viewport.width * 0.8, "Resource editor is still narrow");
      assert(stage && stage.width >= (viewport.width > 1500 ? 600 : 300) && stage.height >= 300, "Drawing canvas remains too small");
      assert.equal(await pointCount(), route.metadata.geometry.coordinates.length);
      await editor().scrollIntoViewIfNeeded(); await screenshot("wide-route-editor");
      return { modalWidth: modal.width, canvas: { width: stage.width, height: stage.height }, points: await pointCount() };
    });
    await check("Fullscreen canvas, 2D/3D and basemap toggles preserve route", async () => {
      const before = await pointsSnapshot(); await editor().getByRole("button", { name: "全屏编辑", exact: true }).click();
      await page.getByRole("dialog", { name: "航线编辑器", exact: true }).waitFor({ state: "visible" }); await fittingMarkers();
      const canvas = await editor().locator(".geometry-stage").boundingBox(); assert(canvas && canvas.width > viewport.width * 0.6 && canvas.height > viewport.height * 0.6);
      for (const label of ["3D", "2D", "电子图", "影像"]) {
        const control = editor().getByRole("button", { name: label, exact: true });
        await control.click(); assert.deepEqual(await pointsSnapshot(), before);
        if (label === "3D" || label === "2D") {
          assert.equal(await control.getAttribute("aria-pressed"), "true");
          await page.waitForTimeout(650);
          const camera = await mapSnapshot();
          assert(label === "3D" ? camera.pitch > 30 : camera.pitch < 1, "The selected map perspective did not reach the requested camera pitch.");
        }
      }
      await editor().getByRole("button", { name: "全线总览", exact: true }).click(); await fittingMarkers(); await waitForTiles();
      await screenshot("fullscreen-route-editor"); return { canvas: { width: canvas.width, height: canvas.height }, preservedPoints: before.length };
    });
    await check("Map clicks add points, marker drag moves, delete and undo stay local", async () => {
      const before = await pointCount(); await canvasClick(); assert.equal(await pointCount(), before + 1);
      const marker = editor().locator(".drawing-waypoint").last(); await marker.scrollIntoViewIfNeeded();
      const oldLongitude = await editor().getByRole("spinbutton", { name: "航点经度", exact: true }).inputValue();
      const box = await marker.boundingBox(); assert(box);
      await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2); await page.mouse.down(); await page.mouse.move(box.x + box.width / 2 + 38, box.y + box.height / 2 + 22, { steps: 9 }); await page.mouse.up();
      await page.waitForFunction((previous) => document.querySelector('[aria-label="航点经度"]')?.value !== previous, oldLongitude);
      assert.equal(await pointCount(), before + 1, "Dragging accidentally added a point");
      await editor().getByRole("button", { name: `删除航点 ${before + 1}`, exact: true }).click(); assert.equal(await pointCount(), before);
      await canvasClick(0.52, 0.68); assert.equal(await pointCount(), before + 1);
      await editor().getByRole("button", { name: "撤销一点", exact: true }).click(); assert.equal(await pointCount(), before);
      return { pointsBefore: before, pointsAfter: await pointCount(), saved: false };
    });
    await check("Building inspection never adds points; real coverage and association are explicit", async () => {
      const before = await pointCount(); await editor().getByRole("button", { name: "查看楼宇", exact: true }).click();
      await canvasClick(); assert.equal(await pointCount(), before);
      // Side-panel selection focuses an existing real route vertex at building scale. No map or features are mocked.
      await editor().getByRole("button", { name: "选择航点 3", exact: true }).click();
      await page.waitForTimeout(600);
      await waitForTiles();
      const feature = await mapSnapshot("building");
      let found = false;
      if (typeof feature.x === "number" && typeof feature.y === "number") {
        await page.mouse.click(feature.x, feature.y);
        await editor().locator(".geometry-building-detail h4").waitFor({ state: "visible" });
        found = true;
      }
      assert.equal(await pointCount(), before, "Building inspection accidentally added waypoints");
      const status = await editor().locator(".map-building-status").textContent();
      const coverage = { viewport: size, status: status?.trim(), selectableRealBuilding: found, associated: false };
      if (found) {
        coverage.buildingName = await editor().locator(".geometry-building-detail h4").textContent();
        const highlight = await mapSnapshot("selection");
        assert.equal(highlight?.features?.length, 1, "The selected building highlight contains multiple buildings");
        assert.equal(highlight.features[0].geometry.type, "Polygon", "The building group was not split into a single polygon");
        assert.equal(highlight.features[0].geometry.coordinates.length, 1);
        const outline = highlight.features[0].geometry.coordinates[0];
        const bounds = [Math.min(...outline.map((p) => p[0])), Math.min(...outline.map((p) => p[1])), Math.max(...outline.map((p) => p[0])), Math.max(...outline.map((p) => p[1]))];
        for (let index = 0; index < 4; index++) assert(Math.abs(bounds[index] - feature.outlineBounds[index]) < 0.0000001, "The selected outline expanded from the clicked building to its source group");
        assert(feature.location[0] >= bounds[0] && feature.location[0] <= bounds[2] && feature.location[1] >= bounds[1] && feature.location[1] <= bounds[3], "The clicked point lies outside the selected building bounds");
        coverage.isolatedSingleBuilding = true; coverage.sourceGeometryType = feature.geometryType;
        await editor().getByRole("button", { name: /^关联到航点/ }).click();
        assert(await editor().locator(".geometry-associated").count()); coverage.associated = true;
      }
      report.buildingCoverage.push({ ...coverage, realRenderedFeatures: feature.features, geometryType: feature.geometryType, rings: feature.rings }); await screenshot("building-inspection");
      assert(found, `Real building association was not verified: ${status?.trim()}; ${feature.features ?? 0} rendered features.`);
      await editor().getByRole("button", { name: "完成绘制", exact: true }).click();
      assert.equal(await resourceModal().locator(".geometry-waypoints > li > button").count(), before);
      if (found) assert(await resourceModal().locator(".geometry-associated").count());
      await resourceModal().getByRole("button", { name: "取消", exact: true }).click();
      return { ...coverage, saved: false, coverageLimitation: found ? undefined : "No selectable real building was encountered in the inspected viewport; no association was fabricated." };
    });
    await check("Flight device queue prioritizes fresh online observations and retains selected device on refresh", async () => {
      await goto("flight"); await page.waitForFunction((total) => document.querySelectorAll(".flight-layout .queue-card").length === total, devices.length);
      await page.locator(".flight-layout .queue-card.selected").waitFor({ state: "visible" });
      const ordering = await page.locator(".flight-layout .queue-card").evaluateAll((nodes) => nodes.map((node) => ({ name: node.querySelector("strong")?.textContent, status: node.querySelector(".status")?.textContent, idOrSn: node.querySelector("small")?.textContent })));
      let seenOther = false; for (const item of ordering) { if (item.status?.includes("在线")) assert(!seenOther, "An online device appears below offline/unknown devices"); else seenOther = true; }
      const selected = await page.locator(".flight-layout .queue-card.selected small").first().textContent();
      const refreshed = page.waitForResponse((response) => new URL(response.url()).pathname === "/api/v1/devices" && response.request().method() === "GET", { timeout: 12_000 });
      await refreshed; await page.waitForTimeout(300);
      assert.equal(await page.locator(".flight-layout .queue-card.selected small").first().textContent(), selected, "Polling changed the selected device");
      await screenshot("flight-online-first"); return { total: ordering.length, online: ordering.filter((item) => item.status?.includes("在线")).length, retainedSelection: true };
    });
    await check("Task navigation resolves the assigned source device instead of another online device", async () => {
      assert(task, "No existing task has an assigned visible source device");
      const archive = archives.find((item) => item.id === task.deviceId), device = devices.find((item) => item.id === archive.sourceDeviceId);
      await goto("flight", { taskId: task.id });
      await page.locator(".flight-task-context strong").waitFor({ state: "visible" });
      await page.waitForFunction((title) => document.querySelector(".flight-task-context strong")?.textContent === title, task.title);
      const selected = page.locator(".flight-layout .queue-card.selected"); await selected.waitFor({ state: "visible" });
      assert.equal(await selected.locator("small").first().textContent(), String(device.sn || device.id));
      assert.equal(await page.locator(".flight-layout .queue-card.selected").count(), 1);
      return { taskId: task.id, sourceDeviceId: device.id, preservedExplicitAssignment: true };
    });
    await context.close();
  }
  size = undefined;
  await check("Existing route geometry, metadata and task state remain unchanged; no commands or writes", async () => {
    assert.deepEqual(await catalog("/resources?kind=ROUTE"), baseline.routes);
    assert.deepEqual(taskSnapshot(await catalog("/tasks")), baseline.tasks);
    assert.equal(report.blockedWrites.length, 0); assert.equal(report.commandRequests.length, 0); assert.equal(report.pageErrors.length, 0); assert.equal(report.failedApiRequests.length, 0);
    return { routesUnchanged: routes.length, tasksUnchanged: tasks.length, businessWrites: 0, commands: 0 };
  });
} catch (error) { report.fatal = error.message; console.error(`FATAL ${error.message}`); }
finally { await browser?.close(); await persist(); console.log(`Evidence: ${path.relative(root, evidence)}`); }
const passed = report.checks.filter((item) => item.pass).length;
console.log(`${passed}/${report.checks.length} checks passed`);
if (report.fatal || report.checks.some((item) => !item.pass)) process.exitCode = 1;
