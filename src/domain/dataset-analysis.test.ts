import { describe, expect, it } from "vitest"

import { parseDataset, runDeterministicAnalysis } from "@/domain/dataset-analysis"

describe("dataset analysis", () => {
  it("parses CSV, infers fields, and counts duplicates/missing values", () => {
    const dataset = parseDataset("id,amount,active\n1,10,true\n2,,false\n2,10,false\n", "csv")
    expect(dataset.fields).toEqual(expect.arrayContaining([{ name: "amount", type: "number", missingCount: 1, invalidCount: 0, uniqueCount: 2 }]))
    expect(dataset.duplicateRowCount).toBe(0)
    expect(runDeterministicAnalysis(dataset).numeric.find((item) => item.field === "amount")).toMatchObject({ field: "amount", count: 2, missingCount: 1, mean: 10, min: 10, max: 10 })
  })

  it("parses JSON objects and returns stable categorical ordering", () => {
    const dataset = parseDataset(JSON.stringify([{ plan: "pro" }, { plan: "free" }, { plan: "pro" }]), "json")
    const result = runDeterministicAnalysis(dataset)
    expect(result.categorical[0].values).toEqual([{ value: "pro", count: 2 }, { value: "free", count: 1 }])
  })

  it("rejects malformed or oversized datasets", () => {
    expect(() => parseDataset("a,a\n1,2", "csv")).toThrow()
    expect(() => parseDataset("not-json", "json")).toThrow()
    expect(() => parseDataset("x".repeat(10 * 1024 * 1024 + 1), "json")).toThrow()
  })
})
