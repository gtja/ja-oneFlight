#!/usr/bin/env node
/** Read-only live acceptance. Draft edits stay in React; every business write is blocked. */
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
const evidence = path.join(root, ".local", "qa-route-3d", runId);
await fs.mkdir(evidence, { recursive: true, mode: 0o700 });
const report = { runId, baseUrl, readOnly: true, checks: [], blockedWrites: [], commandRequests: [], pageErrors: [], consoleErrors: [], failedApiRequests: [], buildingCoverage: [], projectionEvidence: [] };
let cookie, browser, page, size;
async function persist() { await fs.writeFile(path.join(evidence, "results.json"), JSON.stringify(report, null, 2), { mode: 0o600 }); }
const decode = (value) => value.startsWith('"') && value.endsWith('"') ? JSON.parse(value) : value.startsWith("'") && value.endsWith("'") ? value.slice(1, -1) : value;
async function login() {
  const env = {};
  for (const line of (await fs.readFile(path.join(root, ".env"), "utf8")).split(/\r?\n/)) {
    const match = line.match(/^(BOOTSTRAP_ADMIN_USERNAME|BOOTSTRAP_ADMIN_PASSWORD)=(.*)$/);
    if (match) env[match[1]] = decode(match[2]);
  }
  assert(env.BOOTSTRAP_ADMIN_USERNAME && env.BOOTSTRAP_ADMIN_PASSWORD, "Private local login configuration unavailable");
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
const resourceModal = () => page.getByRole("dialog", { name: "编辑资源档案", exact: true });
const editor = () => page.locator(".geometry-workspace").last();
const pointCount = () => editor().locator(".geometry-waypoints > li > button").count();
async function openRoute(route) {
  await page.goto(`${baseUrl}/?view=resources`, { waitUntil: "domcontentloaded" });
  await page.locator(".resource-catalog").getByRole("button", { name: "航线资源", exact: true }).click();
  await page.getByPlaceholder("搜索资源名称、编号或型号").fill(route.title);
  await page.getByRole("row").filter({ has: page.getByText(route.id, { exact: true }) }).click();
  await page.getByRole("dialog").getByRole("button", { name: "编辑档案", exact: true }).click();
  await resourceModal().waitFor({ state: "visible" });
  await editor().locator("canvas").waitFor({ state: "visible" });
  await page.waitForFunction(() => document.querySelectorAll(".drawing-waypoint,.route-elevated-waypoint").length > 0);
}
// Inspect existing React/MapLibre state. No production debug API or fake map/feature is installed.
async function inspect(mode = "projection") {
  return editor().locator(".map-canvas").evaluate((node, mode) => {
    const key = Object.keys(node).find((key) => key.startsWith("__reactFiber$"));
    let fiber = key ? node[key] : undefined, map, drawing, draft;
    for (let depth = 0; fiber && depth < 50; depth++, fiber = fiber.return) {
      if (fiber.memoizedProps?.drawing?.points) drawing = fiber.memoizedProps.drawing;
      if (fiber.memoizedProps?.mode === "ROUTE" && "onContextChange" in fiber.memoizedProps)
        draft = { geometry: typeof fiber.memoizedProps.value === "string" ? JSON.parse(fiber.memoizedProps.value) : fiber.memoizedProps.value, context: fiber.memoizedProps.context };
      let hook = fiber.memoizedState;
      for (let index = 0; hook && index < 100 && !map; index++, hook = hook.next) {
        const value = hook.memoizedState?.current;
        if (value && typeof value.queryRenderedFeatures === "function" && typeof value.project === "function") map = value;
      }
    }
    if (!map) return { available: false };
    if (mode === "selection") return map.getSource("selected-building")?.serialize()?.data || null;
    if (mode === "building") {
      const layers = ["context-buildings-2d", "context-buildings-3d"].filter((id) => map.getLayer(id));
      const features = layers.length ? map.queryRenderedFeatures({ layers }) : [];
      const box = map.getCanvas().getBoundingClientRect();
      for (const feature of features) {
        const polygons = feature.geometry.type === "Polygon" ? [feature.geometry.coordinates] : feature.geometry.type === "MultiPolygon" ? feature.geometry.coordinates : [];
        for (const polygon of polygons) {
          const positions = polygon[0]; if (!positions?.length) continue;
          const center = [(Math.min(...positions.map((p) => p[0])) + Math.max(...positions.map((p) => p[0]))) / 2, (Math.min(...positions.map((p) => p[1])) + Math.max(...positions.map((p) => p[1]))) / 2];
          const pixel = map.project(center);
          if (pixel.x < 40 || pixel.y < 100 || pixel.x > box.width - 40 || pixel.y > box.height - 80) continue;
          if (document.elementFromPoint(box.x + pixel.x, box.y + pixel.y) !== map.getCanvas()) continue;
          const hit = map.queryRenderedFeatures(pixel, { layers })[0]; if (!hit || String(hit.id) !== String(feature.id)) continue;
          return { available: true, features: features.length, geometryType: feature.geometry.type, x: box.x + pixel.x, y: box.y + pixel.y, location: center, outlineBounds: [Math.min(...positions.map((p) => p[0])), Math.min(...positions.map((p) => p[1])), Math.max(...positions.map((p) => p[0])), Math.max(...positions.map((p) => p[1]))] };
        }
      }
      return { available: true, features: features.length, x: null, y: null };
    }
    const canvas = map.getCanvas(), rect = canvas.getBoundingClientRect();
    const customLayers = ["drawing-route-elevated"].filter((id) => map.getLayer(id)).map((id) => {
      const layer = map.getLayer(id); const implementation = layer?.implementation || layer;
      return { id, renderingMode: implementation?.renderingMode, keys: Object.keys(implementation || {}) };
    });
    const layer = map.getLayer("drawing-route-elevated");
    const implementation = layer?.implementation || layer;
    const matrix = implementation?.latestMatrix;
    // Independently reconstruct Mercator XYZ with MapLibre's documented mean earth radius.
    // The application layer's private camera matrix is read only, never replaced.
    const project = (point, altitude) => {
      if (!matrix) return null;
      const x = (180 + point[0]) / 360;
      const y = (180 - 180 / Math.PI * Math.log(Math.tan(Math.PI / 4 + point[1] * Math.PI / 360))) / 360;
      const z = altitude / (2 * Math.PI * 6371008.8 * Math.cos(point[1] * Math.PI / 180));
      const w = matrix[3] * x + matrix[7] * y + matrix[11] * z + matrix[15];
      return { x: ((matrix[0] * x + matrix[4] * y + matrix[8] * z + matrix[12]) / w + 1) * canvas.clientWidth / 2, y: (1 - (matrix[1] * x + matrix[5] * y + matrix[9] * z + matrix[13]) / w) * canvas.clientHeight / 2, worldZ: z };
    };
    const projections = implementation?.drawing?.points?.map((point, index) => {
      const ground = implementation.terrainSamples?.get(point.join(",")) ?? null;
      const height = implementation.drawing.heightMeters?.[index] ?? 100;
      const button = node.parentElement.querySelectorAll(".route-elevated-waypoint")[index];
      return { index, point, terrain: ground, height, air: project(point, (ground ?? 0) + height), ground: project(point, ground ?? 0), foot: project(point, (ground ?? 0) + 0.3), marker: button ? { x: Number(button.dataset.airX), y: Number(button.dataset.airY), groundX: Number(button.dataset.groundX), groundY: Number(button.dataset.groundY), hidden: button.hidden } : null };
    });
    return { available: true, ready: map.isStyleLoaded() && map.areTilesLoaded(), moving: map.isMoving(), camera: { zoom: map.getZoom(), pitch: map.getPitch(), bearing: map.getBearing() }, drawing: drawing ? { mode: drawing.mode, points: drawing.points, heights: drawing.heightMeters, selectedIndex: drawing.selectedIndex } : null, draft, customLayers, projections, rendererReady: !!(implementation?.program && implementation?.buffer && matrix?.length === 16 && implementation?.gl?.isProgram(implementation.program)), canvas: { x: rect.x, y: rect.y, width: rect.width, height: rect.height } };
  }, mode);
}
async function eventually(action, predicate, message, timeout = 12_000) {
  const deadline = Date.now() + timeout; let state;
  do { state = await action(); if (predicate(state)) return state; await page.waitForTimeout(150); } while (Date.now() < deadline);
  assert.fail(`${message}: ${JSON.stringify(state).slice(0, 1500)}`);
}
async function tilesReady() {
  const deadline = Date.now() + 20_000; let state;
  do { state = await inspect(); if (state.ready) { await page.waitForTimeout(250); return; } await page.waitForTimeout(200); } while (Date.now() < deadline);
  report.mapTileLimitations ??= [];
  report.mapTileLimitations.push({ viewport: size, camera: state.camera, reason: "Some real external map tiles remained loading at the 20 second screenshot deadline" });
}
async function canvasClick(fractionX = 0.42, fractionY = 0.61) {
  const box = await editor().locator("canvas").boundingBox(); assert(box);
  await page.mouse.click(box.x + box.width * fractionX, box.y + box.height * fractionY);
}
async function numeric(label, value) {
  const control = editor().getByRole("spinbutton", { name: label, exact: true });
  await control.fill(String(value)); await control.press("Tab");
}
function assertProjected(state, index, expectedHeight) {
  assert(state.rendererReady, "Custom-layer GPU renderer has no linked shader/buffer or camera matrix");
  const point = state.projections?.[index]; assert(point?.air && point?.ground && point?.marker, "No independently projected air/ground point");
  assert.equal(point.height, expectedHeight);
  assert(Math.abs(point.air.x - point.marker.x) < 0.05 && Math.abs(point.air.y - point.marker.y) < 0.05, "Air waypoint is not positioned by the 3D camera matrix");
  assert(Math.abs(point.foot.x - point.marker.groundX) < 0.05 && Math.abs(point.foot.y - point.marker.groundY) < 0.05, "Ground drop does not follow real Mercator ground projection");
  const gap = Math.hypot(point.air.x - point.ground.x, point.air.y - point.ground.y);
  if (expectedHeight === 0) assert(gap < 0.001, "Zero AGL does not coincide with terrain");
  else assert(gap > 0.0001 && point.air.worldZ > point.ground.worldZ, "Non-zero height did not lift route above terrain");
  return { heightMeters: point.height, terrainMeters: point.terrain, pixelGap: gap, air: point.air, ground: point.ground, camera: state.camera };
}
async function projectedAt(index, height) {
  return eventually(() => inspect(), (state) => {
    try { assertProjected(state, index, height); return true; } catch { return false; }
  }, `The rendered frame did not settle at waypoint ${index + 1}, ${height}m AGL`);
}
function taskSnapshot(items) { return items.map(({ id, status, updatedAt, deviceId, pilotId, planId }) => ({ id, status, updatedAt, deviceId, pilotId, planId })); }
try {
  cookie = await login();
  const [routes, tasks] = await Promise.all([catalog("/resources?kind=ROUTE"), catalog("/tasks")]);
  const route = routes.find((item) => item.title === "shiyang-way" && item.metadata?.geometry?.type === "LineString") || routes.find((item) => item.metadata?.geometry?.type === "LineString" && item.metadata.geometry.coordinates.length >= 3);
  assert(route, "A genuine existing route is required");
  const baseline = { routes, tasks: taskSnapshot(tasks) };
  report.realRoute = { id: route.id, title: route.title, points: route.metadata.geometry.coordinates.length, sourceAltitudePoints: route.metadata.geometry.coordinates.filter((point) => point.length > 2).length };
  browser = await chromium.launch({ executablePath: process.env.QA_CHROME_PATH || "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", headless: true, args: ["--disable-dev-shm-usage"] });
  for (const viewport of [{ width: 1920, height: 1080 }, { width: 1280, height: 720 }, { width: 1024, height: 768 }]) {
    size = `${viewport.width}x${viewport.height}`;
    const context = await browser.newContext({ viewport, locale: "zh-CN", timezoneId: "Asia/Shanghai", colorScheme: "dark" });
    await context.addCookies([{ name: "JSESSIONID", value: cookie.slice("JSESSIONID=".length), domain: origin.hostname, path: "/", httpOnly: true, secure: origin.protocol === "https:", sameSite: "Lax" }]);
    await context.route("**/*", async (route) => {
      const request = route.request(), endpoint = new URL(request.url()).pathname;
      if (/\/commands(?:\/|$)/.test(endpoint)) { report.commandRequests.push({ viewport: size, method: request.method(), path: endpoint }); return route.abort("blockedbyclient"); }
      if (!["GET", "HEAD", "OPTIONS"].includes(request.method())) { report.blockedWrites.push({ viewport: size, method: request.method(), path: endpoint }); return route.abort("blockedbyclient"); }
      return route.continue();
    });
    page = await context.newPage(); page.setDefaultTimeout(25_000);
    page.on("pageerror", (error) => report.pageErrors.push({ viewport: size, message: error.message }));
    page.on("console", (message) => { if (message.type() === "error") report.consoleErrors.push({ viewport: size, message: message.text().slice(0, 500) }); });
    page.on("response", (response) => { const url = new URL(response.url()); if (url.origin === origin.origin && url.pathname.startsWith("/api/v1/") && response.status() >= 400) report.failedApiRequests.push({ viewport: size, path: url.pathname, status: response.status() }); });
    await check("Existing real route renders elevated 3D geometry, airborne triangles and ground drops", async () => {
      await openRoute(route);
      await editor().getByRole("button", { name: "全屏编辑", exact: true }).click();
      await page.getByRole("dialog", { name: "航线编辑器", exact: true }).waitFor({ state: "visible" });
      await editor().getByRole("button", { name: "3D", exact: true }).click();
      const state = await eventually(() => inspect(), (state) => state.camera?.pitch > 30 && state.customLayers?.some((layer) => layer.renderingMode === "3d") && state.rendererReady, "No true 3D custom layer");
      assert.equal(await pointCount(), report.realRoute.points);
      assert.deepEqual(state.draft.geometry, route.metadata.geometry, "Opening the height editor changed source geometry/Z");
      const projection = assertProjected(state, 0, route.metadata.geometryContext?.flightProfile?.waypointHeightsMeters?.[0] ?? 100);
      report.projectionEvidence.push({ viewport: size, phase: "initial", ...projection });
      await screenshot("elevated-route-overview");
      await editor().getByRole("button", { name: "选择航点 1", exact: true }).click();
      await eventually(() => inspect(), (state) => state.camera.zoom >= 15.9, "Real source waypoint did not focus at street scale");
      await page.waitForTimeout(600); await tilesReady(); await screenshot("elevated-route");
      return { camera: state.camera, customLayers: state.customLayers, projection };
    });
    await check("Single waypoint 0m coincides with ground; 150m projects above it without changing source Z", async () => {
      await numeric("航点规划高度", 0);
      const zero = await projectedAt(0, 0);
      const zeroProjection = assertProjected(zero, 0, 0);
      assert.deepEqual(zero.draft.geometry, route.metadata.geometry, "Height change replaced source geometry/Z");
      await screenshot("waypoint-ground-zero");
      await numeric("航点规划高度", 150);
      const elevated = await projectedAt(0, 150);
      const elevatedProjection = assertProjected(elevated, 0, 150);
      assert.deepEqual(elevated.draft.geometry, route.metadata.geometry, "Height change replaced source geometry/Z");
      report.projectionEvidence.push({ viewport: size, phase: "zero", ...zeroProjection }, { viewport: size, phase: "150m", ...elevatedProjection });
      await screenshot("waypoint-height-150");
      return { zeroProjection, elevatedProjection, sourceZPreserved: true, saved: false };
    });
    await check("Orbit, pitch and zoom reproject heights instead of using a fixed pixel offset", async () => {
      const before = await inspect(), box = await editor().locator("canvas").boundingBox(); assert(box);
      await page.mouse.move(box.x + box.width * 0.43, box.y + box.height * 0.53);
      await page.mouse.down({ button: "right" });
      await page.mouse.move(box.x + box.width * 0.57, box.y + box.height * 0.63, { steps: 15 });
      await page.mouse.up({ button: "right" });
      await eventually(() => inspect(), (state) => !state.moving && Math.abs(state.camera.bearing - before.camera.bearing) > 5, "Map orbit did not change bearing");
      const rotated = await projectedAt(0, 150);
      assert(Math.abs(rotated.camera.pitch - before.camera.pitch) > 3, "Map pitch did not change");
      const rotatedProjection = assertProjected(rotated, 0, 150);
      await editor().getByRole("button", { name: "放大", exact: true }).click();
      await eventually(() => inspect(), (state) => !state.moving && state.camera.zoom > rotated.camera.zoom + 0.7, "Map zoom did not advance");
      const zoomed = await projectedAt(0, 150);
      const zoomedProjection = assertProjected(zoomed, 0, 150);
      assert(Math.abs(zoomedProjection.pixelGap - rotatedProjection.pixelGap) > 0.5, "Altitude stays a fixed pixel offset after camera zoom");
      report.projectionEvidence.push({ viewport: size, phase: "orbit", ...rotatedProjection }, { viewport: size, phase: "zoom", ...zoomedProjection });
      await screenshot("orbit-zoom-height");
      return { before: before.camera, rotated: rotated.camera, zoomed: zoomed.camera, rotatedGap: rotatedProjection.pixelGap, zoomedGap: zoomedProjection.pixelGap };
    });
    await check("Global planning height applies to all, new points inherit it and deletion retains corresponding heights", async () => {
      await numeric("统一规划高度", 120);
      await editor().getByRole("button", { name: "应用全部", exact: true }).click();
      const before = await pointCount();
      const all = await eventually(() => inspect(), (state) => state.drawing?.heights?.every((height) => height === 120), "Apply all did not update complete profile");
      assert.equal(all.drawing.heights.length, before);
      assert.deepEqual(all.draft.geometry, route.metadata.geometry, "Applying heights changed original geometry/Z");
      await editor().getByRole("button", { name: "全线总览", exact: true }).click();
      await page.waitForTimeout(500);
      await canvasClick(); assert.equal(await pointCount(), before + 1);
      assert.equal(await editor().getByRole("spinbutton", { name: "航点规划高度", exact: true }).inputValue(), "120");
      const added = await projectedAt(before, 120);
      assertProjected(added, before, 120);
      const marker = editor().locator(".route-elevated-waypoint").last(), markerBox = await marker.boundingBox(); assert(markerBox);
      const previousLng = await editor().getByRole("spinbutton", { name: "航点经度", exact: true }).inputValue();
      await page.mouse.move(markerBox.x + markerBox.width / 2, markerBox.y + markerBox.height / 2); await page.mouse.down();
      await page.mouse.move(markerBox.x + markerBox.width / 2 + 25, markerBox.y + markerBox.height / 2 + 15, { steps: 10 }); await page.mouse.up();
      await eventually(() => editor().getByRole("spinbutton", { name: "航点经度", exact: true }).inputValue(), (value) => value !== previousLng, "Elevated marker drag did not move waypoint");
      assert.equal(await pointCount(), before + 1, "Drag added a second waypoint");
      await editor().getByRole("button", { name: `删除航点 ${before + 1}`, exact: true }).click();
      assert.equal(await pointCount(), before);
      const removed = await eventually(() => inspect(), (state) => state.drawing?.heights?.length === before, "Deleted point left stale height");
      assert(removed.drawing.heights.every((height) => height === 120));
      assert.deepEqual(removed.draft.geometry, route.metadata.geometry, "Add/delete or drag modified original source coordinates/Z");
      return { inheritedHeightMeters: 120, elevatedDragVerified: true, sourceZPreserved: true, saved: false };
    });
    await check("2D, 3D, basemap and full-screen return preserve heights, geometry and selected waypoint", async () => {
      await editor().getByRole("button", { name: "选择航点 3", exact: true }).click();
      await numeric("航点规划高度", 150);
      for (const name of ["2D", "3D", "电子图", "影像"]) {
        await editor().getByRole("button", { name, exact: true }).click();
        assert.equal(await editor().getByRole("spinbutton", { name: "航点规划高度", exact: true }).inputValue(), "150");
        if (name === "2D" || name === "3D") {
          const state = await eventually(() => inspect(), (state) => name === "2D" ? state.camera.pitch < 1 && !state.customLayers.some((layer) => layer.id === "drawing-route-elevated") : state.camera.pitch > 30 && state.rendererReady, "Map perspective did not change its actual renderer/camera");
          assert.deepEqual(state.draft.geometry, route.metadata.geometry);
          assert.equal(state.drawing.heights[2], 150);
        }
      }
      await editor().getByRole("button", { name: "完成绘制", exact: true }).click();
      assert.equal(await editor().getByRole("button", { name: "选择航点 3", exact: true }).getAttribute("aria-pressed"), "true");
      assert.equal(await editor().getByRole("spinbutton", { name: "航点规划高度", exact: true }).inputValue(), "150");
      await editor().getByRole("button", { name: "全屏编辑", exact: true }).click();
      await page.getByRole("dialog", { name: "航线编辑器", exact: true }).waitFor({ state: "visible" });
      assert.equal(await editor().getByRole("spinbutton", { name: "航点规划高度", exact: true }).inputValue(), "150");
      return { preservedHeightMeters: 150, preservedSelection: 3, saved: false };
    });
    await check("Real single-building inspection and association remain usable with elevated route", async () => {
      await editor().getByRole("button", { name: "查看楼宇", exact: true }).click();
      await editor().getByRole("button", { name: "选择航点 3", exact: true }).click();
      await eventually(() => inspect(), (state) => state.camera.zoom >= 15.9, "Building-scale camera did not settle");
      await page.waitForTimeout(600); await tilesReady();
      const feature = await eventually(() => inspect("building"), (feature) => typeof feature.x === "number", "No selectable real building was loaded", 20_000);
      const before = await pointCount(); await page.mouse.click(feature.x, feature.y);
      await editor().locator(".geometry-building-detail h4").waitFor({ state: "visible" });
      assert.equal(await pointCount(), before);
      const selected = await inspect("selection"); assert.equal(selected?.features?.length, 1); assert.equal(selected.features[0].geometry.type, "Polygon");
      await editor().getByRole("button", { name: /^关联到航点/ }).click();
      assert(await editor().locator(".geometry-associated").count());
      assert.equal(await editor().getByRole("spinbutton", { name: "航点规划高度", exact: true }).inputValue(), "150");
      const coverage = { viewport: size, features: feature.features, associatedName: await editor().locator(".geometry-building-detail h4").textContent(), saved: false };
      report.buildingCoverage.push(coverage); await screenshot("elevated-route-building");
      await editor().getByRole("button", { name: "完成绘制", exact: true }).click();
      await resourceModal().getByRole("button", { name: "取消", exact: true }).click();
      return coverage;
    });
    if (viewport.width === 1920) {
      // The user requested a reference-style local preview. These are explicitly
      // unsaved planning points on the genuine map, never asserted as source data.
      await openRoute(route);
      await editor().getByRole("button", { name: "全屏编辑", exact: true }).click();
      await page.getByRole("dialog", { name: "航线编辑器", exact: true }).waitFor({ state: "visible" });
      await editor().getByRole("button", { name: "选择航点 3", exact: true }).click();
      await eventually(() => inspect(), (state) => state.camera.zoom >= 15.9, "Preview street-scale camera did not settle");
      await editor().getByRole("button", { name: "放大", exact: true }).click();
      await eventually(() => inspect(), (state) => state.camera.zoom >= 16.9, "Preview zoom did not advance");
      await page.waitForTimeout(500); await tilesReady();
      await editor().getByRole("button", { name: "清空", exact: true }).click();
      assert.equal(await pointCount(), 0);
      await numeric("统一规划高度", 120);
      await editor().getByRole("button", { name: "应用全部", exact: true }).click();
      for (const [x, y] of [[0.22, 0.62], [0.25, 0.80], [0.50, 0.86], [0.73, 0.78], [0.80, 0.58], [0.61, 0.42], [0.38, 0.43]]) await canvasClick(x, y);
      assert.equal(await pointCount(), 7);
      await editor().getByRole("button", { name: "选择航点 4", exact: true }).click();
      // Selecting a point focuses it. Refit is a normal editor action and keeps
      // the entire local preview readable without changing any source geometry.
      await numeric("航点规划高度", 150);
      await editor().getByRole("button", { name: "全线总览", exact: true }).click();
      await page.waitForTimeout(600); await tilesReady();
      const preview = await projectedAt(3, 150);
      assert.equal(preview.drawing.points.length, 7);
      assertProjected(preview, 3, 150);
      await screenshot("user-reference-like");
      report.referencePreview = { localDraft: true, genuineMap: true, saved: false, points: 7, heightMeters: preview.drawing.heights, camera: preview.camera, screenshot: `${size}-user-reference-like.png` };
      await editor().getByRole("button", { name: "完成绘制", exact: true }).click();
      await resourceModal().getByRole("button", { name: "取消", exact: true }).click();
      await persist();
    }
    await context.close();
  }
  size = undefined;
  await check("Original route metadata and source Z, tasks and commands remain unchanged", async () => {
    assert.deepEqual(await catalog("/resources?kind=ROUTE"), baseline.routes);
    assert.deepEqual(taskSnapshot(await catalog("/tasks")), baseline.tasks);
    assert.equal(report.blockedWrites.length, 0); assert.equal(report.commandRequests.length, 0); assert.equal(report.pageErrors.length, 0); assert.equal(report.consoleErrors.length, 0); assert.equal(report.failedApiRequests.length, 0);
    assert.equal(report.referencePreview?.localDraft, true); assert.equal(report.referencePreview.saved, false);
    return { routesUnchanged: routes.length, tasksUnchanged: tasks.length, businessWrites: 0, commands: 0 };
  });
} catch (error) { report.fatal = error.message; console.error(`FATAL ${error.message}`); }
finally { await browser?.close(); await persist(); console.log(`Evidence: ${path.relative(root, evidence)}`); }
console.log(`${report.checks.filter((item) => item.pass).length}/${report.checks.length} checks passed`);
if (report.fatal || report.checks.some((item) => !item.pass)) process.exitCode = 1;
