import { invoke } from "@tauri-apps/api/core"
import { listen, type UnlistenFn } from "@tauri-apps/api/event"

export async function listenForNotificationActivations(
  onOpenItem: (confirmationItemId: string) => void,
  onError: (error: unknown) => void,
): Promise<UnlistenFn> {
  let disposed = false
  let drainChain = Promise.resolve()

  const drainPending = () => {
    drainChain = drainChain.then(async () => {
      while (!disposed) {
        const itemId = await invoke<string | null>("take_pending_notification_open")
        if (!itemId) break
        onOpenItem(itemId)
      }
    }).catch((error) => {
      if (!disposed) onError(error)
    })
    return drainChain
  }

  const unlisten = await listen("notification-open-item", () => { void drainPending() })
  await drainPending()

  return () => {
    disposed = true
    unlisten()
  }
}
