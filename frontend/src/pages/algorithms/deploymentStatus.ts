export function deploymentLabel(value: unknown): string {
  return value === true
    ? "已部署"
    : value === false
      ? "未部署"
      : "部署状态未知";
}
