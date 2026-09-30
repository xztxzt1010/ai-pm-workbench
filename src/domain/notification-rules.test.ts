import { describe, expect, it } from "vitest"

import type { ConfirmationItem } from "./models"
import { buildNotificationSchedule, dueNotificationSchedules, isValidReminderTime, notificationSchedules, notificationDeduplicationKey } from "./notification-rules"

const base: ConfirmationItem = {
  id: "item-1",
  projectId: "project-1",
  title: "确认范围",
  dueDate: "2026-07-13",
  priority: "high",
  status: "pending",
  createdAt: "2026-07-01T08:00:00.000Z",
  updatedAt: "2026-07-01T08:00:00.000Z",
}

describe("notification rules", () => {
  it("没有设置时间时使用本地上午九点", () => {
    const schedule = buildNotificationSchedule(base)
    expect(new Date(schedule!.scheduledAt).getHours()).toBe(9)
    expect(dueNotificationSchedules([base], new Date("2026-07-13T08:59:00+08:00"))).toHaveLength(0)
    expect(dueNotificationSchedules([base], new Date("2026-07-13T09:00:00+08:00"))).toHaveLength(1)
  })

  it("尊重用户设置的具体提醒时间", () => {
    const item = { ...base, dueTime: "14:30" }
    expect(dueNotificationSchedules([item], new Date("2026-07-13T14:29:59+08:00"))).toHaveLength(0)
    expect(dueNotificationSchedules([item], new Date("2026-07-13T14:30:00+08:00"))).toHaveLength(1)
  })

  it("完成或取消事项不再生成提醒", () => {
    expect(buildNotificationSchedule({ ...base, status: "confirmed" })).toBeUndefined()
    expect(buildNotificationSchedule({ ...base, status: "cancelled" })).toBeUndefined()
  })

  it("延期日期会生成新的去重键", () => {
    const original = notificationDeduplicationKey(base)
    const postponed = notificationDeduplicationKey({ ...base, status: "postponed", dueDate: "2026-07-20" })
    expect(postponed).not.toBe(original)
    expect(notificationDeduplicationKey(base)).toBe(original)
  })

  it("使用可配置的默认提醒时间并把它纳入去重键", () => {
    const schedule = buildNotificationSchedule(base, "18:45")
    expect(new Date(schedule!.scheduledAt).getHours()).toBe(18)
    expect(notificationDeduplicationKey(base, "18:45")).not.toBe(notificationDeduplicationKey(base, "09:00"))
    expect(dueNotificationSchedules([base], new Date("2026-07-13T18:45:00+08:00"), "18:45")).toHaveLength(1)
  })

  it("只接受 24 小时制的有效提醒时间", () => {
    expect(isValidReminderTime("00:00")).toBe(true)
    expect(isValidReminderTime("23:59")).toBe(true)
    expect(isValidReminderTime("24:00")).toBe(false)
    expect(isValidReminderTime("9:00")).toBe(false)
  })

  it("保留未来调度，只有到期筛选才移除未来项", () => {
    const schedules = notificationSchedules([base], "18:45")
    expect(schedules).toHaveLength(1)
    expect(dueNotificationSchedules([base], new Date("2026-07-13T18:00:00+08:00"), "18:45")).toHaveLength(0)
  })
})
