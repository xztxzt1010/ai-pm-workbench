import { describe, expect, it } from "vitest"

import { analysisToSvg } from "@/domain/analysis-chart-export"

describe("analysis chart export", () => {
  it("produces deterministic safe SVG output", () => {
    const result = analysisToSvg("funnel", [{ field: "signup & <paid>", count: 4, rateFromPrevious: 0.5 }], "转化 <报告>")
    expect(result).toContain("signup &amp; &lt;paid&gt;")
    expect(result).toContain("转化 &lt;报告&gt;")
    expect(result).not.toContain("<script")
    expect(result).toContain('font-family="Segoe UI, Microsoft YaHei, Noto Sans CJK SC, sans-serif"')
    expect(result).toContain('text-anchor="end"')
    expect(result).toBe(analysisToSvg("funnel", [{ field: "signup & <paid>", count: 4, rateFromPrevious: 0.5 }], "转化 <报告>"))
  })

  it("renders summary numeric and categorical entries", () => {
    const svg = analysisToSvg("summary", { rowCount: 2, duplicateRowCount: 0, numeric: [{ field: "amount", count: 2, missingCount: 0, mean: 12, min: 10, max: 14 }], categorical: [{ field: "plan", values: [{ value: "pro", count: 2 }] }] })
    expect(svg).toContain("amount")
    expect(svg).toContain("plan: pro")
  })

  it("bounds long Chinese and emoji labels without splitting code points", () => {
    const label = `超长中文指标😀${"阶段".repeat(30)}`
    const title = `新用户激活分析${"季度".repeat(40)}`
    const svg = analysisToSvg("funnel", [{ field: label, count: 100, rateFromPrevious: 1 }], title)

    expect(svg).toContain("超长中文指标😀")
    expect(svg).toContain("…")
    expect(svg).toContain(`<title>${label}: 100 · 100.0%</title>`)
    expect(svg).toContain('x="944"')
    expect(svg).toContain('viewBox="0 0 960 280"')
  })

  it("replaces invalid XML controls and normalizes non-finite values", () => {
    const svg = analysisToSvg("trend", [{ period: "2026\u0001-07", value: Number.NaN, count: Number.POSITIVE_INFINITY }])

    expect(svg).toContain("2026�-07")
    expect(svg).not.toContain("\u0001")
    expect(svg).not.toContain("NaN")
    expect(svg).not.toContain("Infinity")
    expect(svg).toContain('width="0.00"')
  })

  it("caps large results at forty rows and keeps the canvas bounded", () => {
    const svg = analysisToSvg("trend", Array.from({ length: 55 }, (_, index) => ({ period: `P${index + 1}`, value: index + 1, count: 1 })))

    expect((svg.match(/<g role="group">/g) ?? []).length).toBe(40)
    expect(svg).toContain('height="1430"')
    expect(svg).not.toContain("P41:")
  })
})
