import { defineConfig } from "@playwright/test";
import path from "node:path";
const evidence =
  process.env.QA_RUN_DIRECTORY || path.resolve("../.local/qa-manual");
export default defineConfig({
  testDir: "./e2e",
  testMatch:
    process.env.QA_FEEDBACK_REGRESSIONS === "true"
      ? "**/feedback-regressions.spec.ts"
      : process.env.QA_LIVE_READONLY === "true"
        ? "**/live-readonly.spec.ts"
        : "**/platform.spec.ts",
  fullyParallel: false,
  workers: 1,
  timeout: 90_000,
  expect: { timeout: 15_000 },
  retries: 0,
  outputDir: path.join(evidence, "artifacts"),
  reporter: [
    ["list"],
    ["html", { outputFolder: path.join(evidence, "report"), open: "never" }],
    ["json", { outputFile: path.join(evidence, "results.json") }],
  ],
  use: {
    actionTimeout: 15_000,
    baseURL: process.env.QA_BASE_URL || "http://127.0.0.1:5174",
    locale: "zh-CN",
    timezoneId: "Asia/Shanghai",
    viewport: { width: 1920, height: 1080 },
    colorScheme: "dark",
    launchOptions: {
      executablePath:
        process.env.QA_CHROME_PATH ||
        "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
      args: ["--disable-dev-shm-usage"],
    },
    screenshot: "only-on-failure",
    trace:
      process.env.QA_LIVE_READONLY === "true" ? "off" : "retain-on-failure",
    video: "off",
  },
  projects: [{ name: "installed-chrome", use: { browserName: "chromium" } }],
});
