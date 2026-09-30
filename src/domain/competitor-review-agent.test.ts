import { describe, expect, it } from "vitest";
import {
  validateCompetitorReviewOutput,
  type CompetitorReviewSource,
} from "./competitor-review-agent";

const sources: CompetitorReviewSource[] = [
  {
    id: "c1",
    name: "Alpha",
    sourceRef: "https://alpha.example",
    accessedAt: "2026-07-16",
    strengths: "自动聚合",
    weaknesses: "缺少离线模式",
    positioning: "团队协作",
  },
  {
    id: "c2",
    name: "Beta",
    sourceRef: "file://beta.md",
    accessedAt: "2026-07-15",
    strengths: "本地优先",
    weaknesses: "分析能力弱",
    positioning: "个人工作台",
  },
];
const valid = {
  schemaVersion: "1.0.0",
  findings: [
    {
      profileIds: ["c1", "c2"],
      category: "positioning_overlap",
      summary: "定位存在部分重叠",
      implication: "需要明确本地个人工作台差异",
      citations: [
        { profileId: "c1", field: "positioning", quote: "团队协作" },
        { profileId: "c2", field: "positioning", quote: "个人工作台" },
      ],
    },
  ],
  limitations: ["仅依据手工档案"],
};

describe("competitor review agent fixed eval", () => {
  it("accepts exact citations for every compared profile", () =>
    expect(
      validateCompetitorReviewOutput(valid, sources).findings[0].profileIds,
    ).toEqual(["c1", "c2"]));
  it("rejects cross-project or invented profiles", () =>
    expect(() =>
      validateCompetitorReviewOutput(
        {
          ...valid,
          findings: [{ ...valid.findings[0], profileIds: ["c1", "other"] }],
        },
        sources,
      ),
    ).toThrow("当前项目"));
  it("rejects comparison profiles without their own evidence", () =>
    expect(() =>
      validateCompetitorReviewOutput(
        {
          ...valid,
          findings: [
            {
              ...valid.findings[0],
              citations: [valid.findings[0].citations[0]],
            },
          ],
        },
        sources,
      ),
    ).toThrow("每个竞品"));
});
