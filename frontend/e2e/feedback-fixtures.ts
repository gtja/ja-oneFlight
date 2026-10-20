import { expect, type Page } from "@playwright/test";
import { devices, installVisualSourceFixtures } from "./fixtures";

/** Only the isolated QA runner loads these provider responses; the live regression has no routes. */
export const feedbackDevices = devices.map((device, index) =>
  index === 0
    ? {
        ...device,
        flightTotals: {
          sorties: 205,
          timeSeconds: 73_800,
          distanceMeters: 205_000,
          reportedAt: "2026-10-14T09:00:00Z",
        },
      }
    : device,
);
const success = (data: unknown) => ({ code: "OK", message: "成功", data });
export const feedbackHistoryCount = 45;
const histories = Array.from({ length: feedbackHistoryCount }, (_, index) => ({
  id: String(9_007_199_254_740_991_000n + BigInt(index)),
  deviceId: feedbackDevices[0].id,
  productKey: feedbackDevices[0].productKey,
  sortieNo: `QA-${String(index + 1).padStart(4, "0")}`,
  flightTimeSeconds: 360,
  flightDistanceMeters: 1000,
  reportedAt: new Date(Date.UTC(2026, 9, 12, 0, index * 10)).toISOString(),
  updatedAt: null,
  settlement: "SETTLED",
  takeoffAt: null,
  landingAt: null,
}));

export async function installFeedbackFixtures(page: Page) {
  await installVisualSourceFixtures(page);
  await page.route("**/api/v1/devices?**", async (route) => {
    const params = new URL(route.request().url()).searchParams;
    const keyword = (params.get("keyword") || "").toLowerCase();
    const items = feedbackDevices.filter(
      (device) =>
        (!keyword ||
          `${device.name} ${device.sn}`.toLowerCase().includes(keyword)) &&
        (!params.get("type") || params.get("type") === device.type) &&
        (params.get("hasFlightTotals") !== "true" ||
          device.flightTotals !== null),
    );
    const current = Number(params.get("page") || "1");
    const pageSize = Number(params.get("pageSize") || "100");
    await route.fulfill({
      json: success({
        items: items.slice((current - 1) * pageSize, current * pageSize),
        total: items.length,
        page: current,
        pageSize,
      }),
    });
  });
  await page.route("**/api/v1/devices/*", async (route) => {
    const segments = new URL(route.request().url()).pathname.split("/");
    const device = feedbackDevices.find((item) => item.id === segments[4]);
    if (segments.length !== 5 || !device) return route.fallback();
    await route.fulfill({ json: success(device) });
  });
  await page.route("**/api/v1/flights?**", async (route) => {
    const params = new URL(route.request().url()).searchParams;
    const deviceId = params.get("deviceId");
    const records =
      !deviceId || deviceId === feedbackDevices[0].id ? histories : [];
    const current = Number(params.get("page") || "1");
    const pageSize = Number(params.get("pageSize") || "100");
    await route.fulfill({
      json: success({
        items: records.slice((current - 1) * pageSize, current * pageSize),
        total: records.length,
        page: current,
        pageSize,
      }),
    });
  });
}

