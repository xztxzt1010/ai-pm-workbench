import { describe, expect, it } from "vitest"

import { buildDocumentDiff } from "@/domain/document-diff"
import { validateDocumentDiffReview } from "@/domain/document-diff-review"

const diff = buildDocumentDiff("old", "new")

describe("document diff review", () => {
  it("accepts findings that cite real changed line indexes", () => {
    const output = validateDocumentDiffReview({ schemaVersion: "1.0.0", verdict: "needs_review", summary: "范围发生变化", findings: [{ severity: "warning", category: "scope", summary: "删除旧范围", recommendation: "确认影响", evidenceLineIndexes: [0, 1] }] }, diff)
    expect(output.findings).toHaveLength(1)
  })

  it("rejects context or missing evidence indexes", () => {
    const withContext = buildDocumentDiff("same\nold", "same\nnew")
    expect(() => validateDocumentDiffReview({ schemaVersion: "1.0.0", verdict: "needs_review", summary: "风险", findings: [{ severity: "warning", category: "scope", summary: "问题", recommendation: "确认", evidenceLineIndexes: [0] }] }, withContext)).toThrow()
    expect(() => validateDocumentDiffReview({ schemaVersion: "1.0.0", verdict: "needs_review", summary: "风险", findings: [{ severity: "warning", category: "scope", summary: "问题", recommendation: "确认", evidenceLineIndexes: [99] }] }, diff)).toThrow()
  })
})
