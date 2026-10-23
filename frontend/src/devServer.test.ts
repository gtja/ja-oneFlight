import { IncomingMessage, ServerResponse } from "node:http";
import { Socket } from "node:net";
import { describe, expect, it, vi } from "vitest";
import {
  canonicalDevOriginMiddleware,
  canonicalDevOriginPlugin,
} from "../devServer";

function run({
  origin = "http://127.0.0.1:8088",
  host = "localhost:8088",
  path = "/api/v1/auth/4a/start",
  method = "GET",
}: {
  origin?: string;
  host?: string;
  path?: string;
  method?: string;
} = {}) {
  const request = new IncomingMessage(new Socket());
  request.method = method;
  request.url = path;
  request.headers.host = host;
  request.headers["x-forwarded-host"] = "attacker.example";
  request.headers.forwarded = "host=attacker.example;proto=https";
  const response = new ServerResponse(request);
  const end = vi.spyOn(response, "end");
  const proxy = vi.fn();
  canonicalDevOriginMiddleware(origin)(request, response, proxy);
  return { response, proxy, end };
}

describe("开发登录入口规范化", () => {
  it.each(["GET", "HEAD"])(
    "localhost %s 在创建认证state之前跳转到固定入口并保留path/query",
    (method) => {
      const path =
        "/api/v1/auth/4a/start?view=flight&deviceId=source%2F1&taskId=task+two";
      const { response, proxy, end } = run({ method, path });
      expect(response.statusCode).toBe(307);
      expect(response.getHeader("Location")).toBe(
        `http://127.0.0.1:8088${path}`,
      );
      expect(response.getHeader("Cache-Control")).toBe("no-store");
      expect(proxy).not.toHaveBeenCalled();
      expect(end).toHaveBeenCalledOnce();
      expect(response.getHeader("Set-Cookie")).toBeUndefined();
    },
  );

  it.each([
    "attacker.example",
    "attacker.example:8088",
    "127.0.0.1:5173",
    "127.0.0.1:8088@attacker.example",
  ])("Host %s 和伪造Forwarded均不能改变跳转目标", (host) => {
    const { response, proxy } = run({
      host,
      path: "/?next=https%3A%2F%2Fattacker.example",
    });
    expect(response.getHeader("Location")).toBe(
      "http://127.0.0.1:8088/?next=https%3A%2F%2Fattacker.example",
    );
    expect(proxy).not.toHaveBeenCalled();
  });

  it.each([
    "http://attacker.example/api/v1/auth/4a/start",
    "//attacker.example/api",
    "/\\attacker.example/api",
    "/api\r\nLocation: https://attacker.example",
    "/api#fragment",
  ])("拒绝非origin-form或不安全请求目标 %j", (path) => {
    const { response, proxy } = run({ path });
    expect(response.statusCode).toBe(400);
    expect(response.getHeader("Location")).toBeUndefined();
    expect(response.getHeader("Cache-Control")).toBe("no-store");
    expect(proxy).not.toHaveBeenCalled();
  });

  it.each(["POST", "PUT", "DELETE", "PATCH", "OPTIONS"])(
    "错Host的%s不能进入代理或重定向写请求",
    (method) => {
      const { response, proxy, end } = run({
        method,
        path: "/api/v1/resources",
      });
      expect(response.statusCode).toBe(400);
      expect(response.getHeader("Location")).toBeUndefined();
      expect(response.getHeader("Cache-Control")).toBe("no-store");
      expect(String(end.mock.calls[0][0])).toContain("http://127.0.0.1:8088");
      expect(proxy).not.toHaveBeenCalled();
    },
  );

  it.each(["GET", "HEAD", "POST"])("正确Host %s完整透传", (method) => {
    const { response, proxy, end } = run({ host: "127.0.0.1:8088", method });
    expect(proxy).toHaveBeenCalledOnce();
    expect(response.getHeader("Location")).toBeUndefined();
    expect(response.getHeader("Cache-Control")).toBeUndefined();
    expect(end).not.toHaveBeenCalled();
  });

  it.each([undefined, ""])("未配置入口%j时完全保留原代理行为", (origin) => {
    const request = new IncomingMessage(new Socket());
    request.method = "POST";
    request.url = "/api/v1/resources";
    request.headers.host = "localhost:5173";
    const response = new ServerResponse(request);
    const proxy = vi.fn();
    canonicalDevOriginMiddleware(origin)(request, response, proxy);
    expect(proxy).toHaveBeenCalledOnce();
    expect(response.getHeader("Location")).toBeUndefined();
    expect(response.getHeader("Cache-Control")).toBeUndefined();
  });

  it("自定义端口和可选末尾斜线固定归一化", () => {
    const { response } = run({
      origin: "http://127.0.0.1:5200/",
      path: "/index.html?view=resources",
    });
    expect(response.getHeader("Location")).toBe(
      "http://127.0.0.1:5200/index.html?view=resources",
    );
  });

  it.each([
    "https://127.0.0.1:8088",
    "http://localhost:8088",
    "http://192.0.2.1:8088",
    "http://2130706433:8088",
    "http://127.0.0.1:0",
    "http://127.0.0.1:65536",
    "http://127.0.0.1:8088/path",
    "http://127.0.0.1:8088?next=bad",
    "http://127.0.0.1:8088#bad",
    "http://user@127.0.0.1:8088",
    " http://127.0.0.1:8088",
    "http://127.0.0.1:8088//",
  ])("错误配置%j在Vite启动配置阶段清晰失败", (origin) => {
    expect(() => canonicalDevOriginPlugin(origin)).toThrow(
      /ONEFLIGHT_DEV_PUBLIC_ORIGIN.*http:\/\/127\.0\.0\.1/,
    );
  });
});
