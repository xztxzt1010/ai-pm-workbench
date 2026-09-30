import { describe, expect, it } from "vitest";
import { validatePlanEngineerOutput } from "./plan-engineer-agent";
import type { ResearchPlanReviewSource } from "./research-plan-review-agent";
import { validateResearchPlanReviewOutput } from "./research-plan-review-agent";

const sources: ResearchPlanReviewSource[] = [
  {
    id: "plan-1",
    title: "访谈计划",
    objective: "验证问题",
    targetPersona: "PM",
    questions: ["目前如何安排任务？"],
    status: "planned",
    startDate: "2026-07-16",
    endDate: "2026-07-20",
    updatedAt: "1000",
    results: [
      {
        entryId: "entry-1",
        researchType: "interview",
        title: "用户访谈",
        sourceRef: "interview://1",
        accessedAt: "2026-07-17",
        insight: "用户需要更明确的问题",
        personaSuggestion: "高级产品经理",
      },
    ],
  },
];

const valid = {
  schemaVersion: "2.0.0",
  proposals: [
    {
      planId: "plan-1",
      expectedUpdatedAt: "1000",
      changes: {
        questions: ["目前如何安排任务？", "什么会打断优先级判断？"],
      },
      rationale: "补齐优先级中断场景",
      citations: [
        {
          sourceType: "result",
          sourceId: "entry-1",
          field: "insight",
          quote: "用户需要更明确的问题",
        },
      ],
    },
  ],
  limitations: [],
};

describe("plan engineer agent eval", () => {
  it("keeps the v1 read-only orchestration output grounded", () => {
    const output = validateResearchPlanReviewOutput(
      {
        schemaVersion: "1.0.0",
        findings: [
          {
            planId: "plan-1",
            category: "coverage",
            severity: "warning",
            summary: "缺少结果",
            recommendation: "补充访谈",
            citations: [{ sourceType: "plan", sourceId: "plan-1", field: "title", quote: "访谈计划" }],
          },
        ],
        limitations: [],
      },
      sources,
    );
    expect(output.findings[0].planId).toBe("plan-1");
  });

  it("accepts an allowlisted update grounded in the current snapshot", () => {
    const output = validatePlanEngineerOutput(valid, sources);
    expect(output.proposals[0]).toMatchObject({
      planId: "plan-1",
      expectedUpdatedAt: "1000",
      changes: { questions: ["目前如何安排任务？", "什么会打断优先级判断？"] },
    });
  });

  it("rejects stale snapshots and fields outside the deterministic executor", () => {
    expect(() =>
      validatePlanEngineerOutput(
        {
          ...valid,
          proposals: [{ ...valid.proposals[0], expectedUpdatedAt: "999" }],
        },
        sources,
      ),
    ).toThrow(/快照/);
    expect(() =>
      validatePlanEngineerOutput(
        {
          ...valid,
          proposals: [
            {
              ...valid.proposals[0],
              changes: { status: "completed" },
            },
          ],
        },
        sources,
      ),
    ).toThrow(/未授权字段/);
  });

  it("rejects non-exact evidence and no-op changes", () => {
    expect(() =>
      validatePlanEngineerOutput(
        {
          ...valid,
          proposals: [
            {
              ...valid.proposals[0],
              citations: [
                { ...valid.proposals[0].citations[0], quote: "模糊转述" },
              ],
            },
          ],
        },
        sources,
      ),
    ).toThrow(/精确命中/);
    expect(() =>
      validatePlanEngineerOutput(
        {
          ...valid,
          proposals: [
            {
              ...valid.proposals[0],
              changes: { objective: "验证问题" },
            },
          ],
        },
        sources,
      ),
    ).toThrow(/实际字段变化/);
  });
});
