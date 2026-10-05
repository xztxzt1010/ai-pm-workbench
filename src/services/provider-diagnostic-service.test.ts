import { beforeEach, describe, expect, it, vi } from "vitest"

const { invokeMock } = vi.hoisted(() => ({ invokeMock: vi.fn() }))
vi.mock("@tauri-apps/api/core", () => ({ invoke: invokeMock }))

import { PROVIDER_DIAGNOSTIC_NONCE } from "@/domain/provider-diagnostic"
import type { ProviderConfig } from "@/domain/provider-rules"
import { runProviderDiagnostic } from "@/services/provider-diagnostic-service"

const provider: ProviderConfig = { kind: "openai", endpoint: "https://api.openai.com/v1", model: "test-model", enabled: true, updatedAt: "2026-07-15T00:00:00.000Z" }
const validOutput = {
  schemaVersion: "1.0.0",
  status: "ready",
  nonce: PROVIDER_DIAGNOSTIC_NONCE,
  checks: { structuredJson: true, instructionFollowing: true, syntheticDataOnly: true },
}

describe("provider diagnostic service", () => {
  beforeEach(() => invokeMock.mockReset())

  it("runs only the fixed synthetic read-only sample", async () => {
    invokeMock.mockResolvedValue({ state: "succeeded", message: "ok", output: validOutput, usage: { inputTokens: 20, outputTokens: 12 }, durationMs: 90 })
    const result = await runProviderDiagnostic(provider, true)
    expect(result.state).toBe("passed")
    const call = invokeMock.mock.calls[0][1].request
    expect(call.runType).toBe("provider_diagnostic")
    expect(call.agentDefinitionId).toBe("provider-diagnostic:v1")
    expect(call.projectId).toBeUndefined()
    expect(call.entityId).toBeUndefined()
    expect(call.maxOutputTokens).toBe(256)
    expect(JSON.stringify(call)).not.toMatch(/apiKey|meetingId|projectId|Bearer|secret/i)
  })

  it("rejects a semantically incorrect response", async () => {
    invokeMock.mockResolvedValue({ state: "succeeded", message: "ok", output: { ...validOutput, nonce: "WRONG" }, durationMs: 90 })
    await expect(runProviderDiagnostic(provider, true)).rejects.toThrow("固定 Eval")
  })

  it("does not run in browser preview", async () => {
    await expect(runProviderDiagnostic(provider, false)).rejects.toThrow("浏览器预览")
    expect(invokeMock).not.toHaveBeenCalled()
  })
})
