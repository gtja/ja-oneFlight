import type { Entity, Page } from "./types";

export const DEFAULT_PAGE_SIZE = 100;
const MAX_CATALOG_SIZE = 10_000;
const API_PREFIX = "/api/v1";
const READ_ONLY_METHODS = new Set(["GET", "HEAD"]);
const SUCCESS_CODES = new Set(["SUCCESS", "OK", "0"]);

export class ApiError extends Error {
  constructor(
    public code: string,
    message: string,
    public status: number,
  ) {
    super(message);
  }
}
async function csrf() {
  const token = await api<{ token: string; headerName: string }>("/auth/csrf");
  if (
    !token ||
    typeof token.token !== "string" ||
    !token.token ||
    typeof token.headerName !== "string" ||
    !token.headerName
  )
    throw new ApiError(
      "INVALID_CSRF_RESPONSE",
      "登录验证信息无效，请刷新页面",
      502,
    );
  return token;
}
export async function api<T = Entity>(
  path: string,
  options: RequestInit = {},
): Promise<T> {
  const headers = new Headers(options.headers);
  if (options.body && !(options.body instanceof FormData))
    headers.set("Content-Type", "application/json");
  if (options.method && !READ_ONLY_METHODS.has(options.method.toUpperCase())) {
    const token = await csrf();
    headers.set(token.headerName, token.token);
  }
  const response = await fetch(`${API_PREFIX}${path}`, {
    ...options,
    headers,
    credentials: "include",
  });
  const json = await response.json().catch(() => ({
    code: "NETWORK_ERROR",
    message: "服务返回了无法识别的响应",
  }));
  if (!response.ok || (json.code && !SUCCESS_CODES.has(String(json.code))))
    throw new ApiError(
      json.code || "REQUEST_FAILED",
      json.message || "请求失败，请稍后重试",
      response.status,
    );
  return json.data as T;
}
export const write = <T = Entity>(
  path: string,
  body: unknown,
  method = "POST",
) => api<T>(path, { method, body: JSON.stringify(body) });
export function queryString(params: Record<string, unknown>) {
  const search = new URLSearchParams();
  Object.entries(params).forEach(([key, value]) => {
    if (value !== undefined && value !== null && value !== "")
      search.set(key, String(value));
  });
  return search.toString();
}
export async function readCatalog(
  path: string,
  params: Record<string, unknown> = {},
) {
  const read = (page: number) =>
    api<Page>(
      `${path}?${queryString({ ...params, page, pageSize: DEFAULT_PAGE_SIZE })}`,
    );
  const first = await read(1);
  if (
    !Number.isSafeInteger(first.total) ||
    first.total < 0 ||
    first.total > MAX_CATALOG_SIZE ||
    !Array.isArray(first.items)
  )
    throw new ApiError(
      "INVALID_CATALOG",
      "关联目录数量无效，请刷新后重试",
      502,
    );
  const pages = await Promise.all(
    Array.from(
      { length: Math.max(0, Math.ceil(first.total / DEFAULT_PAGE_SIZE) - 1) },
      (_, index) => read(index + 2),
    ),
  );
  const items = [...first.items, ...pages.flatMap((page) => page.items)];
  if (
    pages.some((page) => page.total !== first.total) ||
    items.length !== first.total ||
    new Set(items.map((item) => item.id)).size !== first.total
  )
    throw new ApiError(
      "CATALOG_CHANGED",
      "关联目录正在更新，请刷新后重试",
      409,
    );
  return { ...first, items };
}
