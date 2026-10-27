import { useQuery } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { api, DEFAULT_PAGE_SIZE, queryString, readCatalog } from "./client";
import type { Entity, Page } from "./types";

export function useList(
  path: string,
  params: Record<string, unknown> = {},
  enabled = true,
) {
  const [page, setPage] = useState(1);
  const filters = queryString(params);
  useEffect(() => setPage(1), [path, filters]);
  const search = queryString({ page, pageSize: DEFAULT_PAGE_SIZE, ...params });
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
      const first = await api<Page>(
        `/devices?page=1&pageSize=${DEFAULT_PAGE_SIZE}`,
      );
      const pages = await Promise.all(
        Array.from(
          { length: Math.ceil(first.total / DEFAULT_PAGE_SIZE) - 1 },
          (_, index) =>
            api<Page>(
              `/devices?page=${index + 2}&pageSize=${DEFAULT_PAGE_SIZE}`,
            ),
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

/** Selection and map associations need the complete catalog, while tables retain explicit pagination. */
export function useCatalog(
  path: string,
  params: Record<string, unknown> = {},
  enabled = true,
  interval?: number,
) {
  const result = useQuery({
    queryKey: ["catalog", path, queryString(params)],
    queryFn: () => readCatalog(path, params),
    enabled,
    refetchInterval: interval,
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