/** Complete, paginated catalogs for command-board aggregation and region checks. */
export async function installCommandBoardFixtures(page: Page) {
  const tasks = [
    ...Array.from({ length: 104 }, (_, index) => ({
      id: `qa-command-completed-${index}`,
      name: `已完成巡查 ${index + 1}`,
      region: "西湖区",
      status: "COMPLETED",
      startAt: "2026-10-14T00:00:00Z",
    })),
    {
      id: "qa-command-midnight",
      name: "西湖跨日巡查",
      region: "西湖区",
      status: "EXECUTING",
      startAt: "2026-10-15T16:30:00Z",
    },
    {
      id: "qa-command-eight",
      name: "上城清晨巡查",
      region: "上城区",
      status: "EXECUTING",
      startAt: "2026-10-16T00:15:00Z",
    },
    {
      id: "qa-command-west-eight",
      name: "西湖清晨巡查",
      region: "西湖区",
      status: "PENDING_EXECUTION",
      startAt: "2026-10-16T00:45:00Z",
    },
    {
      id: "qa-command-yesterday",
      name: "昨日末班巡查",
      region: "西湖区",
      status: "PENDING_ASSIGNMENT",
      startAt: "2026-10-15T15:59:00Z",
    },
    {
      id: "qa-command-unscoped",
      name: "区域待定巡查",
      region: null,
      status: "COMPLETED",
      startAt: "2026-10-16T08:30:00Z",
    },
    {
      id: "qa-command-cancelled",
      name: "取消巡查",
      region: "西湖区",
      status: "CANCELLED",
      startAt: "2026-10-16T00:30:00Z",
    },
  ];
  const plans = [
    ...Array.from({ length: 101 }, (_, index) => ({
      id: `qa-command-plan-${index}`,
      name: `已通过计划 ${index}`,
      region: "西湖区",
      status: "APPROVED",
    })),
    {
      id: "qa-command-review-west",
      name: "西湖待审核计划",
      region: "西湖区",
      status: "PENDING_REVIEW",
    },
    {
      id: "qa-command-review-east",
      name: "上城待审核计划",
      region: "上城区",
      status: "PENDING_REVIEW",
    },
  ];
  const cases = [
    ...Array.from({ length: 101 }, (_, index) => ({
      id: `qa-command-case-${index}`,
      title: `已归档线索 ${index}`,
      region: "西湖区",
      status: "ARCHIVED",
    })),
    {
      id: "qa-command-open-west",
      title: "西湖待核查目标",
      region: "西湖区",
      status: "PENDING_REVIEW",
    },
    {
      id: "qa-command-open-east",
      title: "上城待核查目标",
      region: "上城区",
      status: "PENDING_REVIEW",
    },
  ];
  const resources = [
    {
      id: "qa-command-uav-west",
      kind: "DEVICE",
      sourceDeviceId: feedbackDevices[0].id,
      region: "西湖区",
    },
    {
      id: "qa-command-dock-west",
      kind: "DEVICE",
      sourceDeviceId: feedbackDevices[1].id,
      region: "西湖区",
    },
    {
      id: "qa-command-uav-east",
      kind: "DEVICE",
      sourceDeviceId: feedbackDevices[2].id,
      region: "上城区",
    },
    {
      id: "qa-command-airspace-west",
      kind: "AIRSPACE",
      name: "西湖重点保障空域",
      region: "西湖区",
      status: "ACTIVE",
      geometry: {
        type: "Polygon",
        coordinates: [
          [
            [120.15, 30.23],
            [120.16, 30.23],
            [120.16, 30.24],
            [120.15, 30.24],
            [120.15, 30.23],
          ],
        ],
      },
    },
    {
      id: "qa-command-route-east",
      kind: "ROUTE",
      name: "上城巡查航线",
      region: "上城区",
      geometry: {
        type: "LineString",
        coordinates: [
          [120.17, 30.23],
          [120.18, 30.24],
        ],
      },
    },
  ];
  for (const [endpoint, items] of Object.entries({
    tasks,
    plans,
    cases,
    resources,
  })) {
    await page.route(`**/api/v1/${endpoint}?**`, async (route) => {
      const params = new URL(route.request().url()).searchParams;
      const filtered = items.filter(
        (item) =>
          !params.get("status") ||
          ("status" in item && item.status === params.get("status")),
      );
      const current = Number(params.get("page") || "1");
      const pageSize = Number(params.get("pageSize") || "100");
      await route.fulfill({
        json: success({
          items: filtered.slice((current - 1) * pageSize, current * pageSize),
          total: filtered.length,
          page: current,
          pageSize,
        }),
      });
    });
  }
}

