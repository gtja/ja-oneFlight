import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repository = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const database = "jdbc:mysql://192.0.2.50:31306/oneflight?serverTimezone=Asia/Shanghai";
const password = "synthetic$(__must_not_execute)' !#";

function fixture(run) {
  const directory = mkdtempSync(join(tmpdir(), "oneflight-dev-test-"));
  try {
    for (const path of ["scripts/lib", "frontend/node_modules/.bin", "backend", "bin", ".local"]) {
      mkdirSync(join(directory, path), { recursive: true });
    }
    for (const path of ["scripts/dev.sh", "scripts/init-env.sh", "scripts/lib/env.sh"]) {
      copyFileSync(join(repository, path), join(directory, path));
    }
    const records = join(directory, "commands.jsonl");
    const mock = `#!${process.execPath}
import { appendFileSync } from 'node:fs';
import { basename } from 'node:path';
const command = basename(process.argv[1]);
const keys = ['DB_URL', 'DB_USERNAME', 'DB_PASSWORD', 'SOURCE_TOKEN', 'SOURCE_TARGET_HOST', 'SOURCE_GATEWAY_ORIGIN', 'SOURCE_DUSHU_JDBC_URL', 'SOURCE_MQTT_URL', 'SOURCE_ALGORITHM_ORIGIN', 'ONEFLIGHT_API_PROXY_URL', 'ONEFLIGHT_DEV_PUBLIC_ORIGIN', 'UPLOAD_DIRECTORY', 'ONEFLIGHT_AUTH_MODE', 'ONEFLIGHT_TRANSPORT_MODE', 'ONEFLIGHT_PUBLIC_ORIGIN', 'FLIGHT_CONTROL_ORIGIN', 'FLIGHT_CONTROL_MODE', 'ONEFLIGHT_EMBED_VIEW', 'ALLOWED_ORIGINS', 'SESSION_COOKIE_SECURE', 'SESSION_COOKIE_NAME', 'SESSION_COOKIE_PATH', 'SERVER_PORT', 'SERVER_ADDRESS', 'SPRING_DATASOURCE_URL', 'SPRING_DATASOURCE_USERNAME', 'SPRING_DATASOURCE_PASSWORD', 'SPRING_DATASOURCE_HIKARI_JDBC_URL', 'SPRING_FLYWAY_URL', 'SPRING_FLYWAY_USER', 'SPRING_FLYWAY_PASSWORD'];
appendFileSync(process.env.TEST_COMMANDS, JSON.stringify({command, args:process.argv.slice(2), environment:Object.fromEntries(keys.map(key => [key, process.env[key]]))}) + '\\n');
if (command === 'docker' && process.argv[2] === 'info') console.log('arm64');
if (command === 'openssl') console.log('a'.repeat(Number(process.argv.at(-1)) * 2));
`;
    for (const command of ["mvn", "java", "docker", "curl", "pnpm", "openssl"]) {
      writeFileSync(join(directory, "bin", command), mock, { mode: 0o755 });
    }
    writeFileSync(join(directory, "frontend/node_modules/.bin/vite"), mock, { mode: 0o755 });
    const environment = Object.fromEntries(Object.entries(process.env).filter(([key]) => !/^(DB_|SOURCE_|ONEFLIGHT_|SPRING_|BOOTSTRAP_|FLIGHT_CONTROL_|SESSION_|MYSQL_|MAP_|WEB_PORT$|SERVER_|ALLOWED_ORIGINS$|UPLOAD_DIRECTORY$)/.test(key)));
    const execute = (args = [], script = "dev.sh", inherited = {}) => {
      const result = spawnSync("bash", [join(directory, "scripts", script), ...args], {
        cwd: directory,
        env: { ...environment, ...inherited, PATH: `${join(directory, "bin")}:${process.env.PATH}`, TEST_COMMANDS: records },
        encoding: "utf8",
        timeout: 10000,
      });
      assert.equal(result.error, undefined, result.error?.message);
      const calls = existsSync(records) ? readFileSync(records, "utf8").trim().split("\n").filter(Boolean).map(line => JSON.parse(line)) : [];
      return { ...result, calls };
    };
    const configure = (overrides = {}) => {
      const values = { DB_URL: database, DB_USERNAME: "synthetic-account", DB_PASSWORD: password, WEB_PORT: "8088", ...overrides };
      writeFileSync(join(directory, ".env"), Object.entries(values).map(([key, value]) => `${key}=${value}`).join("\n") + "\n");
    };
    run({ directory, configure, execute });
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}

for (const args of [[], ["--mysql"]]) {
  test(`dev ${args[0] || "default"} uses the configured remote business database without creating MySQL`, () => fixture(({ configure, execute }) => {
    configure();
    const result = execute(args);
    assert.equal(result.status, 0, result.stderr);
    const backend = result.calls.find(call => call.command === "mvn");
    assert.ok(backend, "native Java application must start");
    assert.equal(backend.environment.DB_URL, database);
    assert.equal(backend.environment.DB_USERNAME, "synthetic-account");
    assert.equal(backend.environment.DB_PASSWORD, password);
    assert.equal(result.calls.some(call => call.command === "docker" && call.args.some(arg => ["pull", "up", "run", "create"].includes(arg))), false);
  }));
}

test("development and packaging both use root configuration instead of stale source or preview overlays", () => fixture(({ directory, configure, execute }) => {
  configure({ ONEFLIGHT_AUTH_MODE: "4a", SOURCE_TOKEN: "synthetic-root-source" });
  writeFileSync(join(directory, ".local/source.env"), "DB_URL=jdbc:h2:file:wrong\nDB_USERNAME=wrong\nDB_PASSWORD=wrong\nONEFLIGHT_AUTH_MODE=local\nSOURCE_TOKEN=synthetic-source-override\n");
  mkdirSync(join(directory, ".local/run"), { recursive: true });
  writeFileSync(join(directory, ".local/run/local-preview.env"), "DB_URL=jdbc:h2:file:preview\nSOURCE_TOKEN=old-preview\nONEFLIGHT_AUTH_MODE=local\n");
  const result = execute([], "dev.sh", { DB_URL: "jdbc:h2:file:inherited", SOURCE_TOKEN: "inherited", SOURCE_TARGET_HOST: "stale-source", ONEFLIGHT_AUTH_MODE: "local", ONEFLIGHT_PUBLIC_ORIGIN: "https://stale.example" });
  assert.equal(result.status, 0, result.stderr);
  const backend = result.calls.find(call => call.command === "mvn");
  assert.equal(backend.environment.DB_URL, database);
  assert.equal(backend.environment.DB_USERNAME, "synthetic-account");
  assert.equal(backend.environment.DB_PASSWORD, password);
  assert.equal(backend.environment.SOURCE_TOKEN, "synthetic-root-source");
  assert.equal(backend.environment.SOURCE_TARGET_HOST, undefined);
  assert.equal(backend.environment.ONEFLIGHT_AUTH_MODE, "4a");
}));

test("--h2 is rejected before starting an application", () => fixture(({ configure, execute }) => {
  configure();
  const result = execute(["--h2"]);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /H2.*(?:自动化测试|automated tests)/i);
  assert.equal(result.calls.some(call => ["mvn", "vite"].includes(call.command)), false);
}));

