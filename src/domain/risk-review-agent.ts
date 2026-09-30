import { AppError } from "@/domain/app-error";
import type { ProjectRiskRecord } from "@/services/project-risk-service";

export type RiskReviewSource = Pick<
  ProjectRiskRecord,
  | "id"
  | "title"
  | "description"
  | "severity"
  | "probability"
  | "status"
  | "owner"
  | "dueDate"
  | "mitigation"
  | "updatedAt"
>;
export type RiskCitationField = Exclude<keyof RiskReviewSource, "id" | "updatedAt">;

export interface RiskReviewCitation {
  field: RiskCitationField;
  quote: string;
}
export interface RiskReviewFinding {
  riskId: string;
  priority: "immediate" | "next" | "monitor";
  rationale: string;
  suggestedMitigation: string;
  citations: RiskReviewCitation[];
}
export interface RiskReviewOutput {
  schemaVersion: "1.0.0";
  overallAssessment: "stable" | "watch" | "critical";
  findings: RiskReviewFinding[];
  limitations: string[];
}

const citationFields: RiskCitationField[] = [
  "title",
  "description",
  "severity",
  "probability",
  "status",
  "owner",
  "dueDate",
  "mitigation",
];
const priorities = ["immediate", "next", "monitor"] as const;

export const riskReviewJsonSchema = {
  type: "object",
  additionalProperties: false,
  required: ["schemaVersion", "overallAssessment", "findings", "limitations"],
  properties: {
    schemaVersion: { const: "1.0.0" },
    overallAssessment: {
      type: "string",
      enum: ["stable", "watch", "critical"],
    },
    findings: {
      type: "array",
      maxItems: 20,
      items: {
        type: "object",
        additionalProperties: false,
        required: [
          "riskId",
          "priority",
          "rationale",
          "suggestedMitigation",
          "citations",
        ],
        properties: {
          riskId: { type: "string", minLength: 1, maxLength: 200 },
          priority: { type: "string", enum: priorities },
          rationale: { type: "string", minLength: 1, maxLength: 1000 },
          suggestedMitigation: {
            type: "string",
            minLength: 1,
            maxLength: 1000,
          },
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

export function validateRiskReviewOutput(
  output: unknown,
  sources: RiskReviewSource[],
): RiskReviewOutput {
  if (!output || typeof output !== "object")
    throw new AppError("validation", "风险审阅 Agent 输出必须是对象");
  const candidate = output as Partial<RiskReviewOutput>;
  if (
    candidate.schemaVersion !== "1.0.0" ||
    !["stable", "watch", "critical"].includes(
      candidate.overallAssessment ?? "",
    ) ||
    !Array.isArray(candidate.findings) ||
    candidate.findings.length > 20 ||
    !Array.isArray(candidate.limitations) ||
    candidate.limitations.length > 10
  )
    throw new AppError("validation", "风险审阅 Agent 输出契约无效");
  const seen = new Set<string>();
  const findings = candidate.findings.map((finding) => {
    const source = sources.find((item) => item.id === finding?.riskId);
    if (
      !source ||
      seen.has(source.id) ||
      !priorities.includes(finding.priority) ||
      !finding.rationale?.trim() ||
      !finding.suggestedMitigation?.trim() ||
      !Array.isArray(finding.citations) ||
      !finding.citations.length ||
      finding.citations.length > 8
    )
      throw new AppError(
        "validation",
        "风险建议必须唯一引用当前项目已保存风险",
      );
    seen.add(source.id);
    const citations = finding.citations.map((citation) => {
      if (
        !citationFields.includes(citation.field) ||
        citation.quote !== String(source[citation.field])
      )
        throw new AppError(
          "validation",
          "风险建议引用未精确命中当前项目风险字段",
        );
      return citation;
    });
    return {
      riskId: source.id,
      priority: finding.priority,
      rationale: finding.rationale.trim(),
      suggestedMitigation: finding.suggestedMitigation.trim(),
      citations,
    };
  });
  if (
    candidate.limitations.some(
      (item) => typeof item !== "string" || !item.trim(),
    )
  )
    throw new AppError("validation", "风险审阅限制条件无效");
  return {
    schemaVersion: "1.0.0",
    overallAssessment: candidate.overallAssessment!,
    findings,
    limitations: candidate.limitations.map((item) => item.trim()),
  };
}
