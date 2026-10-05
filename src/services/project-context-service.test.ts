import { beforeEach, describe, expect, it, vi } from "vitest";

import type { Project, RequirementDocument } from "@/domain/models";
import { getRequirementRepository } from "@/data/requirement-repository";
import { listKnowledgeItems } from "@/services/knowledge-service";
import { listProductDecisions } from "@/services/product-decision-service";
import { listProductDocuments } from "@/services/product-document-service";
import { loadProjectContext } from "@/services/project-context-service";
import { listProjectRisks } from "@/services/project-risk-service";
import { listReleases } from "@/services/release-service";

vi.mock("@/data/requirement-repository", () => ({
  getRequirementRepository: vi.fn(),
}));
vi.mock("@/services/knowledge-service", () => ({
  listKnowledgeItems: vi.fn(),
}));
vi.mock("@/services/product-decision-service", () => ({
  listProductDecisions: vi.fn(),
}));
vi.mock("@/services/product-document-service", () => ({
  listProductDocuments: vi.fn(),
}));
vi.mock("@/services/project-risk-service", () => ({
  listProjectRisks: vi.fn(),
}));
vi.mock("@/services/release-service", () => ({ listReleases: vi.fn() }));

const project: Project = {
  id: "p1",
  name: "上下文预算",
  goal: "验证聚合边界",
  status: "active",
  startDate: "2026-07-01",
  endDate: "2026-08-01",
  progress: 30,
  updatedAt: "2026-07-18T00:00:00.000Z",
};

function requirement(index: number): RequirementDocument {
  const timestamp = `2026-07-18T00:${String(index % 60).padStart(2, "0")}:00.000Z`;
  return {
    card: {
      id: `req-${index}`,
      meetingId: "meeting-1",
      projectId: "p1",
      currentVersionId: `req-version-${index}`,
      title: `需求 ${index}`,
      status: "confirmed",
      createdAt: timestamp,
      updatedAt: timestamp,
    },
    currentVersion: {
      id: `req-version-${index}`,
      requirementCardId: `req-${index}`,
      versionNumber: 1,
      title: `需求 ${index}`,
      content: {
        description: `需求说明 ${index}`,
        targetUsers: "PM",
        scenario: "项目管理",
        painPoint: "上下文分散",
        acceptanceCriteria: [],
      },
      evidence: [
        {
          paragraphId: `paragraph-${index}`,
          quote: "证据",
          startOffset: 0,
          endOffset: 2,
        },
      ],
      source: "user",
      isConfirmed: true,
      createdAt: timestamp,
    },
    versions: [],
  };
}

describe("project context service", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(getRequirementRepository).mockReturnValue({
      listByProject: vi.fn().mockResolvedValue([]),
    } as never);
    vi.mocked(listProductDocuments).mockResolvedValue([]);
    vi.mocked(listKnowledgeItems).mockResolvedValue([]);
    vi.mocked(listProjectRisks).mockResolvedValue([]);
    vi.mocked(listProductDecisions).mockResolvedValue([]);
    vi.mocked(listReleases).mockResolvedValue([]);
  });

  it("requests bounded project data and retains at most one hundred records per source", async () => {
    const listByProject = vi
      .fn()
      .mockResolvedValue(
        Array.from({ length: 120 }, (_, index) => requirement(index)),
      );
    vi.mocked(getRequirementRepository).mockReturnValue({
      listByProject,
    } as never);
    vi.mocked(listProjectRisks).mockResolvedValue(
      Array.from({ length: 120 }, (_, index) => ({
        id: `risk-${index}`,
        projectId: "p1",
        title: `风险 ${index}`,
        description: "风险说明",
        severity: "medium",
        probability: "possible",
        status: "open",
        owner: "PM",
        dueDate: "2026-08-01",
        mitigation: "跟进",
        createdAt: "2026-07-18T00:00:00.000Z",
        updatedAt: "2026-07-18T00:00:00.000Z",
      })),
    );

    const snapshot = await loadProjectContext({
      project,
      milestones: [],
      confirmations: [],
      desktopRuntime: true,
      generatedAt: "2026-07-18T01:00:00.000Z",
    });

    expect(listByProject).toHaveBeenCalledWith("p1", 100);
    expect(listKnowledgeItems).toHaveBeenCalledWith(true, {
      domain: "project",
      projectId: "p1",
      limit: 100,
    });
    const requirements = snapshot.sections.find(
      (item) => item.key === "requirements",
    );
    const risks = snapshot.sections.find((item) => item.key === "risks");
    expect(requirements?.sources).toHaveLength(5);
    expect(requirements?.omittedSourceCount).toBe(95);
    expect(risks?.sources).toHaveLength(5);
    expect(risks?.omittedSourceCount).toBe(95);
  });

  it("fails the complete snapshot when any formal source cannot be loaded", async () => {
    vi.mocked(listProjectRisks).mockRejectedValue(new Error("风险数据不可用"));
    await expect(
      loadProjectContext({
        project,
        milestones: [],
        confirmations: [],
        desktopRuntime: true,
      }),
    ).rejects.toThrow("风险数据不可用");
  });

  it("passes browser mode through every adapter without reading another project", async () => {
    await loadProjectContext({
      project,
      milestones: [],
      confirmations: [],
      desktopRuntime: false,
      generatedAt: "2026-07-18T01:00:00.000Z",
    });
    expect(getRequirementRepository).toHaveBeenCalledWith(false);
    expect(listProductDocuments).toHaveBeenCalledWith(false, "p1");
    expect(listProjectRisks).toHaveBeenCalledWith(false, "p1");
    expect(listProductDecisions).toHaveBeenCalledWith(false, "p1");
    expect(listReleases).toHaveBeenCalledWith(false, "p1");
  });
});
