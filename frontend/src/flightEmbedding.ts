import { useQuery } from "@tanstack/react-query";
import { api } from "./api";

export type FlightControlOptions = {
  mode: "local" | "embedded" | "direct";
  transportMode?: "https" | "http-ip";
  requiresTask?: boolean;
  origin?: string;
  directUrl?: string;
  parentOrigin?: string;
  capabilities?: { microphone: boolean };
  message?: string;
};
export const HTTP_FLIGHT_NOTICE =
  "HTTP 兼容模式：麦克风/喊话等需要安全上下文的功能不可用，视频播放以现场验证为准。";
export const FLIGHT_NAMESPACE = "oneflight:flight-control";
export type FlightMessage = {
  namespace: typeof FLIGHT_NAMESPACE;
  type:
    "READY" | "AUTH_EXPIRED" | "ADAPTER_ERROR" | "ENTRY_DENIED" | "LOGGED_OUT";
  message?: string;
};

export function useFlightControlOptions(enabled: boolean) {
  return useQuery({
    queryKey: ["flight-control-options"],
    queryFn: () => api<FlightControlOptions>("/flight-control/options"),
    enabled,
    retry: false,
    staleTime: 60_000,
  });
}

function isCanonicalIpv4(hostname: string): boolean {
  return (
    /^(0|[1-9]\d{0,2})(\.(0|[1-9]\d{0,2})){3}$/.test(hostname) &&
    hostname.split(".").every((part) => Number(part) <= 255)
  );
}

export function flightOrigin(
  options: FlightControlOptions,
  pageOrigin = window.location.origin,
): string {
  const origin = new URL(options.origin || "");
  if (
    origin.origin === pageOrigin ||
    origin.username ||
    origin.password ||
    ![origin.origin, `${origin.origin}/`].includes(options.origin || "") ||
    (options.parentOrigin && options.parentOrigin !== pageOrigin)
  )
    throw new Error("飞控独立入口配置不正确，请联系管理员");
  const transportMode = options.transportMode || "https";
  if (transportMode === "http-ip") {
    const parent = new URL(pageOrigin);
    if (
      options.parentOrigin !== pageOrigin ||
      origin.protocol !== "http:" ||
      parent.protocol !== "http:" ||
      !isCanonicalIpv4(origin.hostname) ||
      !isCanonicalIpv4(parent.hostname) ||
      origin.hostname !== parent.hostname ||
      origin.port === parent.port
    )
      throw new Error(
        "HTTP 兼容模式须使用同一服务器 IP 的两个独立端口，请联系管理员",
      );
  } else if (transportMode !== "https" || origin.protocol !== "https:") {
    throw new Error("飞控独立入口配置不正确，请联系管理员");
  }
  return origin.origin;
}

/** The backend selects a fixed source; navigation and login never add tokens or target URLs. */
export function directFlightUrl(
  options: FlightControlOptions,
  pageOrigin = window.location.origin,
): string {
  const url = new URL(options.directUrl || "");
  if (
    options.mode !== "direct" ||
    url.protocol !== "https:" ||
    url.origin !== options.origin ||
    url.origin === pageOrigin ||
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    url.href !== options.directUrl ||
    (options.parentOrigin && options.parentOrigin !== pageOrigin)
  )
    throw new Error("飞控原站入口配置不正确，请联系管理员");
  return url.href;
}

export function isFlightMessage(
  event: MessageEvent,
  origin: string,
  source: Window | null,
): event is MessageEvent<FlightMessage> {
  return (
    !!source &&
    event.source === source &&
    event.origin === origin &&
    !!event.data &&
    typeof event.data === "object" &&
    event.data.namespace === FLIGHT_NAMESPACE &&
    [
      "READY",
      "AUTH_EXPIRED",
      "ADAPTER_ERROR",
      "ENTRY_DENIED",
      "LOGGED_OUT",
    ].includes(event.data.type)
  );
}

let activeFrame: { frame: HTMLIFrameElement; origin: string } | undefined;
export function registerFlightFrame(frame: HTMLIFrameElement, origin: string) {
  const registration = { frame, origin };
  activeFrame = registration;
  return () => {
    if (activeFrame === registration) activeFrame = undefined;
  };
}

/** The parent cannot access the isolated origin's IndexedDB. Wait for its acknowledgement. */
export function clearFlightIdentity(
  origin: string,
  timeoutMs = 4000,
): Promise<boolean> {
  return new Promise((resolve) => {
    let created: HTMLIFrameElement | undefined;
    const current =
      activeFrame?.origin === origin && activeFrame.frame.isConnected
        ? activeFrame.frame
        : undefined;
    const frame = current || (created = document.createElement("iframe"));
    let settled = false;
    let timer: number;
    const finish = (success: boolean) => {
      if (settled) return;
      settled = true;
      window.clearTimeout(timer);
      window.removeEventListener("message", receive);
      created?.remove();
      resolve(success);
    };
    const receive = (event: MessageEvent) => {
      if (
        isFlightMessage(event, origin, frame.contentWindow) &&
        event.data.type === "LOGGED_OUT"
      )
        finish(true);
    };
    window.addEventListener("message", receive);
    timer = window.setTimeout(() => finish(false), timeoutMs);
    if (created) {
      created.title = "清理飞控登录状态";
      created.hidden = true;
      created.referrerPolicy = "no-referrer";
      created.src = new URL("/__oneflight/logout", origin).href;
      document.body.append(created);
    } else {
      frame.contentWindow?.postMessage(
        { namespace: FLIGHT_NAMESPACE, type: "LOGOUT" },
        origin,
      );
    }
  });
}
