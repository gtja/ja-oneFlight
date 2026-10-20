import { test, expect } from "@playwright/test";
import path from "node:path";
import { promises as fs } from "node:fs";

test("实际部署、真实设备与真实底图只读检查", async ({ context, page }) => {
  const base = process.env.QA_BASE_URL!;
  await context.addCookies([
    {
      name: "JSESSIONID",
      value: process.env.QA_SESSION_COOKIE!,
      url: base,
      httpOnly: true,
      sameSite: "Lax",
      secure: base.startsWith("https:"),
    },
  ]);
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  let businessWrite = false;
  page.on("request", (request) => {
    if (
      new URL(request.url()).pathname.startsWith("/api/v1/") &&
      !["GET", "HEAD"].includes(request.method())
    )
      businessWrite = true;
  });
  await page.goto("/?view=overview");
  await expect(
    page.getByRole("navigation", { name: "能力中心" }),
  ).toBeVisible();
  const fleet = await page.request.get("/api/v1/devices?page=1&pageSize=100");
  expect(fleet.status()).toBe(200);
  const data = (await fleet.json()).data;
  expect(data.total).toBeGreaterThan(0);
  expect(data.items.length).toBeGreaterThan(0);
  await expect(page.locator(".map-marker").first()).toBeAttached();
  await expect(page.locator(".spin")).toHaveCount(0);
  await page.waitForTimeout(4000);
  const folder = path.join(process.env.QA_RUN_DIRECTORY!, "screenshots");
  await fs.mkdir(folder, { recursive: true });
  await page.screenshot({
    path: path.join(folder, "live-overview-1920x1080.png"),
    animations: "disabled",
  });
  const tileErrors = await page.locator(".map-failure").allTextContents();
  await page
    .getByRole("navigation", { name: "能力中心" })
    .getByRole("button", { name: "飞行管控", exact: true })
    .click();
  await expect(page.locator(".queue-card").first()).toBeVisible();
  for (const action of ["下发任务", "立即起飞", "立即返航"])
    await expect(
      page.getByRole("button", { name: action, exact: true }),
    ).toBeDisabled();
  await expect(page.locator(".spin")).toHaveCount(0);
  await page.waitForTimeout(1500);
  await page.screenshot({
    path: path.join(folder, "live-flight-1920x1080.png"),
    animations: "disabled",
  });
  expect(errors).toEqual([]);
  expect(businessWrite).toBe(false);
  expect(tileErrors).toEqual([]);
  console.log(
    `Read-only deployed app verified: authorizedDevices=${data.total}, displayedRows=${data.items.length}, businessWrites=0, pageErrors=0.`,
  );
});
