// @vitest-environment jsdom

import { fireEvent, render, screen } from "@testing-library/react"
import { describe, expect, it, vi } from "vitest"

import { NotificationsPage } from "@/components/notifications-page"
import type { NotificationRecord } from "@/domain/models"

const record: NotificationRecord = {
  id: "notification-1",
  confirmationItemId: "confirmation-1",
  itemTitle: "确认发布范围",
  scheduledAt: "2026-07-13T10:00:00.000Z",
  deliveredAt: "2026-07-13T10:00:05.000Z",
  status: "delivered",
  deduplicationKey: "confirmation-1:2026-07-13:10:00",
  createdAt: "2026-07-13T10:00:00.000Z",
}

describe("NotificationsPage", () => {
  it("opens the confirmation item represented by a notification record", () => {
    const onOpenItem = vi.fn()
    render(
      <NotificationsPage
        records={[record]}
        desktopRuntime
        paused={false}
        onRefresh={vi.fn()}
        onOpenItem={onOpenItem}
      />,
    )

    fireEvent.click(screen.getByRole("button", { name: "打开事项" }))

    expect(onOpenItem).toHaveBeenCalledWith("confirmation-1")
  })

  it("shows a clear paused state", () => {
    render(
      <NotificationsPage
        records={[]}
        desktopRuntime
        paused
        onRefresh={vi.fn()}
        onOpenItem={vi.fn()}
      />,
    )

    expect(screen.getByText("提醒已暂停")).toBeTruthy()
  })
})
