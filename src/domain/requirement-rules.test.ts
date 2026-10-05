import { describe, expect, it } from "vitest"

import { requirementContentChanges, requirementVersionSummary } from "@/domain/requirement-rules"

const base = { description: "One", targetUsers: "PM", scenario: "Review", painPoint: "Slow", acceptanceCriteria: ["Cite source"] }

describe("requirement version rules", () => {
  it("identifies changed structured fields", () => {
    expect(requirementContentChanges({ ...base, description: "Two", acceptanceCriteria: ["Cite source", "Show offset"] }, base)).toEqual(["需求描述", "验收标准"])
    expect(requirementContentChanges({ ...base, targetUsers: "Designer", scenario: "Planning", painPoint: "Missing context" }, base)).toEqual(["目标用户", "使用场景", "痛点"])
  })

  it("summarizes confirmation and evidence state", () => {
    const summary = requirementVersionSummary({ id: "v2", requirementCardId: "card", versionNumber: 2, title: "Title", content: base, evidence: [{ paragraphId: "p1", quote: "evidence", startOffset: 0, endOffset: 8 }], source: "user", isConfirmed: true, createdAt: "2026-07-14T00:00:00.000Z" })
    expect(summary).toEqual({ versionNumber: 2, changes: ["初始版本"], evidenceCount: 1, confirmed: true })
  })
})
