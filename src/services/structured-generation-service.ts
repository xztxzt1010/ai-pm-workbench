import { invoke } from "@tauri-apps/api/core";

import {
  MEETING_ANALYST_AGENT_POLICY,
  meetingAnalysisIdempotencyKey,
  meetingAnalysisOutputJsonSchema,
  validateMeetingAnalysisOutput,
  type MeetingAnalysisInput,
  type MeetingAnalysisOutput,
} from "@/domain/meeting-analysis";
import {
  projectQaOutputJsonSchema,
  selectProjectQaEvidence,
  validateProjectQaOutput,
  type ProjectQaEvidence,
  type ProjectQaOutput,
} from "@/domain/project-qa";
import {
  prdDraftOutputJsonSchema,
  validatePrdDraftOutput,
  type PrdDraftOutput,
  type PrdRequirementEvidence,
} from "@/domain/prd-draft";
import {
  documentDiffReviewJsonSchema,
  validateDocumentDiffReview,
  type DocumentDiffReview,
} from "@/domain/document-diff-review";
import type { DocumentDiff } from "@/domain/document-diff";
import {
  analysisExplanationJsonSchema,
  validateAnalysisExplanation,
  type AnalysisExplanation,
} from "@/domain/analysis-explanation";
import {
  researchInsightAgentJsonSchema,
  validateResearchAgentOutput,
  type ResearchAgentOutput,
  type ResearchAgentSource,
} from "@/domain/research-insight-agent";
import {
  riskReviewJsonSchema,
  validateRiskReviewOutput,
  type RiskReviewOutput,
  type RiskReviewSource,
} from "@/domain/risk-review-agent";
import {
  riskRemediationJsonSchema,
  validateRiskRemediationOutput,
  type RiskRemediationOutput,
} from "@/domain/risk-remediation-agent";
import {
  dependencyRemediationJsonSchema,
  validateDependencyRemediationOutput,
  type DependencyRemediationOutput,
  type DependencyRemediationSource,
} from "@/domain/dependency-remediation-agent";
import {
  releasePreparationJsonSchema,
  validateReleasePreparationOutput,
  type ReleasePreparationOutput,
  type ReleasePreparationSource,
} from "@/domain/release-preparation-agent";
import {
  releaseReviewJsonSchema,
  validateReleaseReviewOutput,
  type ReleaseReviewOutput,
  type ReleaseReviewSource,
} from "@/domain/release-review-agent";
import {
  competitorReviewJsonSchema,
  validateCompetitorReviewOutput,
  type CompetitorReviewOutput,
  type CompetitorReviewSource,
} from "@/domain/competitor-review-agent";
import {
  researchPlanReviewJsonSchema,
  validateResearchPlanReviewOutput,
  type ResearchPlanReviewOutput,
  type ResearchPlanReviewSource,
} from "@/domain/research-plan-review-agent";
import {
  planEngineerJsonSchema,
  validatePlanEngineerOutput,
  type PlanEngineerOutput,
} from "@/domain/plan-engineer-agent";
import {
  knowledgeReviewJsonSchema,
  validateKnowledgeReviewOutput,
  type KnowledgeReviewOutput,
  type KnowledgeReviewMemory,
} from "@/domain/knowledge-review-agent";
import { searchProjectMemories } from "@/services/project-memory-service";
import { listProjectRisks } from "@/services/project-risk-service";
import { listProjectDependencies } from "@/services/project-dependency-service";
import { listReleases } from "@/services/release-service";
import { listResearchEntries } from "@/services/research-entry-service";
import type { ProviderConfig } from "@/domain/provider-rules";
import { AppError } from "@/domain/app-error";

interface StructuredGenerationResult {
  state: "succeeded" | "failed" | "invalid";
  message: string;
  output?: unknown;
  usage?: { inputTokens?: number; outputTokens?: number };
  durationMs: number;
}

export interface MeetingAnalysisGeneration {
  runId: string;
  output: MeetingAnalysisOutput;
  durationMs: number;
  inputTokens?: number;
  outputTokens?: number;
}

function analysisSystemPrompt() {
  return [
    "You are a meeting requirement analyst.",
    "Use only the provided meeting paragraphs.",
    "Facts and verbatim quotes must include exact evidence offsets.",
    "Mark unsupported reasoning as inference or suggestion.",
    `Business write access: ${MEETING_ANALYST_AGENT_POLICY.businessWriteAccess}.`,
  ].join("\n");
}

export async function generateMeetingAnalysis(
  input: MeetingAnalysisInput,
  provider: ProviderConfig,
): Promise<MeetingAnalysisGeneration> {
  if (!provider.enabled || provider.kind === "none")
    throw new AppError("validation", "请先启用模型 Provider");
  const runId = crypto.randomUUID();
  const result = await invoke<StructuredGenerationResult>(
    "generate_structured_ai_output",
    {
      request: {
        runId,
        runType: "meeting_analysis",
        agentDefinitionId: "meeting-requirement-analyst:v1",
        projectId: input.projectId,
        entityId: input.meetingId,
        idempotencyKey: meetingAnalysisIdempotencyKey(input),
        kind: provider.kind,
        endpoint: provider.endpoint,
        model: provider.model,
        system: analysisSystemPrompt(),
        prompt: JSON.stringify(input),
        responseSchema: meetingAnalysisOutputJsonSchema,
        maxOutputTokens: 8_192,
      },
    },
  );
  if (result.state !== "succeeded" || result.output === undefined) {
    throw new AppError("external_service", result.message || "模型生成失败");
  }
  return {
    runId,
    output: validateMeetingAnalysisOutput(input, result.output),
    durationMs: result.durationMs,
    inputTokens: result.usage?.inputTokens,
    outputTokens: result.usage?.outputTokens,
  };
}

