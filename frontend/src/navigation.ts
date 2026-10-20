export type NavigationContext = {
  deviceId?: string;
  taskId?: string;
  planId?: string;
  userId?: string;
};
export type Navigate = (view: string, context?: NavigationContext) => void;
