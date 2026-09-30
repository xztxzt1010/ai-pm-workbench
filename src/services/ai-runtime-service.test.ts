import { describe, expect, it, vi } from "vitest"

const { invokeMock } = vi.hoisted(() => ({ invokeMock: vi.fn() }))
vi.mock("@tauri-apps/api/core", () => ({ invoke: invokeMock }))

import { loadAiRuntimeStatus } from "@/services/ai-runtime-service"

describe("AI runtime service", () => {
  it("keeps browser preview explicitly offline", async () => {
    expect(await loadAiRuntimeStatus(false)).toMatchObject({ state: "preview", restartCount: 0 })
  })

  it("reads only the sanitized Tauri status", async () => {
    invokeMock.mockResolvedValue({ state: "available", host: "127.0.0.1", port: 43123, protocolVersion: 1, restartCount: 0, message: "Sidecar 健康检查通过" })
    const status = await loadAiRuntimeStatus(true)
    expect(status).toEqual({ state: "available", host: "127.0.0.1", port: 43123, protocolVersion: 1, restartCount: 0, message: "Sidecar 健康检查通过" })
    expect(JSON.stringify(status)).not.toMatch(/token|api.?key|secret/i)
  })
})
