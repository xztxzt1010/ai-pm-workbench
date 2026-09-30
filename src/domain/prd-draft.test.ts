import { describe, expect, it } from "vitest"

import { validatePrdDraftOutput, type PrdRequirementEvidence } from "@/domain/prd-draft"

const requirements: PrdRequirementEvidence[] = [{ requirementId: "r1", versionId: "v1", title: "离线搜索", description: "支持离线搜索", targetUsers: "PM", scenario: "复盘", painPoint: "网络不稳", acceptanceCriteria: ["无需网络"] }]

describe("PRD draft evidence contract", () => {
  it("accepts exact confirmed requirement citations", () => {
    const output = validatePrdDraftOutput({ schemaVersion: "1.0.0", title: "PRD", contentMarkdown: "# PRD", citations: [{ requirementId: "r1", versionId: "v1", title: "离线搜索" }] }, requirements)
    expect(output.citations[0].requirementId).toBe("r1")
  })

  it("rejects fabricated or duplicated requirement citations", () => {
    expect(() => validatePrdDraftOutput({ schemaVersion: "1.0.0", title: "PRD", contentMarkdown: "# PRD", citations: [{ requirementId: "r2", versionId: "v2", title: "伪造" }] }, requirements)).toThrow("未确认")
    expect(() => validatePrdDraftOutput({ schemaVersion: "1.0.0", title: "PRD", contentMarkdown: "# PRD", citations: [{ requirementId: "r1", versionId: "v1", title: "离线搜索" }, { requirementId: "r1", versionId: "v1", title: "离线搜索" }] }, requirements)).toThrow("未确认")
  })
})
