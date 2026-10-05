import { invoke } from "@tauri-apps/api/core"

import { AppError } from "@/domain/app-error"
import {
  PROVIDER_DIAGNOSTIC_AGENT_POLICY,
  PROVIDER_DIAGNOSTIC_NONCE,
  providerDiagnosticOutputJsonSchema,
  validateProviderDiagnosticOutput,
} from "@/domain/provider-diagnostic"
import type { ProviderConfig } from "@/domain/provider-rules"

interface StructuredGenerationResult {
  state: "succeeded" | "failed" | "invalid"
  message: string
  output?: unknown
  usage?: { inputTokens?: number; outputTokens?: number }
  durationMs: number
}

export interface ProviderDiagnosticResult {
  runId: string
  state: "passed"
  message: string
  durationMs: number
  inputTokens?: number
  outputTokens?: number
}

export async function runProviderDiagnostic(provider: ProviderConfig, desktopRuntime: boolean): Promise<ProviderDiagnosticResult> {
  if (!desktopRuntime) throw new AppError("external_service", "浏览器预览不运行诊断 Agent")
  if (!provider.enabled || provider.kind === "none") throw new AppError("validation", "请先启用并保存模型 Provider")
  const runId = crypto.randomUUID()
  const result = await invoke<StructuredGenerationResult>("generate_structured_ai_output", {
    request: {
      runId,
      runType: "provider_diagnostic",
      agentDefinitionId: "provider-diagnostic:v1",
      idempotencyKey: `provider-diagnostic:v1:${runId}`,
      kind: provider.kind,
      endpoint: provider.endpoint,
      model: provider.model,
      system: [
        "You are a provider capability diagnostic agent.",
        "Use only the fixed synthetic instruction below.",
        "Do not request tools, files, project data, meeting data, or user data.",
        `Business write access: ${PROVIDER_DIAGNOSTIC_AGENT_POLICY.businessWriteAccess}.`,
      ].join("\n"),
      prompt: `Return the exact constrained diagnostic object with nonce ${PROVIDER_DIAGNOSTIC_NONCE}.`,
      responseSchema: providerDiagnosticOutputJsonSchema,
      maxOutputTokens: 256,
    },
  })
  if (result.state !== "succeeded" || result.output === undefined) {
    throw new AppError("external_service", result.message || "诊断 Agent 运行失败")
  }
  validateProviderDiagnosticOutput(result.output)
  return {
    runId,
    state: "passed",
    message: "结构化 JSON、指令遵循和只读边界检查通过",
    durationMs: result.durationMs,
    inputTokens: result.usage?.inputTokens,
    outputTokens: result.usage?.outputTokens,
  }
}
