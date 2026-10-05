// @vitest-environment jsdom

import { beforeEach, describe, expect, it } from "vitest"

import { loadProviderConfig, persistProviderConfig } from "@/data/provider-settings"

describe("provider settings", () => {
  beforeEach(() => localStorage.clear())

  it("persists only non-sensitive provider metadata", async () => {
    await persistProviderConfig({ kind: "openai_compatible", endpoint: "https://api.example.com", model: "gpt-test", enabled: true }, false)
    const raw = localStorage.getItem("assistant-product-manager.provider-config.v1") ?? ""
    expect(raw).toContain("gpt-test")
    expect(raw).not.toMatch(/apiKey|token|secret/i)
    expect((await loadProviderConfig(false)).enabled).toBe(true)
  })

  it("rejects unknown provider kinds from legacy or tampered storage", async () => {
    localStorage.setItem("assistant-product-manager.provider-config.v1", JSON.stringify({ kind: "unknown", endpoint: "https://evil.invalid", model: "x", enabled: true }))
    expect(await loadProviderConfig(false)).toMatchObject({ kind: "none", enabled: false })
  })
})
