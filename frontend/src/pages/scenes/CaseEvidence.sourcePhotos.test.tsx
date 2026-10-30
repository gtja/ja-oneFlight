// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, expect, it, vi } from "vitest";
import type { CurrentUser, Entity } from "../../api";
import { UserContext } from "../../context";
import CaseEvidence from "./CaseEvidence";

const clients: QueryClient[] = [];
afterEach(() => {
  cleanup();
  clients.forEach((client) => client.clear());
  clients.length = 0;
  vi.unstubAllGlobals();
});

it("shows the persisted source flight photo in the scene evidence viewer without downloading it", async () => {
  const user: CurrentUser = {
    id: "department-1",
    username: "department",
    displayName: "部门人员",
    role: "DEPARTMENT",
    organizationId: "org-1",
    regions: [],
    deviceIds: ["source-device"],
  };
  const requests: string[] = [];
  vi.stubGlobal("fetch", vi.fn(async (input: string) => {
    const url = new URL(input, "http://localhost");
    requests.push(url.pathname);
    if (url.pathname === "/api/v1/attachments")
      return new Response(JSON.stringify({ code: "SUCCESS", data: { items: [], total: 0, page: 1, pageSize: 100 } }));
    if (url.pathname === "/api/v1/source-data/flight-photos/cases")
      return new Response(JSON.stringify({ code: "SUCCESS", data: { items: [{
        id: "DUSHU:source-device:photo-9",
        title: "scene-source.jpg",
        contentType: "image/jpeg",
        previewUrl: "/api/v1/source-data/flight-photos/preview?deviceId=source-device&sourceMediaId=photo-9&caseId=case-1",
        photoType: "可见光",
        capturedFrom: "2026-10-29T02:00:00Z",
        longitude: 120.1,
        latitude: 30.2,
        sourceDeviceId: "source-device",
        taskId: "task-1",
        entityTitle: "森林巡查任务",
      }], total: 1, page: 1, pageSize: 100 } }));
    throw new Error(`Unexpected request ${url.pathname}`);
  }));
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  clients.push(client);
  const navigate = vi.fn();
  render(
    <QueryClientProvider client={client}>
      <UserContext.Provider value={user}>
        <CaseEvidence record={{ id: "case-1", title: "森林线索", scene: "森林防火" } as Entity} readOnly navigate={navigate} />
      </UserContext.Provider>
    </QueryClientProvider>,
  );

  expect((await screen.findAllByText("scene-source.jpg")).length).toBeGreaterThan(0);
  expect(screen.getByText(/来源文件未复制/)).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: /scene-source\.jpg/ }));
  expect(screen.getAllByRole("img", { name: "scene-source.jpg" }).length).toBeGreaterThan(0);
  expect(requests).toContain("/api/v1/source-data/flight-photos/cases");
});
