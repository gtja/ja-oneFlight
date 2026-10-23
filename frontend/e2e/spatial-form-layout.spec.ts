import { test, expect, type Page, type Locator } from "@playwright/test";
import { chooseSelect } from "../../scripts/lib/select-ui.mjs";
import { installVisualSourceFixtures } from "./fixtures";

for (const viewport of [
  { width: 1920, height: 1080 },
  { width: 1280, height: 720 },
  { width: 390, height: 844 },
]) {
  test(`空域绘制三点及多点后保存可点击 ${viewport.width}×${viewport.height}`, async ({ page }) => {
    await page.setViewportSize(viewport);
    await installVisualSourceFixtures(page);
    const saved: Record<string, unknown>[] = [];
    const list = (items: unknown[]) => ({ items, total: items.length, page: 1, pageSize: 100 });
    await page.route("**/api/v1/**", async (route) => {
      const request = route.request();
      const path = new URL(request.url()).pathname.replace("/api/v1", "");
      let data: unknown = list([]);
      if (path === "/auth/options") data = { mode: "local", localLoginEnabled: true };
      else if (path === "/auth/me") data = {
        id: "layout-admin", username: "synthetic", displayName: "合成管理员", role: "ADMIN",
        organizationId: "layout-org", regions: [], deviceIds: [], businessAccessAssigned: true,
      };
      else if (path === "/auth/csrf") data = { token: "synthetic-csrf", headerName: "X-CSRF-TOKEN" };
      else if (path === "/flight-control/options") data = { mode: "local" };
      else if (path === "/config") data = { mapStyleUrl: "https://basemaps.cartocdn.com/layout/style.json" };
      else if (path === "/organizations") data = list([{ id: "layout-org", title: "合成组织", status: "ACTIVE" }]);
      else if (path === "/resources" && request.method() === "POST") {
        saved.push(request.postDataJSON());
        data = { id: "synthetic-airspace", ...saved.at(-1) };
      } else if (!["GET", "HEAD"].includes(request.method())) {
        throw new Error(`Unexpected synthetic write: ${request.method()} ${path}`);
      }
      await route.fulfill({ json: { code: "OK", message: "成功", data } });
    });
    await page.goto("/?view=resources");
    await page.getByRole("button", { name: "空域资源", exact: true }).click();
    await page.getByRole("button", { name: "本地业务档案", exact: true }).click();
    await page.getByRole("button", { name: "登记资源", exact: true }).click();
    const dialog = page.getByRole("dialog", { name: "登记空域资源", exact: true });
    await expect(dialog.getByRole("button", { name: "保存", exact: true })).toBeEnabled();
    await dialog.getByLabel("资源名称", { exact: false }).fill("合成保存布局空域");
    await chooseSelect(dialog.getByLabel("所属区域", { exact: false }), { label: "西湖区" });
    const save = dialog.getByRole("button", { name: "保存", exact: true });
    await save.click();
    await expect(dialog.locator(".form-error")).toContainText("请先绘制");
    const canvas = dialog.locator(".geometry-stage canvas").first();
    await expect(canvas).toBeVisible();
    const box = await canvas.boundingBox();
    expect(box).not.toBeNull();
    for (let index = 0; index < 8; index++) {
      const angle = (index * Math.PI) / 4;
      await canvas.click({ position: {
        x: box!.width * (0.5 + 0.17 * Math.cos(angle)),
        y: box!.height * (0.55 + 0.17 * Math.sin(angle)),
      } });
      await expect(dialog.locator(".geometry-waypoints > li")).toHaveCount(index + 1);
      if (index === 2 || index === 7) {
        // Visible means both inside the modal and actually receiving pointer input;
        // display/visibility alone miss a footer clipped by overflow:hidden.
        const reachable = await save.evaluate((button) => {
          const rect = button.getBoundingClientRect();
          const modal = button.closest('[role="dialog"]')!.getBoundingClientRect();
          const hit = document.elementFromPoint(rect.x + rect.width / 2, rect.y + rect.height / 2);
          return rect.top >= modal.top && rect.bottom <= Math.min(modal.bottom, innerHeight)
            && !!hit && button.contains(hit);
        });
        expect(reachable).toBe(true);
      }
    }
    await save.click();
    await expect(dialog).toHaveCount(0);
    expect(saved).toHaveLength(1);
    const metadata = saved[0].metadata as { geometry: { type: string; coordinates: number[][][] } };
    expect(metadata.geometry.type).toBe("Polygon");
    expect(metadata.geometry.coordinates[0]).toHaveLength(9);
  });
}

