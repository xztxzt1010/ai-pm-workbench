import { z } from "zod"

import { AppError } from "@/domain/app-error"

export const PROVIDER_DIAGNOSTIC_SCHEMA_VERSION = "1.0.0"
export const PROVIDER_DIAGNOSTIC_NONCE = "APM-DIAGNOSTIC-V1"

export const PROVIDER_DIAGNOSTIC_AGENT_POLICY = Object.freeze({
  agentId: "provider-diagnostic",
  dataScope: "none" as const,
  allowedTools: [] as const,
  businessWriteAccess: false,
  syntheticInputOnly: true,
})

export const providerDiagnosticOutputSchema = z.object({
  schemaVersion: z.literal(PROVIDER_DIAGNOSTIC_SCHEMA_VERSION),
  status: z.literal("ready"),
  nonce: z.literal(PROVIDER_DIAGNOSTIC_NONCE),
  checks: z.object({
    structuredJson: z.literal(true),
    instructionFollowing: z.literal(true),
    syntheticDataOnly: z.literal(true),
  }).strict(),
}).strict()

export const providerDiagnosticOutputJsonSchema = z.toJSONSchema(providerDiagnosticOutputSchema)
export type ProviderDiagnosticOutput = z.infer<typeof providerDiagnosticOutputSchema>

export interface ProviderDiagnosticEvalSample {
  name: string
  output: unknown
  expectedPass: boolean
}

export const PROVIDER_DIAGNOSTIC_EVAL_SAMPLES: readonly ProviderDiagnosticEvalSample[] = Object.freeze([
  {
    name: "exact constrained response",
    output: {
      schemaVersion: PROVIDER_DIAGNOSTIC_SCHEMA_VERSION,
      status: "ready",
      nonce: PROVIDER_DIAGNOSTIC_NONCE,
      checks: { structuredJson: true, instructionFollowing: true, syntheticDataOnly: true },
    },
    expectedPass: true,
  },
  {
    name: "wrong nonce",
    output: {
      schemaVersion: PROVIDER_DIAGNOSTIC_SCHEMA_VERSION,
      status: "ready",
      nonce: "WRONG",
      checks: { structuredJson: true, instructionFollowing: true, syntheticDataOnly: true },
    },
    expectedPass: false,
  },
  {
    name: "claims business data access",
    output: {
      schemaVersion: PROVIDER_DIAGNOSTIC_SCHEMA_VERSION,
      status: "ready",
      nonce: PROVIDER_DIAGNOSTIC_NONCE,
      checks: { structuredJson: true, instructionFollowing: true, syntheticDataOnly: false },
    },
    expectedPass: false,
  },
])

export function validateProviderDiagnosticOutput(value: unknown): ProviderDiagnosticOutput {
  const parsed = providerDiagnosticOutputSchema.safeParse(value)
  if (!parsed.success) throw new AppError("external_service", "诊断 Agent 输出未通过固定 Eval")
  return parsed.data
}
