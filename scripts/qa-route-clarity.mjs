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
const requestedSizes = process.env.QA_VIEWPORTS?.split(',');
const viewports = [{ width: 1920, height: 1080 }, { width: 1280, height: 720 }, { width: 1024, height: 768 }].filter((size) => !requestedSizes || requestedSizes.includes(`${size.width}x${size.height}`));
assert(viewports.length, 'No supported viewport was requested');
const runId = new Date().toISOString().replace(/[:.]/g, "-");
const evidence = path.join(root, ".local", "qa-route-clarity", runId);
await fs.mkdir(evidence, { recursive: true, mode: 0o700 });
const report = { runId, baseUrl, readOnly: true, checks: [], blockedWrites: [], commandRequests: [], pageErrors: [], consoleErrors: [], failedApiRequests: [], projectionEvidence: [], screenshots: [] };
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
async function screenshot(name) { const filename = `${size}-${name}.png`; await page.screenshot({ path: path.join(evidence, filename), fullPage: true }); report.screenshots.push(filename); }
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
// Read real MapLibre/React state only. This suite does not install a mock map,
// modify camera state through JavaScript, or replace an existing source route.
async function inspect() {
  return editor().locator('.map-canvas').evaluate((node) => {
    const key = Object.keys(node).find((key) => key.startsWith('__reactFiber$'));
    let fiber = key ? node[key] : undefined, map, drawing, draft;
    for (let depth = 0; fiber && depth < 50; depth++, fiber = fiber.return) {
      if (fiber.memoizedProps?.drawing?.points) drawing = fiber.memoizedProps.drawing;
      if (fiber.memoizedProps?.mode === 'ROUTE' && 'onContextChange' in fiber.memoizedProps)
        draft = { geometry: typeof fiber.memoizedProps.value === 'string' ? JSON.parse(fiber.memoizedProps.value) : fiber.memoizedProps.value, context: fiber.memoizedProps.context };
      let hook = fiber.memoizedState;
      for (let index = 0; hook && index < 100 && !map; index++, hook = hook.next) {
        const value = hook.memoizedState?.current;
        if (value && typeof value.queryRenderedFeatures === 'function' && typeof value.project === 'function') map = value;
      }
    }
    if (!map) return { available: false };
    const canvas = map.getCanvas(), rect = canvas.getBoundingClientRect();
    const layer = map.getLayer('drawing-route-elevated');
    const implementation = layer?.implementation || layer;
    const matrix = implementation?.latestMatrix;
    const project = (point, altitude) => {
      if (!matrix) return null;
      const x = (180 + point[0]) / 360;
      const y = (180 - 180 / Math.PI * Math.log(Math.tan(Math.PI / 4 + point[1] * Math.PI / 360))) / 360;
      const z = altitude / (2 * Math.PI * 6371008.8 * Math.cos(point[1] * Math.PI / 180));
      const w = matrix[3] * x + matrix[7] * y + matrix[11] * z + matrix[15];
      if (w <= 0) return null;
      return { x: ((matrix[0] * x + matrix[4] * y + matrix[8] * z + matrix[12]) / w + 1) * canvas.clientWidth / 2, y: (1 - (matrix[1] * x + matrix[5] * y + matrix[9] * z + matrix[13]) / w) * canvas.clientHeight / 2, worldZ: z };
    };
    const projections = implementation?.drawing?.points?.map((point, index) => {
      const ground = implementation.terrainSamples?.get(point.join(',')) ?? null;
      const height = implementation.drawing.heightMeters?.[index] ?? 100;
      const button = node.parentElement.querySelectorAll('.route-elevated-waypoint')[index];
      const air = project(point, (ground ?? 0) + height), foot = project(point, (ground ?? 0) + 0.3);
      const label = button?.querySelector('.route-elevated-height');
      const labelBox = label?.getBoundingClientRect();
      const labelOccludedByControls = labelBox ? Array.from(node.parentElement.querySelectorAll('.map-tools button,.map-camera-mode,.geometry-map-instruction')).some((control) => {
        const box = control.getBoundingClientRect();
        return box.width > 0 && box.height > 0 && Math.min(box.right, labelBox.right) > Math.max(box.left, labelBox.left) && Math.min(box.bottom, labelBox.bottom) > Math.max(box.top, labelBox.top);
      }) : false;
      return { index, point, terrain: ground, height, air, foot,
        pixelGap: air && foot ? Math.hypot(air.x - foot.x, air.y - foot.y) : null,
        marker: button ? { x: Number(button.dataset.airX), y: Number(button.dataset.airY), groundX: Number(button.dataset.groundX), groundY: Number(button.dataset.groundY), hidden: button.hidden, label: button.textContent, labelOccludedByControls, heightLabelVisible: Array.from(button.querySelectorAll('.route-elevated-height')).filter((item) => /100\s*m/.test(item.textContent || '')).some((item) => { const style = getComputedStyle(item); return style.display !== 'none' && style.visibility !== 'hidden' && item.getClientRects().length > 0; }) } : null };
    });
    const buildings = ['context-buildings-2d', 'context-buildings-3d'].filter((id) => map.getLayer(id));
    return { available: true, ready: map.isStyleLoaded() && map.areTilesLoaded(), moving: map.isMoving(), camera: { center: map.getCenter().toArray(), zoom: map.getZoom(), pitch: map.getPitch(), bearing: map.getBearing() }, drawing: drawing ? { mode: drawing.mode, points: drawing.points, heights: drawing.heightMeters, selectedIndex: drawing.selectedIndex, showGroundProjection: drawing.showGroundProjection, showCurtain: drawing.showCurtain, showHeightLabels: drawing.showHeightLabels } : null, draft, projections, renderingMode: implementation?.renderingMode, rendererReady: !!(implementation?.program && implementation?.buffer && matrix?.length === 16 && implementation?.gl?.isProgram(implementation.program)), canvas: { x: rect.x, y: rect.y, width: rect.width, height: rect.height }, buildings: buildings.length ? map.queryRenderedFeatures({ layers: buildings }).length : 0 };
  });
}
async function eventually(action, predicate, message, timeout = 15_000) {
  const deadline = Date.now() + timeout; let state;
  do { state = await action(); if (predicate(state)) return state; await page.waitForTimeout(150); } while (Date.now() < deadline);
  assert.fail(`${message}: ${JSON.stringify(state).slice(0, 2200)}`);
}
async function spatialGroup() {
  const disclosure = editor().locator('.geometry-space-aids');
  if (await disclosure.getAttribute('open') === null) await disclosure.locator('summary').click();
  return editor().getByRole('group', { name: '空间辅助', exact: true });
}
async function collapseSpatialGroup() {
  const disclosure = editor().locator('.geometry-space-aids');
  if (await disclosure.getAttribute('open') !== null) await disclosure.locator('summary').click();
}
async function settled() { return eventually(inspect, (state) => state.available && !state.moving && state.camera, 'Camera did not settle'); }
async function tilesReady() {
  const deadline = Date.now() + 20_000; let state;
  do { state = await inspect(); if (state.ready) { await page.waitForTimeout(300); return state; } await page.waitForTimeout(250); } while (Date.now() < deadline);
  report.mapTileLimitations ??= [];
  report.mapTileLimitations.push({ viewport: size, camera: state.camera, reason: 'Some external map tiles were still loading at the 20 second screenshot deadline' });
  return state;
}
function sameCamera(actual, expected, message = 'Unrelated UI action unexpectedly moved the camera') {
  assert(Math.abs(actual.zoom - expected.zoom) < 0.001 && Math.abs(actual.pitch - expected.pitch) < 0.01 && Math.abs(actual.bearing - expected.bearing) < 0.01 && Math.abs(actual.center[0] - expected.center[0]) < 0.000001 && Math.abs(actual.center[1] - expected.center[1]) < 0.000001, message);
}
function preserved(state, route) {
  assert.deepEqual(state.draft.geometry, route.metadata.geometry, 'Existing imported route coordinates or source Z were changed');
  assert.deepEqual(state.drawing.points, route.metadata.geometry.coordinates.map((p) => p.slice(0, 2)), 'Source route points were replaced with a convenient short local draft');
  assert(state.drawing.heights.every((height) => height === 100), '100m AGL was exaggerated to manufacture depth');
}
function clarity(state) {
  assert(state.rendererReady && state.renderingMode === '3d', 'True altitude-aware custom layer is unavailable');
  assert(state.camera.zoom >= 16.5 && state.camera.pitch >= 60, 'Default editor still opens a city-wide flat-looking route overview');
  const visible = state.projections.filter((point) => point.marker && !point.marker.hidden && point.air?.x > 16 && point.air.x < state.canvas.width - 16 && point.air.y > 25 && point.air.y < state.canvas.height - 25 && point.foot?.x > 0 && point.foot.x < state.canvas.width && point.foot.y > 0 && point.foot.y < state.canvas.height);
  assert(visible.length, 'No real source waypoint and its ground foot are simultaneously visible');
  const best = visible.reduce((a, b) => a.pixelGap >= b.pixelGap ? a : b);
  assert(best.pixelGap >= 35, `100m height drop is still visually tiny (${best.pixelGap}px)`);
  assert(best.marker.heightLabelVisible, 'Visible waypoint lacks a readable 100m height label');
  assert(!best.marker.labelOccludedByControls, '100m height label overlaps a map toolbar or camera-mode control');
  assert(Math.abs(best.air.x - best.marker.x) < 0.05 && Math.abs(best.air.y - best.marker.y) < 0.05, 'Air marker does not follow the actual 3D matrix');
  assert(Math.abs(best.foot.x - best.marker.groundX) < 0.05 && Math.abs(best.foot.y - best.marker.groundY) < 0.05, 'Ground foot does not follow the actual 3D matrix');
  return { index: best.index, heightMeters: best.height, pixelGap: best.pixelGap, air: best.air, foot: best.foot, camera: state.camera, terrainMeters: best.terrain, canvas: state.canvas, realBuildingsRendered: state.buildings };
}
function routeLength(coordinates) {
  const rad = (n) => n * Math.PI / 180;
  return coordinates.slice(1).reduce((total, point, index) => {
    const start = coordinates[index], dLat = rad(point[1] - start[1]), dLng = rad(point[0] - start[0]);
    const a = Math.sin(dLat / 2) ** 2 + Math.cos(rad(start[1])) * Math.cos(rad(point[1])) * Math.sin(dLng / 2) ** 2;
    return total + 2 * 6371008.8 * Math.asin(Math.sqrt(a));
  }, 0);
}
function taskSnapshot(items) { return items.map(({ id, status, updatedAt, deviceId, pilotId, planId }) => ({ id, status, updatedAt, deviceId, pilotId, planId })); }
try {
  cookie = await login();
  const [routes, tasks] = await Promise.all([catalog('/resources?kind=ROUTE'), catalog('/tasks')]);
  const route = routes.find((item) => item.title === 'shiyang-way' && item.metadata?.geometry?.type === 'LineString') || routes.filter((item) => item.metadata?.geometry?.type === 'LineString').sort((a, b) => routeLength(b.metadata.geometry.coordinates) - routeLength(a.metadata.geometry.coordinates))[0];
  assert(route, 'Existing genuine source route is required');
  const lengthMeters = routeLength(route.metadata.geometry.coordinates);
  assert(lengthMeters > 10_000, 'Clarity must be accepted on the real long route, not a specially shortened demo');
  const baseline = { routes, tasks: taskSnapshot(tasks) };
  report.realRoute = { id: route.id, title: route.title, points: route.metadata.geometry.coordinates.length, lengthMeters, sourceAltitudePoints: route.metadata.geometry.coordinates.filter((point) => point.length > 2).length };
  browser = await chromium.launch({ executablePath: process.env.QA_CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: true, args: ['--disable-dev-shm-usage'] });
  for (const viewport of viewports) {
    size = `${viewport.width}x${viewport.height}`;
    const context = await browser.newContext({ viewport, locale: 'zh-CN', timezoneId: 'Asia/Shanghai', colorScheme: 'dark' });
    await context.addCookies([{ name: 'JSESSIONID', value: cookie.slice('JSESSIONID='.length), domain: origin.hostname, path: '/', httpOnly: true, secure: origin.protocol === 'https:', sameSite: 'Lax' }]);
    await context.route('**/*', async (route) => {
      const request = route.request(), endpoint = new URL(request.url()).pathname;
      if (/\/commands(?:\/|$)/.test(endpoint)) { report.commandRequests.push({ viewport: size, method: request.method(), path: endpoint }); return route.abort('blockedbyclient'); }
      if (!['GET', 'HEAD', 'OPTIONS'].includes(request.method())) { report.blockedWrites.push({ viewport: size, method: request.method(), path: endpoint }); return route.abort('blockedbyclient'); }
      return route.continue();
    });
    page = await context.newPage(); page.setDefaultTimeout(25_000);
    page.on('pageerror', (error) => report.pageErrors.push({ viewport: size, message: error.message }));
    page.on('console', (message) => { if (message.type() === 'error') report.consoleErrors.push({ viewport: size, message: message.text().slice(0, 500) }); });
    page.on('response', (response) => { const url = new URL(response.url()); if (url.origin === origin.origin && url.pathname.startsWith('/api/v1/') && response.status() >= 400) report.failedApiRequests.push({ viewport: size, path: url.pathname, status: response.status() }); });
    await check('Real 42km source route opens at clear 100m AGL in a local 3D camera without selecting a waypoint', async () => {
      await openRoute(route);
      await eventually(inspect, (state) => state.rendererReady && !state.moving && state.camera.zoom >= 16.5 && state.camera.pitch >= 60, 'Initial real source route did not open with local 3D camera');
      await tilesReady();
      const state = await settled(); preserved(state, route);
      assert.equal(await pointCount(), report.realRoute.points);
      const projection = clarity(state); report.projectionEvidence.push({ viewport: size, phase: 'initial-embedded', ...projection });
      await screenshot('real-source-initial-embedded');
      return projection;
    });
    await check('Fullscreen initial view remains legible with genuine long source route and default 100m', async () => {
      await editor().getByRole('button', { name: '全屏编辑', exact: true }).click();
      await page.getByRole('dialog', { name: '航线编辑器', exact: true }).waitFor({ state: 'visible' });
      await eventually(inspect, (state) => state.rendererReady && !state.moving && state.camera.zoom >= 16.5 && state.camera.pitch >= 60, 'Fullscreen real route lost local depth view');
      await tilesReady();
      const state = await settled(); preserved(state, route);
      const projection = clarity(state); report.projectionEvidence.push({ viewport: size, phase: 'initial-fullscreen', ...projection });
      assert(state.canvas.width > viewport.width * 0.6 && state.canvas.height > viewport.height * 0.6, 'Fullscreen drawing area is too small');
      assert.equal(await editor().locator('.geometry-space-aids').getAttribute('open'), null, 'Spatial aids should start collapsed in the side panel');
      const controls = editor().locator('.geometry-space-aids button');
      assert.equal(await controls.count(), 3);
      for (const button of await controls.all()) assert.equal(await button.getAttribute('aria-pressed'), 'true');
      await screenshot('real-source-initial-fullscreen');
      return projection;
    });
    await check('Whole-route overview and local 3D close-up are distinct reversible actions without data changes', async () => {
      await editor().getByRole('button', { name: '全线总览', exact: true }).click();
      const overview = await eventually(inspect, (state) => !state.moving && state.camera.zoom < 14, 'Whole-route overview did not frame the genuine long route');
      preserved(overview, route); await screenshot('real-source-full-overview');
      const pointsInView = overview.projections.filter((point) => point.marker && !point.marker.hidden).length;
      assert.equal(pointsInView, report.realRoute.points, 'Whole-route overview hides real source waypoints');
      await editor().getByRole('button', { name: '立体近览', exact: true }).click();
      await eventually(inspect, (state) => !state.moving && state.camera.zoom >= 16.5 && state.camera.pitch >= 60, 'Close-up did not return to a clear local 3D view');
      await tilesReady(); const close = await settled(); preserved(close, route); const projection = clarity(close);
      assert(projection.pixelGap > Math.max(...overview.projections.map((point) => point.pixelGap || 0)) * 2, 'Close-up did not materially improve physical altitude separation');
      report.projectionEvidence.push({ viewport: size, phase: 'close-up-after-overview', ...projection });
      await screenshot('real-source-close-up');
      return { overviewCamera: overview.camera, closeCamera: close.camera, pointsInView, projection };
    });
    await check('Ground projection, curtain and height labels toggle independently without moving the camera or changing the route', async () => {
      const before = await settled(), group = await spatialGroup();
      const fields = { 地面投影: 'showGroundProjection', 高度幕帘: 'showCurtain', 高度标注: 'showHeightLabels' };
      for (const [label, field] of Object.entries(fields)) {
        const button = group.getByRole('button', { name: label, exact: true }); await button.click();
        assert.equal(await button.getAttribute('aria-pressed'), 'false');
        const off = await eventually(inspect, (state) => state.drawing[field] === false, `Disabled ${label} did not reach renderer`);
        sameCamera(off.camera, before.camera); preserved(off, route);
        if (field === 'showHeightLabels') assert(off.projections.filter((point) => point.marker && !point.marker.hidden).every((point) => !point.marker.heightLabelVisible), 'Hidden height labels remain visually shown');
        await button.click(); const on = await eventually(inspect, (state) => state.drawing[field] === true, `Enabled ${label} did not reach renderer`);
        sameCamera(on.camera, before.camera); preserved(on, route);
      }
      await collapseSpatialGroup(); const state = await settled(); clarity(state); await screenshot('real-source-spatial-aids');
      return { cameraUnchanged: true, defaultHeightMeters: 100, sourceGeometryPreserved: true };
    });
    await check('Pan, orbit, zoom and marker selection stay under user control and reproject physical height', async () => {
      const before = await settled(), canvas = before.canvas;
      const x = canvas.x + canvas.width * 0.5, y = canvas.y + canvas.height * 0.5;
      await page.mouse.move(x, y); await page.mouse.down({ button: 'right' });
      await page.mouse.move(x + canvas.width * 0.065, y + 5, { steps: 14 }); await page.mouse.up({ button: 'right' });
      const rotated = await eventually(inspect, (state) => !state.moving && Math.abs(state.camera.bearing - before.camera.bearing) > 5, 'Map orbit did not rotate the 3D scene');
      const panPoint = await editor().locator('canvas').evaluate((canvas) => {
        const box = canvas.getBoundingClientRect();
        for (const [x, y] of [[0.3, 0.55], [0.7, 0.55], [0.4, 0.7]]) {
          const point = { x: box.x + box.width * x, y: box.y + box.height * y };
          if (document.elementFromPoint(point.x, point.y) === canvas) return point;
        }
        return null;
      });
      assert(panPoint, 'No free map area is available for real user panning');
      await page.mouse.move(panPoint.x, panPoint.y); await page.mouse.down();
      await page.mouse.move(panPoint.x + 25, panPoint.y + 10, { steps: 10 }); await page.mouse.up();
      const panned = await eventually(inspect, (state) => !state.moving && Math.abs(state.camera.center[0] - rotated.camera.center[0]) + Math.abs(state.camera.center[1] - rotated.camera.center[1]) > 0.000001, 'Real user pan did not move camera');
      preserved(panned, route);
      await editor().getByRole('button', { name: '缩小', exact: true }).click();
      const zoomed = await eventually(inspect, (state) => !state.moving && state.camera.zoom < panned.camera.zoom - 0.8, 'Map zoom did not change');
      const visible = zoomed.projections.find((point) => point.marker && !point.marker.hidden && point.air.x > 50 && point.air.x < zoomed.canvas.width - 120 && point.air.y > 100 && point.air.y < zoomed.canvas.height - 80);
      assert(visible, 'No real waypoint is reachable for selection after camera orbit');
      const button = editor().locator('.route-elevated-waypoint').nth(visible.index);
      await button.click(); await page.waitForTimeout(300);
      const selected = await settled(); sameCamera(selected.camera, zoomed.camera, 'Selecting an airborne marker unexpectedly reframed the map'); preserved(selected, route);
      assert.equal(selected.drawing.selectedIndex, visible.index);
      const buttonHeight = editor().getByRole('spinbutton', { name: '航点规划高度', exact: true });
      assert.equal(await buttonHeight.inputValue(), '100');
      const group = await spatialGroup();
      await group.getByRole('button', { name: '高度幕帘', exact: true }).click();
      await page.waitForTimeout(500); const after = await settled(); sameCamera(after.camera, selected.camera, 'UI re-render unexpectedly undid the user camera');
      await group.getByRole('button', { name: '高度幕帘', exact: true }).click();
      await collapseSpatialGroup();
      const initialPoint = before.projections[visible.index], updatedPoint = selected.projections[visible.index];
      assert(Math.abs(updatedPoint.pixelGap - initialPoint.pixelGap) > 1, 'Altitude is a fixed pixel offset instead of a real camera projection');
      await screenshot('real-source-user-camera-preserved');
      return { before: before.camera, after: selected.camera, selected: visible.index, initialPixelGap: initialPoint.pixelGap, finalPixelGap: updatedPoint.pixelGap, sameDefaultHeight: 100 };
    });
    await check('2D/3D and fullscreen return preserve planning height, source geometry and selection', async () => {
      const before = await settled();
      await editor().getByRole('button', { name: '2D', exact: true }).click();
      const flat = await eventually(inspect, (state) => !state.moving && state.camera.pitch < 1 && !state.rendererReady, '2D did not switch to ground rendering');
      preserved(flat, route);
      await editor().getByRole('button', { name: '3D', exact: true }).click();
      const elevated = await eventually(inspect, (state) => !state.moving && state.camera.pitch >= 60 && state.rendererReady, '3D did not restore physical altitude rendering');
      preserved(elevated, route); assert.equal(elevated.drawing.selectedIndex, before.drawing.selectedIndex);
      await editor().getByRole('button', { name: '完成绘制', exact: true }).click();
      const embedded = await eventually(inspect, (state) => !state.moving && state.rendererReady, 'Returning from fullscreen did not render');
      preserved(embedded, route); assert.equal(embedded.drawing.selectedIndex, before.drawing.selectedIndex);
      await resourceModal().getByRole('button', { name: '取消', exact: true }).click();
      return { selectedWaypoint: before.drawing.selectedIndex, defaultHeightMeters: 100, saved: false };
    });
    await context.close();
  }
  size = undefined;
  await check('Original source routes, task business data and commands remain unchanged', async () => {
    assert.deepEqual(await catalog('/resources?kind=ROUTE'), baseline.routes);
    assert.deepEqual(taskSnapshot(await catalog('/tasks')), baseline.tasks);
    assert.equal(report.blockedWrites.length, 0); assert.equal(report.commandRequests.length, 0); assert.equal(report.pageErrors.length, 0); assert.equal(report.consoleErrors.length, 0); assert.equal(report.failedApiRequests.length, 0);
    return { routesUnchanged: routes.length, tasksUnchanged: tasks.length, businessWrites: 0, commands: 0, noShortDraftSubstitution: true };
  });
} catch (error) { report.fatal = error.message; console.error(`FATAL ${error.message}`); }
finally { await browser?.close(); await persist(); console.log(`Evidence: ${path.relative(root, evidence)}`); }
console.log(`${report.checks.filter((item) => item.pass).length}/${report.checks.length} checks passed`);
if (report.fatal || report.checks.some((item) => !item.pass)) process.exitCode = 1;
