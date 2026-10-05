import { describe, expect, it } from "vitest";
import {
  validateReleaseReviewOutput,
  type ReleaseReviewSource,
} from "./release-review-agent";

const sources: ReleaseReviewSource[] = [
  {
    id: "release-1",
    title: "v1",
    scope: ["今日驾驶舱"],
    checklist: ["备份数据库", "执行回归"],
    rollbackPlan: "恢复上一安装包",
    result: "",
    retrospective: "",
    followUp: ["复查采用率"],
    status: "ready",
    targetDate: "2026-07-20",
  },
];
const valid = {
  schemaVersion: "1.0.0",
  readiness: "needs_attention",
  findings: [
    {
      releaseId: "release-1",
      severity: "warning",
      category: "checklist",
      summary: "仍需确认回归",
      recommendation: "执行发布前回归",
      citations: [{ field: "checklist", quote: "执行回归" }],
    },
  ],
  limitations: ["未执行真实安装验收"],
};

describe("release review agent fixed eval", () => {
  it("accepts exact saved release citations", () =>
    expect(
      validateReleaseReviewOutput(valid, sources).findings[0].releaseId,
    ).toBe("release-1"));
  it("rejects invented or cross-project releases", () =>
    expect(() =>
      validateReleaseReviewOutput(
        { ...valid, findings: [{ ...valid.findings[0], releaseId: "other" }] },
        sources,
      ),
    ).toThrow("当前项目"));
  it("rejects invented checklist evidence", () =>
    expect(() =>
      validateReleaseReviewOutput(
        {
          ...valid,
          findings: [
            {
              ...valid.findings[0],
              citations: [{ field: "checklist", quote: "不存在的检查" }],
            },
          ],
        },
        sources,
      ),
    ).toThrow("未精确命中"));
});
