import { describe, expect, it, vi } from "vitest"

import type { ConfirmationItem } from "./models"
import { completeItem, dueByEndOfToday, isDueToday, isOverdue, postponeItem } from "./confirmation-rules"

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

describe("confirmation rules", () => {
  const now = new Date("2026-07-13T10:00:00+08:00")

  it("识别今日和逾期事项", () => {
    expect(isDueToday(base, now)).toBe(true)
    expect(isOverdue({ ...base, dueDate: "2026-07-12" }, now)).toBe(true)
    expect(isOverdue(base, now)).toBe(false)
  })

  it("完成或取消后不再进入今日列表", () => {
    const items = [base, { ...base, id: "done", status: "confirmed" as const }]
    expect(dueByEndOfToday(items, now).map((item) => item.id)).toEqual(["item-1"])
  })

  it("延期后使用新日期重新调度", () => {
    vi.useFakeTimers()
    vi.setSystemTime(now)
    const postponed = postponeItem(base, "2026-07-20")
    expect(postponed.status).toBe("postponed")
    expect(isDueToday(postponed, now)).toBe(false)
    vi.useRealTimers()
  })

  it("完成时保留人工结论", () => {
    const completed = completeItem(base, "按方案 A 推进")
    expect(completed.status).toBe("confirmed")
    expect(completed.conclusion).toBe("按方案 A 推进")
  })
})