export interface ProjectQuestionAnswer {
  output: ProjectQaOutput;
  evidence: ProjectQaEvidence[];
  runId: string;
  durationMs: number;
  inputTokens?: number;
  outputTokens?: number;
}

export interface ProjectQaBusinessContext {
  project: {
    id: string;
    name: string;
    goal: string;
    status: string;
    startDate: string;
    endDate: string;
    progress: number;
    background?: string;
    phase?: string;
    targetUsers?: string;
    coreProblem?: string;
    successMetrics?: string;
    constraints?: string;
    owner?: string;
  };
  milestones: Array<{
    id: string;
    title: string;
    dueDate: string;
    progress: number;
  }>;
  confirmations: Array<{
    id: string;
    title: string;
    dueDate: string;
    status: string;
    conclusion?: string;
  }>;
}

function projectQaSystemPrompt() {
  return [
    "You are a read-only chief product manager project Q&A agent.",
    "Answer only from the supplied evidence records for the current project.",
    "Evidence may include memories, project facts, milestones, confirmations, risks, dependencies, releases, and research entries; do not mix records from another project.",
    "Do not invent facts, dates, commitments, or sources.",
    "Every answer based on evidence must cite the exact sourceType, sourceId, and title from the supplied records.",
    "If evidence is insufficient, say so explicitly in uncertainty and keep the answer bounded.",
    "Never modify business data or project memory.",
  ].join("\n");
}

export async function generateProjectQuestion(
  projectId: string,
  question: string,
  provider: ProviderConfig,
  desktopRuntime: boolean,
  businessContext?: ProjectQaBusinessContext,
): Promise<ProjectQuestionAnswer> {
  if (!desktopRuntime)
    throw new AppError("permission", "项目问答仅在桌面应用中运行");
  if (!projectId.trim()) throw new AppError("validation", "项目标识不能为空");
  const normalizedQuestion = question.trim();
  if (
    !normalizedQuestion ||
    normalizedQuestion.length > 500 ||
    new TextEncoder().encode(normalizedQuestion).length > 500 ||
    !/[\p{L}\p{N}]/u.test(normalizedQuestion)
  )
    throw new AppError(
      "validation",
      "问题必须包含可搜索文字或数字，且不能超过 500 字节",
    );
  if (!provider.enabled || provider.kind === "none")
    throw new AppError("validation", "请先启用并保存模型 Provider");
  const [memories, risks, dependencies, releases, researchEntries] =
    await Promise.all([
      searchProjectMemories(true, projectId, normalizedQuestion, "confirmed", 8),
      listProjectRisks(true, projectId),
      listProjectDependencies(true, projectId),
      listReleases(true, projectId),
      listResearchEntries(true, projectId),
    ]);
  const evidence = selectProjectQaEvidence([
    ...memories.map((item) => ({
      sourceType: "memory" as const,
      sourceId: item.id,
      title: item.title,
      content: item.content,
      sourceKind: item.sourceKind,
      sourceIdDetail: item.sourceId,
    })),
    ...(businessContext
      ? [
          {
            sourceType: "project" as const,
            sourceId: businessContext.project.id,
            title: `项目：${businessContext.project.name}`,
            content: JSON.stringify({
              goal: businessContext.project.goal,
              status: businessContext.project.status,
              startDate: businessContext.project.startDate ?? "",
              endDate: businessContext.project.endDate ?? "",
              progress: businessContext.project.progress,
              background: businessContext.project.background ?? "",
              phase: businessContext.project.phase ?? "",
              targetUsers: businessContext.project.targetUsers ?? "",
              coreProblem: businessContext.project.coreProblem ?? "",
              successMetrics: businessContext.project.successMetrics ?? "",
              constraints: businessContext.project.constraints ?? "",
              owner: businessContext.project.owner ?? "",
            }),
          },
          ...businessContext.milestones.map((item) => ({
            sourceType: "milestone" as const,
            sourceId: item.id,
            title: item.title,
            content: JSON.stringify({
              dueDate: item.dueDate,
              progress: item.progress,
            }),
          })),
          ...businessContext.confirmations.map((item) => ({
            sourceType: "confirmation" as const,
            sourceId: item.id,
            title: item.title,
            content: JSON.stringify({
              dueDate: item.dueDate,
              status: item.status,
              conclusion: item.conclusion ?? "",
            }),
          })),
        ]
      : []),
    ...risks.map((item) => ({
      sourceType: "risk" as const,
      sourceId: item.id,
      title: item.title,
      content: JSON.stringify({
        description: item.description,
        severity: item.severity,
        probability: item.probability,
        status: item.status,
        owner: item.owner,
        dueDate: item.dueDate,
        mitigation: item.mitigation,
      }),
    })),
    ...dependencies.map((item) => ({
      sourceType: "dependency" as const,
      sourceId: item.id,
      title: item.title,
      content: JSON.stringify({
        description: item.description,
        dependencyType: item.dependencyType,
        owner: item.owner,
        dueDate: item.dueDate,
        status: item.status,
        resolution: item.resolution,
      }),
    })),
    ...releases.map((item) => ({
      sourceType: "release" as const,
      sourceId: item.id,
      title: item.title,
      content: JSON.stringify({
        scopeJson: item.scopeJson,
        checklistJson: item.checklistJson,
        rollbackPlan: item.rollbackPlan,
        result: item.result,
        retrospective: item.retrospective,
        followUpJson: item.followUpJson,
        status: item.status,
        targetDate: item.targetDate,
      }),
    })),
    ...researchEntries.map((item) => ({
      sourceType: "research" as const,
      sourceId: item.id,
      title: item.title,
      content: JSON.stringify({
        researchType: item.researchType,
        sourceRef: item.sourceRef,
        accessedAt: item.accessedAt,
        insight: item.insight,
        personaSuggestion: item.personaSuggestion,
      }),
    })),
  ], normalizedQuestion);
  const runId = crypto.randomUUID();
  const prompt = JSON.stringify({
    projectId,
    question: normalizedQuestion,
    evidence: evidence.map((item) => ({
      sourceType: item.sourceType,
      sourceId: item.sourceId,
      title: item.title,
      content: item.content,
      sourceKind: item.sourceKind,
      sourceIdDetail: item.sourceIdDetail,
    })),
  });
  const result = await invoke<StructuredGenerationResult>(
    "generate_structured_ai_output",
    {
      request: {
        runId,
        runType: "project_qa",
        agentDefinitionId: "project-qa:v2",
        projectId,
        entityId: undefined,
        idempotencyKey: `project-qa:v2:${runId}`,
        kind: provider.kind,
        endpoint: provider.endpoint,
        model: provider.model,
        system: projectQaSystemPrompt(),
        prompt,
        responseSchema: projectQaOutputJsonSchema,
        maxOutputTokens: 2_048,
      },
    },
  );
  if (result.state !== "succeeded" || result.output === undefined)
    throw new AppError(
      "external_service",
      result.message || "项目问答运行失败",
    );
  return {
    output: validateProjectQaOutput(result.output, evidence),
    evidence,
    runId,
    durationMs: result.durationMs,
    inputTokens: result.usage?.inputTokens,
    outputTokens: result.usage?.outputTokens,
  };
}

