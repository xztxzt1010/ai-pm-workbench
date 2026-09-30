import { describe, expect, it } from "vitest"

import { parseDataset } from "@/domain/dataset-analysis"
import { calculateMetric, validateMetricDefinition } from "@/domain/metric-definition"

const dataset = parseDataset("id,amount,seen,paid\n1,10,true,true\n2,20,true,false\n3,,false,false\n", "csv")

describe("metric definitions", () => {
  it("calculates versioned whitelist formulas", () => {
    expect(calculateMetric(validateMetricDefinition({ schemaVersion: "1.0.0", id: "m-mean", name: "平均金额", description: "", unit: "CNY", formula: { operator: "mean", field: "amount" }, sourceDatasetId: "d1" }), dataset)).toMatchObject({ value: 15, includedRows: 2, missingRows: 1 })
    expect(calculateMetric(validateMetricDefinition({ schemaVersion: "1.0.0", id: "m-conv", name: "转化率", description: "", unit: "%", formula: { operator: "conversion", numeratorField: "paid", denominatorField: "seen" }, sourceDatasetId: "d1" }), dataset)).toMatchObject({ value: 0.5, numerator: 1, denominator: 2 })
  })

  it("rejects arbitrary formulas and missing fields", () => {
    expect(() => validateMetricDefinition({ schemaVersion: "1.0.0", id: "m", name: "bad", description: "", unit: "", formula: { operator: "eval", expression: "process.env" }, sourceDatasetId: "d1" })).toThrow()
    expect(() => calculateMetric(validateMetricDefinition({ schemaVersion: "1.0.0", id: "m", name: "bad", description: "", unit: "", formula: { operator: "sum", field: "unknown" }, sourceDatasetId: "d1" }), dataset)).toThrow()
  })
})
