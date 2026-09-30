import { describe, expect, it } from "vitest"

import { validateAnalysisExplanation } from "@/domain/analysis-explanation"

const result = { numeric: [{ field: "amount", mean: 12 }] }

describe("analysis explanation contract", () => {
  it("accepts only values cited from the deterministic result", () => {
    const output = { schemaVersion: "1.0.0", summary: "金额存在明显差异", findings: [{ title: "金额均值", explanation: "建议结合样本量继续观察", evidence: [{ path: "$.numeric[0].mean", label: "金额均值", value: 12 }] }], limitations: ["仅基于当前数据"] }
    expect(validateAnalysisExplanation(output, result).findings[0].evidence[0].value).toBe(12)
  })

  it("rejects unreferenced values and numeric prose", () => {
    const base = { schemaVersion: "1.0.0", summary: "摘要", findings: [{ title: "发现", explanation: "观察 12 个样本", evidence: [{ path: "$.numeric[0].mean", label: "均值", value: 12 }] }], limitations: [] }
    expect(() => validateAnalysisExplanation(base, result)).toThrow("无数值文本契约")
    expect(() => validateAnalysisExplanation({ ...base, findings: [{ ...base.findings[0], explanation: "观察样本", evidence: [{ path: "$.numeric[0].mean", label: "均值", value: 99 }] }] }, result)).toThrow("未命中真实结果")
  })
})
