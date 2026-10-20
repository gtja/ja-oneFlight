import { chooseSelect } from "../../scripts/lib/select-ui.mjs";
import { test, expect, type Page, type Locator } from "@playwright/test";
import { promises as fs } from "node:fs";
import path from "node:path";
import { login } from "./fixtures";
import {
  assertVisibleBoard,
  feedbackDevices,
  feedbackHistoryCount,
  installCommandBoardFixtures,
  installFeedbackFixtures,
} from "./feedback-fixtures";

type Device = {
  id: string;
  name: string;
  sn?: string | null;
  type?: string;
  flightTotals: {
    sorties: number | null;
    timeSeconds: number | null;
    distanceMeters: number | null;
  } | null;
};
type Result<T> = { items: T[]; total: number; page: number; pageSize: number };
const live = process.env.QA_LIVE_READONLY === "true";
const sizes = [
  { width: 1920, height: 1080 },
  { width: 2560, height: 1440 },
  { width: 1366, height: 768 },
  { width: 1024, height: 768 },
];
const origins = [
  { route: "resources", title: "资源管理" },
  { route: "services", title: "飞行服务" },
  { route: "flight", title: "飞行管控" },
];
const errors = new WeakMap<Page, string[]>();
const writes = new WeakMap<Page, string[]>();

async function get<T>(page: Page, endpoint: string): Promise<T> {
  const response = await page.request.get(`/api/v1${endpoint}`);
  expect(
    response.status(),
    `Read-only API ${endpoint.split("?")[0]} must succeed`,
  ).toBe(200);
  const body = await response.json();
  expect(body.code).toBe("OK");
  return body.data as T;
}

test("大屏完整目录、北京时间任务图表及区域联动", async ({ page }) => {
  test.skip(live, "固定分页及跨日样例仅用于隔离 QA 数据源");
  await installCommandBoardFixtures(page);
  await page.clock.setFixedTime(new Date("2026-10-16T02:00:00Z"));
  const catalogPages = new Set<string>();
  page.on("request", (request) => {
    const url = new URL(request.url());
    if (/\/api\/v1\/(tasks|plans|cases)$/.test(url.pathname))
      catalogPages.add(
        `${url.pathname.split("/").pop()}:${url.searchParams.get("page")}`,
      );
  });
  await page.goto("/?view=resources");
  await page.getByRole("button", { name: "指挥大屏", exact: true }).click();
  await assertVisibleBoard(page);
  const board = page.locator(".command-board");
  const current = board.locator(".command-current strong");
  const totals = board.locator(".command-kpi > strong");
  const health = board.locator(".command-health");
  const taskPanel = board.locator(".command-task-panel");
  const hourly = board.getByRole("group", {
    name: "今日任务按计划开始时间分布",
    exact: true,
  });
  const regional = board.getByRole("group", {
    name: "今日计划任务区域分布",
    exact: true,
  });
  await expect(current).toHaveText("2");
  await expect(totals.nth(0)).toHaveText("205架次");
  await expect(totals.nth(1)).toHaveText("20.5小时");
  await expect(totals.nth(2)).toHaveText("205公里");
  await expect(health.getByRole("button", { name: /未结线索/ })).toContainText(
    "2",
  );
  await expect(health.getByRole("button", { name: /待审计划/ })).toContainText(
    "2",
  );
  await expect(
    taskPanel.getByRole("button", { name: /飞行计划/ }),
  ).toContainText("103");
  await expect(taskPanel.getByRole("button", { name: /已完成/ })).toContainText(
    "105",
  );
  await expect(hourly.locator("circle title")).toHaveText(
    Array.from(
      { length: 24 },
      (_, hour) =>
        `${String(hour).padStart(2, "0")}:00 · ${hour === 0 || hour === 16 ? 1 : hour === 8 ? 2 : 0} 项任务`,
    ),
  );
  await expect(regional.locator("rect title")).toHaveText([
    "上城区 · 1 项任务",
    "拱墅区 · 0 项任务",
    "西湖区 · 2 项任务",
    "余杭区 · 0 项任务",
    "萧山区 · 0 项任务",
    "其他/未分区 · 1 项任务",
  ]);
  await expect(
    board.locator(".map-marker:not(.map-geometry-marker)"),
  ).toHaveCount(3);
  for (const endpoint of ["tasks", "plans", "cases"])
    expect(
      catalogPages.has(`${endpoint}:2`),
      `${endpoint} must include the second catalog page`,
    ).toBe(true);

  await chooseSelect(
    board.getByRole("combobox", { name: "指挥区域", exact: true }),
    "西湖区",
  );
  await expect(current).toHaveText("1");
  await expect(
    board.locator(".command-resource-grid button").first(),
  ).toContainText("1架");
  await expect(health.getByRole("button", { name: /未结线索/ })).toContainText(
    "1",
  );
  await expect(health.getByRole("button", { name: /待审计划/ })).toContainText(
    "1",
  );
  await expect(
    taskPanel.getByRole("button", { name: /飞行计划/ }),
  ).toContainText("102");
  await expect(regional.locator("rect title")).toHaveText([
    "西湖区 · 2 项任务",
  ]);
  await expect(hourly.locator("circle title").nth(0)).toHaveText(
    "00:00 · 1 项任务",
  );
  await expect(hourly.locator("circle title").nth(8)).toHaveText(
    "08:00 · 1 项任务",
  );
  await expect(
    board.locator(".map-marker:not(.map-geometry-marker)"),
  ).toHaveCount(2);
  await expect(
    board.locator(".map-marker[aria-label='运河巡查 02 号飞机']"),
  ).toHaveCount(0);

  await chooseSelect(
    board.getByRole("combobox", { name: "指挥区域", exact: true }),
    "上城区",
  );
  await expect(current).toHaveText("1");
  await expect(totals.nth(0)).toContainText(/未知|—/);
  await expect(regional.locator("rect title")).toHaveText([
    "上城区 · 1 项任务",
  ]);
  await expect(
    board.locator(".map-marker:not(.map-geometry-marker)"),
  ).toHaveCount(1);
  await expect(
    board.locator(".map-marker[aria-label='运河巡查 02 号飞机']"),
  ).toBeAttached();
  await expect(board.locator(".command-airspaces")).toContainText(
    "当前区域暂无空域资源",
  );
  await screenshot(page, "command-region-filter");
});

