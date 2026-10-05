import { describe, expect, it } from "vitest";

import {
  selectProjectQaEvidence,
  validateProjectQaOutput,
  type ProjectQaEvidence,
  type ProjectQaOutput,
} from "@/domain/project-qa";
import type { ProjectMemorySearchResult } from "@/services/project-memory-service";

const evidence: ProjectMemorySearchResult[] = [
  {
    id: "m1",
    projectId: "p1",
    memoryType: "confirmed_memory",
    status: "confirmed",
    title: "首发范围",
    content: "首发只做桌面端",
    sourceKind: "manual",
    sourceLocator: {},
    createdBy: "user",
    updatedAt: "1",
  },
];
const valid: ProjectQaOutput = {
  schemaVersion: "1.0.0",
  answer: "首发只做桌面端。",
  citations: [{ sourceType: "memory", sourceId: "m1", title: "首发范围" }],
  uncertainty: "未检索到更多范围信息。",
};

describe("project Q&A evidence contract", () => {
  it("accepts citations that exactly match retrieved memory", () => {
    expect(validateProjectQaOutput(valid, evidence).citations[0].sourceId).toBe(
      "m1",
    );
  });

  it("rejects fabricated, duplicated, or missing citations", () => {
    expect(() =>
      validateProjectQaOutput(
        {
          ...valid,
          citations: [{ sourceType: "memory", sourceId: "m2", title: "伪造" }],
        },
        evidence,
      ),
    ).toThrow("未检索到");
    expect(() =>
      validateProjectQaOutput(
        { ...valid, citations: [valid.citations[0], valid.citations[0]] },
        evidence,
      ),
    ).toThrow("未检索到");
    expect(() =>
      validateProjectQaOutput({ ...valid, citations: [] }, evidence),
    ).toThrow("必要的证据");
  });

  it("allows an explicit insufficient-evidence answer when no records were retrieved", () => {
    expect(
      validateProjectQaOutput(
        { ...valid, citations: [], answer: "暂无足够证据。" },
        [],
      ).uncertainty,
    ).toContain("未检索");
  });

  it("accepts citations for non-memory project sources", () => {
    const records = [
      {
        sourceType: "risk" as const,
        sourceId: "risk-1",
        title: "发布风险",
        content: "等待依赖",
      },
    ];
    const output = {
      ...valid,
      citations: [
        { sourceType: "risk" as const, sourceId: "risk-1", title: "发布风险" },
      ],
    };
    expect(
      validateProjectQaOutput(output, records).citations[0].sourceType,
    ).toBe("risk");
  });

  it("selects bounded evidence per source and prioritizes question matches", () => {
    const records: ProjectQaEvidence[] = [
      ...Array.from({ length: 7 }, (_, index) => ({
        sourceType: "risk" as const,
        sourceId: `risk-${index}`,
        title: index === 6 ? "支付发布风险" : `普通风险 ${index}`,
        content: index === 6 ? "支付依赖阻塞" : "待处理",
      })),
      ...Array.from({ length: 7 }, (_, index) => ({
        sourceType: "research" as const,
        sourceId: `research-${index}`,
        title: `访谈 ${index}`,
        content: "用户反馈",
      })),
      {
        sourceType: "risk" as const,
        sourceId: "risk-6",
        title: "重复证据",
        content: "不应重复",
      },
    ];
    const selected = selectProjectQaEvidence(records, "支付为什么阻塞？");
    expect(selected.filter((item) => item.sourceType === "risk")).toHaveLength(5);
    expect(selected.filter((item) => item.sourceType === "research")).toHaveLength(5);
    expect(selected.find((item) => item.sourceId === "risk-6")?.title).toBe(
      "支付发布风险",
    );
    expect(new Set(selected.map((item) => `${item.sourceType}:${item.sourceId}`)).size).toBe(
      selected.length,
    );
  });
});
