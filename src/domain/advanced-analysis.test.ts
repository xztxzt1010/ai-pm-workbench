import { describe, expect, it } from "vitest"

import { parseDataset } from "@/domain/dataset-analysis"
import { runCohort, runFunnel, runTrend } from "@/domain/advanced-analysis"

const dataset = parseDataset("date,visit,signup,purchase,region,revenue\n2026-01-01,true,true,false,A,10\n2026-01-01,true,false,false,B,20\n2026-01-02,true,true,true,A,30\n", "csv")

describe("advanced deterministic analysis", () => {
  it("computes a funnel with step conversion rates", () => {
    expect(runFunnel(dataset, ["visit", "signup", "purchase"])).toEqual([{ field: "visit", count: 3, rateFromPrevious: 1 }, { field: "signup", count: 2, rateFromPrevious: 2 / 3 }, { field: "purchase", count: 1, rateFromPrevious: 0.5 }])
  })

  it("groups trends by ISO date and cohorts by category", () => {
    expect(runTrend(dataset, "date", "revenue")).toEqual([{ period: "2026-01-01", count: 2, value: 30 }, { period: "2026-01-02", count: 1, value: 30 }])
    expect(runCohort(dataset, "region", "revenue")).toEqual([{ cohort: "A", count: 2, mean: 20 }, { cohort: "B", count: 1, mean: 20 }])
  })

  it("rejects missing fields and invalid funnel shapes", () => {
    expect(() => runFunnel(dataset, ["visit"])).toThrow()
    expect(() => runTrend(dataset, "missing")).toThrow()
    expect(() => runCohort(dataset, "region", "missing")).toThrow()
  })
})