test("大屏图表交互、明细与 Esc 层级", async ({ page }) => {
  test.skip(live, "使用隔离 QA 数据核对图表明细");
  await installCommandBoardFixtures(page);
  await page.clock.setFixedTime(new Date("2026-10-16T02:00:00Z"));
  await page.goto("/?view=resources");
  await page.getByRole("button", { name: "指挥大屏", exact: true }).click();
  await assertVisibleBoard(page);
  const hourly = page.getByRole("group", {
    name: "今日任务按计划开始时间分布",
    exact: true,
  });
  const regional = page.getByRole("group", {
    name: "今日计划任务区域分布",
    exact: true,
  });
  const eight = hourly.getByRole("button", { name: /^08:00/ });
  await eight.hover();
  await expect(page.getByRole("tooltip")).toContainText("08:00–08:59");
  await expect(page.getByRole("tooltip")).toContainText("2");
  await screenshot(page, "command-chart-hover");
  await eight.click();
  const hours = page.getByRole("dialog", { name: "任务时段明细", exact: true });
  await expect(hours.getByRole("listitem")).toHaveCount(2);
  await expect(hours).toContainText("上城清晨巡查");
  await expect(hours).toContainText("西湖清晨巡查");
  await expect(hours).not.toContainText("取消巡查");
  await screenshot(page, "command-chart-tasks");
  await page.keyboard.press("Escape");
  await expect(hours).toBeHidden();
  await expect(page.locator(".app-shell.board")).toBeVisible();
  await expect(eight).toBeFocused();
  await hourly.getByRole("button", { name: /^01:00/ }).click();
  await expect(hours.getByRole("status")).toContainText("当前范围暂无任务");
  await page.keyboard.press("Escape");
  const west = regional.getByRole("button", { name: /^西湖区/ });
  await west.focus();
  await page.keyboard.press("Enter");
  const regions = page.getByRole("dialog", {
    name: "区域任务明细",
    exact: true,
  });
  await expect(regions.getByRole("listitem")).toHaveCount(2);
  await expect(regions).toContainText("西湖跨日巡查");
  await expect(regions).not.toContainText("上城清晨巡查");
  await page.keyboard.press("Escape");
  await regional.getByRole("button", { name: /^拱墅区/ }).focus();
  await page.keyboard.press("Space");
  await expect(regions.getByRole("status")).toContainText("当前范围暂无任务");
  await page.keyboard.press("Escape");
  await regional.getByRole("button", { name: /^其他\/未分区/ }).click();
  await expect(regions.getByRole("listitem")).toHaveCount(1);
  await expect(regions).toContainText("区域待定巡查");
  await regions.getByRole("button", { name: /区域待定巡查/ }).click();
  await expect(page).toHaveURL(/view=dispatch.*taskId=qa-command-unscoped/);
});

