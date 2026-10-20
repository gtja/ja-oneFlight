#!/usr/bin/env node
import { spawn } from "node:child_process";
import { promises as fs, createWriteStream } from "node:fs";
import net from "node:net";
import path from "node:path";
import { randomBytes } from "node:crypto";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const runId = new Date().toISOString().replace(/[:.]/g, "-");
const qaRoot = path.join(root, ".local", "qa", runId);
const backendPort = Number(process.env.QA_BACKEND_PORT || 8091);
const frontendPort = Number(process.env.QA_FRONTEND_PORT || 5174);
const baseUrl = `http://127.0.0.1:${frontendPort}`;
const apiUrl = `http://127.0.0.1:${backendPort}`;
const children = [];
const qaPassword = randomBytes(24).toString("base64url");
await fs.mkdir(qaRoot, { recursive: true, mode: 0o700 });
const isolated = Object.fromEntries(
  Object.entries(process.env).filter(
    ([key]) =>
      !key.startsWith("SOURCE_") &&
      !key.startsWith("DB_") &&
      !key.startsWith("BOOTSTRAP_") &&
      !key.startsWith("SPRING_") &&
      !key.startsWith("ONEFLIGHT_") &&
      !["JAVA_TOOL_OPTIONS", "_JAVA_OPTIONS"].includes(key) &&
      ![
        "SPRING_APPLICATION_JSON",
        "SPRING_CONFIG_LOCATION",
        "SPRING_CONFIG_ADDITIONAL_LOCATION",
      ].includes(key),
  ),
);
const qaEnv = {
  ...isolated,
  QA_FEEDBACK_REGRESSIONS: process.argv.includes("--feedback")
    ? "true"
    : "false",
  QA_BASE_URL: baseUrl,
  QA_API_URL: apiUrl,
  QA_RUN_DIRECTORY: qaRoot,
  QA_USERNAME: "qa_admin",
  QA_PASSWORD: qaPassword,
  QA_FRONTEND_PORT: String(frontendPort),
  QA_CHROME_PATH:
    process.env.QA_CHROME_PATH ||
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
};
function start(command, args, cwd, env, logName) {
  const child = spawn(command, args, {
    cwd,
    env,
    stdio: ["ignore", "pipe", "pipe"],
  });
  children.push(child);
  const log = createWriteStream(path.join(qaRoot, logName), { mode: 0o600 });
  child.stdout.pipe(log, { end: false });
  child.stderr.pipe(log, { end: false });
  child.on("close", () => log.end());
  return child;
}
async function run(command, args, cwd, env) {
  const child = spawn(command, args, { cwd, env, stdio: "inherit" });
  const code = await new Promise((resolve, reject) => {
    child.once("error", reject);
    child.once("exit", resolve);
  });
  if (code !== 0) throw new Error(`${command} exited with ${code}`);
}
async function ready(url, child) {
  for (let attempt = 0; attempt < 90; attempt++) {
    if (child.exitCode !== null)
      throw new Error(`QA service exited before ready. See ${qaRoot}`);
    try {
      if ((await fetch(url)).ok) return;
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
  throw new Error(`QA service did not become ready: ${url}`);
}
async function cleanup() {
  for (const child of children)
    if (child.exitCode === null) child.kill("SIGTERM");
  await new Promise((resolve) => setTimeout(resolve, 1500));
  for (const child of children)
    if (child.exitCode === null) child.kill("SIGKILL");
}
process.on("SIGINT", () => {
  void cleanup().finally(() => process.exit(130));
});
process.on("SIGTERM", () => {
  void cleanup().finally(() => process.exit(143));
});
async function assertFree(port) {
  await new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once("error", () =>
      reject(
        new Error(
          `QA port ${port} is in use; no tests were run against the existing service.`,
        ),
      ),
    );
    server.listen(port, "127.0.0.1", () => server.close(resolve));
  });
}
if (process.argv.includes("--live-readonly")) {
  let liveResult = 0;
  try {
    const liveUrl = process.env.QA_LIVE_BASE_URL || "http://127.0.0.1:8088";
    const origin = new URL(liveUrl);
    if (!["127.0.0.1", "localhost"].includes(origin.hostname))
      throw new Error("Live screenshot QA requires the local running app.");
    const values = {};
    for (const line of (
      await fs.readFile(path.join(root, ".env"), "utf8")
    ).split(/\r?\n/)) {
      const match = line.match(
        /^(BOOTSTRAP_ADMIN_USERNAME|BOOTSTRAP_ADMIN_PASSWORD)=(.*)$/,
      );
      if (match) {
        let value = match[2];
        if (value.startsWith('"') && value.endsWith('"'))
          value = JSON.parse(value);
        else if (value.startsWith("'") && value.endsWith("'"))
          value = value.slice(1, -1);
        values[match[1]] = value;
      }
    }
    const csrf = await fetch(`${liveUrl}/api/v1/auth/csrf`);
    if (!csrf.ok)
      throw new Error("Running app is not ready for read-only screenshot QA.");
    const token = (await csrf.json()).data;
    const firstCookie = csrf.headers
      .getSetCookie()
      .map((cookie) => cookie.split(";")[0])
      .join("; ");
    const auth = await fetch(`${liveUrl}/api/v1/auth/login`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Cookie: firstCookie,
        [token.headerName]: token.token,
      },
      body: JSON.stringify({
        username: values.BOOTSTRAP_ADMIN_USERNAME,
        password: values.BOOTSTRAP_ADMIN_PASSWORD,
      }),
    });
    if (!auth.ok)
      throw new Error(
        "Running app login failed; no business data was changed.",
      );
    const session =
      auth.headers
        .getSetCookie()
        .find((cookie) => cookie.startsWith("JSESSIONID=")) ||
      csrf.headers
        .getSetCookie()
        .find((cookie) => cookie.startsWith("JSESSIONID="));
    if (!session)
      throw new Error("Running app did not return a local session.");
    console.log(
      `Read-only native UI QA at ${liveUrl}; no source/map mocks and no business writes.`,
    );
    await run(
      process.execPath,
      [
        "node_modules/@playwright/test/cli.js",
        "test",
        "--config=playwright.config.ts",
        ...process.argv
          .slice(2)
          .filter(
            (value) =>
              !["--feedback", "--live-readonly", "--skip-build"].includes(
                value,
              ),
          ),
      ],
      path.join(root, "frontend"),
      {
        ...qaEnv,
        QA_LIVE_READONLY: "true",
        QA_BASE_URL: liveUrl,
        QA_SESSION_COOKIE: session.split(";")[0].slice("JSESSIONID=".length),
      },
    );
  } catch (error) {
    console.error(error.message);
    liveResult = 1;
  }
  console.log(`QA evidence: ${qaRoot}`);
  process.exit(liveResult);
}
let result = 0;
try {
  await assertFree(backendPort);
  await assertFree(frontendPort);
  if (!process.argv.includes("--skip-build"))
    await run(
      "mvn",
      ["-q", "-DskipTests", "package"],
      path.join(root, "backend"),
      isolated,
    );
  const jar = path.join(qaRoot, "oneflight-api.jar");
  await fs.copyFile(
    path.join(root, "backend", "target", "oneflight-api-1.0.0.jar"),
    jar,
  );
  console.log(
    `Isolated UI QA: H2 database in ${qaRoot}, backend ${backendPort}, frontend ${frontendPort}`,
  );
  const backend = start(
    "java",
    ["-jar", jar],
    qaRoot,
    {
      ...isolated,
      SERVER_PORT: String(backendPort),
      DB_URL: `jdbc:h2:file:${path.join(qaRoot, "qa-business")};MODE=MySQL;DATABASE_TO_LOWER=TRUE;DB_CLOSE_ON_EXIT=FALSE`,
      DB_USERNAME: "sa",
      DB_PASSWORD: "",
      BOOTSTRAP_ADMIN_USERNAME: qaEnv.QA_USERNAME,
      BOOTSTRAP_ADMIN_PASSWORD: qaPassword,
      BOOTSTRAP_ADMIN_DISPLAY_NAME: "界面验收管理员",
      ALLOWED_ORIGINS: baseUrl,
      UPLOAD_DIRECTORY: path.join(qaRoot, "uploads"),
      SOURCE_TOKEN: "",
      SOURCE_USERNAME: "",
      SOURCE_DUSHU_JDBC_URL: "",
      SOURCE_ICOS_JDBC_URL: "",
      SOURCE_MQTT_URL: "",
      SOURCE_ALGORITHM_ORIGIN: "http://127.0.0.1:1",
      SOURCE_TIMEOUT_SECONDS: "1",
      SESSION_COOKIE_SECURE: "false",
    },
    "backend.log",
  );
  await ready(`${apiUrl}/actuator/health`, backend);
  const frontend = start(
    process.execPath,
    [
      "node_modules/vite/bin/vite.js",
      "--host",
      "127.0.0.1",
      "--port",
      String(frontendPort),
      "--strictPort",
    ],
    path.join(root, "frontend"),
    { ...qaEnv, ONEFLIGHT_API_URL: apiUrl },
    "frontend.log",
  );
  await ready(baseUrl, frontend);
  await run(
    process.execPath,
    [
      "node_modules/@playwright/test/cli.js",
      "test",
      "--config=playwright.config.ts",
      ...process.argv
        .slice(2)
        .filter((v) => !["--skip-build", "--feedback"].includes(v)),
    ],
    path.join(root, "frontend"),
    qaEnv,
  );
} catch (error) {
  console.error(error.message);
  result = 1;
} finally {
  await cleanup();
}
console.log(`QA evidence: ${qaRoot}`);
process.exitCode = result;
