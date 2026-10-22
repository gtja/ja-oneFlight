// Stable public entry point for pages, components, and existing test mocks.
// HTTP transport stays independent of React in api/client.ts.
import type { Entity } from "./api/types";

export type { CurrentUser, Entity, Page } from "./api/types";
export { api, ApiError, queryString, readCatalog, write } from "./api/client";
export { useCatalog, useData, useDevices, useList } from "./api/hooks";

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