export async function assertVisibleBoard(page: Page) {
  await expect(page.locator(".app-shell.board")).toBeVisible();
  await expect(page.locator(".sidebar")).toBeHidden();
  await expect(page.locator(".command-board-header h1")).toHaveText(
    "低空运行指挥",
  );
  await expect(page.locator(".command-kpi")).toHaveCount(3);
  await expect(
    page.locator(".command-bottom-charts svg[role=group]"),
  ).toHaveCount(2);
  const sizes = await page.evaluate(() => {
    const rect = (selector: string) => {
      const element = document.querySelector(selector);
      if (!element) return null;
      const box = element.getBoundingClientRect();
      return { x: box.x, y: box.y, width: box.width, height: box.height };
    };
    const viewport = { width: innerWidth, height: innerHeight };
    const workspace = rect(".main-workspace");
    const map = rect(".overview-map.command-board-map");
    const mapHolder = rect(".overview-map .map-canvas");
    const canvas = rect(".overview-map .maplibregl-canvas");
    const metrics = rect(".overview-map .map-metrics");
    const left = rect(".command-left");
    const right = rect(".command-right");
    const charts = rect(".command-bottom-charts");
    const point = map
      ? {
          x: Math.min(innerWidth - 1, map.x + map.width * 0.4),
          y: Math.min(innerHeight - 1, map.y + map.height * 0.5),
        }
      : { x: 0, y: 0 };
    const hit = document.elementFromPoint(point.x, point.y);
    return {
      viewport,
      workspace,
      map,
      mapHolder,
      canvas,
      metrics,
      left,
      right,
      charts,
      documentWidth: document.documentElement.scrollWidth,
      hitInsideMap: !!hit?.closest(".overview-map"),
    };
  });
  for (const [name, value] of Object.entries({
    workspace: sizes.workspace,
    map: sizes.map,
    mapHolder: sizes.mapHolder,
    canvas: sizes.canvas,
  })) {
    expect(value, `${name} must exist`).not.toBeNull();
    expect(
      value!.width,
      `${name} must use the viewport instead of the zero-width nav column`,
    ).toBeGreaterThan(sizes.viewport.width * 0.8);
    expect(value!.height, `${name} must have visible height`).toBeGreaterThan(
      sizes.viewport.height * 0.45,
    );
    expect(value!.x + value!.width).toBeLessThanOrEqual(
      sizes.viewport.width + 1,
    );
    expect(value!.y + value!.height).toBeLessThanOrEqual(
      sizes.viewport.height + 1,
    );
  }
  for (const [name, value] of Object.entries({
    metrics: sizes.metrics,
    left: sizes.left,
    right: sizes.right,
    charts: sizes.charts,
  })) {
    expect(value, `${name} must exist in the command layout`).not.toBeNull();
    expect(value!.height, `${name} must have visible height`).toBeGreaterThan(
      30,
    );
    expect(value!.x).toBeGreaterThanOrEqual(0);
    expect(value!.x + value!.width).toBeLessThanOrEqual(
      sizes.viewport.width + 1,
    );
    expect(value!.y + value!.height).toBeLessThanOrEqual(
      sizes.viewport.height + 1,
    );
  }
  expect(sizes.metrics!.width).toBeGreaterThan(sizes.viewport.width * 0.35);
  expect(sizes.left!.x + sizes.left!.width).toBeLessThan(sizes.metrics!.x);
  expect(sizes.metrics!.x + sizes.metrics!.width).toBeLessThan(sizes.right!.x);
  expect(sizes.charts!.y).toBeGreaterThanOrEqual(
    sizes.left!.y + sizes.left!.height,
  );
  expect(
    sizes.documentWidth,
    "command board must not create horizontal page overflow",
  ).toBeLessThanOrEqual(sizes.viewport.width);
  expect(
    sizes.hitInsideMap,
    "the measured map must actually intersect the visible viewport",
  ).toBe(true);
  return sizes;
}
