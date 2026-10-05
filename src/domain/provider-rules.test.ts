import { describe, expect, it } from "vitest"

import { providerCapabilities, providerDefaultEndpoint, providerDefaultModel, sanitizeProviderError, validateProviderApiKey, validateProviderConfig } from "@/domain/provider-rules"

describe("provider rules", () => {
  it("allows disabled providers without endpoint or model", () => {
    expect(validateProviderConfig({ kind: "openai_compatible", endpoint: "", model: "", enabled: false })).toEqual({ valid: true })
  })

  it("validates enabled provider endpoint and model", () => {
    expect(validateProviderConfig({ kind: "openai_compatible", endpoint: "not-url", model: "gpt", enabled: true }).valid).toBe(false)
    expect(validateProviderConfig({ kind: "openai_compatible", endpoint: "https://api.example.com", model: "gpt", enabled: true })).toEqual({ valid: true })
  })

  it("restricts CC Switch to the local loopback route", () => {
    expect(providerDefaultEndpoint("cc_switch")).toBe("http://127.0.0.1:15721")
    expect(providerDefaultModel("cc_switch")).toBe("current")
    expect(validateProviderConfig({ kind: "cc_switch", endpoint: "http://127.0.0.1:15721", model: "current", enabled: true })).toEqual({ valid: true })
    expect(validateProviderConfig({ kind: "cc_switch", endpoint: "http://192.168.1.8:15721", model: "current", enabled: true }).valid).toBe(false)
    expect(validateProviderConfig({ kind: "cc_switch", endpoint: "https://127.0.0.1:15721", model: "current", enabled: true }).valid).toBe(false)
  })

  it("requires HTTPS for direct cloud providers", () => {
    expect(validateProviderConfig({ kind: "openai", endpoint: "http://api.openai.com/v1", model: "gpt", enabled: true }).valid).toBe(false)
    expect(validateProviderConfig({ kind: "anthropic", endpoint: "https://api.anthropic.com/v1", model: "claude", enabled: true })).toEqual({ valid: true })
  })

  it("rejects non-loopback HTTP for OpenAI-compatible providers", () => {
    expect(validateProviderConfig({ kind: "openai_compatible", endpoint: "http://192.168.1.5:8000/v1", model: "local", enabled: true }).valid).toBe(false)
    expect(validateProviderConfig({ kind: "openai_compatible", endpoint: "http://127.0.0.1:8000/v1", model: "local", enabled: true })).toEqual({ valid: true })
  })

  it("redacts bearer tokens and key-like error values", () => {
    expect(sanitizeProviderError("Bearer abc.def token=secret-value")).toBe("Bearer [REDACTED] token=[REDACTED]")
  })

  it("accepts bounded visible ASCII API keys and rejects unsafe characters", () => {
    expect(validateProviderApiKey("sk-test-value")).toBe(true)
    expect(validateProviderApiKey("x".repeat(512))).toBe(true)
    expect(validateProviderApiKey(" ")).toBe(false)
    expect(validateProviderApiKey("x".repeat(513))).toBe(false)
    expect(validateProviderApiKey("key\nvalue")).toBe(false)
    expect(validateProviderApiKey("key\u200bvalue")).toBe(false)
    expect(validateProviderApiKey("密钥")).toBe(false)
  })

  it("declares the structured-output capability by protocol", () => {
    expect(providerCapabilities("anthropic")).toEqual({ protocol: "anthropic_messages", structuredJson: true, maxOutputTokens: 8_192 })
    expect(providerCapabilities("openai")).toEqual({ protocol: "openai_chat", structuredJson: true, maxOutputTokens: 8_192 })
    expect(providerCapabilities("none")).toEqual({ protocol: "none", structuredJson: false, maxOutputTokens: 0 })
  })
})