type SyntheticAirspace = {
  id: string;
  title: string;
  kind: string;
  status: string;
  region: string;
  organizationId: string;
  metadata: {
    geometry: { type: "Polygon"; coordinates: number[][][] };
    geometryContext?: { airspaceShape?: Record<string, unknown> };
  };
};

// Independent geodesic fixture: old records have only a Polygon, without shape metadata.
function syntheticCircle(): number[][] {
  const longitude = (120.12 * Math.PI) / 180;
  const latitude = (30.27 * Math.PI) / 180;
  const radius = 500 / 6_371_008.8;
  const ring = Array.from({ length: 32 }, (_, index) => {
    const bearing = (index * 2 * Math.PI) / 32;
    const targetLatitude = Math.asin(
      Math.sin(latitude) * Math.cos(radius) +
        Math.cos(latitude) * Math.sin(radius) * Math.cos(bearing),
    );
    const targetLongitude = longitude + Math.atan2(
      Math.sin(bearing) * Math.sin(radius) * Math.cos(latitude),
      Math.cos(radius) - Math.sin(latitude) * Math.sin(targetLatitude),
    );
    return [targetLongitude * 180 / Math.PI, targetLatitude * 180 / Math.PI];
  });
  return [...ring, [...ring[0]]];
}

async function installShapeFixtures(page: Page, geometry: number[][]) {
  await installVisualSourceFixtures(page);
  // No remote business requests or real device commands are permitted in this suite.
  await page.route("https://tiles.openfreemap.org/**", (route) =>
    route.request().url().endsWith(".pbf")
      ? route.fulfill({ contentType: "application/x-protobuf", body: Buffer.alloc(0) })
      : route.fulfill({ json: {
        tilejson: "3.0.0", minzoom: 0, maxzoom: 14,
        tiles: ["https://tiles.openfreemap.org/synthetic/{z}/{x}/{y}.pbf"],
        vector_layers: [{ id: "building", fields: {} }],
      } }),
  );
  let resource: SyntheticAirspace = {
    id: "synthetic-edit-airspace",
    title: "合成原始空域",
    kind: "AIRSPACE",
    status: "ACTIVE",
    region: "西湖区",
    organizationId: "layout-org",
    metadata: { geometry: { type: "Polygon", coordinates: [geometry] } },
  };
  const writes: SyntheticAirspace[] = [];
  const unexpected: string[] = [];
  const list = (items: unknown[]) => ({ items, total: items.length, page: 1, pageSize: 100 });
  await page.route((url) => url.pathname.startsWith("/api/"), async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const path = url.pathname.replace("/api/v1", "");
    let data: unknown;
    if (request.method() === "PUT" && path === `/resources/${resource.id}`) {
      expect(request.headers()["x-csrf-token"]).toBe("synthetic-csrf");
      resource = { ...resource, ...request.postDataJSON() };
      writes.push(structuredClone(resource));
      data = resource;
    } else if (!["GET", "HEAD"].includes(request.method())) {
      unexpected.push(`${request.method()} ${path}`);
    } else if (path === "/auth/options") data = { mode: "local", localLoginEnabled: true };
    else if (path === "/auth/me") data = {
      id: "shape-admin", username: "synthetic", displayName: "合成管理员", role: "ADMIN",
      organizationId: "layout-org", regions: [], deviceIds: [], businessAccessAssigned: true,
    };
    else if (path === "/auth/csrf") data = { token: "synthetic-csrf", headerName: "X-CSRF-TOKEN" };
    else if (path === "/flight-control/options") data = { mode: "local" };
    else if (path === "/config") data = { mapStyleUrl: "https://basemaps.cartocdn.com/layout/style.json" };
    else if (path === "/organizations") data = list([{ id: "layout-org", title: "合成组织", status: "ACTIVE" }]);
    else if (path === "/resources") data = list(
      !url.searchParams.get("kind") || url.searchParams.get("kind") === "AIRSPACE" ? [resource] : [],
    );
    else if (path === "/dashboard") data = { executingTasks: 0, openCases: 0, resourcesCount: 1 };
    else if (["/devices", "/tasks", "/cases", "/source-data/airspaces"].includes(path)) data = list([]);
    else unexpected.push(`${request.method()} ${path}`);
    await route.fulfill({
      status: data === undefined ? 500 : 200,
      json: { code: data === undefined ? "UNEXPECTED_SYNTHETIC_REQUEST" : "OK", message: "合成数据", data },
    });
  });
  return { writes, unexpected };
}

