import { describe, expect, it } from "vitest"

import { DEFAULT_DESIGN_BRIEF, validateDesignBrief } from "@/domain/design-brief"

describe("design brief schema", () => {
  it("accepts the safe default brief", () => {
    expect(validateDesignBrief(DEFAULT_DESIGN_BRIEF).nodes).toHaveLength(5)
  })

  it("rejects arbitrary executable or unknown fields", () => {
    expect(() => validateDesignBrief({ ...DEFAULT_DESIGN_BRIEF, nodes: [{ ...DEFAULT_DESIGN_BRIEF.nodes[0], type: "html", html: "<script>alert(1)</script>" }] })).toThrow()
  })

  it("rejects oversized coordinates and invalid viewport", () => {
    expect(() => validateDesignBrief({ ...DEFAULT_DESIGN_BRIEF, viewport: { width: 10, height: 640 } })).toThrow()
    expect(() => validateDesignBrief({ ...DEFAULT_DESIGN_BRIEF, nodes: [{ ...DEFAULT_DESIGN_BRIEF.nodes[0], x: 3000 }] })).toThrow()
  })
})
