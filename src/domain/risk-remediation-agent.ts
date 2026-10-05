import { AppError } from "@/domain/app-error";
import {
  riskProbabilities,
  riskSeverities,
  validateProjectRiskDraft,
  type ProjectRiskDraft,
  type RiskProbability,
  type RiskSeverity,
} from "@/domain/project-risk";
import type {
  RiskReviewCitation,
  RiskReviewSource,
} from "@/domain/risk-review-agent";

export interface ProjectRiskUpdateChanges {
  mitigation?: string;
  owner?: string;
  dueDate?: string;
  severity?: RiskSeverity;
  probability?: RiskProbability;
}

export interface RiskRemediationProposal {
  riskId: string;
  expectedUpdatedAt: string;
  priority: "immediate" | "next" | "monitor";
  changes: ProjectRiskUpdateChanges;
  rationale: string;
  citations: RiskReviewCitation[];
}

export interface RiskRemediationOutput {
  schemaVersion: "2.0.0";
  overallAssessment: "stable" | "watch" | "critical";
  proposals: RiskRemediationProposal[];
  limitations: string[];
}

const priorities = ["immediate", "next", "monitor"] as const;
const changeKeys = [
  "mitigation",
  "owner",
  "dueDate",
  "severity",
  "probability",
] as const;
const citationFields = [
  "title",
  "description",
  "severity",
  "probability",
  "status",
  "owner",
  "dueDate",
  "mitigation",
] as const;

export const riskRemediationJsonSchema = {
  type: "object",
  additionalProperties: false,
  required: ["schemaVersion", "overallAssessment", "proposals", "limitations"],
  properties: {
    schemaVersion: { const: "2.0.0" },
    overallAssessment: { type: "string", enum: ["stable", "watch", "critical"] },
    proposals: {
      type: "array",
      maxItems: 20,
      items: {
        type: "object",
        additionalProperties: false,
        required: ["riskId", "expectedUpdatedAt", "priority", "changes", "rationale", "citations"],
        properties: {
          riskId: { type: "string", minLength: 1, maxLength: 200 },
          expectedUpdatedAt: { type: "string", minLength: 1, maxLength: 100 },
          priority: { type: "string", enum: priorities },
          changes: {
            type: "object",
            additionalProperties: false,
            minProperties: 1,
            properties: {
              mitigation: { type: "string", minLength: 1, maxLength: 5000 },
              owner: { type: "string", minLength: 1, maxLength: 200 },
              dueDate: { type: "string", pattern: "^\\d{4}-\\d{2}-\\d{2}$" },
              severity: { type: "string", enum: riskSeverities },
              probability: { type: "string", enum: riskProbabilities },
            },
          },
          rationale: { type: "string", minLength: 1, maxLength: 2000 },
          citations: {
            type: "array",
            minItems: 1,
            maxItems: 8,
            items: {
              type: "object",
              additionalProperties: false,
              required: ["field", "quote"],
              properties: {
                field: { type: "string", enum: citationFields },
                quote: { type: "string", minLength: 1, maxLength: 5000 },
              },
            },
          },
        },
      },
    },
    limitations: {
      type: "array",
      maxItems: 10,
      items: { type: "string", minLength: 1, maxLength: 300 },
    },
  },
} as const;

export function validateRiskRemediationOutput(
  output: unknown,
  sources: RiskReviewSource[],
): RiskRemediationOutput {
  if (!output || typeof output !== "object")
    throw new AppError("validation", "风险缓解提案 Agent 输出必须是对象");
  const candidate = output as Partial<RiskRemediationOutput>;
  if (
    candidate.schemaVersion !== "2.0.0" ||
    !["stable", "watch", "critical"].includes(candidate.overallAssessment ?? "") ||
    !Array.isArray(candidate.proposals) ||
    candidate.proposals.length > 20 ||
    !Array.isArray(candidate.limitations) ||
    candidate.limitations.length > 10
  )
    throw new AppError("validation", "风险缓解提案 Agent 输出契约无效");
  const seen = new Set<string>();
  const proposals = candidate.proposals.map((proposal) => {
    const source = sources.find((item) => item.id === proposal?.riskId);
    if (
      !source ||
      source.status === "closed" ||
      seen.has(source.id) ||
      proposal.expectedUpdatedAt !== source.updatedAt ||
      !priorities.includes(proposal.priority) ||
      !proposal.changes ||
      typeof proposal.changes !== "object" ||
      Array.isArray(proposal.changes) ||
      !proposal.rationale?.trim() ||
      proposal.rationale.trim().length > 2000 ||
      !Array.isArray(proposal.citations) ||
      !proposal.citations.length ||
      proposal.citations.length > 8
    )
      throw new AppError("validation", "风险提案必须唯一绑定当前开放风险快照和证据");
    seen.add(source.id);
    const entries = Object.entries(proposal.changes);
    if (
      !entries.length ||
      entries.some(([key]) => !changeKeys.includes(key as (typeof changeKeys)[number]))
    )
      throw new AppError("validation", "风险提案包含未授权字段");
    const merged: ProjectRiskDraft = validateProjectRiskDraft({
      title: source.title,
      description: source.description,
      severity: proposal.changes.severity ?? source.severity,
      probability: proposal.changes.probability ?? source.probability,
      owner: proposal.changes.owner ?? source.owner,
      dueDate: proposal.changes.dueDate ?? source.dueDate,
      mitigation: proposal.changes.mitigation ?? source.mitigation,
    });
    const changes: ProjectRiskUpdateChanges = {};
    if (proposal.changes.mitigation !== undefined && merged.mitigation !== source.mitigation && merged.mitigation)
      changes.mitigation = merged.mitigation;
    if (proposal.changes.owner !== undefined && merged.owner !== source.owner && merged.owner)
      changes.owner = merged.owner;
    if (proposal.changes.dueDate !== undefined && merged.dueDate !== source.dueDate)
      changes.dueDate = merged.dueDate;
    if (proposal.changes.severity !== undefined && merged.severity !== source.severity)
      changes.severity = merged.severity;
    if (proposal.changes.probability !== undefined && merged.probability !== source.probability)
      changes.probability = merged.probability;
    if (!Object.keys(changes).length)
      throw new AppError("validation", "风险提案没有产生实际字段变化");
    const citations = proposal.citations.map((citation) => {
      if (
        !citationFields.includes(citation.field as (typeof citationFields)[number]) ||
        citation.quote !== String(source[citation.field])
      )
        throw new AppError("validation", "风险提案引用未精确命中当前风险字段");
      return citation;
    });
    return {
      riskId: source.id,
      expectedUpdatedAt: source.updatedAt,
      priority: proposal.priority,
      changes,
      rationale: proposal.rationale.trim(),
      citations,
    };
  });
  if (candidate.limitations.some((item) => typeof item !== "string" || !item.trim() || item.length > 300))
    throw new AppError("validation", "风险缓解提案限制条件无效");
  return {
    schemaVersion: "2.0.0",
    overallAssessment: candidate.overallAssessment!,
    proposals,
    limitations: candidate.limitations.map((item) => item.trim()),
  };
}
