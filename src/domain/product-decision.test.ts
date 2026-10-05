import { describe, expect, it } from "vitest"

import { decisionReviewState, nextProductDecisionStatus, validateProductDecisionDraft } from "@/domain/product-decision"

describe("product decision", () => {
  it("normalizes evidence lists and review dates", () => {
    const result = validateProductDecisionDraft({ title: " 采用本地优先 ", context: "隐私要求", decision: "本地保存", alternatives: ["云端", "云端"], evidence: ["访谈"], objections: ["同步成本"], impact: "降低泄漏风险", reviewDate: "2026-08-01" })
    expect(result.alternatives).toEqual(["云端"])
    expect(result.title).toBe("采用本地优先")
  })

  it.each([
    ["title", "请填写决策标题"],
    ["context", "请填写背景与问题"],
    ["decision", "请填写决策结论"],
    ["impact", "请填写影响与后续"],
  ] as const)("identifies a missing required %s field", (field, message) => {
    const draft = { title: "标题", context: "背景", decision: "结论", alternatives: [], evidence: [], objections: [], impact: "影响", reviewDate: "2026-08-01" }
    expect(() => validateProductDecisionDraft({ ...draft, [field]: "   " })).toThrow(message)
  })

  it("identifies the exact field that exceeds its limit", () => {
    expect(() => validateProductDecisionDraft({ title: "决".repeat(201), context: "背景", decision: "结论", alternatives: [], evidence: [], objections: [], impact: "影响", reviewDate: "2026-08-01" })).toThrow("决策标题不能超过 200 字符")
  })

  it("enforces decision state transitions and deterministic review state", () => {
    expect(nextProductDecisionStatus("proposed", "confirm")).toBe("confirmed")
    expect(nextProductDecisionStatus("confirmed", "revisit")).toBe("revisit")
    expect(() => nextProductDecisionStatus("proposed", "revisit")).toThrow("不允许")
    expect(decisionReviewState("2026-07-15", "2026-07-16")).toBe("overdue")
  })
})
