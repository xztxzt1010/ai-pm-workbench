import { describe, expect, it } from "vitest"

import { buildDocumentDiff } from "@/domain/document-diff"

describe("document diff", () => {
  it("reports deterministic additions and removals", () => {
    const result = buildDocumentDiff("# Title\nold\nfooter", "# Title\nnew\nfooter")
    expect(result).toMatchObject({ changed: true, added: 1, removed: 1, unchanged: 2 })
    expect(result.lines.filter((line) => line.kind === "removed").map((line) => line.text)).toEqual(["old"])
    expect(result.lines.filter((line) => line.kind === "added").map((line) => line.text)).toEqual(["new"])
  })

  it("does not execute or parse Markdown", () => {
    const result = buildDocumentDiff("<script>alert(1)</script>", "<script>alert(2)</script>")
    expect(result.lines.some((line) => line.text.includes("script"))).toBe(true)
  })

  it("rejects oversized input", () => {
    expect(() => buildDocumentDiff("x".repeat(200_001), "x")).toThrow()
  })
})
