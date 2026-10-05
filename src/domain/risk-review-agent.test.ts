import { describe, expect, it } from "vitest";
import {
  validateRiskReviewOutput,
  type RiskReviewSource,
} from "./risk-review-agent";

const sources: RiskReviewSource[] = [
  {
    id: "risk-1",
    title: "发布延期",
    description: "审批尚未完成",
    severity: "high",
    probability: "likely",
    status: "open",
    owner: "PM",
    dueDate: "2026-07-18",
    updatedAt: "100",
    mitigation: "准备降级范围",
  },
];
const valid = {
  schemaVersion: "1.0.0",
  overallAssessment: "critical",
  findings: [
    {
      riskId: "risk-1",
      priority: "immediate",
      rationale: "高影响且很可能发生",
      suggestedMitigation: "确认降级范围并跟进审批",
      citations: [
        { field: "severity", quote: "high" },
        { field: "mitigation", quote: "准备降级范围" },
      ],
    },
  ],
  limitations: ["仅依据已登记风险"],
};

describe("risk review agent fixed eval", () => {
  it("accepts exact current-project risk citations", () =>
    expect(validateRiskReviewOutput(valid, sources).findings[0].riskId).toBe(
      "risk-1",
    ));
  it("rejects invented or cross-project risks", () =>
    expect(() =>
      validateRiskReviewOutput(
        {
          ...valid,
          findings: [{ ...valid.findings[0], riskId: "risk-other" }],
        },
        sources,
      ),
    ).toThrow("当前项目"));
  it("rejects citations that do not exactly match saved fields", () =>
    expect(() =>
      validateRiskReviewOutput(
        {
          ...valid,
          findings: [
            {
              ...valid.findings[0],
              citations: [{ field: "severity", quote: "critical" }],
            },
          ],
        },
        sources,
      ),
    ).toThrow("未精确命中"));
});
