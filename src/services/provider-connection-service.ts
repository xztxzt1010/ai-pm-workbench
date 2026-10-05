import { invoke } from "@tauri-apps/api/core"

import { sanitizeProviderError, validateProviderConfig, type ProviderConfig } from "@/domain/provider-rules"

export type ProviderConnectionState = "not_configured" | "preview_only" | "sidecar_required" | "credential_missing" | "available" | "unavailable" | "invalid"

export interface ProviderConnectionResult {
  state: ProviderConnectionState
  message: string
  checkedAt: string
  latencyMs?: number
}

type ProviderProbe = { state: ProviderConnectionState; message: string; latencyMs?: number }
type ProbeProvider = (config: Pick<ProviderConfig, "kind" | "endpoint" | "model">) => Promise<ProviderProbe>

const invokeProviderProbe: ProbeProvider = (config) => invoke<ProviderProbe>("test_ai_provider_connection", config)

function result(state: ProviderConnectionState, message: string, latencyMs?: number): ProviderConnectionResult {
  return { state, message, checkedAt: new Date().toISOString(), latencyMs }
}

export async function testProviderConnection(config: ProviderConfig, desktopRuntime: boolean, probeProvider: ProbeProvider = invokeProviderProbe) {
  const validation = validateProviderConfig(config)
  if (!validation.valid) return result("invalid", validation.message)
  if (!config.enabled || config.kind === "none") return result("not_configured", "请先启用并保存一个模型 Provider")
  if (!desktopRuntime) return result("preview_only", "浏览器预览不执行真实模型连接测试，请在桌面应用中验证")

  try {
    const probe = await probeProvider({ kind: config.kind, endpoint: config.endpoint, model: config.model })
    return result(probe.state, sanitizeProviderError(probe.message), probe.latencyMs)
  } catch (error) {
    return result("unavailable", sanitizeProviderError(error instanceof Error ? error.message : String(error)))
  }
}
