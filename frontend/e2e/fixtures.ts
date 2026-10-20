import type { Page, APIRequestContext } from "@playwright/test";
import { expect } from "@playwright/test";
import { deflateSync } from "node:zlib";
export const devices = [
  {
    id: "qa-aircraft-001",
    name: "西湖巡查 01 号飞机",
    productKey: "QA_UAV",
    type: "UAV",
    sn: "QA-SN-001",
    status: "ONLINE",
    longitude: 120.095,
    latitude: 30.263,
    lastObservedAt: "2026-10-14T01:00:00Z",
    flightTotals: {
      sorties: 36,
      timeSeconds: 61200,
      distanceMeters: 164500,
      reportedAt: "2026-10-14T01:00:00Z",
    },
  },
  {
    id: "qa-dock-001",
    name: "西湖值守机场",
    productKey: "QA_DOCK",
    type: "UAV_AIRPORT",
    sn: "QA-DOCK-001",
    status: "ONLINE",
    longitude: 120.13,
    latitude: 30.242,
    lastObservedAt: "2026-10-14T01:00:00Z",
    flightTotals: null,
  },
  {
    id: "qa-aircraft-002",
    name: "运河巡查 02 号飞机",
    productKey: "QA_UAV",
    type: "UAV",
    sn: "QA-SN-002",
    status: "UNKNOWN",
    longitude: 120.17,
    latitude: 30.3,
    lastObservedAt: null,
    flightTotals: null,
  },
];
const algorithms = [
  {
    id: "qa-algo-fire",
    name: "森林烟火识别",
    description: "用于界面验收的固定算法目录样例",
    categories: ["森林防火"],
    deviceTypes: ["UAV"],
    deployed: true,
    modelName: "烟火检测模型",
    version: "v1.0",
    details: { deployedDeviceCount: 2 },
  },
  {
    id: "qa-algo-road",
    name: "道路车辆识别",
    description: "仅用于界面验收，不进入正式运行数据",
    categories: ["非现执法"],
    deviceTypes: ["UAV", "UAV_AIRPORT"],
    deployed: false,
    modelName: "车辆识别模型",
    version: "v2.0",
    details: { deployedDeviceCount: 0 },
  },
  {
    id: "qa-algo-mine",
    name: "矿区变化检测",
    description: "用于固定截图的测试目录",
    categories: ["矿产监管"],
    deviceTypes: ["UAV"],
    deployed: true,
    modelName: "地表变化模型",
    version: "v1.2",
    details: { deployedDeviceCount: 1 },
  },
];
const success = (data: unknown) => ({ code: "OK", message: "成功", data });
const pageResult = (items: unknown[], page = 1, pageSize = 100) => ({
  items,
  total: items.length,
  page,
  pageSize,
});
function fixtureTile(terrain = false): Buffer {
  function crc32(data: Buffer) {
    let c = 0xffffffff;
    for (const b of data) {
      c ^= b;
      for (let i = 0; i < 8; i++) c = (c >>> 1) ^ (c & 1 ? 0xedb88320 : 0);
    }
    return (c ^ 0xffffffff) >>> 0;
  }
  function chunk(type: string, data: Buffer) {
    const name = Buffer.from(type),
      size = Buffer.alloc(4),
      crc = Buffer.alloc(4);
    size.writeUInt32BE(data.length);
    crc.writeUInt32BE(crc32(Buffer.concat([name, data])));
    return Buffer.concat([size, name, data, crc]);
  }
  const header = Buffer.alloc(13);
  header.writeUInt32BE(256, 0);
  header.writeUInt32BE(256, 4);
  header[8] = 8;
  header[9] = 6;
  const pixels = Buffer.alloc(256 * (1 + 256 * 4));
  for (let y = 0; y < 256; y++) {
    const row = y * (1 + 256 * 4);
    for (let x = 0; x < 256; x++) {
      const i = row + 1 + x * 4;
      const road = x % 64 < 2 || y % 64 < 2;
      pixels[i] = terrain ? 128 : road ? 35 : 14;
      pixels[i + 1] = terrain ? 0 : road ? 77 : 39;
      pixels[i + 2] = terrain ? 0 : road ? 95 : 48;
      pixels[i + 3] = 255;
    }
  }
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk("IHDR", header),
    chunk("IDAT", deflateSync(pixels)),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}
