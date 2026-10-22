export type NavigationContext = {
  deviceId?: string;
  taskId?: string;
  planId?: string;
  userId?: string;
  action?: "apply" | "assign";
};
export type Navigate = (view: string, context?: NavigationContext) => void;