export interface PrdDraftGeneration {
  output: PrdDraftOutput;
  requirements: PrdRequirementEvidence[];
  runId: string;
  durationMs: number;
  inputTokens?: number;
  outputTokens?: number;
}

function prdAgentSystemPrompt() {
  return [
    "You are a read-only product requirements document drafting agent.",
    "Use only the confirmed requirements supplied in the input.",
    "Do not add unsupported scope, users, dates, metrics, or acceptance criteria.",
    "Every requirement used in the Markdown must be cited with its exact requirementId, versionId, and title.",
    "Return a draft preview only; never claim that the document was saved or confirmed.",
  ].join("\n");
}

export async function generatePrdDraft(
  projectId: string,
  requirements: PrdRequirementEvidence[],
  provider: ProviderConfig,
  desktopRuntime: boolean,
): Promise<PrdDraftGeneration> {
  if (!desktopRuntime)
    throw new AppError("permission", "PRD Agent 仅在桌面应用中运行");
  if (!projectId.trim() || !requirements.length)
    throw new AppError("validation", "当前项目没有可用于 PRD 草稿的已确认需求");
  if (!provider.enabled || provider.kind === "none")
    throw new AppError("validation", "请先启用并保存模型 Provider");
  const runId = crypto.randomUUID();
  const result = await invoke<StructuredGenerationResult>(
    "generate_structured_ai_output",
    {
      request: {
        runId,
        runType: "prd_draft",
        agentDefinitionId: "prd-agent:v1",
        projectId,
        entityId: undefined,
        idempotencyKey: `prd-agent:v1:${runId}`,
        kind: provider.kind,
        endpoint: provider.endpoint,
        model: provider.model,
        system: prdAgentSystemPrompt(),
        prompt: JSON.stringify({
          projectId,
          confirmedRequirements: requirements,
        }),
        responseSchema: prdDraftOutputJsonSchema,
        maxOutputTokens: 8_192,
      },
    },
  );
  if (result.state !== "succeeded" || result.output === undefined)
    throw new AppError(
      "external_service",
      result.message || "PRD Agent 运行失败",
    );
  return {
    output: validatePrdDraftOutput(result.output, requirements),
    requirements,
    runId,
    durationMs: result.durationMs,
    inputTokens: result.usage?.inputTokens,
    outputTokens: result.usage?.outputTokens,
  };
}

export interface DocumentDiffReviewGeneration {
  output: DocumentDiffReview;
  runId: string;
  durationMs: number;
  inputTokens?: number;
  outputTokens?: number;
}

