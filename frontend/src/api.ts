import { useQuery } from "@tanstack/react-query";
import { useEffect, useState } from "react";
export type Entity = {
  id: string;
  title?: string;
  name?: string;
  status?: string;
  region?: string;
  organizationId?: string;
  [key: string]: unknown;
};
export type Page<T = Entity> = {
  items: T[];
  total: number;
  page: number;
  pageSize: number;
};
export type CurrentUser = {
  id: string;
  username: string;
  displayName: string;
  role: "ADMIN" | "DISPATCH" | "DEPARTMENT" | "PILOT";
  organizationId: string;
  regions: string[];
  deviceIds: string[];
  organizationIds?: string[];
};
export class ApiError extends Error {
  constructor(
    public code: string,
    message: string,
    public status: number,
  ) {
    super(message);
  }
}
const prefix = "/api/v1";
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
  if (
    options.method &&
    !["GET", "HEAD"].includes(options.method.toUpperCase())
  ) {
    const token = await csrf();
    headers.set(token.headerName, token.token);
  }
  const response = await fetch(`${prefix}${path}`, {
    ...options,
    headers,
    credentials: "include",
  });
  const json = await response.json().catch(() => ({
    code: "NETWORK_ERROR",
    message: "服务返回了无法识别的响应",
  }));
  if (
    !response.ok ||
    (json.code && !["SUCCESS", "OK", "0"].includes(String(json.code)))
  )
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
  const q = new URLSearchParams();
  Object.entries(params).forEach(([k, v]) => {
    if (v !== undefined && v !== null && v !== "") q.set(k, String(v));
  });
  return q.toString();
}
export function useList(
  path: string,
  params: Record<string, unknown> = {},
  enabled = true,
) {
  const [page, setPage] = useState(1);
  const filters = queryString(params);
  useEffect(() => setPage(1), [path, filters]);
  const search = queryString({ page, pageSize: 100, ...params });
  const result = useQuery({
    queryKey: [path, search],
    queryFn: () => api<Page>(`${path}?${search}`),
    enabled,
  });
  return {
    ...result,
    data: result.isError ? undefined : result.data,
    page,
    setPage,
  };
}
export function useDevices(enabled = true) {
  const result = useQuery({
    queryKey: ["all-devices"],
    enabled,
    refetchInterval: 5000,
    queryFn: async () => {
      const first = await api<Page>("/devices?page=1&pageSize=100");
      const pages = await Promise.all(
        Array.from({ length: Math.ceil(first.total / 100) - 1 }, (_, i) =>
          api<Page>(`/devices?page=${i + 2}&pageSize=100`),
        ),
      );
      return {
        ...first,
        items: [...first.items, ...pages.flatMap((p) => p.items)],
      };
    },
  });
  return { ...result, data: result.isError ? undefined : result.data };
}

export async function readCatalog(
  path: string,
  params: Record<string, unknown> = {},
) {
  const read = (page: number) =>
    api<Page>(`${path}?${queryString({ ...params, page, pageSize: 100 })}`);
  const first = await read(1);
  if (
    !Number.isSafeInteger(first.total) ||
    first.total < 0 ||
    first.total > 10000 ||
    !Array.isArray(first.items)
  )
    throw new ApiError(
      "INVALID_CATALOG",
      "关联目录数量无效，请刷新后重试",
      502,
    );
  const pages = await Promise.all(
    Array.from(
      { length: Math.max(0, Math.ceil(first.total / 100) - 1) },
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

/** Selection and map associations need the complete catalog, while tables retain explicit pagination. */
export function useCatalog(
  path: string,
  params: Record<string, unknown> = {},
  enabled = true,
) {
  const result = useQuery({
    queryKey: ["catalog", path, queryString(params)],
    queryFn: () => readCatalog(path, params),
    enabled,
  });
  return { ...result, data: result.isError ? undefined : result.data };
}
export function useData<T = Entity>(
  path: string,
  enabled = true,
  interval?: number,
) {
  const result = useQuery({
    queryKey: [path],
    queryFn: () => api<T>(path),
    enabled,
    refetchInterval: interval,
  });
  return { ...result, data: result.isError ? undefined : result.data };
}
export const entityName = (entity?: Entity) =>
  String(
    entity?.title ||
      entity?.name ||
      entity?.deviceName ||
      entity?.appName ||
      "未命名",
  );
export const value = (entity: Entity, key: string, fallback = "—") =>
  entity[key] === undefined || entity[key] === null || entity[key] === ""
    ? fallback
    : String(entity[key]);
