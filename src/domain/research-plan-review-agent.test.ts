import { describe, expect, it } from "vitest";
import {
  validateResearchPlanReviewOutput,
  type ResearchPlanReviewSource,
} from "./research-plan-review-agent";

const sources: ResearchPlanReviewSource[] = [
  {
    id: "p1",
    title: "访谈计划",
    objective: "验证优先级痛点",
    targetPersona: "产品经理",
    questions: ["每天如何安排待办？"],
    status: "active",
    startDate: "2026-07-10",
    endDate: "2026-07-20",
    updatedAt: "1000",
    results: [
      {
        entryId: "e1",
        researchType: "interview",
        title: "访谈 1",
        sourceRef: "interview://1",
        accessedAt: "2026-07-16",
        insight: "跨模块优先级不清晰",
        personaSuggestion: "高频项目负责人",
      },
    ],
  },
];
const valid = {
  schemaVersion: "1.0.0",
  findings: [
    {
      planId: "p1",
      severity: "warning",
      category: "coverage",
      summary: "当前只有一次访谈结果",
      recommendation: "补充样本",
      citations: [
        {
          sourceType: "result",
          sourceId: "e1",
          field: "insight",
          quote: "跨模块优先级不清晰",
        },
      ],
    },
  ],
  limitations: ["样本有限"],
};
describe("research plan review agent fixed eval", () => {
  it("accepts exact linked-result citations", () =>
    expect(
      validateResearchPlanReviewOutput(valid, sources).findings[0].planId,
    ).toBe("p1"));
  it("rejects results from another plan", () =>
    expect(() =>
      validateResearchPlanReviewOutput(
        {
          ...valid,
          findings: [
            {
              ...valid.findings[0],
              citations: [
                {
                  sourceType: "result",
                  sourceId: "other",
                  field: "insight",
                  quote: "跨模块优先级不清晰",
                },
              ],
            },
          ],
        },
        sources,
      ),
    ).toThrow("关联研究结果"));
  it("rejects altered plan evidence", () =>
    expect(() =>
      validateResearchPlanReviewOutput(
        {
          ...valid,
          findings: [
            {
              ...valid.findings[0],
              citations: [
                {
                  sourceType: "plan",
                  sourceId: "p1",
                  field: "objective",
                  quote: "不同目标",
                },
              ],
            },
          ],
        },
        sources,
      ),
    ).toThrow("未精确命中"));
});