export async function generateDocumentDiffReview(
  projectId: string,
  documentId: string,
  previousVersion: number,
  currentVersion: number,
  diff: DocumentDiff,
  provider: ProviderConfig,
  desktopRuntime: boolean,
): Promise<DocumentDiffReviewGeneration> {
  if (!desktopRuntime)
    throw new AppError("permission", "文档差异审阅仅在桌面应用中运行");
  if (
    !projectId.trim() ||
    !documentId.trim() ||
    previousVersion >= currentVersion ||
    !diff.changed ||
    !diff.lines.length
  )
    throw new AppError("validation", "请选择有效的两个文档版本并先生成差异");
  if (!provider.enabled || provider.kind === "none")
    throw new AppError("validation", "请先启用并保存模型 Provider");
  const runId = crypto.randomUUID();
  const result = await invoke<StructuredGenerationResult>(
    "generate_structured_ai_output",
    {
      request: {
        runId,
        runType: "document_diff_review",
        agentDefinitionId: "document-diff-reviewer:v1",
        projectId,
        entityId: undefined,
        idempotencyKey: `document-diff-reviewer:v1:${runId}`,
        kind: provider.kind,
        endpoint: provider.endpoint,
        model: provider.model,
        system: [
          "You are a read-only product document diff reviewer.",
          "Use only the deterministic changed lines supplied in the input.",
          "Every finding must cite exact evidenceLineIndexes that point to added or removed lines.",
          "Do not rewrite, save, confirm, or claim changes were applied.",
        ].join("\n"),
        prompt: JSON.stringify({
          projectId,
          documentId,
          previousVersion,
          currentVersion,
          changedLines: diff.lines.map((line, index) => ({
            index,
            kind: line.kind,
            lineNumber: line.lineNumber,
            text: line.text,
          })),
        }),
        responseSchema: documentDiffReviewJsonSchema,
        maxOutputTokens: 4_096,
      },
    },
  );
  if (result.state !== "succeeded" || result.output === undefined)
    throw new AppError(
      "external_service",
      result.message || "文档差异审阅运行失败",
    );
  return {
    output: validateDocumentDiffReview(result.output, diff),
    runId,
    durationMs: result.durationMs,
    inputTokens: result.usage?.inputTokens,
    outputTokens: result.usage?.outputTokens,
  };
}

export interface AnalysisExplanationGeneration {
  output: AnalysisExplanation;
  runId: string;
  durationMs: number;
  inputTokens?: number;
  outputTokens?: number;
}

function analysisExplainerSystemPrompt() {
  return [
    "You are a read-only data analysis explanation agent.",
    "Use only the supplied deterministic analysis result from the current project.",
    "Do not calculate, round, or invent any value.",
    "Keep summary, title, explanation, and evidence labels free of digits; put every number only in evidence.value.",
    "Every evidence.path must point to an existing numeric value in result and evidence.value must match it exactly.",
    "Do not modify datasets, metrics, experiments, requirements, or insights.",
  ].join("\n");
}

export async function generateAnalysisExplanation(
  projectId: string,
  analysisRunId: string,
  operator: "summary" | "funnel" | "trend" | "cohort",
  parameters: unknown,
  resultData: unknown,
  provider: ProviderConfig,
  desktopRuntime: boolean,
): Promise<AnalysisExplanationGeneration> {
  if (!desktopRuntime)
    throw new AppError("permission", "分析解释 Agent 仅在桌面应用中运行");
  if (!projectId.trim() || !analysisRunId.trim())
    throw new AppError("validation", "项目和分析运行标识不能为空");
  if (!provider.enabled || provider.kind === "none")
    throw new AppError("validation", "请先启用并保存模型 Provider");
  const runId = crypto.randomUUID();
  const result = await invoke<StructuredGenerationResult>(
    "generate_structured_ai_output",
    {
      request: {
        runId,
        runType: "analysis_explanation",
        agentDefinitionId: "analysis-explainer:v1",
        projectId,
        entityId: analysisRunId,
        idempotencyKey: `analysis-explainer:v1:${analysisRunId}:${operator}:${runId}`,
        kind: provider.kind,
        endpoint: provider.endpoint,
        model: provider.model,
        system: analysisExplainerSystemPrompt(),
        prompt: JSON.stringify({
          projectId,
          analysisRunId,
          operator,
          parameters,
          result: resultData,
        }),
        responseSchema: analysisExplanationJsonSchema,
        maxOutputTokens: 4_096,
      },
    },
  );
  if (result.state !== "succeeded" || result.output === undefined)
    throw new AppError(
      "external_service",
      result.message || "分析解释 Agent 运行失败",
    );
  return {
    output: validateAnalysisExplanation(result.output, resultData),
    runId,
    durationMs: result.durationMs,
    inputTokens: result.usage?.inputTokens,
    outputTokens: result.usage?.outputTokens,
  };
}

export interface ResearchInsightGeneration {
  output: ResearchAgentOutput;
  runId: string;
  durationMs: number;
  inputTokens?: number;
  outputTokens?: number;
}

export async function generateResearchInsights(
  projectId: string,
  sources: ResearchAgentSource[],
  provider: ProviderConfig,
  desktopRuntime: boolean,
): Promise<ResearchInsightGeneration> {
  if (!desktopRuntime)
    throw new AppError("permission", "研究洞察 Agent 仅在桌面应用中运行");
  if (!projectId.trim() || !sources.length)
    throw new AppError("validation", "当前项目没有可供分析的研究记录");
  if (!provider.enabled || provider.kind === "none")
    throw new AppError("validation", "请先启用并保存模型 Provider");
  const canonicalSources = [...sources].sort((left, right) =>
    left.entryId.localeCompare(right.entryId),
  );
  const runId = crypto.randomUUID();
  const result = await invoke<StructuredGenerationResult>(
    "generate_structured_ai_output",
    {
      request: {
        runId,
        runType: "research_insight",
        agentDefinitionId: "research-insight:v1",
        projectId,
        entityId: undefined,
        idempotencyKey: `research-insight:v1:${projectId}:${runId}`,
        kind: provider.kind,
        endpoint: provider.endpoint,
        model: provider.model,
        system: [
          "You are a read-only user research insight agent.",
          "Use only the supplied current-project research entries.",
          "Every finding must cite exact text contained in the cited entry insight and repeat its sourceRef exactly.",
          "Return proposals only. Never save, accept, reject, or create requirements.",
        ].join("\n"),
        prompt: JSON.stringify({
          projectId,
          researchEntries: canonicalSources,
        }),
        responseSchema: researchInsightAgentJsonSchema,
        maxOutputTokens: 4_096,
      },
    },
  );
  if (result.state !== "succeeded" || result.output === undefined)
    throw new AppError(
      "external_service",
      result.message || "研究洞察 Agent 运行失败",
    );
  return {
    output: validateResearchAgentOutput(result.output, canonicalSources),
    runId,
    durationMs: result.durationMs,
    inputTokens: result.usage?.inputTokens,
    outputTokens: result.usage?.outputTokens,
  };
}