test("missing remote credentials or a non-MySQL URL do not silently start another database", () => fixture(({ configure, execute }) => {
  for (const overrides of [{ DB_URL: "" }, { DB_USERNAME: "" }, { DB_PASSWORD: "" }, { DB_URL: "jdbc:h2:file:wrong" }]) {
    configure(overrides);
    const result = execute();
    assert.notEqual(result.status, 0);
    assert.equal(result.calls.some(call => ["mvn", "vite"].includes(call.command)), false);
    assert.equal(result.calls.some(call => call.command === "docker" && call.args.includes("up")), false);
  }
}));

test("legacy Spring datasource and Flyway overrides cannot redirect the configured business database", () => fixture(({ configure, execute }) => {
  configure({ SPRING_DATASOURCE_URL: "jdbc:h2:file:legacy", SPRING_DATASOURCE_HIKARI_JDBC_URL: "jdbc:h2:file:legacy",
    SPRING_FLYWAY_URL: "jdbc:h2:file:legacy", SPRING_DATASOURCE_USERNAME: "legacy", SPRING_FLYWAY_USER: "legacy" });
  const result = execute();
  assert.equal(result.status, 0, result.stderr);
  const environment = result.calls.find(call => call.command === "mvn").environment;
  for (const key of ["SPRING_DATASOURCE_URL", "SPRING_DATASOURCE_HIKARI_JDBC_URL", "SPRING_FLYWAY_URL"]) {
    assert.equal(environment[key], database);
  }
  for (const key of ["SPRING_DATASOURCE_USERNAME", "SPRING_FLYWAY_USER"]) assert.equal(environment[key], "synthetic-account");
  for (const key of ["SPRING_DATASOURCE_PASSWORD", "SPRING_FLYWAY_PASSWORD"]) assert.equal(environment[key], password);
}));

test("--container-api keeps using the existing container API without starting native Java", () => fixture(({ configure, execute }) => {
  configure({ DB_URL: "", DB_USERNAME: "", DB_PASSWORD: "", WEB_PORT: "18088" });
  const result = execute(["--container-api"]);
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.calls.some(call => call.command === "mvn"), false);
  assert.equal(result.calls.find(call => call.command === "vite").environment.ONEFLIGHT_API_PROXY_URL, "http://127.0.0.1:18088");
}));

