import { openDesktopDatabase } from "@/data/desktop-database"

const BROWSER_KEY = "assistant-product-manager.onboarding.v1"
const DESKTOP_KEY = "onboarding_state"

function parseCompleted(value: unknown) {
  return Boolean(value && typeof value === "object" && (value as { completed?: unknown }).completed === true)
}

export async function loadOnboardingCompleted(desktopRuntime: boolean) {
  if (!desktopRuntime) {
    try { return parseCompleted(JSON.parse(localStorage.getItem(BROWSER_KEY) ?? "null")) } catch { return false }
  }
  const db = await openDesktopDatabase()
  const rows = await db.select<Array<{ value_json: string }>>("SELECT value_json FROM app_settings WHERE key = $1 LIMIT 1", [DESKTOP_KEY])
  if (!rows[0]) return false
  try { return parseCompleted(JSON.parse(rows[0].value_json)) } catch { return false }
}

export async function persistOnboardingCompleted(completed: boolean, desktopRuntime: boolean) {
  const updatedAt = new Date().toISOString()
  const value = JSON.stringify({ completed, updatedAt })
  if (!desktopRuntime) {
    localStorage.setItem(BROWSER_KEY, value)
    return
  }
  const db = await openDesktopDatabase()
  await db.execute(
    `INSERT INTO app_settings (key, value_json, updated_at) VALUES ($1, $2, $3)
     ON CONFLICT(key) DO UPDATE SET value_json = excluded.value_json, updated_at = excluded.updated_at`,
    [DESKTOP_KEY, value, updatedAt],
  )
}
