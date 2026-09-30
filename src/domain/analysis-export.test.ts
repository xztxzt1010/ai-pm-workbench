import { describe, expect, it } from "vitest"

import { analysisToCsv } from "@/domain/analysis-export"

describe("analysis export", () => {
  it("exports funnel rows with a stable header", () => {
    expect(analysisToCsv("funnel", [{ field: "signup", count: 2, rateFromPrevious: 0.5 }])).toBe("field,count,rateFromPrevious\r\nsignup,2,0.5\r\n")
  })

  it("quotes commas, quotes, and newlines safely", () => {
    const csv = analysisToCsv("cohort", [{ cohort: "A, \"new\"", count: 1, mean: 2 }])
    expect(csv).toContain('"A, ""new"""')
  })
})
