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