export async function installVisualSourceFixtures(page: Page) {
  const baseTile = fixtureTile(),
    terrainTile = fixtureTile(true);
  await page.route("https://server.arcgisonline.com/**", (route) =>
    route.fulfill({ contentType: "image/png", body: baseTile }),
  );
  await page.route("https://tile.openstreetmap.org/**", (route) =>
    route.fulfill({ contentType: "image/png", body: baseTile }),
  );
  await page.route(
    "https://s3.amazonaws.com/elevation-tiles-prod/**",
    (route) => route.fulfill({ contentType: "image/png", body: terrainTile }),
  );
  // Source and map mocks exist only inside QA. Every local business write reaches the real isolated H2 backend.
  await page.route("**/api/v1/devices?**", async (route) =>
    route.fulfill({ json: success(pageResult(devices)) }),
  );
  await page.route("**/api/v1/devices/*/telemetry", async (route) => {
    const id = new URL(route.request().url()).pathname.split("/")[4];
    const device = devices.find((d) => d.id === id) || devices[0];
    await route.fulfill({
      json: success({
        ...device,
        deviceId: id,
        batteryPercent: 78,
        altitudeMeters: device.type === "UAV" ? 86 : null,
        windSpeed: device.type === "UAV_AIRPORT" ? 2.4 : null,
        temperature: device.type === "UAV_AIRPORT" ? 24.8 : null,
        lastObservedAt: device.lastObservedAt,
        positionObservedAt: device.lastObservedAt,
        receivedAt: "2026-10-14T01:00:01Z",
      }),
    });
  });
  await page.route("**/api/v1/executions?**", async (route) => {
    const id = new URL(route.request().url()).searchParams.get("deviceId");
    await route.fulfill({
      json: success(
        pageResult(
          id === "qa-aircraft-001"
            ? [
                {
                  id: "qa-native-execution-001",
                  nativeActionId: "qa-native-action",
                  nativeActionRecordId: "qa-native-record",
                  nativeActionItemId: "qa-native-item",
                  nativeTaskRecordId: "qa-source-record",
                  nativeTaskId: null,
                  name: "原生巡查执行 · QA",
                  deviceIds: [id],
                  status: null,
                  nativeItemCurrentStatus: "FINISHED",
                  executionStartAt: "2026-10-14T00:30:00Z",
                  executionEndAt: "2026-10-14T00:50:00Z",
                  reportedAt: "2026-10-14T00:50:00Z",
                  provider: "ICOS_ACTION_ITEM_RECORD",
                },
              ]
            : [],
        ),
      ),
    });
  });
  await page.route("**/api/v1/algorithms**", async (route) => {
    const url = new URL(route.request().url());
    const filtered = algorithms.filter(
      (item) =>
        (!url.searchParams.get("category") ||
          item.categories.includes(url.searchParams.get("category")!)) &&
        (!url.searchParams.get("keyword") ||
          item.name.includes(url.searchParams.get("keyword")!)) &&
        (!url.searchParams.get("deviceType") ||
          item.deviceTypes.includes(url.searchParams.get("deviceType")!)),
    );
    const list = filtered.filter((item) =>
      url.searchParams.get("deployment") === "deployed"
        ? item.deployed
        : url.searchParams.get("deployment") === "undeployed"
          ? !item.deployed
          : true,
    );
    const data = url.pathname.endsWith("/statistics")
      ? {
          all: filtered.length,
          deployed: filtered.filter((item) => item.deployed).length,
          undeployed: filtered.filter((item) => !item.deployed).length,
          readAt: "2026-10-14T01:00:00Z",
        }
      : url.pathname.endsWith("/categories")
        ? [
            { key: "森林防火", name: "森林防火", count: 1 },
            { key: "非现执法", name: "非现执法", count: 1 },
            { key: "矿产监管", name: "矿产监管", count: 1 },
          ]
        : url.pathname.endsWith("/devices")
          ? pageResult([
              {
                id: "qa-deploy",
                deviceId: devices[0].id,
                deviceName: devices[0].name,
                status: "已部署",
                version: "v1.0",
              },
            ])
          : pageResult(list);
    await route.fulfill({ json: success(data) });
  });
  await page.route("https://basemaps.cartocdn.com/**", async (route) => {
    const style = {
      version: 8,
      sources: {
        "qa-boundaries": {
          type: "geojson",
          data: {
            type: "FeatureCollection",
            features: [
              {
                type: "Feature",
                properties: { name: "西湖区" },
                geometry: {
                  type: "Polygon",
                  coordinates: [
                    [
                      [120.02, 30.15],
                      [120.15, 30.15],
                      [120.15, 30.32],
                      [120.02, 30.32],
                      [120.02, 30.15],
                    ],
                  ],
                },
              },
              {
                type: "Feature",
                properties: { name: "上城区" },
                geometry: {
                  type: "Polygon",
                  coordinates: [
                    [
                      [120.15, 30.15],
                      [120.25, 30.15],
                      [120.25, 30.29],
                      [120.15, 30.29],
                      [120.15, 30.15],
                    ],
                  ],
                },
              },
            ],
          },
        },
      },
      layers: [
        {
          id: "qa-background",
          type: "background",
          paint: { "background-color": "#091e2b" },
        },
        {
          id: "qa-fill",
          type: "fill",
          source: "qa-boundaries",
          paint: { "fill-color": "#143345", "fill-opacity": 0.7 },
        },
        {
          id: "qa-lines",
          type: "line",
          source: "qa-boundaries",
          paint: { "line-color": "#216076", "line-width": 1.5 },
        },
      ],
    };
    await route.fulfill({ json: style });
  });
}
export async function login(
  page: Page,
  username = process.env.QA_USERNAME!,
  password = process.env.QA_PASSWORD!,
) {
  await page.goto("/?view=services");
  await page
    .getByRole("textbox", { name: "登录账号", exact: true })
    .fill(username);
  await page.getByLabel("密码", { exact: true }).fill(password);
  await page.getByRole("button", { name: /进入工作台/ }).click();
  await expect(
    page.getByRole("navigation", { name: "能力中心" }),
  ).toBeVisible();
}
export async function backend<T = Record<string, unknown>>(
  request: APIRequestContext,
  path: string,
  body?: unknown,
  method = "POST",
): Promise<T> {
  let headers: Record<string, string> = {};
  if (body !== undefined || method !== "GET") {
    const csrf = await request.get("/api/v1/auth/csrf");
    const data = (await csrf.json()).data;
    headers[data.headerName] = data.token;
  }
  const response = await request.fetch(`/api/v1${path}`, {
    method,
    headers,
    data: body,
  });
  const json = await response.json();
  expect(response.status(), `${path}: ${json.message}`).toBeLessThan(400);
  return json.data as T;
}
