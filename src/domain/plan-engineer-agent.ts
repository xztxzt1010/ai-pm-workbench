import { AppError } from "@/domain/app-error";
import {
  validateResearchPlanDraft,
  type ResearchPlanDraft,
} from "@/domain/research-plan";
import type {
  ResearchPlanReviewCitation,
  ResearchPlanReviewSource,
} from "@/domain/research-plan-review-agent";

export interface ResearchPlanUpdateChanges {
  objective?: string;
  targetPersona?: string;
  questions?: string[];
  startDate?: string;
  endDate?: string;
}

export interface PlanEngineerProposal {
  planId: string;
  expectedUpdatedAt: string;
  changes: ResearchPlanUpdateChanges;
  rationale: string;
  citations: ResearchPlanReviewCitation[];
}

export interface PlanEngineerOutput {
  schemaVersion: "2.0.0";
  proposals: PlanEngineerProposal[];
  limitations: string[];
}

const changeKeys = [
  "objective",
  "targetPersona",
  "questions",
  "startDate",
  "endDate",
] as const;
const planCitationFields = [
  "title",
  "objective",
  "targetPersona",
  "questions",
  "status",
  "startDate",
  "endDate",
] as const;
const resultCitationFields = [
  "researchType",
  "title",
  "sourceRef",
  "accessedAt",
  "insight",
  "personaSuggestion",
] as const;

