// @vitest-environment jsdom
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import Login, { authErrorMessage, fourALoginUrl } from "./Login";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});
const props = () => ({ onSuccess: vi.fn(), onRetry: vi.fn() });
describe("platform login modes", () => {
  it("uses the official4A login and hides password authentication by default", () => {
    render(
      <Login {...props()} options={{ mode: "4a", localLoginEnabled: false }} />,
    );
    expect(
      screen.getByRole("link", { name: /4A 统一登录/ }).getAttribute("href"),
    ).toBe("/api/v1/auth/4a/start");
    expect(screen.queryByLabelText("密码")).toBeNull();
    expect(screen.queryByLabelText("登录账号")).toBeNull();
  });
  it("keeps the primary 4A login free of local credentials even if maintenance is enabled", () => {
    render(
      <Login {...props()} options={{ mode: "4a", localLoginEnabled: true }} />,
    );
    expect(screen.queryByLabelText("密码")).toBeNull();
    expect(screen.queryByRole("button", { name: "本地维护登录" })).toBeNull();
    expect(screen.getByText(/平台业务权限由平台管理员配置/)).toBeTruthy();
    expect(screen.queryByText(/绑定身份/)).toBeNull();
  });
  it("preserves only a fixed flight destination through official login", () => {
    render(
      <Login
        {...props()}
        options={{ mode: "4a", accountsMode: "4a", localLoginEnabled: false }}
        loginContext={{
          view: "flight",
          deviceId: "source device",
          taskId: "task/1",
        }}
      />,
    );
    expect(
      screen.getByRole("link", { name: /4A 统一登录/ }).getAttribute("href"),
    ).toBe(
      "/api/v1/auth/4a/start?view=flight&deviceId=source+device&taskId=task%2F1",
    );
    expect(
      fourALoginUrl({ view: "https://untrusted.test", deviceId: "source" }),
    ).toBe("/api/v1/auth/4a/start");
    expect(fourALoginUrl({ view: "flight", deviceId: "x".repeat(129) })).toBe(
      "/api/v1/auth/4a/start?view=flight",
    );
  });
  it("does not fall back to local password login when options cannot be loaded", () => {
    render(<Login {...props()} optionsError={new Error("配置不可用")} />);
    expect(screen.queryByLabelText("密码")).toBeNull();
    expect(
      screen.getByRole("button", { name: "重新读取登录配置" }),
    ).toBeTruthy();
  });
  it("retains the existing Session and CSRF local login request", async () => {
    const request = vi.fn().mockImplementation((url: string) =>
      Promise.resolve(
        new Response(
          JSON.stringify({
            code: "SUCCESS",
            data: url.endsWith("/csrf")
              ? { token: "csrf-value", headerName: "X-CSRF-TOKEN" }
              : {},
          }),
        ),
      ),
    );
    vi.stubGlobal("fetch", request);
    const onSuccess = vi.fn();
    render(
      <Login
        {...props()}
        onSuccess={onSuccess}
        options={{ mode: "local", localLoginEnabled: true }}
      />,
    );
    fireEvent.change(screen.getByLabelText("登录账号"), {
      target: { value: "pilot" },
    });
    fireEvent.change(screen.getByLabelText("密码"), {
      target: { value: "a local password" },
    });
    fireEvent.click(screen.getByRole("button", { name: /进入工作台/ }));
    await waitFor(() => expect(onSuccess).toHaveBeenCalledOnce());
    const options = request.mock.calls.find(([url]) =>
      url.endsWith("/login"),
    )![1];
    expect(options.credentials).toBe("include");
    expect(options.headers.get("X-CSRF-TOKEN")).toBe("csrf-value");
    expect(JSON.parse(options.body)).toEqual({
      username: "pilot",
      password: "a local password",
    });
  });
  it("maps known callback errors and never reflects arbitrary query content", () => {
    expect(authErrorMessage("PLATFORM_NOT_OPEN")).toContain(
      "尚未开通一网统飞应用权限",
    );
    expect(authErrorMessage("secret-query-value")).not.toContain(
      "secret-query-value",
    );
  });
  it("distinguishes upstream profile compatibility, 4A disable, and platform business disable", () => {
    expect(authErrorMessage("FOUR_A_PROFILE_INVALID")).toBe(
      "4A 返回的身份数据暂不兼容，请联系平台管理员。",
    );
    expect(authErrorMessage("FOUR_A_ACCOUNT_DISABLED")).toBe(
      "4A 账号已停用，请联系 4A 管理员。",
    );
    expect(authErrorMessage("ACCOUNT_DISABLED")).toBe(
      "平台业务账号已停用，请联系平台管理员。",
    );
    expect(authErrorMessage("FOUR_A_SESSION_EXPIRED")).toBe(
      "4A 登录已失效，请重新登录。",
    );
  });
});
