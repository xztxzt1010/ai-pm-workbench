import { describe, expect, it } from "vitest"

import { parseVocFeedback, summarizeVocFeedback, trendVocFeedback } from "@/domain/voc-feedback"

describe("VOC feedback", () => {
  it("normalizes feedback and deterministically clusters and trends it", () => {
    const items = parseVocFeedback(JSON.stringify([{ content: "导出很慢", category: "性能", severity: "high", source: "support", sourceRef: "ticket-1", occurredAt: "2026-07-16" }, { content: "导出很慢", category: "性能", severity: "critical", source: "support", sourceRef: "ticket-2", occurredAt: "2026-07-17" }]), "json")
    expect(summarizeVocFeedback(items)[0]).toMatchObject({ count: 2, highestSeverity: "critical" })
    expect(trendVocFeedback(items)).toEqual([{ period: "2026-07", count: 2, criticalCount: 1 }])
  })

  it("rejects unsupported severity and source values", () => {
    expect(() => parseVocFeedback('[{"content":"x","severity":"urgent"}]', "json")).toThrow("严重程度无效")
    expect(() => parseVocFeedback('[{"content":"x","source":"unknown"}]', "json")).toThrow("来源无效")
  })
})
