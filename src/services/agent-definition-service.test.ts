import { beforeEach, describe, expect, it, vi } from "vitest"

const { invokeMock } = vi.hoisted(() => ({ invokeMock: vi.fn() }))
vi.mock("@tauri-apps/api/core", () => ({ invoke: invokeMock }))

import { listAgentDefinitions } from "@/services/agent-definition-service"

describe("agent definition service", () => {
  beforeEach(() => invokeMock.mockReset())

  it("does not query the desktop database in browser preview", async () => {
    await expect(listAgentDefinitions(false)).resolves.toEqual([])
    expect(invokeMock).not.toHaveBeenCalled()
  })

  it("parses capability metadata without exposing raw JSON to the UI", async () => {
    invokeMock.mockResolvedValue([{ id: "provider-diagnostic:v1", definitionKey: "provider-diagnostic", version: 1, name: "诊断", description: "只读", inputSchemaVersion: "1.0.0", outputSchemaVersion: "1.0.0", permissionsJson: "{\"dataScope\":\"none\",\"allowedTools\":[],\"businessWriteAccess\":false}", createdAt: "1" }])
    const definitions = await listAgentDefinitions(true)
    expect(definitions[0].permissions).toEqual({ dataScope: "none", allowedTools: [], businessWriteAccess: false })
    expect(invokeMock).toHaveBeenCalledWith("list_agent_definitions")
  })

  it("falls back to empty capabilities for malformed legacy metadata", async () => {
    invokeMock.mockResolvedValue([{ id: "a:v1", definitionKey: "a", version: 1, name: "A", description: "", inputSchemaVersion: "1", outputSchemaVersion: "1", permissionsJson: "not-json", createdAt: "1" }])
    await expect(listAgentDefinitions(true)).resolves.toEqual([expect.objectContaining({ permissions: {} })])
  })
})