test("HTTP IP 4A development serves the fixed callback origin rather than the old unused 5173 port", () => fixture(({ directory, configure, execute }) => {
  const serviceValues = {
    SOURCE_TOKEN: "synthetic-root-token", SOURCE_TARGET_HOST: "192.0.2.118:32716",
    SOURCE_GATEWAY_ORIGIN: "https://source.example.test:32716", SOURCE_DUSHU_JDBC_URL: "jdbc:mysql://192.0.2.118:3306/source",
    SOURCE_MQTT_URL: "tcp://192.0.2.118:32715", SOURCE_ALGORITHM_ORIGIN: "http://192.0.2.118:32052",
    ONEFLIGHT_AUTH_MODE: "4a", FLIGHT_CONTROL_MODE: "embedded", ONEFLIGHT_EMBED_VIEW: "native",
    SESSION_COOKIE_NAME: "EXISTING_SESSION", SESSION_COOKIE_PATH: "/api", UPLOAD_DIRECTORY: "/synthetic/shared/uploads",
  };
  configure({ ...serviceValues, ONEFLIGHT_TRANSPORT_MODE: "http-ip", FLIGHT_CONTROL_GATEWAY_SECRET: "g".repeat(32),
    ONEFLIGHT_PUBLIC_ORIGIN: "http://192.0.2.118:8088", FLIGHT_CONTROL_ORIGIN: "http://192.0.2.118:8089",
    ALLOWED_ORIGINS: "http://192.0.2.118:8088", SESSION_COOKIE_SECURE: "true" });
  const before = readFileSync(join(directory, ".env"), "utf8");
  const result = execute();
  assert.equal(result.status, 0, result.stderr);
  const backend = result.calls.find(call => call.command === "mvn");
  const frontend = result.calls.find(call => call.command === "vite");
  for (const [key, value] of Object.entries(serviceValues)) assert.equal(backend.environment[key], value, key);
  assert.equal(backend.environment.ONEFLIGHT_PUBLIC_ORIGIN, "http://127.0.0.1:8088");
  assert.equal(backend.environment.FLIGHT_CONTROL_ORIGIN, "http://127.0.0.1:8089");
  assert.equal(backend.environment.ALLOWED_ORIGINS, backend.environment.ONEFLIGHT_PUBLIC_ORIGIN);
  assert.equal(backend.environment.SESSION_COOKIE_SECURE, "false");
  assert.equal(backend.environment.SERVER_PORT, "8080");
  assert.equal(backend.environment.SERVER_ADDRESS, undefined);
  assert.equal(frontend.environment.ONEFLIGHT_API_PROXY_URL, "http://127.0.0.1:8080");
  assert.equal(frontend.environment.ONEFLIGHT_DEV_PUBLIC_ORIGIN, backend.environment.ONEFLIGHT_PUBLIC_ORIGIN);
  assert.deepEqual(frontend.args, ["--host", "127.0.0.1", "--port", "8088", "--strictPort"]);
  assert.match(result.stdout, /Web: http:\/\/127\.0\.0\.1:8088/);
  assert.equal(readFileSync(join(directory, ".env"), "utf8"), before);
  assert.equal(result.calls.some(call => call.command === "docker" && call.args.some(arg => ["stop", "restart", "run", "up"].includes(arg))), false);
}));

test("legacy local development keeps 5173 when no transport or external identity was requested", () => fixture(({ configure, execute }) => {
  configure();
  const result = execute();
  assert.equal(result.status, 0, result.stderr);
  const frontend = result.calls.find(call => call.command === "vite");
  assert.deepEqual(frontend.args, ["--host", "127.0.0.1", "--port", "5173", "--strictPort"]);
  assert.equal(frontend.environment.ONEFLIGHT_TRANSPORT_MODE, undefined);
  assert.equal(frontend.environment.ONEFLIGHT_DEV_PUBLIC_ORIGIN, undefined);
}));

test("the backend bind address is inherited only from root configuration so the Docker flight proxy stays reachable", () => fixture(({ configure, execute }) => {
  configure({ ONEFLIGHT_TRANSPORT_MODE: "http-ip" });
  let result = execute([], "dev.sh", { SERVER_ADDRESS: "127.0.0.1" });
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.calls.find(call => call.command === "mvn").environment.SERVER_ADDRESS, undefined);
  configure({ ONEFLIGHT_TRANSPORT_MODE: "http-ip", SERVER_ADDRESS: "0.0.0.0" });
  result = execute();
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.calls.filter(call => call.command === "mvn").at(-1).environment.SERVER_ADDRESS, "0.0.0.0");
}));