export const planEngineerJsonSchema = {
  type: "object",
  additionalProperties: false,
  required: ["schemaVersion", "proposals", "limitations"],
  properties: {
    schemaVersion: { const: "2.0.0" },
    proposals: {
      type: "array",
      maxItems: 20,
      items: {
        type: "object",
        additionalProperties: false,
        required: [
          "planId",
          "expectedUpdatedAt",
          "changes",
          "rationale",
          "citations",
        ],
        properties: {
          planId: { type: "string", minLength: 1, maxLength: 200 },
          expectedUpdatedAt: { type: "string", minLength: 1, maxLength: 100 },
          changes: {
            type: "object",
            additionalProperties: false,
            minProperties: 1,
            properties: {
              objective: { type: "string", minLength: 1, maxLength: 5000 },
              targetPersona: { type: "string", maxLength: 2000 },
              questions: {
                type: "array",
                maxItems: 100,
                items: { type: "string", minLength: 1, maxLength: 1000 },
              },
              startDate: { type: "string", pattern: "^\\d{4}-\\d{2}-\\d{2}$" },
              endDate: { type: "string", pattern: "^\\d{4}-\\d{2}-\\d{2}$" },
            },
          },
          rationale: { type: "string", minLength: 1, maxLength: 2000 },
          citations: {
            type: "array",
            minItems: 1,
            maxItems: 20,
            items: {
              type: "object",
              additionalProperties: false,
              required: ["sourceType", "sourceId", "field", "quote"],
              properties: {
                sourceType: { type: "string", enum: ["plan", "result"] },
                sourceId: { type: "string", minLength: 1, maxLength: 200 },
                field: {
                  type: "string",
                  enum: [...planCitationFields, ...resultCitationFields],
                },
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

function sameQuestions(left: string[], right: string[]) {
  return JSON.stringify(left) === JSON.stringify(right);
}

function validateCitation(
  citation: ResearchPlanReviewCitation,
  plan: ResearchPlanReviewSource,
) {
  if (!citation?.quote?.trim())
    throw new AppError("validation", "计划工程师提案引用无效");
  if (citation.sourceType === "plan") {
    if (
      citation.sourceId !== plan.id ||
      !planCitationFields.includes(
        citation.field as (typeof planCitationFields)[number],
      )
    )
      throw new AppError("validation", "计划工程师提案引用超出目标计划");
    const stored = plan[citation.field as (typeof planCitationFields)[number]];
    const exact = Array.isArray(stored)
      ? stored.includes(citation.quote)
      : String(stored) === citation.quote;
    if (!exact)
      throw new AppError("validation", "计划工程师提案引用未精确命中计划字段");
  } else if (citation.sourceType === "result") {
    const result = plan.results.find((item) => item.entryId === citation.sourceId);
    if (
      !result ||
      !resultCitationFields.includes(
        citation.field as (typeof resultCitationFields)[number],
      ) ||
      String(result[citation.field as (typeof resultCitationFields)[number]]) !==
        citation.quote
    )
      throw new AppError("validation", "计划工程师提案引用未精确命中关联研究结果");
  } else throw new AppError("validation", "计划工程师提案引用类型无效");
  return citation;
}

export function validatePlanEngineerOutput(
  output: unknown,
  sources: ResearchPlanReviewSource[],
): PlanEngineerOutput {
  if (!output || typeof output !== "object")
    throw new AppError("validation", "计划工程师 Agent 输出必须是对象");
  const candidate = output as Partial<PlanEngineerOutput>;
  if (
    candidate.schemaVersion !== "2.0.0" ||
    !Array.isArray(candidate.proposals) ||
    candidate.proposals.length > 20 ||
    !Array.isArray(candidate.limitations) ||
    candidate.limitations.length > 10
  )
    throw new AppError("validation", "计划工程师 Agent 输出契约无效");
  const proposals = candidate.proposals.map((proposal) => {
    const plan = sources.find((item) => item.id === proposal?.planId);
    if (
      !plan ||
      proposal.expectedUpdatedAt !== plan.updatedAt ||
      !proposal.changes ||
      typeof proposal.changes !== "object" ||
      Array.isArray(proposal.changes) ||
      !proposal.rationale?.trim() ||
      proposal.rationale.trim().length > 2000 ||
      !Array.isArray(proposal.citations) ||
      !proposal.citations.length ||
      proposal.citations.length > 20
    )
      throw new AppError("validation", "计划工程师提案必须绑定当前计划快照和证据");
    const entries = Object.entries(proposal.changes);
    if (
      !entries.length ||
      entries.some(([key]) => !changeKeys.includes(key as (typeof changeKeys)[number]))
    )
      throw new AppError("validation", "计划工程师提案包含未授权字段");
    const merged: ResearchPlanDraft = validateResearchPlanDraft({
      title: plan.title,
      objective: proposal.changes.objective ?? plan.objective,
      targetPersona: proposal.changes.targetPersona ?? plan.targetPersona,
      questions: proposal.changes.questions ?? plan.questions,
      startDate: proposal.changes.startDate ?? plan.startDate,
      endDate: proposal.changes.endDate ?? plan.endDate,
    });
    const changes: ResearchPlanUpdateChanges = {};
    if (proposal.changes.objective !== undefined && merged.objective !== plan.objective)
      changes.objective = merged.objective;
    if (
      proposal.changes.targetPersona !== undefined &&
      merged.targetPersona !== plan.targetPersona
    )
      changes.targetPersona = merged.targetPersona;
    if (
      proposal.changes.questions !== undefined &&
      !sameQuestions(merged.questions, plan.questions)
    )
      changes.questions = merged.questions;
    if (proposal.changes.startDate !== undefined && merged.startDate !== plan.startDate)
      changes.startDate = merged.startDate;
    if (proposal.changes.endDate !== undefined && merged.endDate !== plan.endDate)
      changes.endDate = merged.endDate;
    if (!Object.keys(changes).length)
      throw new AppError("validation", "计划工程师提案没有产生实际字段变化");
    return {
      planId: plan.id,
      expectedUpdatedAt: plan.updatedAt,
      changes,
      rationale: proposal.rationale.trim(),
      citations: proposal.citations.map((citation) =>
        validateCitation(citation, plan),
      ),
    };
  });
  if (
    candidate.limitations.some(
      (item) => typeof item !== "string" || !item.trim() || item.length > 300,
    )
  )
    throw new AppError("validation", "计划工程师限制条件无效");
  return {
    schemaVersion: "2.0.0",
    proposals,
    limitations: candidate.limitations.map((item) => item.trim()),
  };
}