export interface RiskReviewGeneration {
  output: RiskReviewOutput;
  runId: string;
  durationMs: number;
  inputTokens?: number;
  outputTokens?: number;
}

export async function generateRiskReview(
  projectId: string,
  risks: RiskReviewSource[],
  provider: ProviderConfig,
  desktopRuntime: boolean,
): Promise<RiskReviewGeneration> {
  if (!desktopRuntime)
    throw new AppError("permission", "风险审阅 Agent 仅在桌面应用中运行");
  const canonicalRisks = risks
    .filter((risk) => risk.status !== "closed")
    .sort((left, right) => left.id.localeCompare(right.id));
  if (!projectId.trim() || !canonicalRisks.length)
    throw new AppError("validation", "当前项目没有可供审阅的开放风险");
  if (!provider.enabled || provider.kind === "none")
    throw new AppError("validation", "请先启用并保存模型 Provider");
  const runId = crypto.randomUUID();
  const result = await invoke<StructuredGenerationResult>(
    "generate_structured_ai_output",
    {
      request: {
        runId,
        runType: "risk_review",
        agentDefinitionId: "risk-review:v1",
        projectId,
        entityId: undefined,
        idempotencyKey: `risk-review:v1:${projectId}:${runId}`,
        kind: provider.kind,
        endpoint: provider.endpoint,
        model: provider.model,
        system: [
          "You are a read-only project risk review agent.",
          "Use only the supplied current-project saved risks.",
          "Every finding must cite exact complete values from the cited risk fields.",
          "Return mitigation proposals only. Never update a risk, change status, or execute an action.",
        ].join("\n"),
        prompt: JSON.stringify({ projectId, risks: canonicalRisks }),
        responseSchema: riskReviewJsonSchema,
        maxOutputTokens: 4_096,
      },
    },
  );
  if (result.state !== "succeeded" || result.output === undefined)
    throw new AppError(
      "external_service",
      result.message || "风险审阅 Agent 运行失败",
    );
  return {
    output: validateRiskReviewOutput(result.output, canonicalRisks),
    runId,
    durationMs: result.durationMs,
    inputTokens: result.usage?.inputTokens,
    outputTokens: result.usage?.outputTokens,
  };
}

export interface RiskRemediationGeneration {
  output: RiskRemediationOutput;
  runId: string;
  durationMs: number;
  inputTokens?: number;
  outputTokens?: number;
}

export async function generateRiskRemediationProposals(
  projectId: string,
  risks: RiskReviewSource[],
  provider: ProviderConfig,
  desktopRuntime: boolean,
): Promise<RiskRemediationGeneration> {
  if (!desktopRuntime)
    throw new AppError("permission", "风险缓解提案 Agent 仅在桌面应用中运行");
  const canonicalRisks = risks
    .filter((risk) => risk.status !== "closed")
    .sort((left, right) => left.id.localeCompare(right.id));
  if (!projectId.trim() || !canonicalRisks.length)
    throw new AppError("validation", "当前项目没有可生成提案的开放风险");
  if (!provider.enabled || provider.kind === "none")
    throw new AppError("validation", "请先启用并保存模型 Provider");
  const runId = crypto.randomUUID();
  const result = await invoke<StructuredGenerationResult>(
    "generate_structured_ai_output",
    {
      request: {
        runId,
        runType: "risk_review",
        agentDefinitionId: "risk-review:v2",
        projectId,
        entityId: undefined,
        idempotencyKey: `risk-review:v2:${projectId}:${runId}`,
        kind: provider.kind,
        endpoint: provider.endpoint,
        model: provider.model,
        system: [
          "You are a proposal-only project risk remediation agent.",
          "Use only the supplied current-project saved risks and copy expectedUpdatedAt exactly.",
          "Every proposal must cite exact complete values from its target risk fields.",
          "You may propose mitigation, owner, dueDate, severity, or probability only.",
          "Never change title, description, or status. Never execute, save, confirm, or reject a proposal.",
        ].join("\n"),
        prompt: JSON.stringify({ projectId, risks: canonicalRisks }),
        responseSchema: riskRemediationJsonSchema,
        maxOutputTokens: 4_096,
      },
    },
  );
  if (result.state !== "succeeded" || result.output === undefined)
    throw new AppError(
      "external_service",
      result.message || "风险缓解提案 Agent 运行失败",
    );
  return {
    output: validateRiskRemediationOutput(result.output, canonicalRisks),
    runId,
    durationMs: result.durationMs,
    inputTokens: result.usage?.inputTokens,
    outputTokens: result.usage?.outputTokens,
  };
}

