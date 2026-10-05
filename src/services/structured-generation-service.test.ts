import { beforeEach, describe, expect, it, vi } from "vitest";

const { invokeMock } = vi.hoisted(() => ({ invokeMock: vi.fn() }));
vi.mock("@tauri-apps/api/core", () => ({ invoke: invokeMock }));

import {
  generateAnalysisExplanation,
  generateCompetitorReview,
  generateDocumentDiffReview,
  generateDependencyRemediationProposals,
  generateMeetingAnalysis,
  generatePlanEngineer,
  generatePrdDraft,
  generateProjectQuestion,
  generateReleaseReview,
  generateReleasePreparationProposals,
  generateResearchPlanReview,
  generateResearchInsights,
  generateRiskRemediationProposals,
  generateRiskReview,
} from "@/services/structured-generation-service";
import { buildDocumentDiff } from "@/domain/document-diff";
import type { MeetingAnalysisInput } from "@/domain/meeting-analysis";
import type { ProviderConfig } from "@/domain/provider-rules";

const input: MeetingAnalysisInput = {
  schemaVersion: "1.0.0",
  projectId: "project-1",
  meetingId: "meeting-1",
  sourceId: "source-1",
  sourceHash: "hash-1",
  paragraphs: [
    {
      id: "p-1",
      ordinal: 1,
      text: "用户需要批量导出",
      startOffset: 0,
      endOffset: 8,
    },
  ],
};
const provider: ProviderConfig = {
  kind: "openai",
  endpoint: "https://api.openai.com/v1",
  model: "test-model",
  enabled: true,
  updatedAt: "2026-07-15T00:00:00.000Z",
};
const output = {
  schemaVersion: "1.0.0",
  projectId: "project-1",
  meetingId: "meeting-1",
  summary: [],
  topics: [],
  verbatimQuotes: [],
  decisions: [],
  openQuestions: [],
  requirements: [],
  actionItems: [],
  risks: [],
  dependencies: [],
  conflicts: [],
};

