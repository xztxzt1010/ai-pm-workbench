export type NotificationPermissionState = "browser_unsupported" | "desktop_denied" | "desktop_granted"

export function notificationPermissionState(desktopRuntime: boolean, granted: boolean): NotificationPermissionState {
  if (!desktopRuntime) return "browser_unsupported"
  return granted ? "desktop_granted" : "desktop_denied"
}

export function notificationPermissionLabel(state: NotificationPermissionState) {
  if (state === "browser_unsupported") return "浏览器模式不支持"
  return state === "desktop_granted" ? "已授权" : "未授权"
}

export function notificationActionLabel(state: NotificationPermissionState) {
  if (state === "browser_unsupported") return "请安装桌面版"
  return state === "desktop_granted" ? "发送测试通知" : "授权并测试通知"
}