export interface DependencyRemediationGeneration {
  output: DependencyRemediationOutput;
  runId: string;
  durationMs: number;
  inputTokens?: number;
  outputTokens?: number;
}

export async function generateDependencyRemediationProposals(
  projectId: string,
  dependencies: DependencyRemediationSource[],
  provider: ProviderConfig,
  desktopRuntime: boolean,
): Promise<DependencyRemediationGeneration> {
  if (!desktopRuntime)
    throw new AppError("permission", "依赖处置提案 Agent 仅在桌面应用中运行");
  const canonicalDependencies = dependencies
    .filter((item) => item.status !== "resolved")
    .sort((left, right) => left.id.localeCompare(right.id));
  if (!projectId.trim() || !canonicalDependencies.length)
    throw new AppError("validation", "当前项目没有可生成提案的未解决依赖");
  if (!provider.enabled || provider.kind === "none")
    throw new AppError("validation", "请先启用并保存模型 Provider");
  const runId = crypto.randomUUID();
  const result = await invoke<StructuredGenerationResult>(
    "generate_structured_ai_output",
    {
      request: {
        runId,
        runType: "dependency_review",
        agentDefinitionId: "dependency-remediation:v1",
        projectId,
        entityId: undefined,
        idempotencyKey: `dependency-remediation:v1:${projectId}:${runId}`,
        kind: provider.kind,
        endpoint: provider.endpoint,
        model: provider.model,
        system: [
          "You are a proposal-only project dependency remediation agent.",
          "Use only supplied current-project unresolved dependencies and copy expectedUpdatedAt exactly.",
          "Every proposal must cite exact complete values from its target dependency fields.",
          "You may propose owner, dueDate, or resolution only.",
          "Never change title, description, dependencyType, or status. Never execute, save, confirm, or reject a proposal.",
        ].join("\n"),
        prompt: JSON.stringify({ projectId, dependencies: canonicalDependencies }),
        responseSchema: dependencyRemediationJsonSchema,
        maxOutputTokens: 4_096,
      },
    },
  );
  if (result.state !== "succeeded" || result.output === undefined)
    throw new AppError("external_service", result.message || "依赖处置提案 Agent 运行失败");
  return {
    output: validateDependencyRemediationOutput(result.output, canonicalDependencies),
    runId,
    durationMs: result.durationMs,
    inputTokens: result.usage?.inputTokens,
    outputTokens: result.usage?.outputTokens,
  };
}

export async function generateReleasePreparationProposals(projectId: string, releases: ReleasePreparationSource[], provider: ProviderConfig, desktopRuntime: boolean): Promise<{ output: ReleasePreparationOutput; runId: string; durationMs: number; inputTokens?: number; outputTokens?: number }> {
  if (!desktopRuntime) throw new AppError("permission", "发布准备提案 Agent 仅在桌面应用中运行");
  const canonicalReleases = releases.filter((item) => item.status === "planned" || item.status === "ready").sort((a, b) => a.id.localeCompare(b.id));
  if (!projectId.trim() || !canonicalReleases.length) throw new AppError("validation", "当前项目没有可生成提案的发布前记录");
  if (!provider.enabled || provider.kind === "none") throw new AppError("validation", "请先启用并保存模型 Provider");
  const runId = crypto.randomUUID();
  const result = await invoke<StructuredGenerationResult>("generate_structured_ai_output", { request: { runId, runType: "release_preparation", agentDefinitionId: "release-preparation:v1", projectId, entityId: undefined, idempotencyKey: `release-preparation:v1:${projectId}:${runId}`, kind: provider.kind, endpoint: provider.endpoint, model: provider.model,
    system: ["You are a proposal-only release preparation agent.", "Use only supplied current-project planned or ready release records and copy expectedUpdatedAt exactly.", "Cite exact complete stored field values.", "You may propose scope, checklist, rollbackPlan, or targetDate only.", "Never change title, status, result, retrospective, or followUp. Never execute, save, confirm, or reject."].join("\n"),
    prompt: JSON.stringify({ projectId, releases: canonicalReleases }), responseSchema: releasePreparationJsonSchema, maxOutputTokens: 4_096 } });
  if (result.state !== "succeeded" || result.output === undefined) throw new AppError("external_service", result.message || "发布准备提案 Agent 运行失败");
  return { output: validateReleasePreparationOutput(result.output, canonicalReleases), runId, durationMs: result.durationMs, inputTokens: result.usage?.inputTokens, outputTokens: result.usage?.outputTokens };
}

export interface ReleaseReviewGeneration {
  output: ReleaseReviewOutput;
  runId: string;
  durationMs: number;
  inputTokens?: number;
  outputTokens?: number;
}

