import { invoke } from "@tauri-apps/api/core"

import { sanitizeProviderError } from "@/domain/provider-rules"

export type AgentRunStatus = "queued" | "running" | "succeeded" | "failed" | "cancelled"

export interface AgentRunSummary {
  id: string
  runType: string
  entityId?: string
  providerMode: string
  model: string
  status: AgentRunStatus
  durationMs?: number
  inputTokens?: number
  outputTokens?: number
  errorCode?: string
  errorSummary?: string
  createdAt: string
  completedAt?: string
}

export interface AgentRunStepSummary {
  ordinal: number
  stepType: "model_request" | "model_response" | "tool_call" | "tool_result" | "validation"
  status: AgentRunStatus
  durationMs?: number
  inputTokens?: number
  outputTokens?: number
  errorCode?: string
  errorSummary?: string
  createdAt: string
  completedAt?: string
}

export interface AgentRecoveryResult {
  recoveredRuns: number
  recoveredSteps: number
}

let recoveryPromise: Promise<AgentRecoveryResult> | undefined

export async function recoverInterruptedAgentRuns(desktopRuntime: boolean): Promise<AgentRecoveryResult> {
  if (!desktopRuntime) return { recoveredRuns: 0, recoveredSteps: 0 }
  recoveryPromise ??= invoke<AgentRecoveryResult>("recover_interrupted_agent_runs").catch((error) => {
    recoveryPromise = undefined
    throw error
  })
  return recoveryPromise
}

export async function loadRecentAgentRuns(desktopRuntime: boolean, limit = 10): Promise<AgentRunSummary[]> {
  if (!desktopRuntime) return []
  const runs = await invoke<AgentRunSummary[]>("list_recent_agent_runs", { limit })
  return runs.map((run) => ({
    ...run,
    errorSummary: run.errorSummary ? sanitizeProviderError(run.errorSummary) : undefined,
  }))
}

export async function loadAgentRunSteps(desktopRuntime: boolean, runId: string): Promise<AgentRunStepSummary[]> {
  if (!desktopRuntime) return []
  const steps = await invoke<AgentRunStepSummary[]>("list_agent_run_steps", { runId })
  return steps.map((step) => ({
    ...step,
    errorSummary: step.errorSummary ? sanitizeProviderError(step.errorSummary) : undefined,
  }))
}