describe("structured generation service", () => {
  beforeEach(() => invokeMock.mockReset());

  it("sends no API key and validates the structured output", async () => {
    invokeMock.mockResolvedValue({
      state: "succeeded",
      message: "ok",
      output,
      usage: { inputTokens: 12, outputTokens: 5 },
      durationMs: 80,
    });
    const generated = await generateMeetingAnalysis(input, provider);
    expect(generated.output.projectId).toBe("project-1");
    expect(generated.inputTokens).toBe(12);
    const call = invokeMock.mock.calls[0][1];
    expect(JSON.stringify(call)).not.toMatch(/apiKey|secret|Bearer/i);
    expect(call.request.maxOutputTokens).toBe(8_192);
    expect(call.request.responseSchema.type).toBe("object");
  });

  it("rejects output outside the requested project", async () => {
    invokeMock.mockResolvedValue({
      state: "succeeded",
      message: "ok",
      output: { ...output, projectId: "project-2" },
      durationMs: 80,
    });
    await expect(generateMeetingAnalysis(input, provider)).rejects.toThrow(
      "超出当前项目",
    );
  });

  it("retrieves project evidence before running read-only Q&A and requires exact citations", async () => {
    invokeMock.mockImplementation((command: string) => {
      if (!command) return Promise.resolve([]);
      if (command === "search_project_memories")
        return Promise.resolve([
        {
          id: "m1",
          projectId: "project-1",
          memoryType: "confirmed_memory",
          status: "confirmed",
          title: "范围",
          content: "桌面端优先",
          sourceKind: "manual",
          sourceLocatorJson: "{}",
          createdBy: "user",
          updatedAt: "1",
        },
      ]);
      if (command.startsWith("list_")) return Promise.resolve([]);
      return Promise.resolve({
        state: "succeeded",
        message: "ok",
        output: {
          schemaVersion: "1.0.0",
          answer: "桌面端优先。",
          citations: [{ sourceType: "memory", sourceId: "m1", title: "范围" }],
          uncertainty: "只基于一条记忆。",
        },
        durationMs: 70,
      });
    });
    const result = await generateProjectQuestion(
      "project-1",
      "首发范围是什么？",
      provider,
      true,
    );
    expect(result.output.citations[0].sourceId).toBe("m1");
    expect(invokeMock.mock.calls.map(([command]) => command)).toEqual([
      "search_project_memories",
      "list_project_risks",
      "list_project_dependencies",
      "list_releases",
      "list_research_entries",
      "generate_structured_ai_output",
    ]);
    expect(invokeMock.mock.calls[0][0]).toBe("search_project_memories");
    const generationCall = invokeMock.mock.calls.find(
      ([command]) => command === "generate_structured_ai_output",
    )?.[1].request;
    expect(generationCall.agentDefinitionId).toBe("project-qa:v2");
    expect(generationCall.projectId).toBe("project-1");
    expect(generationCall.entityId).toBeUndefined();
    expect(generationCall.maxOutputTokens).toBe(2_048);
  });

  it("does not run Q&A in browser preview", async () => {
    await expect(
      generateProjectQuestion("project-1", "问题", provider, false),
    ).rejects.toThrow("桌面应用");
    expect(invokeMock).not.toHaveBeenCalled();
  });

  it("rejects non-searchable or oversized UTF-8 questions before desktop reads", async () => {
    await expect(
      generateProjectQuestion("project-1", "？？？", provider, true),
    ).rejects.toThrow(/可搜索文字/);
    await expect(
      generateProjectQuestion("project-1", "问".repeat(200), provider, true),
    ).rejects.toThrow(/500 字节/);
    expect(invokeMock).not.toHaveBeenCalled();
  });

  it("accepts citations to formal project context as well as memories", async () => {
    invokeMock.mockImplementation((command: string) => {
      if (command === "generate_structured_ai_output")
        return Promise.resolve({
          state: "succeeded",
          message: "ok",
          output: {
            schemaVersion: "1.0.0",
            answer: "项目目标是离线检索。",
            citations: [
              {
                sourceType: "project",
                sourceId: "project-1",
                title: "项目：产品",
              },
            ],
            uncertainty: "未检索到额外记忆。",
          },
          durationMs: 70,
        });
      return Promise.resolve([]);
    });
    const result = await generateProjectQuestion(
      "project-1",
      "项目目标是什么？",
      provider,
      true,
      {
        project: {
          id: "project-1",
          name: "产品",
          goal: "离线检索",
          status: "active",
          startDate: "2026-01-01",
          endDate: "2026-12-31",
          progress: 20,
        },
        milestones: [],
        confirmations: [],
      },
    );
    expect(result.output.citations[0].sourceType).toBe("project");
    expect(
      JSON.stringify(
        invokeMock.mock.calls.find(
          ([command]) => command === "generate_structured_ai_output",
        )?.[1].request.prompt,
      ),
    ).toContain("离线检索");
  });

  it("loads risk, dependency, release, and research evidence for v2 Q&A", async () => {
    invokeMock.mockImplementation((command: string) => {
      if (command === "list_project_risks")
        return Promise.resolve([
          {
            id: "risk-1",
            projectId: "project-1",
            title: "发布阻塞",
            description: "审批未完成",
            severity: "high",
            probability: "likely",
            status: "open",
            owner: "PM",
            dueDate: "2026-07-20",
            mitigation: "准备降级范围",
            createdAt: "1",
            updatedAt: "1",
          },
        ]);
      if (command === "generate_structured_ai_output")
        return Promise.resolve({
          state: "succeeded",
          message: "ok",
          output: {
            schemaVersion: "1.0.0",
            answer: "发布被审批阻塞。",
            citations: [
              { sourceType: "risk", sourceId: "risk-1", title: "发布阻塞" },
            ],
            uncertainty: "仅发现一条风险记录。",
          },
          durationMs: 50,
        });
      return Promise.resolve([]);
    });
    const result = await generateProjectQuestion(
      "project-1",
      "发布为什么阻塞？",
      provider,
      true,
    );
    expect(result.evidence).toEqual([
      expect.objectContaining({ sourceType: "risk", sourceId: "risk-1" }),
    ]);
    const request = invokeMock.mock.calls.find(
      ([command]) => command === "generate_structured_ai_output",
    )?.[1].request;
    expect(JSON.parse(request.prompt).evidence[0]).toMatchObject({
      sourceType: "risk",
      sourceId: "risk-1",
      content: expect.stringContaining("审批未完成"),
    });
  });

  it("generates a PRD preview from confirmed requirements without saving it", async () => {
    const requirements = [
      {
        requirementId: "r1",
        versionId: "v1",
        title: "离线搜索",
        description: "支持离线搜索",
        targetUsers: "PM",
        scenario: "复盘",
        painPoint: "网络不稳",
        acceptanceCriteria: ["无需网络"],
      },
    ];
    invokeMock.mockResolvedValue({
      state: "succeeded",
      message: "ok",
      output: {
        schemaVersion: "1.0.0",
        title: "搜索 PRD",
        contentMarkdown: "# 搜索 PRD",
        citations: [
          { requirementId: "r1", versionId: "v1", title: "离线搜索" },
        ],
      },
      durationMs: 80,
    });
    const result = await generatePrdDraft(
      "project-1",
      requirements,
      provider,
      true,
    );
    expect(result.output.title).toBe("搜索 PRD");
    expect(invokeMock.mock.calls[0][0]).toBe("generate_structured_ai_output");
    expect(invokeMock.mock.calls[0][1].request.agentDefinitionId).toBe(
      "prd-agent:v1",
    );
  });

  it("reviews only deterministic document diff lines with exact citations", async () => {
    const diff = buildDocumentDiff("old", "new");
    invokeMock.mockResolvedValue({
      state: "succeeded",
      message: "ok",
      output: {
        schemaVersion: "1.0.0",
        verdict: "needs_review",
        summary: "范围变化",
        findings: [
          {
            severity: "warning",
            category: "scope",
            summary: "内容变更",
            recommendation: "人工确认",
            evidenceLineIndexes: [0, 1],
          },
        ],
      },
      durationMs: 60,
    });
    const result = await generateDocumentDiffReview(
      "project-1",
      "doc-1",
      1,
      2,
      diff,
      provider,
      true,
    );
    expect(result.output.findings[0].evidenceLineIndexes).toEqual([0, 1]);
    expect(invokeMock.mock.calls[0][1].request).toMatchObject({
      runType: "document_diff_review",
      agentDefinitionId: "document-diff-reviewer:v1",
      projectId: "project-1",
      entityId: undefined,
    });
  });

  it("sends only a saved analysis run to the read-only explanation agent", async () => {
    const deterministicResult = { numeric: [{ field: "amount", mean: 12 }] };
    invokeMock.mockResolvedValue({
      state: "succeeded",
      message: "ok",
      output: {
        schemaVersion: "1.0.0",
        summary: "金额存在差异",
        findings: [
          {
            title: "金额均值",
            explanation: "建议结合样本继续观察",
            evidence: [
              { path: "$.numeric[0].mean", label: "金额均值", value: 12 },
            ],
          },
        ],
        limitations: ["仅基于当前运行"],
      },
      durationMs: 75,
    });
    const result = await generateAnalysisExplanation(
      "project-1",
      "analysis-run-1",
      "summary",
      { fields: [] },
      deterministicResult,
      provider,
      true,
    );
    expect(result.output.findings[0].evidence[0].value).toBe(12);
    expect(invokeMock.mock.calls[0][1].request).toMatchObject({
      runType: "analysis_explanation",
      agentDefinitionId: "analysis-explainer:v1",
      projectId: "project-1",
      entityId: "analysis-run-1",
    });
  });

  it("runs the research agent with sorted exact project sources", async () => {
    const sources = [
      {
        entryId: "e2",
        title: "二",
        insight: "需要批量导出",
        sourceRef: "interview://2",
      },
      {
        entryId: "e1",
        title: "一",
        insight: "跨模块优先级不清晰",
        sourceRef: "interview://1",
      },
    ];
    invokeMock.mockResolvedValue({
      state: "succeeded",
      message: "ok",
      output: {
        schemaVersion: "1.0.0",
        findings: [
          {
            title: "统一优先级",
            statement: "需要统一视图",
            citations: [
              {
                entryId: "e1",
                quote: "跨模块优先级",
                sourceRef: "interview://1",
              },
            ],
          },
        ],
        limitations: ["样本有限"],
      },
      durationMs: 50,
    });
    const result = await generateResearchInsights(
      "project-1",
      sources,
      provider,
      true,
    );
    expect(result.output.findings[0].citations[0].entryId).toBe("e1");
    const request = invokeMock.mock.calls[0][1].request;
    expect(request).toMatchObject({
      runType: "research_insight",
      agentDefinitionId: "research-insight:v1",
      projectId: "project-1",
      entityId: undefined,
    });
    expect(
      JSON.parse(request.prompt).researchEntries.map(
        (item: { entryId: string }) => item.entryId,
      ),
    ).toEqual(["e1", "e2"]);
  });

  it("runs the risk review agent with sorted open risks", async () => {
    const risks = [
      {
        id: "risk-2",
        title: "二",
        description: "desc",
        severity: "medium" as const,
        probability: "possible" as const,
        status: "open" as const,
        owner: "PM",
        dueDate: "2026-08-01",
        updatedAt: "200",
        mitigation: "m2",
      },
      {
        id: "risk-1",
        title: "一",
        description: "desc",
        severity: "high" as const,
        probability: "likely" as const,
        status: "open" as const,
        owner: "PM",
        dueDate: "2026-07-20",
        updatedAt: "100",
        mitigation: "m1",
      },
    ];
    invokeMock.mockResolvedValue({
      state: "succeeded",
      message: "ok",
      output: {
        schemaVersion: "1.0.0",
        overallAssessment: "watch",
        findings: [
          {
            riskId: "risk-1",
            priority: "immediate",
            rationale: "high risk",
            suggestedMitigation: "follow up",
            citations: [{ field: "severity", quote: "high" }],
          },
        ],
        limitations: ["limited"],
      },
      durationMs: 40,
    });
    const result = await generateRiskReview("project-1", risks, provider, true);
    expect(result.output.findings[0].riskId).toBe("risk-1");
    const request = invokeMock.mock.calls[0][1].request;
    expect(request).toMatchObject({
      runType: "risk_review",
      agentDefinitionId: "risk-review:v1",
      projectId: "project-1",
      entityId: undefined,
    });
    expect(
      JSON.parse(request.prompt).risks.map((item: { id: string }) => item.id),
    ).toEqual(["risk-1", "risk-2"]);
  });

  it("runs risk remediation v2 as proposal-only generation", async () => {
    const risks = [
      {
        id: "risk-1",
        title: "Release delay",
        description: "Approval pending",
        severity: "high" as const,
        probability: "likely" as const,
        status: "open" as const,
        owner: "PM",
        dueDate: "2026-07-20",
        mitigation: "Prepare reduced scope",
        updatedAt: "100",
      },
    ];
    invokeMock.mockResolvedValue({
      state: "succeeded",
      message: "ok",
      output: {
        schemaVersion: "2.0.0",
        overallAssessment: "critical",
        proposals: [
          {
            riskId: "risk-1",
            expectedUpdatedAt: "100",
            priority: "immediate",
            changes: { mitigation: "Review approval daily" },
            rationale: "High exposure",
            citations: [{ field: "severity", quote: "high" }],
          },
        ],
        limitations: [],
      },
      durationMs: 40,
    });
    const result = await generateRiskRemediationProposals(
      "project-1",
      risks,
      provider,
      true,
    );
    expect(result.output.proposals[0].changes).toEqual({
      mitigation: "Review approval daily",
    });
    expect(invokeMock.mock.calls[0][1].request).toMatchObject({
      runType: "risk_review",
      agentDefinitionId: "risk-review:v2",
      projectId: "project-1",
    });
  });

  it("runs dependency remediation as proposal-only generation", async () => {
    const dependencies = [{ id: "dep-1", projectId: "project-1", title: "Approval", description: "Pending", dependencyType: "approval" as const, owner: "PM", dueDate: "2026-07-20", status: "blocked" as const, resolution: "Provide scope", createdAt: "90", updatedAt: "100" }];
    invokeMock.mockResolvedValue({ state: "succeeded", message: "ok", output: { schemaVersion: "1.0.0", proposals: [{ dependencyId: "dep-1", expectedUpdatedAt: "100", priority: "immediate", changes: { owner: "Legal" }, rationale: "Unblock approval", citations: [{ field: "status", quote: "blocked" }] }], limitations: [] }, durationMs: 30 });
    const result = await generateDependencyRemediationProposals("project-1", dependencies, provider, true);
    expect(result.output.proposals[0].changes).toEqual({ owner: "Legal" });
    expect(invokeMock.mock.calls[0][1].request).toMatchObject({ runType: "dependency_review", agentDefinitionId: "dependency-remediation:v1", projectId: "project-1" });
  });
  it("runs release preparation as proposal-only generation",async()=>{const releases=[{id:"r1",projectId:"project-1",title:"v1",scope:["dashboard"],checklist:["backup"],rollbackPlan:"restore",result:"",retrospective:"",followUp:[],status:"ready" as const,targetDate:"2026-07-20",createdAt:"90",updatedAt:"100"}];invokeMock.mockResolvedValue({state:"succeeded",message:"ok",output:{schemaVersion:"1.0.0",proposals:[{releaseId:"r1",expectedUpdatedAt:"100",priority:"immediate",changes:{checklist:["backup","regression"]},rationale:"complete gate",citations:[{field:"checklist",quote:"backup"}]}],limitations:[]},durationMs:30});const result=await generateReleasePreparationProposals("project-1",releases,provider,true);expect(result.output.proposals[0].changes.checklist).toEqual(["backup","regression"]);expect(invokeMock.mock.calls[0][1].request).toMatchObject({runType:"release_preparation",agentDefinitionId:"release-preparation:v1"});});

  it("runs the release review agent with sorted non-cancelled records", async () => {
    const releases = [
      {
        id: "release-2",
        title: "二",
        scope: ["B"],
        checklist: ["QA"],
        rollbackPlan: "rollback",
        result: "",
        retrospective: "",
        followUp: [],
        status: "planned" as const,
        targetDate: "2026-08-01",
      },
      {
        id: "release-1",
        title: "一",
        scope: ["A"],
        checklist: ["Backup"],
        rollbackPlan: "restore",
        result: "",
        retrospective: "",
        followUp: [],
        status: "ready" as const,
        targetDate: "2026-07-20",
      },
    ];
    invokeMock.mockResolvedValue({
      state: "succeeded",
      message: "ok",
      output: {
        schemaVersion: "1.0.0",
        readiness: "needs_attention",
        findings: [
          {
            releaseId: "release-1",
            severity: "warning",
            category: "checklist",
            summary: "verify backup",
            recommendation: "run backup check",
            citations: [{ field: "checklist", quote: "Backup" }],
          },
        ],
        limitations: ["not installed"],
      },
      durationMs: 45,
    });
    const result = await generateReleaseReview(
      "project-1",
      releases,
      provider,
      true,
    );
    expect(result.output.findings[0].releaseId).toBe("release-1");
    const request = invokeMock.mock.calls[0][1].request;
    expect(request).toMatchObject({
      runType: "release_review",
      agentDefinitionId: "release-review:v1",
      projectId: "project-1",
      entityId: undefined,
    });
    expect(
      JSON.parse(request.prompt).releases.map(
        (item: { id: string }) => item.id,
      ),
    ).toEqual(["release-1", "release-2"]);
  });

  it("runs the competitor review agent with sorted saved profiles", async () => {
    const profiles = [
      {
        id: "c2",
        name: "Beta",
        sourceRef: "file://beta",
        accessedAt: "2026-07-15",
        strengths: "Local",
        weaknesses: "Weak analytics",
        positioning: "Personal",
      },
      {
        id: "c1",
        name: "Alpha",
        sourceRef: "https://alpha",
        accessedAt: "2026-07-16",
        strengths: "Automation",
        weaknesses: "No offline",
        positioning: "Teams",
      },
    ];
    invokeMock.mockResolvedValue({
      state: "succeeded",
      message: "ok",
      output: {
        schemaVersion: "1.0.0",
        findings: [
          {
            profileIds: ["c1", "c2"],
            category: "positioning_overlap",
            summary: "overlap",
            implication: "differentiate",
            citations: [
              { profileId: "c1", field: "positioning", quote: "Teams" },
              { profileId: "c2", field: "positioning", quote: "Personal" },
            ],
          },
        ],
        limitations: ["saved profiles only"],
      },
      durationMs: 42,
    });
    const result = await generateCompetitorReview(
      "project-1",
      profiles,
      provider,
      true,
    );
    expect(result.output.findings[0].profileIds).toEqual(["c1", "c2"]);
    const request = invokeMock.mock.calls[0][1].request;
    expect(request).toMatchObject({
      runType: "competitor_review",
      agentDefinitionId: "competitor-review:v1",
      projectId: "project-1",
      entityId: undefined,
    });
    expect(
      JSON.parse(request.prompt).competitorProfiles.map(
        (item: { id: string }) => item.id,
      ),
    ).toEqual(["c1", "c2"]);
  });

  it("runs the research plan review agent with linked results", async () => {
    const plans = [
      {
        id: "p1",
        title: "Plan",
        objective: "Validate",
        targetPersona: "PM",
        questions: ["Q1"],
        status: "active" as const,
        startDate: "2026-07-10",
        endDate: "2026-07-20",
        updatedAt: "1000",
        results: [
          {
            entryId: "e1",
            researchType: "interview",
            title: "Entry",
            sourceRef: "interview://1",
            accessedAt: "2026-07-16",
            insight: "Insight",
            personaSuggestion: "Persona",
          },
        ],
      },
    ];
    invokeMock.mockResolvedValue({
      state: "succeeded",
      message: "ok",
      output: {
        schemaVersion: "1.0.0",
        findings: [
          {
            planId: "p1",
            severity: "warning",
            category: "coverage",
            summary: "coverage",
            recommendation: "add sample",
            citations: [
              {
                sourceType: "result",
                sourceId: "e1",
                field: "insight",
                quote: "Insight",
              },
            ],
          },
        ],
        limitations: ["one result"],
      },
      durationMs: 35,
    });
    const result = await generateResearchPlanReview(
      "project-1",
      plans,
      provider,
      true,
    );
    expect(result.output.findings[0].planId).toBe("p1");
    const request = invokeMock.mock.calls[0][1].request;
    expect(request).toMatchObject({
      runType: "research_plan_review",
      agentDefinitionId: "research-plan-review:v1",
      projectId: "project-1",
      entityId: undefined,
    });
    expect(JSON.parse(request.prompt).researchPlans[0].results[0].entryId).toBe(
      "e1",
    );
  });

  it("generates a v2 plan engineer proposal bound to the saved timestamp", async () => {
    const plans = [{
      id: "p1", title: "Plan", objective: "Objective", targetPersona: "PM",
      questions: ["Old question"], status: "active" as const,
      startDate: "2026-07-16", endDate: "2026-07-20", updatedAt: "1000", results: [],
    }];
    invokeMock.mockResolvedValue({
      state: "succeeded", message: "ok", durationMs: 20,
      output: {
        schemaVersion: "2.0.0",
        proposals: [{
          planId: "p1", expectedUpdatedAt: "1000",
          changes: { questions: ["Old question", "New question"] },
          rationale: "expand coverage",
          citations: [{ sourceType: "plan", sourceId: "p1", field: "questions", quote: "Old question" }],
        }],
        limitations: [],
      },
    });
    const result = await generatePlanEngineer("project-1", plans, provider, true);
    expect(result.output.proposals[0].expectedUpdatedAt).toBe("1000");
    expect(invokeMock.mock.calls[0][1].request).toMatchObject({
      runType: "plan_engineer",
      agentDefinitionId: "plan-engineer:v2",
      projectId: "project-1",
    });
  });
});