test("4A without an explicit transport selects one local HTTP IP entry", () => fixture(({ configure, execute }) => {
  configure({ ONEFLIGHT_AUTH_MODE: "4a" });
  const result = execute();
  assert.equal(result.status, 0, result.stderr);
  const backend = result.calls.find(call => call.command === "mvn");
  assert.equal(backend.environment.ONEFLIGHT_TRANSPORT_MODE, "http-ip");
  assert.equal(backend.environment.ONEFLIGHT_PUBLIC_ORIGIN, "http://127.0.0.1:8088");
  assert.equal(result.calls.find(call => call.command === "vite").args[3], "8088");
}));

test("explicit HTTPS keeps its fixed origins and secure cookie settings for the existing gateway", () => fixture(({ configure, execute }) => {
  configure({ ONEFLIGHT_TRANSPORT_MODE: "https", ONEFLIGHT_AUTH_MODE: "4a", FLIGHT_CONTROL_MODE: "embedded",
    FLIGHT_CONTROL_GATEWAY_SECRET: "g".repeat(32), ONEFLIGHT_PUBLIC_ORIGIN: "https://platform.example.test",
    FLIGHT_CONTROL_ORIGIN: "https://flight.example.test", ALLOWED_ORIGINS: "https://platform.example.test", SESSION_COOKIE_SECURE: "true" });
  const result = execute();
  assert.equal(result.status, 0, result.stderr);
  const backend = result.calls.find(call => call.command === "mvn");
  assert.equal(backend.environment.ONEFLIGHT_TRANSPORT_MODE, "https");
  assert.equal(backend.environment.ONEFLIGHT_PUBLIC_ORIGIN, "https://platform.example.test");
  assert.equal(backend.environment.FLIGHT_CONTROL_ORIGIN, "https://flight.example.test");
  assert.equal(backend.environment.ALLOWED_ORIGINS, "https://platform.example.test");
  assert.equal(backend.environment.SESSION_COOKIE_SECURE, "true");
  assert.equal(result.calls.find(call => call.command === "vite").args[3], "5173");
  assert.equal(result.calls.find(call => call.command === "vite").environment.ONEFLIGHT_DEV_PUBLIC_ORIGIN, undefined);
  assert.match(result.stdout, /HTTPS origins and cookies are preserved/);
}));

test("embedded startup explains a missing shared gateway secret without replacing it", () => fixture(({ configure, execute }) => {
  configure({ ONEFLIGHT_TRANSPORT_MODE: "http-ip", FLIGHT_CONTROL_MODE: "embedded" });
  const result = execute();
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /FLIGHT_CONTROL_GATEWAY_SECRET.*root \.env/);
  assert.equal(result.calls.some(call => ["mvn", "vite", "openssl"].includes(call.command)), false);
}));

test("HTTP IP 4A container-api mode cannot start a second mismatched login origin", () => fixture(({ configure, execute }) => {
  configure({ ONEFLIGHT_TRANSPORT_MODE: "http-ip", ONEFLIGHT_AUTH_MODE: "4a" });
  const result = execute(["--container-api"]);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /unified entry/);
  assert.equal(result.calls.some(call => ["mvn", "vite"].includes(call.command)), false);
}));

test("initializing an explicit remote database leaves its credentials for the operator", () => fixture(({ directory, execute }) => {
  writeFileSync(join(directory, ".env.example"), `DB_URL=${database}\nDB_USERNAME=\nDB_PASSWORD=\nMYSQL_ROOT_PASSWORD=\nBOOTSTRAP_ADMIN_PASSWORD=\n`);
  const result = execute([], "init-env.sh");
  assert.equal(result.status, 0, result.stderr);
  const configuration = readFileSync(join(directory, ".env"), "utf8");
  assert.match(configuration, /^DB_USERNAME=$/m);
  assert.match(configuration, /^DB_PASSWORD=$/m);
  assert.match(configuration, /^BOOTSTRAP_ADMIN_PASSWORD=[a-f0-9]+$/m);
}));

test("legacy Compose templates without DB_URL retain generated database credentials", () => fixture(({ directory, execute }) => {
  writeFileSync(join(directory, ".env.example"), "DB_USERNAME=oneflight\nDB_PASSWORD=\nMYSQL_ROOT_PASSWORD=\nBOOTSTRAP_ADMIN_PASSWORD=\n");
  const result = execute([], "init-env.sh");
  assert.equal(result.status, 0, result.stderr);
  assert.match(readFileSync(join(directory, ".env"), "utf8"), /^DB_PASSWORD=[a-f0-9]{48}$/m);
}));
