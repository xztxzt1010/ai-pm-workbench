import { openDesktopDatabase } from "@/data/desktop-database"
import { isProviderKind, validateProviderConfig, type ProviderConfig } from "@/domain/provider-rules"

const KEY = "assistant-product-manager.provider-config.v1"
const APP_KEY = "provider_config"
const defaultConfig: ProviderConfig = { kind: "none", endpoint: "", model: "", enabled: false, updatedAt: new Date(0).toISOString() }

function parse(value: unknown): ProviderConfig {
  if (!value || typeof value !== "object") return defaultConfig
  const candidate = value as Partial<ProviderConfig>
  const config: ProviderConfig = { kind: isProviderKind(candidate.kind) ? candidate.kind : "none", endpoint: typeof candidate.endpoint === "string" ? candidate.endpoint : "", model: typeof candidate.model === "string" ? candidate.model : "", enabled: candidate.enabled === true, updatedAt: typeof candidate.updatedAt === "string" ? candidate.updatedAt : defaultConfig.updatedAt }
  return validateProviderConfig(config).valid ? config : defaultConfig
}

export async function loadProviderConfig(desktopRuntime: boolean) {
  if (!desktopRuntime) {
    try { return parse(JSON.parse(localStorage.getItem(KEY) ?? "null")) } catch { return defaultConfig }
  }
  const db = await openDesktopDatabase()
  const rows = await db.select<Array<{ value_json: string }>>("SELECT value_json FROM app_settings WHERE key = $1 LIMIT 1", [APP_KEY])
  if (!rows[0]) return defaultConfig
  try { return parse(JSON.parse(rows[0].value_json)) } catch { return defaultConfig }
}

export async function persistProviderConfig(config: Omit<ProviderConfig, "updatedAt">, desktopRuntime: boolean) {
  const validation = validateProviderConfig(config)
  if (!validation.valid) throw new Error(validation.message)
  const next: ProviderConfig = { ...config, updatedAt: new Date().toISOString() }
  if (!desktopRuntime) {
    localStorage.setItem(KEY, JSON.stringify(next))
    return next
  }
  const db = await openDesktopDatabase()
  await db.execute(
    `INSERT INTO app_settings (key, value_json, updated_at) VALUES ($1, $2, $3)
     ON CONFLICT(key) DO UPDATE SET value_json = excluded.value_json, updated_at = excluded.updated_at`,
    [APP_KEY, JSON.stringify(next), next.updatedAt],
  )
  return next
}
