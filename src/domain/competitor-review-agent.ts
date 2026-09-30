import { AppError } from "@/domain/app-error";
import type { CompetitorProfileRecord } from "@/services/competitor-profile-service";

export type CompetitorReviewSource = Pick<
  CompetitorProfileRecord,
  | "id"
  | "name"
  | "sourceRef"
  | "accessedAt"
  | "strengths"
  | "weaknesses"
  | "positioning"
>;
export type CompetitorCitationField = Exclude<
  keyof CompetitorReviewSource,
  "id"
>;
export interface CompetitorReviewCitation {
  profileId: string;
  field: CompetitorCitationField;
  quote: string;
}
export interface CompetitorReviewFinding {
  profileIds: string[];
  category:
    | "strength_gap"
    | "weakness_opportunity"
    | "positioning_overlap"
    | "evidence_gap";
  summary: string;
  implication: string;
  citations: CompetitorReviewCitation[];
}
export interface CompetitorReviewOutput {
  schemaVersion: "1.0.0";
  findings: CompetitorReviewFinding[];
  limitations: string[];
}

const citationFields: CompetitorCitationField[] = [
  "name",
  "sourceRef",
  "accessedAt",
  "strengths",
  "weaknesses",
  "positioning",
];
const categories = [
  "strength_gap",
  "weakness_opportunity",
  "positioning_overlap",
  "evidence_gap",
] as const;

export const competitorReviewJsonSchema = {
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
          "profileIds",
          "category",
          "summary",
          "implication",
          "citations",
        ],
        properties: {
          profileIds: {
            type: "array",
            minItems: 1,
            maxItems: 10,
            uniqueItems: true,
            items: { type: "string", minLength: 1, maxLength: 200 },
          },
          category: { type: "string", enum: categories },
          summary: { type: "string", minLength: 1, maxLength: 1000 },
          implication: { type: "string", minLength: 1, maxLength: 1000 },
          citations: {
            type: "array",
            minItems: 1,
            maxItems: 20,
            items: {
              type: "object",
              additionalProperties: false,
              required: ["profileId", "field", "quote"],
              properties: {
                profileId: { type: "string", minLength: 1, maxLength: 200 },
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

export function validateCompetitorReviewOutput(
  output: unknown,
  sources: CompetitorReviewSource[],
): CompetitorReviewOutput {
  if (!output || typeof output !== "object")
    throw new AppError("validation", "竞品审阅 Agent 输出必须是对象");
  const candidate = output as Partial<CompetitorReviewOutput>;
  if (
    candidate.schemaVersion !== "1.0.0" ||
    !Array.isArray(candidate.findings) ||
    candidate.findings.length > 30 ||
    !Array.isArray(candidate.limitations) ||
    candidate.limitations.length > 10
  )
    throw new AppError("validation", "竞品审阅 Agent 输出契约无效");
  const findings = candidate.findings.map((finding) => {
    const profileIds = Array.isArray(finding?.profileIds)
      ? [...new Set(finding.profileIds)]
      : [];
    if (
      !profileIds.length ||
      profileIds.length > 10 ||
      profileIds.length !== finding.profileIds.length ||
      profileIds.some((id) => !sources.some((source) => source.id === id)) ||
      !categories.includes(finding.category) ||
      !finding.summary?.trim() ||
      !finding.implication?.trim() ||
      !Array.isArray(finding.citations) ||
      !finding.citations.length ||
      finding.citations.length > 20
    )
      throw new AppError("validation", "竞品结论必须引用当前项目已保存竞品");
    const citedProfiles = new Set<string>();
    const citations = finding.citations.map((citation) => {
      const source = sources.find((item) => item.id === citation.profileId);
      if (
        !source ||
        !profileIds.includes(source.id) ||
        !citationFields.includes(citation.field) ||
        !citation.quote.trim() ||
        citation.quote !== String(source[citation.field])
      )
        throw new AppError(
          "validation",
          "竞品结论引用未精确命中当前项目竞品字段",
        );
      citedProfiles.add(source.id);
      return citation;
    });
    if (profileIds.some((id) => !citedProfiles.has(id)))
      throw new AppError("validation", "竞品结论中的每个竞品都必须提供证据");
    return {
      profileIds,
      category: finding.category,
      summary: finding.summary.trim(),
      implication: finding.implication.trim(),
      citations,
    };
  });
  if (
    candidate.limitations.some(
      (item) => typeof item !== "string" || !item.trim(),
    )
  )
    throw new AppError("validation", "竞品审阅限制条件无效");
  return {
    schemaVersion: "1.0.0",
    findings,
    limitations: candidate.limitations.map((item) => item.trim()),
  };
}
