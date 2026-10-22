// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  clearFlightIdentity,
  FLIGHT_NAMESPACE,
  flightOrigin,
  directFlightUrl,
  registerFlightFrame,
} from "./flightEmbedding";
const origin = "https://flight.example.test";
afterEach(() => {
  document.body.innerHTML = "";
  vi.useRealTimers();
});
describe("configured flight origins", () => {
  const parent = "http://192.0.2.20:8088";
  const httpOptions = {
    mode: "embedded" as const,
    transportMode: "http-ip" as const,
    origin: "http://192.0.2.20:8089",
    parentOrigin: parent,
  };
  it("preserves HTTPS as the default and requires explicit HTTP compatibility", () => {
    expect(flightOrigin({ mode: "embedded", origin }, parent)).toBe(origin);
    expect(() =>
      flightOrigin({ ...httpOptions, transportMode: undefined }, parent),
    ).toThrow();
    expect(flightOrigin(httpOptions, parent)).toBe(httpOptions.origin);
    expect(
      flightOrigin(
        { ...httpOptions, parentOrigin: "http://192.0.2.20" },
        "http://192.0.2.20",
      ),
    ).toBe(httpOptions.origin);
  });
  it.each([
    { origin: "http://192.0.2.20:8088" },
    { origin: "http://192.0.2.21:8089" },
    { origin: "http://flight.example.test:8089" },
    { origin: "http://[::1]:8089" },
    { origin: "http://192.0.2.020:8089" },
    { origin: "http://3221226004:8089" },
    { origin: "http://192.0.2.20:8089/path" },
    { origin: "http://192.0.2.20:8089?next=https://evil.example" },
    { origin: "http://192.0.2.20:8089#fragment" },
    { origin: "http://user:password@192.0.2.20:8089" },
    { origin: "https://192.0.2.20:8089" },
    { parentOrigin: undefined },
    { parentOrigin: "http://192.0.2.21:8088" },
  ])(
    "rejects an HTTP origin outside the fixed IP and port configuration: %o",
    (override) => {
      expect(() =>
        flightOrigin({ ...httpOptions, ...override }, parent),
      ).toThrow();
    },
  );
  it("does not accept a DNS name or HTTPS page as an HTTP compatibility parent", () => {
    for (const parentOrigin of [
      "http://platform.example.test:8088",
      "https://192.0.2.20:8088",
    ]) {
      expect(() =>
        flightOrigin({ ...httpOptions, parentOrigin }, parentOrigin),
      ).toThrow();
    }
  });
});
describe("fixed direct flight entry", () => {
  const direct = {
    mode: "direct" as const,
    origin: "https://dushu.jing-an.com:32716",
    directUrl: "https://dushu.jing-an.com:32716/control-room",
  };
  it("uses the configured remote HTTPS origin without requiring a local proxy", () => {
    expect(directFlightUrl(direct, "http://192.0.2.20:8088")).toBe(
      direct.directUrl,
    );
    expect(
      directFlightUrl(
        { ...direct, directUrl: `${direct.origin}/control-room/uav/source-id` },
        "http://192.0.2.20:8088",
      ),
    ).toBe(`${direct.origin}/control-room/uav/source-id`);
  });
  it.each([
    { directUrl: "http://dushu.jing-an.com:32716/control-room" },
    { directUrl: "https://unconfigured.example/control-room" },
    { directUrl: `${direct.directUrl}?token=never-accepted` },
    { directUrl: `${direct.directUrl}?next=https://elsewhere.example` },
    { directUrl: `${direct.directUrl}#token` },
    { directUrl: "https://name:password@dushu.jing-an.com:32716/control-room" },
    { directUrl: `${direct.origin}/unresolved/../control-room` },
    { parentOrigin: "http://wrong-parent.example:8088" },
  ])("rejects an entry outside the fixed source contract: %o", (override) => {
    expect(() =>
      directFlightUrl({ ...direct, ...override }, "http://192.0.2.20:8088"),
    ).toThrow();
  });
});
describe("isolated flight logout", () => {
  it("requires exact child origin and iframe source before acknowledging cleanup", async () => {
    const result = clearFlightIdentity(origin);
    const frame = document.querySelector("iframe")!;
    expect(frame.src).toBe(`${origin}/__oneflight/logout`);
    let finished = false;
    void result.then(() => {
      finished = true;
    });
    window.dispatchEvent(
      new MessageEvent("message", {
        origin,
        source: window,
        data: { namespace: FLIGHT_NAMESPACE, type: "LOGGED_OUT" },
      }),
    );
    await Promise.resolve();
    expect(finished).toBe(false);
    window.dispatchEvent(
      new MessageEvent("message", {
        origin,
        source: frame.contentWindow,
        data: { namespace: FLIGHT_NAMESPACE, type: "LOGGED_OUT" },
      }),
    );
    expect(await result).toBe(true);
    expect(document.querySelector("iframe")).toBeNull();
  });
  it("asks a mounted flight frame to clear its identity before returning success", async () => {
    const frame = document.createElement("iframe");
    document.body.append(frame);
    const unregister = registerFlightFrame(frame, origin);
    const send = vi.spyOn(frame.contentWindow!, "postMessage");
    const result = clearFlightIdentity(origin);
    expect(send).toHaveBeenCalledWith(
      { namespace: FLIGHT_NAMESPACE, type: "LOGOUT" },
      origin,
    );
    window.dispatchEvent(
      new MessageEvent("message", {
        origin,
        source: frame.contentWindow,
        data: { namespace: FLIGHT_NAMESPACE, type: "LOGGED_OUT" },
      }),
    );
    expect(await result).toBe(true);
    unregister();
  });
  it("reports an unconfirmed cleanup instead of treating an iframe load as success", async () => {
    vi.useFakeTimers();
    const result = clearFlightIdentity(origin, 500);
    document.querySelector("iframe")!.dispatchEvent(new Event("load"));
    await vi.advanceTimersByTimeAsync(500);
    expect(await result).toBe(false);
    expect(document.querySelector("iframe")).toBeNull();
  });
});
