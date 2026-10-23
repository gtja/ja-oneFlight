// @vitest-environment jsdom
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Entity } from "../api";
import DeviceDetails from "./DeviceDetails";

const clients: QueryClient[] = [];
afterEach(() => {
  cleanup();
  clients.forEach((client) => client.clear());
  clients.length = 0;
  vi.unstubAllGlobals();
});
function show(device: Entity) {
  const requests: string[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL) => {
      const url = new URL(String(input), "http://localhost");
      requests.push(url.pathname);
      return new Response(
        JSON.stringify({
          code: "OK",
          data: url.pathname.startsWith("/api/v1/devices/")
            ? device
            : { items: [], total: 0, page: 1, pageSize: 20 },
        }),
        { headers: { "Content-Type": "application/json" } },
      );
    }),
  );
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  clients.push(client);
  render(
    <QueryClientProvider client={client}>
      <DeviceDetails device={device} />
    </QueryClientProvider>,
  );
  return requests;
}

describe("来源设备详情按实际类型展示", () => {
  it.each(["CAMERA", "RADAR", "AI_POD", "UNRECOGNIZED"])(
    "%s不展示或请求飞行记录",
    (type) => {
      const requests = show({
        id: "camera-id",
        type,
        name: "无人机名称不能代替类型",
        flightTotals: { sorties: 99 },
      });
      expect(screen.getByText("设备编号")).toBeTruthy();
      expect(screen.getByText("来源状态")).toBeTruthy();
      expect(screen.queryByText("累计飞行统计")).toBeNull();
      expect(screen.queryByText("设备飞行架次记录")).toBeNull();
      expect(requests).toEqual([]);
    },
  );
  it("无统计机巢不查飞行记录", () => {
    expect(show({ id: "dock", type: "DOCK", flightTotals: {} })).toEqual([]);
    expect(screen.queryByText("累计飞行统计")).toBeNull();
  });
  it.each([
    { id: "9223372036854775807", type: "UAV" },
    { id: "zero-dock", type: "DOCK", flightTotals: { sorties: 0 } },
  ])("$type使用原始字符串编号读取飞行记录", async (device) => {
    const requests = show(device);
    await waitFor(() => expect(requests).toContain("/api/v1/flights"));
    expect(requests).toContain(`/api/v1/devices/${device.id}`);
    expect(screen.getByText("累计飞行统计")).toBeTruthy();
    expect(screen.getByText("设备飞行架次记录")).toBeTruthy();
  });
});