test("大屏卡片联动、对象定位和数据保障", async ({ page }) => {
  test.skip(live, "隔离目录验证对应卡片范围");
  await installCommandBoardFixtures(page);
  await page.clock.setFixedTime(new Date("2026-10-16T02:00:00Z"));
  await page.goto("/?view=resources");
  await page.getByRole("button", { name: "指挥大屏", exact: true }).click();
  await assertVisibleBoard(page);
  const board = page.locator(".command-board");
  await board
    .locator(".command-resource-grid")
    .getByRole("button", { name: /航空器/ })
    .click();
  const aircraft = page.getByRole("dialog", {
    name: "航空器明细",
    exact: true,
  });
  await expect(aircraft.getByRole("listitem")).toHaveCount(2);
  await aircraft.getByRole("button", { name: /西湖巡查 01 号飞机/ }).click();
  const inspector = board.getByRole("region", {
    name: "地图对象详情",
    exact: true,
  });
  await expect(inspector).toContainText("西湖巡查 01 号飞机");
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(board.locator(".map-marker.selected")).toHaveAttribute(
    "data-entity-id",
    "qa-aircraft-001",
  );
  await inspector.getByRole("button", { name: "定位", exact: true }).click();
  await screenshot(page, "command-object-inspector");
  await page.keyboard.press("Escape");
  await expect(inspector).toBeHidden();
  await expect(page.locator(".app-shell.board")).toBeVisible();
  await board.locator(".command-airspace-item").click();
  await expect(inspector).toContainText("西湖重点保障空域");
  await expect(board.locator(".map-geometry-marker.selected")).toHaveCount(1);
  await expect(board.locator(".map-geometry-marker.selected")).toBeInViewport();
  await screenshot(page, "command-airspace-focus");
  await board.getByRole("button", { name: "空域与航线", exact: true }).click();
  await expect(inspector).toBeHidden();
  await expect(board.locator(".map-geometry-marker")).toHaveCount(0);
  await board.getByRole("button", { name: "空域与航线", exact: true }).click();
  await expect(board.locator(".map-geometry-marker")).toHaveCount(2);
  await board
    .locator(".command-health")
    .getByRole("button", { name: /未结线索/ })
    .click();
  const cases = page.getByRole("dialog", { name: "未结线索明细", exact: true });
  await expect(cases.getByRole("listitem")).toHaveCount(2);
  await cases.getByRole("button", { name: /西湖待核查目标/ }).click();
  await expect(
    page.getByRole("dialog", { name: "西湖待核查目标", exact: true }),
  ).toBeVisible();
  await page.keyboard.press("Escape");
  await board.locator(".command-kpi").nth(1).click();
  const totals = page.getByRole("dialog", {
    name: "累计飞行时长明细",
    exact: true,
  });
  await expect(totals.getByRole("listitem")).toHaveCount(1);
  await expect(totals).toContainText("20.5 小时");
  await page.keyboard.press("Escape");
  await board.locator("button.command-feed").first().click();
  const feeds = page.getByRole("dialog", { name: "数据同步状态", exact: true });
  await expect(feeds.locator(".command-feed-row")).toHaveCount(5);
  await feeds.getByRole("button", { name: "立即刷新", exact: true }).click();
  await expect(feeds.getByRole("status")).toContainText(
    "当前授权范围的数据已刷新",
  );
  await page.keyboard.press("Escape");
  await expect(page.locator(".app-shell.board")).toBeVisible();
  await board
    .locator(".command-task-grid")
    .getByRole("button", { name: /飞行计划/ })
    .click();
  const plans = page.getByRole("dialog", { name: "飞行计划明细", exact: true });
  await expect(plans.getByRole("listitem")).toHaveCount(103);
  await plans.getByPlaceholder("搜索名称、区域或状态").fill("已通过计划 100");
  await expect(plans.getByRole("listitem")).toHaveCount(1);
  await page.keyboard.press("Escape");
});

for (const size of [
  { width: 2560, height: 1195 },
  { width: 1366, height: 768 },
  { width: 1024, height: 768 },
]) {
  test(`大屏地图详情避让 ${size.width}×${size.height}`, async ({ page }) => {
    test.skip(live, "隔离地图对象验证详情面板布局");
    await installCommandBoardFixtures(page);
    await page.setViewportSize(size);
    await page.goto("/?view=resources");
    await page.getByRole("button", { name: "指挥大屏", exact: true }).click();
    await assertVisibleBoard(page);
    await page.locator(".command-airspace-item").click();
    const inspector = page.getByRole("region", {
      name: "地图对象详情",
      exact: true,
    });
    await expect(inspector).toBeVisible();
    const rects = await page.evaluate(() => {
      const rect = (selector: string) => {
        const b = document.querySelector(selector)!.getBoundingClientRect();
        return {
          x: b.x,
          y: b.y,
          right: b.right,
          bottom: b.bottom,
          height: b.height,
          width: b.width,
        };
      };
      return {
        inspector: rect(".command-map-inspector"),
        tools: rect(".flight-sim-controls"),
        charts: rect(".command-bottom-charts"),
        left: rect(".command-left"),
        right: rect(".command-right"),
      };
    });
    expect(rects.inspector.y).toBeGreaterThanOrEqual(rects.tools.bottom);
    expect(rects.inspector.x).toBeGreaterThanOrEqual(rects.left.right);
    expect(rects.inspector.right).toBeLessThanOrEqual(rects.right.x);
    expect(rects.inspector.bottom).toBeLessThan(rects.charts.y);
    await expect(
      inspector.getByRole("button", { name: "定位", exact: true }),
    ).toBeVisible();
    await screenshot(page, `command-inspector-layout-${size.width}`);
    await page.keyboard.press("Escape");
    await expect(page.locator(".app-shell.board")).toBeVisible();
  });
}