async function setShapeNumber(dialog: Locator, label: string, value: number) {
  const field = dialog.getByLabel(label, { exact: true });
  await field.fill(String(value));
  await field.press("Tab");
  await expect(dialog.getByLabel(label, { exact: true })).toHaveValue(String(value));
}

for (const width of [1920, 390]) {
  for (const shape of ["圆形", "矩形"] as const) {
    test(`已有${shape}可调整并保存，同步态势首页 ${width}px`, async ({ page }, testInfo) => {
      await page.setViewportSize({ width, height: width === 390 ? 844 : 1080 });
      const ring = shape === "圆形" ? syntheticCircle() : [
        [120.11, 30.26], [120.13, 30.26], [120.13, 30.28], [120.11, 30.28], [120.11, 30.26],
      ];
      const fixtures = await installShapeFixtures(page, ring);
      await page.goto("/?view=overview");
      await expect(page.locator(".map-geometry-marker").getByText("合成原始空域")).toBeVisible();
      const navigation = page.getByRole("navigation", { name: "能力中心" });
      await navigation.getByRole("button", { name: "资源管理", exact: true }).click();
      await page.getByRole("button", { name: "空域资源", exact: true }).click();
      await page.getByRole("button", { name: "本地业务档案", exact: true }).click();
      await page.getByRole("row").filter({ hasText: "合成原始空域" }).click();
      await page.getByRole("dialog", { name: "合成原始空域", exact: true })
        .getByRole("button", { name: "编辑档案", exact: true }).click();
      const dialog = page.getByRole("dialog", { name: "编辑资源档案", exact: true });
      await expect(dialog.getByRole("button", { name: shape, exact: true })).toHaveAttribute("aria-pressed", "true");
      await expect(dialog.getByRole("region", { name: "空域形状参数" })).toBeVisible();
      const updatedTitle = `合成${shape}已调整`;
      await dialog.getByLabel("资源名称", { exact: false }).fill(updatedTitle);
      if (shape === "圆形") {
        await dialog.getByLabel("圆心经度", { exact: true }).fill("120.121");
        const latitude = dialog.getByLabel("圆心纬度", { exact: true });
        await latitude.click();
        await expect(latitude).toBeFocused();
        await latitude.fill("30.271");
        const radius = dialog.getByLabel("半径（米）", { exact: true });
        await radius.click();
        await expect(radius).toBeFocused();
        // Clicking Save must commit the focused field's blur update without an extra click.
        await radius.fill("750");
        await expect(dialog.getByRole("button", { name: "圆心，可拖动调整", exact: true })).toHaveCount(1);
        await expect(dialog.getByRole("button", { name: "半径，可拖动调整", exact: true })).toHaveCount(1);
      } else {
        await setShapeNumber(dialog, "东侧经度", 120.135);
        await dialog.getByRole("button", { name: "设为正方形", exact: true }).click();
        const north = Number(await dialog.getByLabel("北侧纬度", { exact: true }).inputValue());
        const widthDegrees = 2 * Math.asin(
          Math.cos(30.26 * Math.PI / 180) * Math.sin((120.135 - 120.11) * Math.PI / 360),
        ) * 180 / Math.PI;
        expect(north - 30.26).toBeCloseTo(widthDegrees, 8);
        await expect(dialog.getByRole("button", { name: "西南，可拖动调整", exact: true })).toHaveCount(1);
        await expect(dialog.getByRole("button", { name: "东北，可拖动调整", exact: true })).toHaveCount(1);
      }
      await dialog.getByRole("button", { name: "保存", exact: true }).click();
      await expect(dialog).toHaveCount(0);
      expect(fixtures.writes).toHaveLength(1);
      const saved = fixtures.writes[0].metadata;
      expect(saved.geometry.type).toBe("Polygon");
      expect(saved.geometry.coordinates[0]).not.toEqual(ring);
      expect(saved.geometry.coordinates[0].at(-1)).toEqual(saved.geometry.coordinates[0][0]);
      expect(saved.geometryContext?.airspaceShape?.type).toBe(shape === "圆形" ? "CIRCLE" : "RECTANGLE");
      if (shape === "圆形") {
        expect(saved.geometryContext?.airspaceShape?.center).toEqual([120.121, 30.271]);
        expect(saved.geometryContext?.airspaceShape?.radiusMeters).toBe(750);
        expect(saved.geometry.coordinates[0]).toHaveLength(33);
      } else {
        expect(saved.geometry.coordinates[0]).toHaveLength(5);
        expect(Math.max(...saved.geometry.coordinates[0].map((point) => point[0]))).toBe(120.135);
      }

      // Return to the previously mounted overview to exercise the mutation's cache invalidation.
      await navigation.getByRole("button", { name: "态势感知", exact: true }).click();
      const updatedMarker = page.locator(".map-geometry-marker").filter({ hasText: updatedTitle });
      await expect(updatedMarker).toBeVisible();
      await expect(page.locator(".map-geometry-marker").filter({ hasText: "合成原始空域" })).toHaveCount(0);
      await page.screenshot({ path: testInfo.outputPath(`shape-overview-${width}.png`), fullPage: true });
      await updatedMarker.click();
      const overviewDetail = page.getByRole("dialog", { name: updatedTitle, exact: true });
      await expect(overviewDetail).toContainText("空域");
      await overviewDetail.getByRole("button", { name: "关闭", exact: true }).click();
      await navigation.getByRole("button", { name: "资源管理", exact: true }).click();
      await page.getByRole("button", { name: "空域资源", exact: true }).click();
      await page.getByRole("button", { name: "本地业务档案", exact: true }).click();
      await page.getByRole("row").filter({ hasText: updatedTitle }).click();
      await page.getByRole("dialog", { name: updatedTitle, exact: true })
        .getByRole("button", { name: "编辑档案", exact: true }).click();
      await expect(dialog.getByRole("button", { name: shape, exact: true })).toHaveAttribute("aria-pressed", "true");
      if (shape === "圆形") {
        await expect(dialog.getByLabel("圆心经度", { exact: true })).toHaveValue("120.121");
        await expect(dialog.getByLabel("圆心纬度", { exact: true })).toHaveValue("30.271");
        await expect(dialog.getByLabel("半径（米）", { exact: true })).toHaveValue("750");
      } else {
        await expect(dialog.getByLabel("东侧经度", { exact: true })).toHaveValue("120.135");
      }
      await dialog.getByRole("region", { name: "空域形状参数" }).scrollIntoViewIfNeeded();
      await page.screenshot({ path: testInfo.outputPath(`shape-editor-${width}.png`), fullPage: true });
      expect(fixtures.unexpected).toEqual([]);
    });
  }
}
