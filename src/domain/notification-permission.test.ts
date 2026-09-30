import { describe, expect, it } from "vitest"

import { notificationActionLabel, notificationPermissionLabel, notificationPermissionState } from "@/domain/notification-permission"

describe("notification permission presentation", () => {
  it("does not report browser preview as an OS permission denial", () => {
    const state = notificationPermissionState(false, false)
    expect(state).toBe("browser_unsupported")
    expect(notificationPermissionLabel(state)).toBe("浏览器模式不支持")
    expect(notificationActionLabel(state)).toBe("请安装桌面版")
  })

  it("distinguishes denied and granted desktop permission", () => {
    const denied = notificationPermissionState(true, false)
    const granted = notificationPermissionState(true, true)
    expect(notificationPermissionLabel(denied)).toBe("未授权")
    expect(notificationActionLabel(denied)).toBe("授权并测试通知")
    expect(notificationPermissionLabel(granted)).toBe("已授权")
    expect(notificationActionLabel(granted)).toBe("发送测试通知")
  })
})
