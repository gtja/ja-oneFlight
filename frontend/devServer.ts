import type { Connect, Plugin } from "vite";

const ORIGIN_ENV = "ONEFLIGHT_DEV_PUBLIC_ORIGIN";

function trustedDevOrigin(value: string | undefined): URL | null {
  if (value === undefined || value === "") return null;
  const invalid = () =>
    new Error(
      `${ORIGIN_ENV} 必须为 http://127.0.0.1[:端口]，不能包含路径、参数或账号信息`,
    );
  // Require the literal loopback IPv4 address, including before URL normalization.
  if (!/^http:\/\/127\.0\.0\.1(?::[1-9][0-9]{0,4})?\/?$/.test(value))
    throw invalid();
  try {
    return new URL(value);
  } catch {
    throw invalid();
  }
}

/** Normalize the browser host before a proxied auth/start can create its session state. */
export function canonicalDevOriginMiddleware(
  value: string | undefined,
): Connect.NextHandleFunction {
  const canonical = trustedDevOrigin(value);
  return (request, response, next) => {
    if (!canonical) {
      next();
      return;
    }
    const path = request.url;
    // Only an HTTP origin-form request target is carried into Location. Never resolve
    // a browser-supplied absolute URL, authority or backslash against the fixed origin.
    if (
      !path ||
      !path.startsWith("/") ||
      path.startsWith("//") ||
      /[\\#\u0000-\u001f\u007f]/.test(path)
    ) {
      response.statusCode = 400;
      response.setHeader("Cache-Control", "no-store");
      response.setHeader("Content-Type", "text/plain; charset=utf-8");
      response.end(`请求路径无效，请从规范开发入口访问：${canonical.origin}`);
      return;
    }
    if (request.headers.host === canonical.host) {
      next();
      return;
    }
    response.setHeader("Cache-Control", "no-store");
    if (request.method === "GET" || request.method === "HEAD") {
      response.statusCode = 307;
      response.setHeader("Location", canonical.origin + path);
      response.end();
      return;
    }
    response.statusCode = 400;
    response.setHeader("Content-Type", "text/plain; charset=utf-8");
    response.end(`请从规范开发入口重新发起请求：${canonical.origin}`);
  };
}

export function canonicalDevOriginPlugin(value: string | undefined): Plugin {
  const middleware = canonicalDevOriginMiddleware(value);
  return {
    name: "oneflight-canonical-dev-origin",
    apply: "serve",
    configureServer(server) {
      // A direct configureServer registration runs before Vite's internal proxy.
      server.middlewares.use(middleware);
    },
  };
}
