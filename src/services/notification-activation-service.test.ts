import { invoke } from "@tauri-apps/api/core"
import { listen } from "@tauri-apps/api/event"
import { beforeEach, describe, expect, it, vi } from "vitest"

import { listenForNotificationActivations } from "@/services/notification-activation-service"

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }))
vi.mock("@tauri-apps/api/event", () => ({ listen: vi.fn() }))

beforeEach(() => vi.resetAllMocks())

describe("notification activation service", () => {
  it("drains a notification click that arrived before the frontend listener", async () => {
    const onOpenItem = vi.fn()
    const unlisten = vi.fn()
    vi.mocked(listen).mockResolvedValue(unlisten)
    vi.mocked(invoke)
      .mockResolvedValueOnce("confirmation-early")
      .mockResolvedValueOnce(null)

    const dispose = await listenForNotificationActivations(onOpenItem, vi.fn())

    expect(onOpenItem).toHaveBeenCalledWith("confirmation-early")
    expect(invoke).toHaveBeenCalledTimes(2)
    dispose()
    expect(unlisten).toHaveBeenCalledOnce()
  })

  it("uses the event as a signal and drains every queued activation in order", async () => {
    const onOpenItem = vi.fn()
    let signal: (() => void) | undefined
    vi.mocked(listen).mockImplementation(async (_event, handler) => {
      signal = () => handler({ event: "notification-open-item", id: 1, payload: "ignored" })
      return () => undefined
    })
    vi.mocked(invoke).mockResolvedValueOnce(null)
    const dispose = await listenForNotificationActivations(onOpenItem, vi.fn())
    vi.mocked(invoke)
      .mockResolvedValueOnce("confirmation-1")
      .mockResolvedValueOnce("confirmation-2")
      .mockResolvedValueOnce(null)

    signal?.()
    await vi.waitFor(() => expect(onOpenItem.mock.calls).toEqual([
      ["confirmation-1"],
      ["confirmation-2"],
    ]))
    dispose()
  })

  it("does not navigate after the subscription has been disposed", async () => {
    const onOpenItem = vi.fn()
    let signal: (() => void) | undefined
    vi.mocked(listen).mockImplementation(async (_event, handler) => {
      signal = () => handler({ event: "notification-open-item", id: 1, payload: null })
      return () => undefined
    })
    vi.mocked(invoke).mockResolvedValue(null)
    const dispose = await listenForNotificationActivations(onOpenItem, vi.fn())

    dispose()
    signal?.()
    await Promise.resolve()

    expect(onOpenItem).not.toHaveBeenCalled()
  })
})