export async function generateReleaseReview(
  projectId: string,
  releases: ReleaseReviewSource[],
  provider: ProviderConfig,
  desktopRuntime: boolean,
): Promise<ReleaseReviewGeneration> {
  if (!desktopRuntime)
    throw new AppError("permission", "发布审阅 Agent 仅在桌面应用中运行");
  const canonicalReleases = releases
    .filter((release) => release.status !== "cancelled")
    .sort((left, right) => left.id.localeCompare(right.id));
  if (!projectId.trim() || !canonicalReleases.length)
    throw new AppError("validation", "当前项目没有可供审阅的发布记录");
  if (!provider.enabled || provider.kind === "none")
    throw new AppError("validation", "请先启用并保存模型 Provider");
  const runId = crypto.randomUUID();
  const result = await invoke<StructuredGenerationResult>(
    "generate_structured_ai_output",
    {
      request: {
        runId,
        runType: "release_review",
        agentDefinitionId: "release-review:v1",
        projectId,
        entityId: undefined,
        idempotencyKey: `release-review:v1:${projectId}:${runId}`,
        kind: provider.kind,
        endpoint: provider.endpoint,
        model: provider.model,
        system: [
          "You are a read-only release and retrospective review agent.",
          "Use only the supplied current-project saved release records.",
          "Every finding must cite an exact complete scalar field value or an exact item from a saved list field.",
          "Return readiness and review proposals only. Never change release status or execute a release.",
        ].join("\n"),
        prompt: JSON.stringify({ projectId, releases: canonicalReleases }),
        responseSchema: releaseReviewJsonSchema,
        maxOutputTokens: 4_096,
      },
    },
  );
  if (result.state !== "succeeded" || result.output === undefined)
    throw new AppError(
      "external_service",
      result.message || "发布审阅 Agent 运行失败",
    );
  return {
    output: validateReleaseReviewOutput(result.output, canonicalReleases),
    runId,
    durationMs: result.durationMs,
    inputTokens: result.usage?.inputTokens,
    outputTokens: result.usage?.outputTokens,
  };
}

export interface CompetitorReviewGeneration {
  output: CompetitorReviewOutput;
  runId: string;
  durationMs: number;
  inputTokens?: number;
  outputTokens?: number;
}

export async function generateCompetitorReview(
  projectId: string,
  profiles: CompetitorReviewSource[],
  provider: ProviderConfig,
  desktopRuntime: boolean,
): Promise<CompetitorReviewGeneration> {
  if (!desktopRuntime)
    throw new AppError("permission", "竞品审阅 Agent 仅在桌面应用中运行");
  const canonicalProfiles = [...profiles].sort((left, right) =>
    left.id.localeCompare(right.id),
  );
  if (!projectId.trim() || !canonicalProfiles.length)
    throw new AppError("validation", "当前项目没有可供审阅的竞品档案");
  if (!provider.enabled || provider.kind === "none")
    throw new AppError("validation", "请先启用并保存模型 Provider");
  const runId = crypto.randomUUID();
  const result = await invoke<StructuredGenerationResult>(
    "generate_structured_ai_output",
    {
      request: {
        runId,
        runType: "competitor_review",
        agentDefinitionId: "competitor-review:v1",
        projectId,
        entityId: undefined,
        idempotencyKey: `competitor-review:v1:${projectId}:${runId}`,
        kind: provider.kind,
        endpoint: provider.endpoint,
        model: provider.model,
        system: [
          "You are a read-only competitor profile review agent.",
          "Use only the supplied current-project saved competitor profiles. Do not use external knowledge or search.",
          "Every involved profile must have at least one citation whose quote exactly equals the complete saved field value.",
          "Return comparison and research-gap proposals only. Never update a profile or create a requirement.",
        ].join("\n"),
        prompt: JSON.stringify({
          projectId,
          competitorProfiles: canonicalProfiles,
        }),
        responseSchema: competitorReviewJsonSchema,
        maxOutputTokens: 4_096,
      },
    },
  );
  if (result.state !== "succeeded" || result.output === undefined)
    throw new AppError(
      "external_service",
      result.message || "竞品审阅 Agent 运行失败",
    );
  return {
    output: validateCompetitorReviewOutput(result.output, canonicalProfiles),
    runId,
    durationMs: result.durationMs,
    inputTokens: result.usage?.inputTokens,
    outputTokens: result.usage?.outputTokens,
  };
}

export interface ResearchPlanReviewGeneration {
  output: ResearchPlanReviewOutput;
  runId: string;
  durationMs: number;
  inputTokens?: number;
  outputTokens?: number;
}

export interface PlanEngineerGeneration {
  output: PlanEngineerOutput;
  runId: string;
  durationMs: number;
  inputTokens?: number;
  outputTokens?: number;
}

export async function generateResearchPlanReview(
  projectId: string,
  sources: ResearchPlanReviewSource[],
  provider: ProviderConfig,
  desktopRuntime: boolean,
): Promise<ResearchPlanReviewGeneration> {
  if (!desktopRuntime)
    throw new AppError("permission", "研究计划审阅 Agent 仅在桌面应用中运行");
  const canonicalSources = [...sources]
    .filter((source) => source.status !== "cancelled")
    .sort((left, right) => left.id.localeCompare(right.id));
  if (!projectId.trim() || !canonicalSources.length)
    throw new AppError("validation", "当前项目没有可供审阅的研究计划");
  if (!provider.enabled || provider.kind === "none")
    throw new AppError("validation", "请先启用并保存模型 Provider");
  const runId = crypto.randomUUID();
  const result = await invoke<StructuredGenerationResult>(
    "generate_structured_ai_output",
    {
      request: {
        runId,
        runType: "research_plan_review",
        agentDefinitionId: "research-plan-review:v1",
        projectId,
        entityId: undefined,
        idempotencyKey: `research-plan-review:v1:${projectId}:${runId}`,
        kind: provider.kind,
        endpoint: provider.endpoint,
        model: provider.model,
        system: [
          "You are a read-only research planning review agent.",
          "Use only the supplied current-project research plans and their linked research entries.",
          "Every plan or result claim must cite exact saved field values; never move a result between plans.",
          "Return planning proposals only. Never update a plan, create a research entry, or create a requirement.",
        ].join("\n"),
        prompt: JSON.stringify({ projectId, researchPlans: canonicalSources }),
        responseSchema: researchPlanReviewJsonSchema,
        maxOutputTokens: 4_096,
      },
    },
  );
  if (result.state !== "succeeded" || result.output === undefined)
    throw new AppError(
      "external_service",
      result.message || "研究计划审阅 Agent 运行失败",
    );
  return {
    output: validateResearchPlanReviewOutput(result.output, canonicalSources),
    runId,
    durationMs: result.durationMs,
    inputTokens: result.usage?.inputTokens,
    outputTokens: result.usage?.outputTokens,
  };
}

