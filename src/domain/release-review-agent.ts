import { AppError } from "@/domain/app-error";
import type { ReleaseRecord } from "@/services/release-service";

export interface ReleaseReviewSource {
  id: string;
  title: string;
  scope: string[];
  checklist: string[];
  rollbackPlan: string;
  result: string;
  retrospective: string;
  followUp: string[];
  status: ReleaseRecord["status"];
  targetDate: string;
}
export type ReleaseCitationField = Exclude<keyof ReleaseReviewSource, "id">;
export interface ReleaseReviewCitation {
  field: ReleaseCitationField;
  quote: string;
}
export interface ReleaseReviewFinding {
  releaseId: string;
  severity: "info" | "warning" | "blocker";
  category:
    | "scope"
    | "checklist"
    | "rollback"
    | "outcome"
    | "retrospective"
    | "follow_up";
  summary: string;
  recommendation: string;
  citations: ReleaseReviewCitation[];
}
export interface ReleaseReviewOutput {
  schemaVersion: "1.0.0";
  readiness: "ready" | "needs_attention" | "blocked";
  findings: ReleaseReviewFinding[];
  limitations: string[];
}

const citationFields: ReleaseCitationField[] = [
  "title",
  "scope",
  "checklist",
  "rollbackPlan",
  "result",
  "retrospective",
  "followUp",
  "status",
  "targetDate",
];
const severities = ["info", "warning", "blocker"] as const;
const categories = [
  "scope",
  "checklist",
  "rollback",
  "outcome",
  "retrospective",
  "follow_up",
] as const;

function parseList(value: string, label: string): string[] {
  try {
    const parsed = JSON.parse(value);
    if (
      !Array.isArray(parsed) ||
      parsed.some((item) => typeof item !== "string")
    )
      throw new Error();
    return parsed;
  } catch {
    throw new AppError("validation", `${label}数据已损坏，无法执行发布审阅`);
  }
}

export function releaseRecordToReviewSource(
  record: ReleaseRecord,
): ReleaseReviewSource {
  return {
    id: record.id,
    title: record.title,
    scope: parseList(record.scopeJson, "发布范围"),
    checklist: parseList(record.checklistJson, "发布检查清单"),
    rollbackPlan: record.rollbackPlan,
    result: record.result,
    retrospective: record.retrospective,
    followUp: parseList(record.followUpJson, "发布后续行动"),
    status: record.status,
    targetDate: record.targetDate,
  };
}

export const releaseReviewJsonSchema = {
  type: "object",
  additionalProperties: false,
  required: ["schemaVersion", "readiness", "findings", "limitations"],
  properties: {
    schemaVersion: { const: "1.0.0" },
    readiness: {
      type: "string",
      enum: ["ready", "needs_attention", "blocked"],
    },
    findings: {
      type: "array",
      maxItems: 30,
      items: {
        type: "object",
        additionalProperties: false,
        required: [
          "releaseId",
          "severity",
          "category",
          "summary",
          "recommendation",
          "citations",
        ],
        properties: {
          releaseId: { type: "string", minLength: 1, maxLength: 200 },
          severity: { type: "string", enum: severities },
          category: { type: "string", enum: categories },
          summary: { type: "string", minLength: 1, maxLength: 1000 },
          recommendation: { type: "string", minLength: 1, maxLength: 1000 },
          citations: {
            type: "array",
            minItems: 1,
            maxItems: 10,
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

export function validateReleaseReviewOutput(
  output: unknown,
  sources: ReleaseReviewSource[],
): ReleaseReviewOutput {
  if (!output || typeof output !== "object")
    throw new AppError("validation", "发布审阅 Agent 输出必须是对象");
  const candidate = output as Partial<ReleaseReviewOutput>;
  if (
    candidate.schemaVersion !== "1.0.0" ||
    !["ready", "needs_attention", "blocked"].includes(
      candidate.readiness ?? "",
    ) ||
    !Array.isArray(candidate.findings) ||
    candidate.findings.length > 30 ||
    !Array.isArray(candidate.limitations) ||
    candidate.limitations.length > 10
  )
    throw new AppError("validation", "发布审阅 Agent 输出契约无效");
  const findings = candidate.findings.map((finding) => {
    const source = sources.find((item) => item.id === finding?.releaseId);
    if (
      !source ||
      !severities.includes(finding.severity) ||
      !categories.includes(finding.category) ||
      !finding.summary?.trim() ||
      !finding.recommendation?.trim() ||
      !Array.isArray(finding.citations) ||
      !finding.citations.length ||
      finding.citations.length > 10
    )
      throw new AppError(
        "validation",
        "发布建议必须引用当前项目已保存发布记录",
      );
    const citations = finding.citations.map((citation) => {
      if (!citationFields.includes(citation.field) || !citation.quote.trim())
        throw new AppError("validation", "发布建议引用字段无效");
      const stored = source[citation.field];
      const exact = Array.isArray(stored)
        ? stored.includes(citation.quote)
        : citation.quote === String(stored);
      if (!exact)
        throw new AppError(
          "validation",
          "发布建议引用未精确命中当前项目发布字段",
        );
      return citation;
    });
    return {
      releaseId: source.id,
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
    throw new AppError("validation", "发布审阅限制条件无效");
  return {
    schemaVersion: "1.0.0",
    readiness: candidate.readiness!,
    findings,
    limitations: candidate.limitations.map((item) => item.trim()),
  };
}
