import { beforeEach, describe, expect, it, vi } from "vitest"

const { invokeMock } = vi.hoisted(() => ({ invokeMock: vi.fn() }))
vi.mock("@tauri-apps/api/core", () => ({ invoke: invokeMock }))

import { loadAgentRunSteps, loadRecentAgentRuns, recoverInterruptedAgentRuns } from "@/services/agent-run-service"

describe("agent run service", () => {
  beforeEach(() => invokeMock.mockReset())

  it("keeps browser preview free of desktop trace calls", async () => {
    await expect(loadRecentAgentRuns(false)).resolves.toEqual([])
    expect(invokeMock).not.toHaveBeenCalled()
  })

  it("returns only sanitized run summaries", async () => {
    invokeMock.mockResolvedValue([{ id: "run-1", runType: "meeting_analysis", providerMode: "openai", model: "test", status: "failed", errorSummary: "Bearer secret-value", createdAt: "123", durationMs: 10 }])
    const runs = await loadRecentAgentRuns(true, 5)
    expect(runs[0].errorSummary).toBe("Bearer [REDACTED]")
    expect(invokeMock).toHaveBeenCalledWith("list_recent_agent_runs", { limit: 5 })
  })

  it("loads ordered step summaries and sanitizes errors", async () => {
    invokeMock.mockResolvedValue([{ ordinal: 1, stepType: "model_request", status: "failed", errorSummary: "token=private-value", createdAt: "1" }])
    const steps = await loadAgentRunSteps(true, "run-1")
    expect(steps[0].errorSummary).toBe("token=[REDACTED]")
    expect(invokeMock).toHaveBeenCalledWith("list_agent_run_steps", { runId: "run-1" })
  })

  it("does not query steps in browser preview", async () => {
    await expect(loadAgentRunSteps(false, "run-1")).resolves.toEqual([])
    expect(invokeMock).not.toHaveBeenCalled()
  })

  it("recovers interrupted runs only in the desktop runtime", async () => {
    await expect(recoverInterruptedAgentRuns(false)).resolves.toEqual({ recoveredRuns: 0, recoveredSteps: 0 })
    expect(invokeMock).not.toHaveBeenCalled()
    invokeMock.mockResolvedValue({ recoveredRuns: 2, recoveredSteps: 3 })
    await expect(recoverInterruptedAgentRuns(true)).resolves.toEqual({ recoveredRuns: 2, recoveredSteps: 3 })
    await expect(recoverInterruptedAgentRuns(true)).resolves.toEqual({ recoveredRuns: 2, recoveredSteps: 3 })
    expect(invokeMock).toHaveBeenCalledWith("recover_interrupted_agent_runs")
    expect(invokeMock).toHaveBeenCalledTimes(1)
  })
})
