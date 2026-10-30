// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { CurrentUser } from "../../api";
import { UserContext } from "../../context";
import SourceFlightPhotos from "./SourceFlightPhotos";

const clients: QueryClient[] = [];
afterEach(() => {
  cleanup();
  clients.forEach((client) => client.clear());
  clients.length = 0;
  vi.unstubAllGlobals();
});

const photo = {
  id: "DUSHU:source-device:photo-1",
  sourceMediaId: "photo-1",
  sourceDeviceId: "source-device",
  title: "forest-flight-1.jpg",
  contentType: "image/jpeg",
  previewUrl: "/api/v1/source-data/flight-photos/preview?deviceId=source-device&sourceMediaId=photo-1",
  capturedFrom: "2026-10-29T02:00:00Z",
  photoType: "可见光",
  longitude: 120.1,
  latitude: 30.2,
  taskId: "task-1",
  entityTitle: "森林巡查任务",
  associationStatus: "AUTO_MATCHED",
  taskCandidates: [{ id: "task-1", title: "森林巡查任务", startAt: "2026-10-29T01:00:00Z", endAt: "2026-10-29T03:00:00Z" }],
};

function start(role: CurrentUser["role"] = "ADMIN") {
  const requests: Array<{ url: URL; method: string; body?: unknown }> = [];
  const user: CurrentUser = {
    id: "user-1",
    username: "operator",
    displayName: "操作人员",
    role,
    organizationId: "org-1",
    regions: [],
    deviceIds: ["source-device"],
  };
  vi.stubGlobal("fetch", vi.fn(async (input: string, init?: RequestInit) => {
    const url = new URL(input, "http://localhost");
    const method = String(init?.method || "GET").toUpperCase();
    const body = typeof init?.body === "string" ? JSON.parse(init.body) : undefined;
    requests.push({ url, method, body });
    if (url.pathname === "/api/v1/auth/csrf")
      return new Response(JSON.stringify({ code: "SUCCESS", data: { token: "csrf-token", headerName: "X-CSRF-TOKEN" } }));
    if (url.pathname === "/api/v1/resources")
      return new Response(JSON.stringify({ code: "SUCCESS", data: { items: [{ id: "local-device", title: "森林巡查无人机", sourceDeviceId: "source-device" }], total: 1, page: 1, pageSize: 100 } }));
    if (url.pathname === "/api/v1/source-data/flight-photos" && method === "GET")
      return new Response(JSON.stringify({ code: "SUCCESS", data: { items: [photo], total: 1, page: 1, pageSize: 100 } }));
    if (url.pathname === "/api/v1/source-data/flight-photos/clues" && method === "POST")
      return new Response(JSON.stringify({ code: "SUCCESS", data: { id: "case-1", title: "森林线索" } }));
    if (url.pathname === "/api/v1/source-data/flight-photos/associate" && method === "POST")
      return new Response(JSON.stringify({ code: "SUCCESS", data: { taskId: "task-1", sourceMediaId: "photo-1" } }));
    throw new Error(`Unexpected request ${method} ${url.pathname}`);
  }));
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity } } });
  clients.push(client);
  return { client, requests, user };
}

function mount(navigate = vi.fn(), role: CurrentUser["role"] = "ADMIN") {
  const state = start(role);
  render(
    <QueryClientProvider client={state.client}>
      <UserContext.Provider value={state.user}>
        <SourceFlightPhotos navigate={navigate} />
      </UserContext.Provider>
    </QueryClientProvider>,
  );
  return state;
}

describe("Dushu flight photos", () => {
  it("shows a source photo, opens its preview, and navigates to its matched task", async () => {
    const navigate = vi.fn();
    const { requests } = mount(navigate);
    const card = await screen.findByRole("article");
    expect(within(card).getByText("牍术飞行照片")).toBeTruthy();
    expect(requests.some((request) => request.url.pathname === "/api/v1/source-data/flight-photos"
      && request.url.searchParams.get("deviceId") === "source-device")).toBe(true);
    fireEvent.click(within(card).getByRole("button", { name: "查看任务" }));
    expect(navigate).toHaveBeenCalledWith("dispatch", { taskId: "task-1" });
    fireEvent.click(within(card).getByRole("button", { name: "预览forest-flight-1.jpg" }));
    expect(await screen.findByRole("dialog", { name: "forest-flight-1.jpg" })).toBeTruthy();
    expect(screen.getAllByRole("img", { name: "forest-flight-1.jpg" }).length).toBeGreaterThan(1);
  });

  it("only creates a scene clue after the explicit user action and preserves the task link", async () => {
    const navigate = vi.fn();
    const { requests } = mount(navigate);
    const card = await screen.findByRole("article");
    fireEvent.click(within(card).getByRole("button", { name: "标记疑似线索" }));
    await waitFor(() => expect(navigate).toHaveBeenCalledWith("scenes", { caseId: "case-1" }));
    const creation = requests.find((request) => request.url.pathname === "/api/v1/source-data/flight-photos/clues");
    expect(creation?.body).toEqual({ deviceId: "source-device", sourceMediaId: "photo-1", taskId: "task-1" });
  });

  it("keeps clue creation unavailable to pilots", async () => {
    mount(vi.fn(), "PILOT");
    const card = await screen.findByRole("article");
    expect(within(card).queryByRole("button", { name: "标记疑似线索" })).toBeNull();
  });
});