test("大屏上报点驱动轨迹、飞行控制与图层生命周期", async ({ page }) => {
  if (!live) await installCommandBoardFixtures(page);
  await page.goto("/?view=resources");
  await page.getByRole("button", { name: "指挥大屏", exact: true }).click();
  await assertVisibleBoard(page);
  const simulation = page.getByTestId("flight-simulation");
  const overlay = page.locator(".flight-simulation-overlay");
  const aircraft = page.locator(".flight-simulation-aircraft");
  await expect(simulation).toHaveAttribute("data-enabled", "true");
  await expect(simulation).toHaveAttribute("data-source", "demo");
  await expect(overlay).toHaveAttribute("data-layer-ready", "true");
  await expect(aircraft).toHaveCount(4);
  await expect(
    page.getByRole("button", { name: "选择巡查 01", exact: true }),
  ).toHaveAttribute("data-kind", "multirotor");
  await expect(
    page.locator(".flight-simulation-aircraft[data-kind='multirotor']"),
  ).toHaveCount(2);
  await expect(
    page.locator(".flight-simulation-aircraft[data-kind='fixed-wing']"),
  ).toHaveCount(2);
  const telemetry = () =>
    aircraft.evaluateAll((elements) =>
      elements.map((element) => {
        const data = (element as HTMLElement).dataset;
        return {
          id: data.aircraftId,
          altitude: Number(data.altitude),
          lng: Number(data.lng),
          lat: Number(data.lat),
          phase: Number(data.phase),
          separation: Math.hypot(
            Number(data.airX) - Number(data.groundX),
            Number(data.airY) - Number(data.groundY),
          ),
        };
      }),
    );
  const reports = () =>
    aircraft.evaluateAll((elements) =>
      elements.map((element) => {
        const data = (element as HTMLElement).dataset;
        return {
          id: data.aircraftId,
          count: Number(data.reportCount),
          firstAt: Number(data.firstReportAt),
          latestAt: Number(data.lastReportAt),
          renderedAt: Number(data.renderedAt),
          previousAt: Number(data.previousReportAt),
          previous: [
            Number(data.previousReportLng),
            Number(data.previousReportLat),
            Number(data.previousReportAltitude),
          ],
          latest: [
            Number(data.lastReportLng),
            Number(data.lastReportLat),
            Number(data.lastReportAltitude),
          ],
          rendered: [Number(data.lng), Number(data.lat), Number(data.altitude)],
        };
      }),
    );
  const assertNoExtrapolation = (
    snapshot: Awaited<ReturnType<typeof reports>>,
  ) => {
    for (const track of snapshot) {
      expect(
        track.renderedAt,
        `${track.id} cannot advance beyond its latest report`,
      ).toBeLessThanOrEqual(track.latestAt + 0.001);
      expect(track.renderedAt).toBeGreaterThanOrEqual(track.previousAt - 0.001);
      track.rendered.forEach((coordinate, index) => {
        const tolerance = index === 2 ? 0.01 : 0.0000001;
        expect(
          coordinate,
          `${track.id} interpolates only between received observations`,
        ).toBeGreaterThanOrEqual(
          Math.min(track.previous[index], track.latest[index]) - tolerance,
        );
        expect(coordinate).toBeLessThanOrEqual(
          Math.max(track.previous[index], track.latest[index]) + tolerance,
        );
      });
    }
  };
  const poses = async () =>
    (await telemetry()).map(({ id, lng, lat, altitude, phase }) => ({
      id,
      lng,
      lat,
      altitude,
      phase,
    }));
  await expect
    .poll(async () =>
      (await telemetry()).every(
        (item) =>
          item.altitude >= 120 && item.altitude <= 420 && item.separation > 10,
      ),
    )
    .toBe(true);
  await test.info().attach("flight-height-and-projection", {
    body: Buffer.from(JSON.stringify(await telemetry())),
    contentType: "application/json",
  });
  const firstReports = await reports();
  firstReports.forEach((track) => {
    expect(track.count).toBeGreaterThan(1);
    expect(
      track.latestAt - track.firstAt,
      "demo source reports once per second",
    ).toBe((track.count - 1) * 1000);
  });
  await expect
    .poll(async () =>
      (await reports()).every(
        (track, index) => track.count >= firstReports[index].count + 2,
      ),
    )
    .toBe(true);
  const advancing = await reports();
  advancing.forEach((track, index) => {
    expect(
      track.firstAt,
      "appending reports retains the existing history",
    ).toBe(firstReports[index].firstAt);
    expect(track.latestAt - firstReports[index].latestAt).toBe(
      (track.count - firstReports[index].count) * 1000,
    );
  });
  assertNoExtrapolation(advancing);
  // The source supplies recent past observations initially; keep running until the
  // oldest retained point is over 30 seconds old to catch the previous tail window.
  await expect
    .poll(
      async () =>
        (await reports()).every(
          (track) => track.latestAt - track.firstAt > 31_000,
        ),
      { timeout: 20_000 },
    )
    .toBe(true);
  const retained = await reports();
  retained.forEach((track, index) =>
    expect(track.firstAt, "history older than 30 seconds must remain").toBe(
      firstReports[index].firstAt,
    ),
  );
  assertNoExtrapolation(retained);
  await test.info().attach("reported-flight-history", {
    body: Buffer.from(JSON.stringify({ initial: firstReports, retained })),
    contentType: "application/json",
  });
  await simulation
    .getByRole("button", { name: "暂停飞行", exact: true })
    .click();
  await expect(simulation).toHaveAttribute("data-paused", "true");
  await page.waitForTimeout(100);
  const paused = await poses();
  const pausedReports = await reports();
  await page.waitForTimeout(1200);
  expect(await poses()).toEqual(paused);
  expect(await reports()).toEqual(pausedReports);
  await simulation
    .getByRole("button", { name: "继续飞行", exact: true })
    .click();
  await expect
    .poll(async () => (await reports())[0].count)
    .toBeGreaterThan(pausedReports[0].count);
  assertNoExtrapolation(await reports());

  await simulation
    .getByRole("button", { name: "暂停飞行", exact: true })
    .click();
  await aircraft.first().click();
  await expect(aircraft.first()).toHaveAttribute("aria-pressed", "true");
  await chooseSelect(
    simulation.getByRole("combobox", { name: "选择航空器", exact: true }),
    "cargo-03",
  );
  await simulation.getByRole("button", { name: /^跟随/ }).click();
  await expect(simulation).toHaveAttribute("data-following", "cargo-03");
  const canvas = page.locator(".command-board-map .maplibregl-canvas");
  const box = (await canvas.boundingBox())!;
  await page.mouse.move(box.x + box.width * 0.5, box.y + box.height * 0.52);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width * 0.55, box.y + box.height * 0.57, {
    steps: 8,
  });
  await page.mouse.up();
  await expect(simulation).toHaveAttribute("data-following", "");

  const beforeStyle = await reports();
  const pausedSeconds = await simulation.getAttribute("data-seconds");
  await page
    .locator(".map-tools")
    .getByRole("button", { name: "电子图", exact: true })
    .click();
  await expect(overlay).toHaveAttribute("data-layer-ready", "true");
  await expect(aircraft).toHaveCount(4);
  await expect(simulation).toHaveAttribute("data-paused", "true");
  await expect(simulation).toHaveAttribute("data-seconds", pausedSeconds!);
  await expect
    .poll(reports, {
      message:
        "style changes preserve all reported history and the frozen position",
    })
    .toEqual(beforeStyle);
  await simulation.getByRole("button", { name: /^跟随/ }).click();
  await page
    .locator(".map-tools")
    .getByRole("button", { name: "2D", exact: true })
    .click();
  await expect(simulation).toHaveAttribute("data-following", "");
  await expect(aircraft).toHaveCount(4);
  await simulation
    .getByRole("button", { name: "飞行近览", exact: true })
    .click();
  await expect(
    page.locator(".map-tools").getByRole("button", { name: "3D", exact: true }),
  ).toHaveAttribute("aria-pressed", "true");
  await simulation
    .getByRole("button", { name: "全市总览", exact: true })
    .click();
  await expect(simulation).toHaveAttribute("data-following", "");
  await expect(aircraft).toHaveCount(4);
  await simulation
    .getByRole("button", { name: "关闭飞行", exact: true })
    .click();
  await expect(simulation).toHaveAttribute("data-enabled", "false");
  await expect(aircraft).toHaveCount(0);
  await expect(overlay).toHaveCount(0);
  await simulation
    .getByRole("button", { name: "开启飞行", exact: true })
    .click();
  await expect(simulation).toHaveAttribute("data-enabled", "true");
  await expect(overlay).toHaveAttribute("data-layer-ready", "true");
  await expect(aircraft).toHaveCount(4);
  await expect(simulation).toHaveAttribute("data-paused", "false");
  await expect
    .poll(async () => Number(await simulation.getAttribute("data-seconds")))
    .toBeLessThan(3);
  await screenshot(page, "command-3d-flight");
  await page.getByRole("button", { name: "返回工作台", exact: true }).click();
  await expect(simulation).toHaveCount(0);
  await expect(page.locator(".flight-simulation-aircraft")).toHaveCount(0);
  await page.getByRole("button", { name: "指挥大屏", exact: true }).click();
  await expect(simulation).toHaveAttribute("data-enabled", "true");
  await expect(aircraft).toHaveCount(4);
  await expect(overlay).toHaveAttribute("data-layer-ready", "true");
});
async function fleet(page: Page) {
  const first = await get<Result<Device>>(page, "/devices?page=1&pageSize=100");
  const devices = [...first.items];
  for (let current = 2; current <= Math.ceil(first.total / 100); current++) {
    devices.push(
      ...(
        await get<Result<Device>>(page, `/devices?page=${current}&pageSize=100`)
      ).items,
    );
  }
  expect(devices.length).toBe(first.total);
  return devices;
}
async function screenshot(page: Page, name: string) {
  const folder = path.join(process.env.QA_RUN_DIRECTORY!, "screenshots");
  await fs.mkdir(folder, { recursive: true });
  await page.screenshot({
    path: path.join(
      folder,
      `${live ? "live" : "isolated"}-feedback-${name}.png`,
    ),
    animations: "disabled",
  });
}

