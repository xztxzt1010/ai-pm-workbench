import { describe, expect, it, vi } from "vitest"

import { testProviderConnection } from "@/services/provider-connection-service"
import type { ProviderConfig } from "@/domain/provider-rules"

const base: ProviderConfig = { kind: "cc_switch", endpoint: "http://127.0.0.1:15721", model: "current", enabled: true, updatedAt: "2026-07-15T00:00:00.000Z" }

describe("provider connection service", () => {
  it("does not probe from browser preview", async () => {
    const probe = vi.fn()
    expect((await testProviderConnection(base, false, probe)).state).toBe("preview_only")
    expect(probe).not.toHaveBeenCalled()
  })

  it("reports a provider connection confirmed by the Sidecar", async () => {
    const probe = vi.fn().mockResolvedValue({ state: "available", message: "Provider 连接成功", latencyMs: 12 })
    const connection = await testProviderConnection(base, true, probe)
    expect(connection.state).toBe("available")
    expect(connection.latencyMs).toBe(12)
    expect(probe).toHaveBeenCalledWith({ kind: "cc_switch", endpoint: "http://127.0.0.1:15721", model: "current" })
  })

  it("reports an unavailable provider without exposing transport details", async () => {
    const connection = await testProviderConnection(base, true, vi.fn().mockResolvedValue({ state: "unavailable", message: "Provider 暂时不可访问", latencyMs: 1501 }))
    expect(connection.state).toBe("unavailable")
    expect(connection.latencyMs).toBe(1501)
  })

  it("tests cloud providers through the Sidecar boundary", async () => {
    const direct: ProviderConfig = { ...base, kind: "openai", endpoint: "https://api.openai.com/v1" }
    const probe = vi.fn().mockResolvedValue({ state: "credential_missing", message: "请先保存 API Key" })
    expect((await testProviderConnection(direct, true, probe)).state).toBe("credential_missing")
    expect(probe).toHaveBeenCalledOnce()
  })
})
