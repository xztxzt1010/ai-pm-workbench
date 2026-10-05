import { describe, expect, it } from "vitest"

import { analyzeExperiment, validateExperiment, validateExperimentResult } from "@/domain/experiment"

const result = validateExperimentResult({ schemaVersion: "1.0.0", experimentId: "exp-1", control: { name: "A", successes: 40, trials: 100 }, treatment: { name: "B", successes: 55, trials: 100 }, importedAt: "2026-07-15T00:00:00.000Z" })

describe("experiment", () => {
  it("validates the plan and produces deterministic lift/significance", () => {
    expect(validateExperiment({ schemaVersion: "1.0.0", id: "exp-1", projectId: "p1", name: "按钮实验", hypothesis: "新文案提高转化", primaryMetric: "signup_rate", samplePlan: "A/B 各 100", startDate: "2026-07-01", endDate: "2026-07-15", status: "completed", conclusion: "", decision: "" }).status).toBe("completed")
    const analysis = analyzeExperiment(result)
    expect(analysis).toMatchObject({ controlRate: 0.4, treatmentRate: 0.55, significance: "significant" })
    expect(analysis.absoluteLift).toBeCloseTo(0.15)
  })

  it("marks small samples and rejects invalid outcomes", () => {
    const small = validateExperimentResult({ ...result, control: { ...result.control, trials: 10, successes: 2 }, treatment: { ...result.treatment, trials: 10, successes: 3 } })
    expect(analyzeExperiment(small).significance).toBe("insufficient_sample")
    expect(() => validateExperimentResult({ ...result, control: { ...result.control, successes: 101 } })).toThrow()
    expect(() => validateExperiment({ schemaVersion: "1.0.0", id: "e", projectId: "p", name: "e", hypothesis: "h", primaryMetric: "m", samplePlan: "s", startDate: "2026-07-20", endDate: "2026-07-01", status: "draft", conclusion: "", decision: "" })).toThrow()
  })
})
