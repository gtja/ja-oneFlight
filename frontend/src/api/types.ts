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

export type AirspaceProfile = {
  reference: "AGL" | "AMSL" | null;
  lowerHeightMeters: number | null;
  upperHeightMeters: number | null;
};
export type AirspaceImportRow = {
  index: number;
  title: string;
  model: string | null;
  description: string | null;
  geometry: GeoJSON.Polygon | null;
  airspaceProfile: AirspaceProfile | null;
  pointCount: number;
  duplicate: boolean;
  errors: { code: string; message: string }[];
  warnings: { code: string; message: string }[];
};
export type AirspaceImportPreview = {
  batchId: string | null;
  expiresAt: string | null;
  canCommit: boolean;
  summary: {
    total: number;
    valid: number;
    invalid: number;
    duplicates: number;
    pointCount: number;
  };
  rows: AirspaceImportRow[];
};
export type AirspaceImportResult = {
  batchId: string;
  status: "COMMITTED";
  imported: number;
  skipped: number;
  ids: string[];
  importedAt: string;
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
  identitySource?: "local" | "4a";
  businessAccessAssigned?: boolean;
};