async function assertUsableAircraftLabels(page: Page) {
  const aircraft = page.locator(".flight-simulation-aircraft");
  await expect(aircraft).toHaveCount(4);
  for (const label of await aircraft.all()) await expect(label).toBeVisible();
  const labels = await aircraft.evaluateAll((elements) =>
    elements.map((element) => {
      const box = element.getBoundingClientRect();
      const hit = document.elementFromPoint(
        box.x + box.width / 2,
        box.y + box.height / 2,
      );
      return {
        id: (element as HTMLElement).dataset.aircraftId,
        x: box.x,
        y: box.y,
        width: box.width,
        height: box.height,
        unobstructed: hit === element || (!!hit && element.contains(hit)),
      };
    }),
  );
  const viewport = page.viewportSize()!;
  for (const label of labels) {
    expect(
      label.x,
      `${label.id} label stays inside the viewport`,
    ).toBeGreaterThanOrEqual(0);
    expect(
      label.y,
      `${label.id} label stays inside the viewport`,
    ).toBeGreaterThanOrEqual(0);
    expect(label.x + label.width).toBeLessThanOrEqual(viewport.width + 1);
    expect(label.y + label.height).toBeLessThanOrEqual(viewport.height + 1);
    expect(
      label.unobstructed,
      `${label.id} label remains clickable above map decoration and clear of panels`,
    ).toBe(true);
  }
  for (let i = 0; i < labels.length; i++) {
    for (let j = i + 1; j < labels.length; j++) {
      const first = labels[i],
        second = labels[j];
      const overlapWidth = Math.max(
        0,
        Math.min(first.x + first.width, second.x + second.width) -
          Math.max(first.x, second.x),
      );
      const overlapHeight = Math.max(
        0,
        Math.min(first.y + first.height, second.y + second.height) -
          Math.max(first.y, second.y),
      );
      expect(
        overlapWidth * overlapHeight,
        `${first.id} and ${second.id} labels must not cover one another`,
      ).toBeLessThan(1);
    }
  }
  await test.info().attach("aircraft-label-visibility", {
    body: Buffer.from(JSON.stringify({ viewport, labels })),
    contentType: "application/json",
  });
}
function datum(section: Locator, label: string) {
  return section
    .locator(".details > div")
    .filter({ has: section.page().locator("dt", { hasText: label }) })
    .locator("dd");
}
async function verifySummary(section: Locator, device: Device) {
  await expect(
    section.getByRole("heading", { name: "累计飞行统计", exact: true }),
  ).toBeVisible();
  await expect(datum(section, "累计飞行架次")).toHaveText(
    `${device.flightTotals!.sorties} 架次`,
  );
  await expect(datum(section, "累计飞行时长")).toHaveText(
    `${(device.flightTotals!.timeSeconds! / 3600).toFixed(2)} 小时`,
  );
}

