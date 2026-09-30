export type ProviderKind = "none" | "cc_switch" | "openai" | "anthropic" | "openai_compatible"

export const providerKinds: ProviderKind[] = ["none", "cc_switch", "openai", "anthropic", "openai_compatible"]

export function isProviderKind(value: unknown): value is ProviderKind {
  return typeof value === "string" && providerKinds.includes(value as ProviderKind)
}

export function providerDefaultEndpoint(kind: ProviderKind) {
  if (kind === "cc_switch") return "http://127.0.0.1:15721"
  if (kind === "openai") return "https://api.openai.com/v1"
  if (kind === "anthropic") return "https://api.anthropic.com/v1"
  return ""
}

export function providerNeedsApiKey(kind: ProviderKind) {
  return !["none", "cc_switch"].includes(kind)
}

export const PROVIDER_MAX_API_KEY_BYTES = 512

export function validateProviderApiKey(apiKey: string) {
  return apiKey.length > 0
    && new TextEncoder().encode(apiKey).length <= PROVIDER_MAX_API_KEY_BYTES
    && [...apiKey].every((character) => {
      const codePoint = character.codePointAt(0) ?? 0
      return codePoint >= 0x21 && codePoint <= 0x7e
    })
}

export function providerDefaultModel(kind: ProviderKind) {
  return kind === "cc_switch" ? "current" : ""
}

export interface ProviderCapabilities {
  protocol: "openai_chat" | "anthropic_messages" | "none"
  structuredJson: boolean
  maxOutputTokens: number
}

export function providerCapabilities(kind: ProviderKind): ProviderCapabilities {
  if (kind === "anthropic") return { protocol: "anthropic_messages", structuredJson: true, maxOutputTokens: 8_192 }
  if (kind === "cc_switch" || kind === "openai" || kind === "openai_compatible") {
    return { protocol: "openai_chat", structuredJson: true, maxOutputTokens: 8_192 }
  }
  return { protocol: "none", structuredJson: false, maxOutputTokens: 0 }
}

export interface ProviderConfig {
  kind: ProviderKind
  endpoint: string
  model: string
  enabled: boolean
  updatedAt: string
}

export type ProviderValidation = { valid: true } | { valid: false; message: string }

export function validateProviderConfig(config: Pick<ProviderConfig, "kind" | "endpoint" | "model" | "enabled">): ProviderValidation {
  if (!config.enabled) return { valid: true }
  if (config.kind === "none") return { valid: false, message: "启用模型连接时必须选择 Provider" }
  if (!config.model.trim()) return { valid: false, message: "启用模型连接时必须填写模型名称" }
  if (!config.endpoint.trim()) return { valid: false, message: "启用模型连接时必须填写服务地址" }
  try {
    const url = new URL(config.endpoint)
    if (!["http:", "https:"].includes(url.protocol)) return { valid: false, message: "服务地址必须使用 HTTP 或 HTTPS" }
    if (url.username || url.password || url.search || url.hash) return { valid: false, message: "服务地址不能包含凭据、查询参数或片段" }
    const loopback = ["127.0.0.1", "localhost"].includes(url.hostname)
    if (config.kind === "cc_switch" && (url.protocol !== "http:" || !loopback)) {
      return { valid: false, message: "CC Switch 只允许使用 127.0.0.1 或 localhost 的 HTTP 地址" }
    }
    if (["openai", "anthropic"].includes(config.kind) && url.protocol !== "https:") {
      return { valid: false, message: "OpenAI 与 Anthropic 直连必须使用 HTTPS" }
    }
    if (config.kind === "openai_compatible" && url.protocol === "http:" && !loopback) {
      return { valid: false, message: "OpenAI 兼容接口使用 HTTP 时只能连接本机回环地址" }
    }
  } catch {
    return { valid: false, message: "服务地址不是有效 URL" }
  }
  return { valid: true }
}

export function sanitizeProviderError(message: string) {
  return message
    .replace(/Bearer\s+[A-Za-z0-9._~-]+/gi, "Bearer [REDACTED]")
    .replace(/(api[_-]?key|token|secret)\s*[:=]\s*[^\s,;]+/gi, "$1=[REDACTED]")
    .slice(0, 500)
}
