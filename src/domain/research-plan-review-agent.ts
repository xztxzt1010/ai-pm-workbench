import { AppError } from "@/domain/app-error";
import type { ResearchPlanRecord } from "@/services/research-plan-service";
import type { ResearchEntryRecord } from "@/services/research-entry-service";

export interface ResearchPlanResultSource {
  entryId: string;
  researchType: string;
  title: string;
  sourceRef: string;
  accessedAt: string;
  insight: string;
  personaSuggestion: string;
}
export interface ResearchPlanReviewSource {
  id: string;
  title: string;
  objective: string;
  targetPersona: string;
  questions: string[];
  status: ResearchPlanRecord["status"];
  startDate: string;
  endDate: string;
  updatedAt: string;
  results: ResearchPlanResultSource[];
}
export interface ResearchPlanReviewCitation {
  sourceType: "plan" | "result";
  sourceId: string;
  field: string;
  quote: string;
}
export interface ResearchPlanReviewFinding {
  planId: string;
  severity: "info" | "warning" | "blocker";
  category: "objective" | "persona" | "questions" | "schedule" | "coverage";
  summary: string;
  recommendation: string;
  citations: ResearchPlanReviewCitation[];
}
export interface ResearchPlanReviewOutput {
  schemaVersion: "1.0.0";
  findings: ResearchPlanReviewFinding[];
  limitations: string[];
}

const planFields = [
  "title",
  "objective",
  "targetPersona",
  "questions",
  "status",
  "startDate",
  "endDate",
] as const;
const resultFields = [
  "researchType",
  "title",
  "sourceRef",
  "accessedAt",
  "insight",
  "personaSuggestion",
] as const;
const severities = ["info", "warning", "blocker"] as const;
const categories = [
  "objective",
  "persona",
  "questions",
  "schedule",
  "coverage",
] as const;

function parseQuestions(value: string): string[] {
  try {
    const parsed = JSON.parse(value);
    if (
      !Array.isArray(parsed) ||
      parsed.some((item) => typeof item !== "string")
    )
      throw new Error();
    return parsed;
  } catch {
    throw new AppError("validation", "研究计划提纲数据已损坏");
  }
}

export function buildResearchPlanReviewSources(
  plans: ResearchPlanRecord[],
  entries: ResearchEntryRecord[],
): ResearchPlanReviewSource[] {
  return plans
    .filter((plan) => plan.status !== "cancelled")
    .map((plan) => ({
      id: plan.id,
      title: plan.title,
      objective: plan.objective,
      targetPersona: plan.targetPersona,
      questions: parseQuestions(plan.questionsJson),
      status: plan.status,
      startDate: plan.startDate,
      endDate: plan.endDate,
      updatedAt: plan.updatedAt,
      results: entries
        .filter((entry) => entry.planId === plan.id)
        .sort((left, right) => left.id.localeCompare(right.id))
        .map((entry) => ({
          entryId: entry.id,
          researchType: entry.researchType,
          title: entry.title,
          sourceRef: entry.sourceRef,
          accessedAt: entry.accessedAt,
          insight: entry.insight,
          personaSuggestion: entry.personaSuggestion,
        })),
    }))
    .sort((left, right) => left.id.localeCompare(right.id));
}

export const researchPlanReviewJsonSchema = {
  type: "object",
  additionalProperties: false,
  required: ["schemaVersion", "findings", "limitations"],
  properties: {
    schemaVersion: { const: "1.0.0" },
    findings: {
      type: "array",
      maxItems: 30,
      items: {
        type: "object",
        additionalProperties: false,
        required: [
          "planId",
          "severity",
          "category",
          "summary",
          "recommendation",
          "citations",
        ],
        properties: {
          planId: { type: "string", minLength: 1, maxLength: 200 },
          severity: { type: "string", enum: severities },
          category: { type: "string", enum: categories },
          summary: { type: "string", minLength: 1, maxLength: 1000 },
          recommendation: { type: "string", minLength: 1, maxLength: 1000 },
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
                  enum: [...planFields, ...resultFields],
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

export function validateResearchPlanReviewOutput(
  output: unknown,
  sources: ResearchPlanReviewSource[],
): ResearchPlanReviewOutput {
  if (!output || typeof output !== "object")
    throw new AppError("validation", "研究计划审阅 Agent 输出必须是对象");
  const candidate = output as Partial<ResearchPlanReviewOutput>;
  if (
    candidate.schemaVersion !== "1.0.0" ||
    !Array.isArray(candidate.findings) ||
    candidate.findings.length > 30 ||
    !Array.isArray(candidate.limitations) ||
    candidate.limitations.length > 10
  )
    throw new AppError("validation", "研究计划审阅 Agent 输出契约无效");
  const findings = candidate.findings.map((finding) => {
    const plan = sources.find((item) => item.id === finding?.planId);
    if (
      !plan ||
      !severities.includes(finding.severity) ||
      !categories.includes(finding.category) ||
      !finding.summary?.trim() ||
      !finding.recommendation?.trim() ||
      !Array.isArray(finding.citations) ||
      !finding.citations.length ||
      finding.citations.length > 20
    )
      throw new AppError("validation", "计划建议必须引用当前项目研究计划");
    const citations = finding.citations.map((citation) => {
      if (!citation.quote?.trim())
        throw new AppError("validation", "计划建议引用无效");
      if (citation.sourceType === "plan") {
        if (
          citation.sourceId !== plan.id ||
          !planFields.includes(citation.field as (typeof planFields)[number])
        )
          throw new AppError("validation", "计划建议引用未命中当前研究计划");
        const stored = plan[citation.field as (typeof planFields)[number]];
        const exact = Array.isArray(stored)
          ? stored.includes(citation.quote)
          : String(stored) === citation.quote;
        if (!exact)
          throw new AppError("validation", "计划建议引用未精确命中计划字段");
      } else if (citation.sourceType === "result") {
        const result = plan.results.find(
          (item) => item.entryId === citation.sourceId,
        );
        if (
          !result ||
          !resultFields.includes(
            citation.field as (typeof resultFields)[number],
          ) ||
          String(result[citation.field as (typeof resultFields)[number]]) !==
            citation.quote
        )
          throw new AppError(
            "validation",
            "计划建议引用未精确命中关联研究结果",
          );
      } else throw new AppError("validation", "计划建议引用类型无效");
      return citation;
    });
    return {
      planId: plan.id,
      severity: finding.severity,
      category: finding.category,
      summary: finding.summary.trim(),
      recommendation: finding.recommendation.trim(),
      citations,
    };
  });
  if (
    candidate.limitations.some(
      (item) => typeof item !== "string" || !item.trim(),
    )
  )
    throw new AppError("validation", "研究计划审阅限制条件无效");
  return {
    schemaVersion: "1.0.0",
    findings,
    limitations: candidate.limitations.map((item) => item.trim()),
  };
}
