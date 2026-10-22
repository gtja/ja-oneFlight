import { afterEach, describe, it, expect, vi } from "vitest";
import { api, ApiError, queryString, readCatalog, write } from "./api";
const envelope = (data: unknown, status = 200, code = "SUCCESS") =>
  new Response(
    JSON.stringify({
      code,
      message: code === "SUCCESS" ? "成功" : "来源服务不可用",
      data,
    }),
    { status, headers: { "Content-Type": "application/json" } },
  );
afterEach(() => vi.unstubAllGlobals());
describe("工作台请求边界", () => {
  it.each(["GET", "HEAD", "get", "head"])(
    "%s 读请求不获取CSRF令牌，并保留调用方请求头",
    async (method) => {
      const fetcher = vi.fn().mockResolvedValue(envelope({ id: "record-1" }));
      vi.stubGlobal("fetch", fetcher);
      await api("/tasks", { method, headers: { "X-Trace-Id": "trace-1" } });
      expect(fetcher).toHaveBeenCalledTimes(1);
      const [path, options] = fetcher.mock.calls[0];
      expect(path).toBe("/api/v1/tasks");
      expect(options.credentials).toBe("include");
      expect(options.headers.get("X-Trace-Id")).toBe("trace-1");
      expect(options.headers.has("X-CSRF-TOKEN")).toBe(false);
    },
  );
  it.each(["SUCCESS", "OK", "0"])(
    "兼容成功码 %s 并保留返回数据",
    async (code) => {
      vi.stubGlobal(
        "fetch",
        vi.fn().mockResolvedValue(envelope({ id: "record-1" }, 200, code)),
      );
      await expect(api("/tasks/record-1")).resolves.toEqual({ id: "record-1" });
    },
  );
  it("写操作携带本地会话和CSRF令牌，长ID完整传递", async () => {
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce(
        envelope({ token: "qa-token", headerName: "X-CSRF-TOKEN" }),
      )
      .mockResolvedValueOnce(envelope({ id: "9223372036854775807" }));
    vi.stubGlobal("fetch", fetcher);
    const result = await write("/tasks", { id: "9223372036854775807" });
    expect(result.id).toBe("9223372036854775807");
    const [path, options] = fetcher.mock.calls[1];
    expect(path).toBe("/api/v1/tasks");
    expect(options.credentials).toBe("include");
    expect(options.headers.get("X-CSRF-TOKEN")).toBe("qa-token");
    expect(options.body).toContain("9223372036854775807");
  });
  it("来源失败抛出明确错误，不能作为成功空列表", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(envelope(null, 503, "SOURCE_UNAVAILABLE")),
    );
    await expect(api("/flights")).rejects.toMatchObject({
      code: "SOURCE_UNAVAILABLE",
      status: 503,
    });
  });
  it("CSRF失败不会继续提交业务写操作", async () => {
    const fetcher = vi.fn().mockResolvedValue(envelope(null, 403, "FORBIDDEN"));
    vi.stubGlobal("fetch", fetcher);
    await expect(write("/tasks", {})).rejects.toBeInstanceOf(ApiError);
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
  it("无效JSON响应拒绝成功，搜索保留字符串ID和编码", async () => {
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValue(new Response("<html>error</html>", { status: 200 })),
    );
    await expect(api("/devices")).rejects.toMatchObject({
      code: "NETWORK_ERROR",
    });
    expect(
      queryString({
        deviceId: "9223372036854775807",
        keyword: "上城 & 河道",
        empty: "",
      }),
    ).toContain("deviceId=9223372036854775807");
    expect(
      new URLSearchParams(queryString({ keyword: "上城 & 河道" })).get(
        "keyword",
      ),
    ).toBe("上城 & 河道");
  });
});

describe("完整关联目录", () => {
  it("读取全部分页，保留超过100条的设备关联", async () => {
    const items = Array.from({ length: 101 }, (_, index) => ({
      id: String(index),
    }));
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce(
        envelope({
          items: items.slice(0, 100),
          total: 101,
          page: 1,
          pageSize: 100,
        }),
      )
      .mockResolvedValueOnce(
        envelope({
          items: items.slice(100),
          total: 101,
          page: 2,
          pageSize: 100,
        }),
      );
    vi.stubGlobal("fetch", fetcher);
    expect(
      (await readCatalog("/resources", { kind: "DEVICE" })).items.at(-1)?.id,
    ).toBe("100");
    expect(fetcher.mock.calls[1][0]).toContain("page=2");
  });
  it("目录变化或分页重复时拒绝残缺关联", async () => {
    const items = Array.from({ length: 100 }, (_, i) => ({ id: String(i) }));
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValueOnce(envelope({ items, total: 101 }))
        .mockResolvedValueOnce(envelope({ items: [items[0]], total: 101 })),
    );
    await expect(readCatalog("/resources")).rejects.toMatchObject({
      code: "CATALOG_CHANGED",
    });
  });
});