export async function generatePlanEngineer(
  projectId: string,
  sources: ResearchPlanReviewSource[],
  provider: ProviderConfig,
  desktopRuntime: boolean,
): Promise<PlanEngineerGeneration> {
  if (!desktopRuntime)
    throw new AppError("permission", "计划工程师 Agent 仅在桌面应用中运行");
  const canonicalSources = [...sources]
    .filter((source) => source.status !== "cancelled")
    .sort((left, right) => left.id.localeCompare(right.id));
  if (!projectId.trim() || !canonicalSources.length)
    throw new AppError(
      "validation",
      "当前项目没有可供计划工程师审阅的研究计划",
    );
  if (!provider.enabled || provider.kind === "none")
    throw new AppError("validation", "请先启用并保存模型 Provider");
  const runId = crypto.randomUUID();
  const result = await invoke<StructuredGenerationResult>(
    "generate_structured_ai_output",
    {
      request: {
        runId,
        runType: "plan_engineer",
        agentDefinitionId: "plan-engineer:v2",
        projectId,
        entityId: undefined,
        idempotencyKey: `plan-engineer:v2:${projectId}:${runId}`,
        kind: provider.kind,
        endpoint: provider.endpoint,
        model: provider.model,
        system: [
          "You are a proposal-only research plan engineer. Use only the supplied current-project plans and linked entries.",
          "Return structured changes only for objective, targetPersona, questions, startDate, or endDate. Never change title or status.",
          "Copy expectedUpdatedAt exactly from the target plan. Every proposal must cite exact complete saved field values.",
          "The application will persist proposals for user review. You cannot confirm or execute any update.",
        ].join("\n"),
        prompt: JSON.stringify({ projectId, researchPlans: canonicalSources }),
        responseSchema: planEngineerJsonSchema,
        maxOutputTokens: 4_096,
      },
    },
  );
  if (result.state !== "succeeded" || result.output === undefined)
    throw new AppError(
      "external_service",
      result.message || "计划工程师 Agent 运行失败",
    );
  return {
    output: validatePlanEngineerOutput(result.output, canonicalSources),
    runId,
    durationMs: result.durationMs,
    inputTokens: result.usage?.inputTokens,
    outputTokens: result.usage?.outputTokens,
  };
}

export interface KnowledgeReviewGeneration {
  output: KnowledgeReviewOutput;
  runId: string;
  durationMs: number;
  inputTokens?: number;
  outputTokens?: number;
}
export async function generateKnowledgeReview(
  projectId: string,
  memories: KnowledgeReviewMemory[],
  provider: ProviderConfig,
  desktopRuntime: boolean,
): Promise<KnowledgeReviewGeneration> {
  if (!desktopRuntime)
    throw new AppError("permission", "知识管理 Agent 仅在桌面应用中运行");
  const canonicalMemories = [...memories]
    .filter((memory) => !["archived", "rejected"].includes(memory.status))
    .sort((a, b) => a.id.localeCompare(b.id));
  if (!projectId.trim() || !canonicalMemories.length)
    throw new AppError("validation", "当前项目没有可审阅的项目记忆");
  if (!provider.enabled || provider.kind === "none")
    throw new AppError("validation", "请先启用并保存模型 Provider");
  const runId = crypto.randomUUID();
  const result = await invoke<StructuredGenerationResult>(
    "generate_structured_ai_output",
    {
      request: {
        runId,
        runType: "knowledge_review",
        agentDefinitionId: "knowledge-review:v1",
        projectId,
        entityId: undefined,
        idempotencyKey: `knowledge-review:v1:${projectId}:${runId}`,
        kind: provider.kind,
        endpoint: provider.endpoint,
        model: provider.model,
        system:
          "You are a read-only knowledge management review agent. Use only the supplied project memory snapshot, sources, and conflict relations. Cite exact saved values. Never confirm, reject, archive, edit, or relate memories.",
        prompt: JSON.stringify({ projectId, memories: canonicalMemories }),
        responseSchema: knowledgeReviewJsonSchema,
        maxOutputTokens: 4_096,
      },
    },
  );
  if (result.state !== "succeeded" || result.output === undefined)
    throw new AppError(
      "external_service",
      result.message || "知识管理 Agent 运行失败",
    );
  return {
    output: validateKnowledgeReviewOutput(result.output, canonicalMemories),
    runId,
    durationMs: result.durationMs,
    inputTokens: result.usage?.inputTokens,
    outputTokens: result.usage?.outputTokens,
  };
}
