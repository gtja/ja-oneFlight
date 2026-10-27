export type NavigationContext = {
  deviceId?: string;
  taskId?: string;
  planId?: string;
  resourceKind?: string;
  resourceSearch?: string;
  userId?: string;
  action?: "apply" | "assign";
};
export type Navigate = (view: string, context?: NavigationContext) => void;