test.beforeEach(async ({ context, page }) => {
  if (live) {
    await context.addCookies([
      {
        name: "JSESSIONID",
        value: process.env.QA_SESSION_COOKIE!,
        url: process.env.QA_BASE_URL!,
        httpOnly: true,
        sameSite: "Lax",
        secure: process.env.QA_BASE_URL!.startsWith("https:"),
      },
    ]);
  } else {
    await installFeedbackFixtures(page);
    await login(page);
  }
  const pageErrors: string[] = [],
    businessWrites: string[] = [];
  errors.set(page, pageErrors);
  writes.set(page, businessWrites);
  page.on("pageerror", (error) => pageErrors.push(error.message));
  page.on("request", (request) => {
    const url = new URL(request.url());
    if (
      url.pathname.startsWith("/api/v1/") &&
      !["GET", "HEAD"].includes(request.method())
    )
      businessWrites.push(`${request.method()} ${url.pathname}`);
  });
});
test.afterEach(async ({ page }) => {
  expect(
    writes.get(page),
    "Feedback regressions must never write normal business data or source data",
  ).toEqual([]);
  expect(
    errors.get(page),
    "No page runtime errors, including WebGL style teardown failures",
  ).toEqual([]);
});

for (const size of sizes) {
  for (const origin of origins) {
    test(`大屏布局 ${origin.route} ${size.width}×${size.height}`, async ({
      page,
    }) => {
      if (!live) await installCommandBoardFixtures(page);
      await page.setViewportSize(size);
      await page.goto(`/?view=${origin.route}`);
      await expect(page.locator(".page-header h1")).toHaveText(origin.title);
      await page.getByRole("button", { name: "指挥大屏", exact: true }).click();
      await expect(
        page.locator(".overview-map .maplibregl-canvas"),
      ).toBeAttached();
      const measured = await assertVisibleBoard(page);
      await test.info().attach("actual-visible-board-sizes", {
        body: Buffer.from(JSON.stringify(measured)),
        contentType: "application/json",
      });
      await expect(page).toHaveURL(new RegExp(`view=${origin.route}`));
      if (origin.route === "resources") {
        await expect
          .poll(async () =>
            Number(
              await page
                .getByTestId("flight-simulation")
                .getAttribute("data-seconds"),
            ),
          )
          .toBeGreaterThan(1.2);
        await assertUsableAircraftLabels(page);
        await screenshot(page, `resources-to-board-${size.width}`);
      }
      await page
        .getByRole("button", { name: "返回工作台", exact: true })
        .click();
      await expect(page.locator(".app-shell.board")).toHaveCount(0);
      await expect(page.locator(".page-header h1")).toHaveText(origin.title);
      await expect(page.locator(".sidebar")).toBeVisible();
      await page.getByRole("button", { name: "指挥大屏", exact: true }).click();
      await assertVisibleBoard(page);
      await page.keyboard.press("Escape");
      await expect(page.locator(".app-shell.board")).toHaveCount(0);
      await expect(page.locator(".page-header h1")).toHaveText(origin.title);
      await page.getByRole("button", { name: "指挥大屏", exact: true }).click();
      await assertVisibleBoard(page);
      await page.locator(".map-metrics button").first().click();
      const executing = page.getByRole("dialog", {
        name: "执行中任务明细",
        exact: true,
      });
      await expect(executing).toBeVisible();
      await executing
        .getByRole("button", { name: "前往任务调度", exact: true })
        .click();
      await expect(page.locator(".app-shell.board")).toHaveCount(0);
      await expect(page.locator(".page-header h1")).toHaveText("任务调度");
    });
  }

  if (![1920, 1024].includes(size.width)) continue;
  test(`设备默认可见、累计与架次分页独立、机巢和维护空态 ${size.width}×${size.height}`, async ({
    page,
  }) => {
    await page.setViewportSize(size);
    await page.goto("/?view=resources");
    await expect(page.locator(".page-header h1")).toHaveText("资源管理");
    await expect(
      page.getByRole("button", { name: "设备总览", exact: true }),
    ).toHaveClass(/active/);
    await expect(page.locator(".resource-main tbody tr").first()).toBeVisible();
    const allDevices = live ? await fleet(page) : (feedbackDevices as Device[]);
    expect(allDevices.length).toBeGreaterThan(0);
    const candidates = allDevices
      .filter(
        (item) =>
          item.flightTotals?.sorties != null &&
          item.flightTotals?.timeSeconds != null,
      )
      .sort(
        (a, b) =>
          (b.flightTotals!.sorties || 0) - (a.flightTotals!.sorties || 0),
      );
    expect(
      candidates.length,
      "The live provider must expose at least one real cumulative statistics row",
    ).toBeGreaterThan(0);
    const device = candidates[0];
    await chooseSelect(
      page.getByRole("combobox", { name: "飞行统计筛选", exact: true }),
      "true",
    );
    const search = page.locator(".resource-main .search-box input");
    await search.fill(device.sn || device.name);
    const row = page
      .locator(".resource-main tbody tr")
      .filter({ hasText: device.name })
      .first();
    await expect(row).toBeVisible();
    const header = await page.locator(".resource-main th").allTextContents();
    const sortiesColumn = header.findIndex((label) =>
      label.includes("累计飞行架次"),
    );
    const timeColumn = header.findIndex((label) =>
      label.includes("累计飞行时长"),
    );
    expect(sortiesColumn).toBeGreaterThanOrEqual(0);
    expect(timeColumn).toBeGreaterThanOrEqual(0);
    await expect(row.locator("td").nth(sortiesColumn)).toContainText(
      String(device.flightTotals!.sorties),
    );
    await expect(row.locator("td").nth(timeColumn)).toContainText(
      (device.flightTotals!.timeSeconds! / 3600).toFixed(2),
    );
    await row.click();
    const modal = page.getByRole("dialog").last();
    const history = modal.locator(".device-flight-history");
    await verifySummary(history.locator(".device-flight-summary"), device);
    await expect(
      history.getByRole("heading", { name: "设备飞行架次记录", exact: true }),
    ).toBeVisible();
    const first = live
      ? await get<Result<{ id: string; sortieNo: string }>>(
          page,
          `/flights?deviceId=${encodeURIComponent(device.id)}&page=1&pageSize=20`,
        )
      : { total: feedbackHistoryCount };
    await expect(history.locator(".list-footer")).toContainText(
      `当前结果 ${first.total} 条`,
    );
    if (!live) {
      expect(device.flightTotals!.sorties).toBeGreaterThan(first.total);
      await expect(
        history.getByRole("tab", { name: /架次记录/ }),
      ).toContainText(String(feedbackHistoryCount));
    }
    if (first.total > 20) {
      const before = await history.locator("tbody tr").first().textContent();
      const nextResponse = page.waitForResponse((response) => {
        const url = new URL(response.url());
        return (
          url.pathname === "/api/v1/flights" &&
          url.searchParams.get("deviceId") === device.id &&
          url.searchParams.get("page") === "2"
        );
      });
      await history
        .getByRole("button", { name: "下一页", exact: true })
        .click();
      expect((await nextResponse).status()).toBe(200);
      await expect(history.locator(".list-footer")).toContainText("2 /");
      await expect(history.locator("tbody tr").first()).not.toHaveText(
        before || "",
      );
    } else {
      await expect(
        history.getByRole("button", { name: "下一页", exact: true }),
      ).toHaveCount(0);
    }
    await screenshot(page, `device-statistics-history-${size.width}`);
    await modal.getByRole("button", { name: "关闭", exact: true }).click();
    await page
      .getByRole("navigation", { name: "能力中心" })
      .getByRole("button", { name: "飞行管控", exact: true })
      .click();
    const deviceSearch = page.locator(".queue .search-box input");
    await deviceSearch.fill(device.sn || device.id);
    await page
      .locator(".queue-card")
      .filter({ hasText: device.sn || device.id })
      .first()
      .click();
    await verifySummary(
      page.locator(".flight-control .device-flight-summary"),
      device,
    );
    await page
      .getByRole("button", { name: "查看观测与飞行记录", exact: true })
      .click();
    await expect(
      page.getByRole("dialog").locator(".device-flight-history"),
    ).toBeVisible();
    await page
      .getByRole("dialog")
      .getByRole("button", { name: "关闭", exact: true })
      .click();
    await page
      .getByRole("navigation", { name: "能力中心" })
      .getByRole("button", { name: "资源管理", exact: true })
      .click();
    await page
      .locator(".resource-catalog")
      .getByRole("button", { name: "设备维护", exact: true })
      .click();
    const maintenance = await get<Result<unknown>>(
      page,
      "/resources?kind=MAINTENANCE&page=1&pageSize=20",
    );
    if (maintenance.total === 0) {
      await expect(
        page.getByText("尚未登记维护记录", { exact: true }),
      ).toBeVisible();
      await expect(page.locator(".resource-main .empty")).toContainText(
        /来源|上游|数据源/,
      );
      await expect(page.locator(".resource-main tbody tr")).toHaveCount(0);
    }
    if (!live) {
      await page
        .locator(".resource-catalog")
        .getByRole("button", { name: "设备资源", exact: true })
        .click();
      await chooseSelect(
        page.getByRole("combobox", { name: "飞行统计筛选", exact: true }),
        "",
      );
      await page
        .locator(".resource-main .search-box input")
        .fill(feedbackDevices[1].sn!);
      await page
        .locator(".resource-main tbody tr")
        .filter({ hasText: feedbackDevices[1].name })
        .click();
      const dock = page.getByRole("dialog").last();
      await expect(dock.locator(".device-flight-summary")).toContainText(
        "该设备未提供累计统计",
      );
      await expect(
        datum(dock.locator(".device-flight-summary"), "累计飞行架次"),
      ).toHaveText("未知");
      await expect(
        dock.getByText("该设备暂无架次记录", { exact: true }),
      ).toBeVisible();
      await expect(dock.locator(".device-flight-history tbody tr")).toHaveCount(
        0,
      );
      await screenshot(page, `unknown-dock-statistics-${size.width}`);
    }
    await test.info().attach("source-readonly-check", {
      body: Buffer.from(
        JSON.stringify({
          live,
          authorizedDeviceCount: allDevices.length,
          devicesWithStatistics: candidates.length,
          cumulativeSorties: device.flightTotals!.sorties,
          historyTotal: first.total,
          businessWrites: writes.get(page)?.length || 0,
        }),
      ),
      contentType: "application/json",
    });
  });
}
