import { describe, expect, it } from "vitest";

import type { Project } from "@/domain/models";
import {
  buildProjectContext,
  projectContextRecordLocator,
  renderProjectContextMarkdown,
} from "@/domain/project-context";

const project: Project = {
  id: "p1",
  name: "上下文中心",
  goal: "在一个页面掌握项目全貌",
  status: "active",
  startDate: "2026-07-01",
  endDate: "2026-08-01",
  progress: 40,
  updatedAt: "2026-07-17T00:00:00.000Z",
  owner: "PM",
};

function input() {
  return {
    project,
    milestones: [],
    confirmations: [],
    requirements: [],
    documents: [],
    knowledgeItems: [],
    risks: [],
    decisions: [],
    releases: [],
    generatedAt: "2026-07-18T00:00:00.000Z",
  };
}

describe("project context contract", () => {
  it("uses one stable record locator contract for source links and target panels", () => {
    expect(projectContextRecordLocator("project", "p1")).toBe(
      "project-settings",
    );
    expect(projectContextRecordLocator("requirement", "req-1")).toBe(
      "project-requirement-req-1",
    );
    expect(projectContextRecordLocator("product_document", "prd-1")).toBe(
      "project-document-prd-1",
    );
    expect(projectContextRecordLocator("risk", "risk-1")).toBe(
      "project-risk-risk-1",
    );
    expect(() => projectContextRecordLocator("decision", " ")).toThrow(/ID/);
  });

  it("keeps unsupported technical and testing material as explicit gaps", () => {
    const snapshot = buildProjectContext({
      ...input(),
      knowledgeItems: [
        {
          id: "k1",
          projectId: "p1",
          title: "架构讨论",
          itemType: "technical_discussion",
          status: "confirmed",
          contentVersion: 2,
          contentMarkdown: "讨论本地优先方案",
          updatedAt: "2026-07-18T00:00:00.000Z",
        },
      ],
      releases: [
        {
          id: "r1",
          projectId: "p1",
          title: "0.1 发布",
          status: "reviewed",
          result: "完成冒烟检查",
          retrospective: "",
          updatedAt: "2026-07-18T00:00:00.000Z",
        },
      ],
    });
    expect(
      snapshot.sections.find((item) => item.key === "technical_solution"),
    ).toMatchObject({
      status: "missing",
      candidateSources: [{ id: "k1", formal: false }],
    });
    expect(
      snapshot.sections.find((item) => item.key === "testing"),
    ).toMatchObject({
      status: "missing",
      candidateSources: [{ id: "r1", formal: false }],
    });
  });

  it("marks old formal sources stale and caps sources deterministically", () => {
    const snapshot = buildProjectContext({
      ...input(),
      generatedAt: "2026-09-01T00:00:00.000Z",
      sourceLimitPerSection: 1,
    });
    expect(snapshot.sections.find((item) => item.key === "goal")?.status).toBe(
      "stale",
    );
    expect(snapshot.sourceLimitPerSection).toBe(1);
  });

  it("rejects cross-project records before they enter the package", () => {
    expect(() =>
      buildProjectContext({
        ...input(),
        risks: [
          {
            id: "risk",
            projectId: "p2",
            title: "越界",
            description: "不应出现",
            status: "open",
            owner: "",
            updatedAt: "2026-07-18T00:00:00.000Z",
          },
        ],
      }),
    ).toThrow(/跨项目/);
  });

  it("renders the same statuses and bounded source identities to Markdown", () => {
    const snapshot = buildProjectContext(input());
    const markdown = renderProjectContextMarkdown(snapshot);
    expect(markdown).toContain("项目目标 · 已有");
    expect(markdown).toContain("技术方案 · 缺失");
    expect(markdown).toContain("缺口及候选材料不是项目事实");
    expect(markdown).toContain("个人知识：未加入");
  });
});
