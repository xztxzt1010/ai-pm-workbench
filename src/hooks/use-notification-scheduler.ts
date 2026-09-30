import { useCallback, useEffect, useRef, useState } from "react"
import { invoke } from "@tauri-apps/api/core"
import { emit, listen, TauriEvent, type UnlistenFn } from "@tauri-apps/api/event"
import { isPermissionGranted } from "@tauri-apps/plugin-notification"

import {
  loadNotificationHistory,
  loadDefaultReminderTime,
  loadReminderPaused,
  markNotificationResult,
  persistReminderPaused,
  persistDefaultReminderTime,
  reconcileDueNotifications,
} from "@/data/desktop-database"
import type { ConfirmationItem, NotificationRecord } from "@/domain/models"
import { DEFAULT_REMINDER_TIME, isValidReminderTime } from "@/domain/notification-rules"
import { listenForNotificationActivations } from "@/services/notification-activation-service"

export function useNotificationScheduler(
  items: ConfirmationItem[],
  desktopRuntime: boolean,
  onOpenItem?: (confirmationItemId: string) => void,
) {
  const itemsRef = useRef(items)
  const onOpenItemRef = useRef(onOpenItem)
  const runningRef = useRef(false)
  const settingsReadyRef = useRef(false)
  const pausedRef = useRef(false)
  const reminderTimeRef = useRef(DEFAULT_REMINDER_TIME)
  const [records, setRecords] = useState<NotificationRecord[]>([])
  const [paused, setPausedState] = useState(false)
  const [reminderTime, setReminderTimeState] = useState(DEFAULT_REMINDER_TIME)
  const [error, setError] = useState<string>()

  useEffect(() => { itemsRef.current = items }, [items])
  useEffect(() => { onOpenItemRef.current = onOpenItem }, [onOpenItem])

  const runNow = useCallback(async () => {
    if (!desktopRuntime || !settingsReadyRef.current || runningRef.current) return
    runningRef.current = true
    try {
      const due = await reconcileDueNotifications(itemsRef.current, new Date(), reminderTimeRef.current)
      if (!pausedRef.current && due.length && await isPermissionGranted()) {
        for (const record of due) {
          try {
            await invoke("send_clickable_notification", {
              title: "待确认事项",
              body: `${record.itemTitle} 已到确认时间，请完成或重新排期。`,
              confirmationItemId: record.confirmationItemId ?? "",
            })
            await markNotificationResult(record.id, "delivered")
          } catch (notificationError) {
            const summary = notificationError instanceof Error ? notificationError.message : "系统通知发送失败"
            await markNotificationResult(record.id, "failed", summary)
          }
        }
      }
      setRecords(await loadNotificationHistory())
      setError(undefined)
    } catch (cycleError) {
      setError(cycleError instanceof Error ? cycleError.message : "提醒调度失败")
    } finally {
      runningRef.current = false
    }
  }, [desktopRuntime])

  const updateReminderTime = useCallback(async (nextTime: string) => {
    if (!isValidReminderTime(nextTime)) throw new Error("提醒时间必须是有效的 HH:mm")
    if (!desktopRuntime) return
    await persistDefaultReminderTime(nextTime)
    reminderTimeRef.current = nextTime
    setReminderTimeState(nextTime)
    void runNow()
  }, [desktopRuntime, runNow])

  const setPaused = useCallback(async (nextPaused: boolean) => {
    if (!desktopRuntime) return
    await persistReminderPaused(nextPaused)
    pausedRef.current = nextPaused
    setPausedState(nextPaused)
    await emit("reminders-pause-state-changed", nextPaused)
    if (!nextPaused) void runNow()
  }, [desktopRuntime, runNow])

  useEffect(() => {
    if (!desktopRuntime) {
      settingsReadyRef.current = false
      return
    }
    let cancelled = false
    void Promise.all([loadReminderPaused(), loadDefaultReminderTime()])
      .then(([storedPaused, storedReminderTime]) => {
        if (cancelled) return
        pausedRef.current = storedPaused
        reminderTimeRef.current = storedReminderTime
        setReminderTimeState(storedReminderTime)
        setPausedState(storedPaused)
        void emit("reminders-pause-state-changed", storedPaused)
        settingsReadyRef.current = true
        void runNow()
      })
      .catch((settingsError) => setError(settingsError instanceof Error ? settingsError.message : "无法读取提醒设置"))
    return () => { cancelled = true }
  }, [desktopRuntime, runNow])

  useEffect(() => {
    if (!desktopRuntime) return
    void runNow()
  }, [desktopRuntime, items, runNow])

  useEffect(() => {
    if (!desktopRuntime) return
    const interval = window.setInterval(() => { void runNow() }, 60_000)
    const onFocus = () => { void runNow() }
    const onVisibility = () => { if (document.visibilityState === "visible") void runNow() }
    window.addEventListener("focus", onFocus)
    document.addEventListener("visibilitychange", onVisibility)

    let unlistenResume: UnlistenFn | undefined
    let unlistenPause: UnlistenFn | undefined
    let unlistenNotificationOpen: UnlistenFn | undefined
    let disposed = false
    void listen(TauriEvent.WINDOW_RESUMED, () => { void runNow() }).then((dispose) => {
      if (disposed) dispose()
      else unlistenResume = dispose
    })
    void listen("reminders-pause-requested", () => {
      void setPaused(!pausedRef.current).catch((pauseError) => {
        setError(pauseError instanceof Error ? pauseError.message : "无法更新提醒设置")
      })
    }).then((dispose) => {
      if (disposed) dispose()
      else unlistenPause = dispose
    })
    void listenForNotificationActivations(
      (itemId) => { if (!disposed) onOpenItemRef.current?.(itemId) },
      (activationError) => { if (!disposed) setError(activationError instanceof Error ? activationError.message : "无法读取通知点击操作") },
    ).then((dispose) => {
      if (disposed) dispose()
      else unlistenNotificationOpen = dispose
    }).catch((activationError) => {
      if (!disposed) setError(activationError instanceof Error ? activationError.message : "无法监听通知点击操作")
    })

    return () => {
      disposed = true
      window.clearInterval(interval)
      window.removeEventListener("focus", onFocus)
      document.removeEventListener("visibilitychange", onVisibility)
      unlistenResume?.()
      unlistenPause?.()
      unlistenNotificationOpen?.()
    }
  }, [desktopRuntime, runNow, setPaused])

  return { records, error, paused, reminderTime, runNow, setPaused, setReminderTime: updateReminderTime }
}
