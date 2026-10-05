import { describe, expect, it } from "vitest"

import { DEFAULT_DESIGN_BRIEF } from "@/domain/design-brief"
import { reviewDesignBrief } from "@/domain/design-review"

describe("design review", () => {
  it("reports missing UX states without blocking a draft", () => {
    const result = reviewDesignBrief(DEFAULT_DESIGN_BRIEF)
    expect(result.passed).toBe(true)
    expect(result.findings.some((finding) => finding.id === "state:empty")).toBe(true)
  })

  it("blocks duplicate, overflow, and broken-flow structures", () => {
    const result = reviewDesignBrief({ ...DEFAULT_DESIGN_BRIEF, nodes: [{ ...DEFAULT_DESIGN_BRIEF.nodes[0], id: "same", x: 900 }, { ...DEFAULT_DESIGN_BRIEF.nodes[1], id: "same" }], flows: [{ id: "f1", fromNodeId: "same", toNodeId: "missing", trigger: "click" }] })
    expect(result.passed).toBe(false)
    expect(result.criticalCount).toBeGreaterThanOrEqual(3)
  })

  it("requires keyboard and visible focus support", () => {
    const result = reviewDesignBrief({ ...DEFAULT_DESIGN_BRIEF, accessibility: { ...DEFAULT_DESIGN_BRIEF.accessibility, keyboard: false, focusVisible: false } })
    expect(result.findings.map((finding) => finding.id)).toEqual(expect.arrayContaining(["a11y:keyboard", "a11y:focus"]))
  })
})
