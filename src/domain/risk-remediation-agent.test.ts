import { describe, expect, it } from "vitest";
import {
  validateRiskRemediationOutput,
  type RiskRemediationOutput,
} from "./risk-remediation-agent";
import type { RiskReviewSource } from "./risk-review-agent";

const source: RiskReviewSource = {
  id: "risk-1",
  title: "发布延期",
  description: "审批尚未完成",
  severity: "high",
  probability: "likely",
  status: "open",
  owner: "PM",
  dueDate: "2026-07-18",
  mitigation: "准备降级范围",
  updatedAt: "100",
};

const valid: RiskRemediationOutput = {
  schemaVersion: "2.0.0",
  overallAssessment: "critical",
  proposals: [
    {
      riskId: "risk-1",
      expectedUpdatedAt: "100",
      priority: "immediate",
      changes: {
        mitigation: "确认降级范围并每天跟进审批",
        owner: "Release PM",
      },
      rationale: "高影响且很可能发生",
      citations: [
        { field: "severity", quote: "high" },
        { field: "mitigation", quote: "准备降级范围" },
      ],
    },
  ],
  limitations: ["仅依据已登记风险"],
};

describe("risk remediation agent fixed eval", () => {
  it("accepts an exact proposal for whitelisted fields", () => {
    const result = validateRiskRemediationOutput(valid, [source]);
    expect(result.proposals[0].changes).toEqual({
      mitigation: "确认降级范围并每天跟进审批",
      owner: "Release PM",
    });
  });

  it("rejects stale target snapshots", () => {
    const output = structuredClone(valid);
    output.proposals[0].expectedUpdatedAt = "99";
    expect(() => validateRiskRemediationOutput(output, [source])).toThrow();
  });

  it("rejects status changes outside the whitelist", () => {
    const output = structuredClone(valid) as unknown as {
      proposals: Array<{ changes: Record<string, string> }>;
    };
    output.proposals[0].changes.status = "closed";
    expect(() => validateRiskRemediationOutput(output, [source])).toThrow();
  });

  it("rejects inexact evidence and no-op changes", () => {
    const inexact = structuredClone(valid);
    inexact.proposals[0].citations[0].quote = "critical";
    expect(() => validateRiskRemediationOutput(inexact, [source])).toThrow();
    const noOp = structuredClone(valid);
    noOp.proposals[0].changes = { owner: "PM" };
    expect(() => validateRiskRemediationOutput(noOp, [source])).toThrow();
  });
});
