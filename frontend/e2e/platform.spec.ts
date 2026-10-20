import { chooseSelect } from "../../scripts/lib/select-ui.mjs";
import { test, expect, type Page, type Route } from "@playwright/test";
import path from "node:path";
import { promises as fs } from "node:fs";
import { backend, installVisualSourceFixtures, login } from "./fixtures";
const evidence = process.env.QA_RUN_DIRECTORY!;
const taskTitle = "西湖森林防火巡查 · QA";
const resourceTitle = "验收专用飞机 · QA";
const pilotName = "界面验收飞手";
test.describe.configure({ mode: "serial" });
let pilotId: string, deviceId: string, taskId: string;
const consoleErrors: string[] = [];
async function navigate(page: Page, label: string) {
  await page
    .getByRole("navigation", { name: "能力中心" })
    .getByRole("button", { name: label, exact: true })
    .click();
  await expect(page.locator(".page-header h1")).toHaveText(label);
}
async function fillTask(
  page: Page,
  title: string,
  start = "2030-10-15T09:00",
  end = "2030-10-15T10:00",
) {
  await page.getByRole("button", { name: "提报需求", exact: true }).click();
  const dialog = page.getByRole("dialog", {
    name: "提报飞行需求",
    exact: true,
  });
  await dialog.getByLabel("任务名称").fill(title);
  await chooseSelect(dialog.getByLabel("应用场景"), { label: "森林防火" });
  await chooseSelect(dialog.getByLabel("作业区域"), { label: "西湖区" });
  await dialog.getByLabel("期望开始时间").fill(start);
  await dialog.getByLabel("期望结束时间").fill(end);
  await dialog
    .getByLabel("作业要求")
    .fill("固定界面验收任务：核查重点区域，提交人工巡查成果。");
  await dialog.getByRole("button", { name: "提交需求", exact: true }).click();
  await expect(dialog).toHaveCount(0);
}
async function action(page: Page, title: string, note?: string) {
  const outer = page.getByRole("dialog", { name: taskTitle, exact: true });
  await outer.getByRole("button", { name: title, exact: true }).click();
  const modalTitle =
    title === "分配资源"
      ? "分配执行资源"
      : title === "退回完善"
        ? "退回完善"
        : title;
  const dialog = page.getByRole("dialog", { name: modalTitle, exact: true });
  if (title === "分配资源") {
    await chooseSelect(dialog.getByLabel("执行设备"), deviceId);
    await chooseSelect(dialog.getByLabel("执行飞手"), pilotId);
  }
  if (title === "提交成果")
    await dialog
      .getByLabel("成果说明")
      .fill("已完成 QA 巡查，人工成果说明已补充。");
  if (note) await dialog.getByLabel("办理说明").fill(note);
  await dialog.getByRole("button", { name: modalTitle, exact: true }).click();
  await expect(dialog).toHaveCount(0);
}
test.beforeEach(async ({ page }) => {
  await installVisualSourceFixtures(page);
  page.on("pageerror", (error) => consoleErrors.push(error.message));
  await page.clock.setFixedTime(new Date("2026-10-14T09:00:00+08:00"));
  await login(page);
});
test("真实登录、组织、设备与飞手登记，以及任务闭环、验收退回和取消", async ({
  page,
}) => {
  await test.step("新增组织", async () => {
    await page.getByRole("button", { name: "平台设置", exact: true }).click();
    await page.getByRole("tab", { name: "组织与权限" }).click();
    await page.getByRole("button", { name: "新增组织", exact: true }).click();
    const modal = page.getByRole("dialog", { name: "新增组织", exact: true });
    await modal.getByLabel("组织名称").fill("界面验收组织 · QA");
    await chooseSelect(modal.getByLabel("所属区域"), { label: "西湖区" });
    await modal.getByRole("button", { name: "保存", exact: true }).click();
    await expect(modal).toHaveCount(0);
    await page
      .getByRole("dialog", { name: "平台设置", exact: true })
      .getByRole("button", { name: "关闭", exact: true })
      .click();
  });
  await test.step("登记设备", async () => {
    await navigate(page, "资源管理");
    await page.getByRole("button", { name: "登记资源", exact: true }).click();
    const modal = page.getByRole("dialog", {
      name: "登记设备资源",
      exact: true,
    });
    await modal.getByLabel("资源名称").fill(resourceTitle);
    await chooseSelect(modal.getByLabel("所属区域"), { label: "西湖区" });
    await modal.getByLabel("型号 / 类型").fill("QA-M3D");
    await chooseSelect(modal.getByLabel("关联来源设备"), "qa-aircraft-001");
    await modal.getByRole("button", { name: "保存", exact: true }).click();
    await expect(modal).toHaveCount(0);
    await expect(
      page.getByRole("row").filter({ hasText: resourceTitle }),
    ).toBeVisible();
    const resources = await backend<{ items: { id: string; title: string }[] }>(
      page.request,
      "/resources?kind=DEVICE",
      undefined,
      "GET",
    );
    deviceId = resources.items.find((d) => d.title === resourceTitle)!.id;
  });
  await test.step("新增飞手", async () => {
    await page.getByRole("button", { name: "平台设置", exact: true }).click();
    await page.getByRole("tab", { name: "组织与权限" }).click();
    await page.getByRole("button", { name: "新增账号", exact: true }).click();
    const modal = page.getByRole("dialog", {
      name: "新增本地账号",
      exact: true,
    });
    await modal.getByLabel("登录账号").fill("qa_pilot");
    await modal.getByLabel("姓名").fill(pilotName);
    await modal
      .getByLabel("初始密码（至少12位）")
      .fill(process.env.QA_PASSWORD!);
    await chooseSelect(modal.getByLabel("岗位角色"), "PILOT");
    await chooseSelect(modal.getByLabel("所属组织"), { label: "平台运营中心" });
    await modal.getByLabel("可见区域（逗号分隔）").fill("西湖区");
    await modal.getByLabel("授权设备 ID（逗号分隔）").fill(deviceId);
    await modal.getByRole("button", { name: "保存", exact: true }).click();
    await expect(modal).toHaveCount(0);
    const users = await backend<{ items: { id: string; username: string }[] }>(
      page.request,
      "/users?role=PILOT",
      undefined,
      "GET",
    );
    pilotId = users.items.find((u) => u.username === "qa_pilot")!.id;
    await page
      .getByRole("dialog", { name: "平台设置", exact: true })
      .getByRole("button", { name: "关闭", exact: true })
      .click();
  });
  await test.step("提报与分配", async () => {
    await navigate(page, "任务调度");
    await fillTask(page, taskTitle);
    await page.getByRole("row").filter({ hasText: taskTitle }).click();
    await expect(
      page
        .getByRole("dialog", { name: taskTitle, exact: true })
        .locator(".detail-heading"),
    ).toContainText("待分配");
    await action(page, "分配资源");
    await expect(
      page
        .getByRole("dialog", { name: taskTitle, exact: true })
        .locator(".detail-heading"),
    ).toContainText("待执行");
  });
  await test.step("执行、成果、验收退回与重新验收", async () => {
    await action(page, "开始执行");
    await action(page, "提交成果");
    await action(page, "退回完善", "补充巡查成果说明");
    await expect(
      page
        .getByRole("dialog", { name: taskTitle, exact: true })
        .locator(".detail-heading"),
    ).toContainText("执行中");
    await action(page, "提交成果");
    await action(page, "验收通过");
    const detail = page.getByRole("dialog", { name: taskTitle, exact: true });
    await expect(detail.locator(".detail-heading")).toContainText("已完成");
    await expect(detail.locator(".timeline li")).toHaveCount(8);
    await detail.getByRole("button", { name: "关闭", exact: true }).click();
    const tasks = await backend<{
      items: { id: string; title: string; status: string }[];
    }>(page.request, "/tasks", undefined, "GET");
    taskId = tasks.items.find((t) => t.title === taskTitle)!.id;
    expect(tasks.items.find((t) => t.id === taskId)!.status).toBe("COMPLETED");
    await page.reload();
    await expect(
      page.getByRole("row").filter({ hasText: taskTitle }),
    ).toContainText("已完成");
  });
  await test.step("受理退回、重新提交及取消", async () => {
    await fillTask(
      page,
      "待补正与取消任务 · QA",
      "2030-10-16T09:00",
      "2030-10-16T10:00",
    );
    await page
      .getByRole("row")
      .filter({ hasText: "待补正与取消任务 · QA" })
      .click();
    const detail = page.getByRole("dialog", {
      name: "待补正与取消任务 · QA",
      exact: true,
    });
    await detail.getByRole("button", { name: "退回完善", exact: true }).click();
    let dialog = page.getByRole("dialog", { name: "退回完善", exact: true });
    await dialog.getByLabel("办理说明").fill("请补充范围");
    await dialog.getByRole("button", { name: "退回完善", exact: true }).click();
    await expect(dialog).toHaveCount(0);
    await detail.getByRole("button", { name: "编辑需求", exact: true }).click();
    const edit = page.getByRole("dialog", {
      name: "编辑退回需求",
      exact: true,
    });
    await edit.getByLabel("作业要求").fill("补正后的巡查范围与人工成果要求。");
    await edit.getByRole("button", { name: "保存修改", exact: true }).click();
    await expect(edit).toHaveCount(0);
    await expect(detail).toContainText("补正后的巡查范围与人工成果要求。");
    await detail.getByRole("button", { name: "重新提交", exact: true }).click();
    dialog = page.getByRole("dialog", { name: "提交需求", exact: true });
    await dialog.getByRole("button", { name: "提交需求", exact: true }).click();
    await expect(dialog).toHaveCount(0);
    await detail.getByRole("button", { name: "取消任务", exact: true }).click();
    dialog = page.getByRole("dialog", { name: "取消任务", exact: true });
    await dialog.getByLabel("办理说明").fill("验收任务取消");
    await dialog.getByRole("button", { name: "取消任务", exact: true }).click();
    await expect(dialog).toHaveCount(0);
    await expect(detail.locator(".detail-heading")).toContainText("已取消");
  });
  await test.step("地图绘制航线及编辑回读", async () => {
    await page
      .getByRole("dialog", { name: "待补正与取消任务 · QA", exact: true })
      .getByRole("button", { name: "关闭", exact: true })
      .click();
    await navigate(page, "资源管理");
    await page
      .locator(".resource-catalog")
      .getByRole("button", { name: "航线资源", exact: true })
      .click();
    await page.getByRole("button", { name: "登记资源", exact: true }).click();
    let modal = page.getByRole("dialog", { name: "登记航线资源", exact: true });
    await modal.getByLabel("资源名称").fill("地图绘制航线 · QA");
    await chooseSelect(modal.getByLabel("所属区域"), { label: "西湖区" });
    const canvas = modal.locator(".geometry-map canvas");
    await expect(canvas).toBeVisible();
    await canvas.click({ position: { x: 80, y: 100 } });
    await canvas.click({ position: { x: 150, y: 160 } });
    await expect(modal.locator(".geometry-hint")).toContainText("2 个点");
    await modal.getByRole("button", { name: "保存", exact: true }).click();
    await expect(modal).toHaveCount(0);
    const resources = await backend<{
      items: {
        id: string;
        title: string;
        metadata: { geometry: { type: string; coordinates: number[][] } };
      }[];
    }>(page.request, "/resources?kind=ROUTE", undefined, "GET");
    const route = resources.items.find(
      (item) => item.title === "地图绘制航线 · QA",
    )!;
    expect(route.metadata.geometry.type).toBe("LineString");
    expect(route.metadata.geometry.coordinates).toHaveLength(2);
    await page
      .getByRole("row")
      .filter({ hasText: "地图绘制航线 · QA" })
      .click();
    await page
      .getByRole("dialog", { name: "地图绘制航线 · QA", exact: true })
      .getByRole("button", { name: "编辑档案", exact: true })
      .click();
    modal = page.getByRole("dialog", { name: "编辑资源档案", exact: true });
    await expect(modal.locator(".geometry-hint")).toContainText("2 个点");
    await modal
      .getByLabel("能力与备注")
      .fill("地图绘制保存后再次编辑的航线备注。");
    await modal.getByRole("button", { name: "保存", exact: true }).click();
    await expect(modal).toHaveCount(0);
    const reread = await backend<{
      metadata: { geometry: unknown; description: string };
    }>(page.request, `/resources/${route.id}`, undefined, "GET");
    expect(reread.metadata.geometry).toEqual(route.metadata.geometry);
    expect(reread.metadata.description).toBe(
      "地图绘制保存后再次编辑的航线备注。",
    );
  });
  expect(consoleErrors).toEqual([]);
});
test("七个中心、设置、大屏、详情和真实控制禁用；三个桌面尺寸无页面横向溢出", async ({
  page,
}) => {
  // Fixed business fixtures are created only in the isolated QA database, before visual capture.
  for (const [title, kind, state] of [
    ["西湖森林防火日常计划 · QA", "DAILY", "PENDING_REVIEW"],
    ["河道巡查长期计划 · QA", "LONG_TERM", "APPROVED"],
    ["巡查设备准入补正 · QA", "DEVICE_ADMISSION", "RETURNED"],
  ]) {
    const item = await backend<{ id: string }>(page.request, "/plans", {
      title,
      kind,
      region: "西湖区",
      startAt: "2030-10-15T01:00:00Z",
      endAt: "2030-10-15T03:00:00Z",
      height: 100,
      scope: "西湖区重点巡查区域；固定界面验收材料。",
    });
    await backend(page.request, `/plans/${item.id}/actions`, {
      action: "SUBMIT",
    });
    if (state === "APPROVED")
      await backend(page.request, `/plans/${item.id}/actions`, {
        action: "APPROVE",
      });
    if (state === "RETURNED")
      await backend(page.request, `/plans/${item.id}/actions`, {
        action: "RETURN",
        note: "补充设备登记材料",
      });
  }
  await backend(page.request, "/cases", {
    title: "林地疑似烟点核查 · QA",
    scene: "森林防火",
    region: "西湖区",
    description: "固定截图线索，等待人工复核。",
    taskId,
  });
  await backend(page.request, "/cases", {
    title: "矿区作业边界变化 · QA",
    scene: "矿产监管",
    region: "西湖区",
    description: "界面验收专用线索；不代表真实识别结果。",
  });
  await backend(page.request, "/consultations", {
    title: "飞手培训服务咨询 · QA",
    kind: "TRAINING",
    region: "西湖区",
    description: "固定界面验收咨询事项。",
  });
  // Seeding used direct API writes; reload once so the client starts with a fresh query cache.
  await page.reload();
  await expect(
    page.getByRole("navigation", { name: "能力中心" }),
  ).toBeVisible();
  await expect(
    page
      .locator(".queue-card")
      .filter({ hasText: "西湖森林防火日常计划 · QA" }),
  ).toBeVisible();
  await fs.mkdir(path.join(evidence, "screenshots"), { recursive: true });
  const centers = [
    ["overview", "态势感知"],
    ["dispatch", "任务调度"],
    ["flight", "飞行管控"],
    ["services", "飞行服务"],
    ["resources", "资源管理"],
    ["algorithms", "飞行算法"],
    ["scenes", "场景应用"],
  ];
  for (const viewport of [
    { width: 1920, height: 1080 },
    { width: 1280, height: 720 },
    { width: 1024, height: 768 },
  ]) {
    await page.setViewportSize(viewport);
    for (const [id, label] of centers) {
      await navigate(page, label);
      if (id === "services")
        await expect(
          page
            .locator(".queue-card")
            .filter({ hasText: "西湖森林防火日常计划 · QA" }),
        ).toBeVisible();
      if (id === "scenes")
        await expect(
          page
            .locator(".queue-card")
            .filter({ hasText: "林地疑似烟点核查 · QA" }),
        ).toBeVisible();
      if (id === "dispatch")
        await expect(
          page.getByRole("row").filter({ hasText: taskTitle }),
        ).toBeVisible();
      if (id === "resources")
        await expect(
          page.getByRole("row").filter({ hasText: resourceTitle }),
        ).toBeVisible();
      if (id === "algorithms")
        await expect(
          page.getByRole("heading", { name: "森林烟火识别", exact: true }),
        ).toBeVisible();
      if (id === "overview" || id === "flight")
        await expect(page.locator(".map-marker").first()).toBeVisible();
      if (id === "overview" && viewport.width === 1920) {
        await expect(page.locator(".map-marker")).toHaveCount(3);
        await page.getByRole("button", { name: "航空器", exact: true }).click();
        await expect(page.locator(".map-marker")).toHaveCount(1);
        await page.getByRole("button", { name: "起降点", exact: true }).click();
        await expect(page.locator(".map-marker")).toHaveCount(0);
        await page.getByRole("button", { name: "航空器", exact: true }).click();
        await page.getByRole("button", { name: "起降点", exact: true }).click();
        await expect(page.locator(".map-marker")).toHaveCount(3);
        await page.getByRole("button", { name: "2D", exact: true }).click();
        await expect(
          page.getByRole("button", { name: "2D", exact: true }),
        ).toHaveAttribute("aria-pressed", "true");
        await page.getByRole("button", { name: "电子图", exact: true }).click();
        await expect(page.locator(".map-marker")).toHaveCount(3);
        await page.getByRole("button", { name: "影像", exact: true }).click();
        await page.getByRole("button", { name: "3D", exact: true }).click();
        await expect(page.locator(".map-marker")).toHaveCount(3);
      }
      await expect(page.locator(".spin")).toHaveCount(0);
      await page.waitForTimeout(350);
      await page.screenshot({
        path: path.join(
          evidence,
          "screenshots",
          `${id}-${viewport.width}x${viewport.height}.png`,
        ),
        animations: "disabled",
      });
      const dimensions = await page.evaluate(() => ({
        width: document.documentElement.clientWidth,
        scroll: document.documentElement.scrollWidth,
      }));
      expect(
        dimensions.scroll,
        `${label} ${viewport.width} 页面横向溢出`,
      ).toBeLessThanOrEqual(dimensions.width + 1);
      if (id === "flight") {
        for (const action of [
          "下发任务",
          "立即起飞",
          "立即返航",
          "发送云台指令",
          "发送喊话",
        ])
          await expect(
            page.getByRole("button", { name: action, exact: true }),
          ).toBeDisabled();
      }
    }
    await page.getByRole("button", { name: "平台设置", exact: true }).click();
    await expect(
      page.getByRole("dialog", { name: "平台设置", exact: true }),
    ).toBeVisible();
    await expect(page.locator(".spin")).toHaveCount(0);
    await page.screenshot({
      path: path.join(
        evidence,
        "screenshots",
        `settings-${viewport.width}x${viewport.height}.png`,
      ),
      animations: "disabled",
    });
    await page
      .getByRole("dialog", { name: "平台设置", exact: true })
      .getByRole("button", { name: "关闭", exact: true })
      .click();
  }
  await page.setViewportSize({ width: 1920, height: 1080 });
  await navigate(page, "飞行管控");
  await page
    .getByRole("button", { name: "查看观测与执行记录", exact: true })
    .click();
  const observation = page.getByRole("dialog", {
    name: "设备观测与执行记录",
    exact: true,
  });
  await expect(
    observation.getByRole("row").filter({ hasText: "原生巡查执行 · QA" }),
  ).toBeVisible();
  await expect(
    observation.getByRole("row").filter({ hasText: "原生巡查执行 · QA" }),
  ).toContainText("未知");
  await page.screenshot({
    path: path.join(evidence, "screenshots", "flight-records-1920x1080.png"),
    animations: "disabled",
  });
  await observation.getByRole("button", { name: "关闭", exact: true }).click();
  await test.step("观测失败保留末次位置并强制未知状态", async () => {
    await expect(page.locator(".flight-control > .status")).toContainText(
      "在线",
    );
    const telemetryFailure = (route: Route) =>
      route.fulfill({
        status: 503,
        json: {
          code: "SOURCE_UNAVAILABLE",
          message: "QA 来源观测暂不可用",
          data: null,
        },
      });
    await page.route("**/api/v1/devices/*/telemetry", telemetryFailure);
    await expect(page.locator(".flight-control .form-error")).toContainText(
      "当前观测不可用：QA 来源观测暂不可用",
    );
    await expect(page.locator(".flight-control > .status")).toContainText(
      "未知",
    );
    await expect(page.locator(".telemetry-strip .status")).toContainText(
      "未知",
    );
    await expect(page.locator(".map-marker").first()).toBeVisible();
    await page.unroute("**/api/v1/devices/*/telemetry", telemetryFailure);
    await expect(page.locator(".flight-control .form-error")).toHaveCount(0);
    await expect(page.locator(".flight-control > .status")).toContainText(
      "在线",
    );
  });
  await navigate(page, "任务调度");
  await page.getByRole("row").filter({ hasText: taskTitle }).click();
  await expect(
    page
      .getByRole("dialog", { name: taskTitle, exact: true })
      .locator(".timeline li"),
  ).toHaveCount(8);
  await expect(page.locator(".spin")).toHaveCount(0);
  await page.screenshot({
    path: path.join(evidence, "screenshots", "task-detail-1920x1080.png"),
    animations: "disabled",
  });
  await page
    .getByRole("dialog", { name: taskTitle, exact: true })
    .getByRole("button", { name: "关闭", exact: true })
    .click();
  await page.getByRole("button", { name: "指挥大屏", exact: true }).click();
  await expect(page.locator(".app-shell.board")).toBeVisible();
  await expect(page.locator(".map-marker").first()).toBeVisible();
  await expect(page.locator(".spin")).toHaveCount(0);
  await page.waitForTimeout(350);
  await page.screenshot({
    path: path.join(evidence, "screenshots", "command-screen-1920x1080.png"),
    animations: "disabled",
  });
  await test.step("行业线索复核、处置后直接归档", async () => {
    await page.getByRole("button", { name: "返回工作台", exact: true }).click();
    await navigate(page, "场景应用");
    await page
      .locator(".queue-card")
      .filter({ hasText: "林地疑似烟点核查 · QA" })
      .click();
    await expect(page.locator(".object-heading")).toContainText("待复核");
    for (const [title, conclusion, status] of [
      ["复核通过", "人工复核确认线索，需要现场处置。", "待处置"],
      ["登记处置并归档", "人工处置已完成，证据已登记并归档。", "已归档"],
    ]) {
      await page.getByRole("button", { name: title, exact: true }).click();
      const modal = page.getByRole("dialog", { name: title, exact: true });
      await modal.getByLabel("人工结论 / 处置结果").fill(conclusion);
      await modal.getByRole("button", { name: title, exact: true }).click();
      await expect(modal).toHaveCount(0);
      await expect(page.locator(".object-heading")).toContainText(status);
    }
    await chooseSelect(page.getByLabel("事项状态"), "archived");
    await expect(
      page.locator(".queue-card").filter({ hasText: "林地疑似烟点核查 · QA" }),
    ).toContainText("已归档");
    await expect(
      page.getByRole("button", { name: "完成归档", exact: true }),
    ).toHaveCount(0);
  });
  expect(consoleErrors).toEqual([]);
});
test("执行飞手实际登录只查看分配任务和设备范围", async ({ page }) => {
  await page.locator(".user-menu > button").click();
  await page.getByRole("button", { name: "退出登录", exact: true }).click();
  await expect(page.getByRole("heading", { name: "登录工作台" })).toBeVisible();
  await login(page, "qa_pilot", process.env.QA_PASSWORD!);
  await navigate(page, "任务调度");
  await expect(
    page.getByRole("row").filter({ hasText: taskTitle }),
  ).toBeVisible();
  await expect(
    page.getByRole("row").filter({ hasText: "待补正与取消任务 · QA" }),
  ).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "提报需求", exact: true }),
  ).toHaveCount(0);
  const tasks = await backend<{ items: { id: string }[] }>(
    page.request,
    "/tasks",
    undefined,
    "GET",
  );
  expect(tasks.items.every((t) => t.id === taskId)).toBe(true);
});
