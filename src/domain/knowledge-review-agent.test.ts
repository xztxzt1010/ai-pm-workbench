import { describe, expect, it } from "vitest";
import {
  validateKnowledgeReviewOutput,
  type KnowledgeReviewMemory,
} from "./knowledge-review-agent";

const memory: KnowledgeReviewMemory = {
  id: "m1",
  memoryType: "confirmed_memory",
  status: "confirmed",
  title: "范围",
  content: "桌面优先",
  sourceKind: "manual",
  createdBy: "user",
  updatedAt: "2026-07-16",
  sources: [
    {
      id: "s1",
      sourceKind: "manual",
      quote: "桌面优先",
      createdAt: "2026-07-16",
    },
  ],
  conflicts: [],
};

describe("knowledge review agent eval", () => {
  it("accepts an exact memory citation", () => {
    const output = validateKnowledgeReviewOutput(
      {
        schemaVersion: "1.0.0",
        findings: [
          {
            memoryId: "m1",
            severity: "info",
            category: "provenance",
            summary: "来源可追溯",
            recommendation: "保留来源",
            citations: [
              { memoryId: "m1", field: "sourceQuote", quote: "桌面优先" },
            ],
          },
        ],
        limitations: [],
      },
      [memory],
    );
    expect(output.findings[0].citations[0].quote).toBe("桌面优先");
  });
  it("rejects citations that are not in the current snapshot", () => {
    expect(() =>
      validateKnowledgeReviewOutput(
        {
          schemaVersion: "1.0.0",
          findings: [
            {
              memoryId: "m1",
              severity: "warning",
              category: "missing_source",
              summary: "缺来源",
              recommendation: "补来源",
              citations: [
                { memoryId: "m1", field: "sourceQuote", quote: "未保存内容" },
              ],
            },
          ],
          limitations: [],
        },
        [memory],
      ),
    ).toThrow();
  });
});
