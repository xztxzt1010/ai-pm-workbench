import { describe, expect, it } from "vitest"

import { PROVIDER_DIAGNOSTIC_AGENT_POLICY, PROVIDER_DIAGNOSTIC_EVAL_SAMPLES, providerDiagnosticOutputSchema } from "@/domain/provider-diagnostic"

describe("provider diagnostic fixed eval", () => {
  it.each(PROVIDER_DIAGNOSTIC_EVAL_SAMPLES)("evaluates $name", ({ output, expectedPass }) => {
    expect(providerDiagnosticOutputSchema.safeParse(output).success).toBe(expectedPass)
  })

  it("has no business data or tool permissions", () => {
    expect(PROVIDER_DIAGNOSTIC_AGENT_POLICY).toEqual({
      agentId: "provider-diagnostic",
      dataScope: "none",
      allowedTools: [],
      businessWriteAccess: false,
      syntheticInputOnly: true,
    })
  })
})
