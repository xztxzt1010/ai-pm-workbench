import { z } from "zod";

import { AppError } from "@/domain/app-error";
import type { ProjectMemorySearchResult } from "@/services/project-memory-service";

export const PROJECT_QA_SCHEMA_VERSION = "1.0.0";

export const projectQaOutputSchema = z.object({
  schemaVersion: z.literal(PROJECT_QA_SCHEMA_VERSION),
  answer: z.string().trim().min(1).max(6_000),
  citations: z
    .array(
      z.object({
        sourceType: z.enum([
          "memory",
          "project",
          "milestone",
          "confirmation",
          "risk",
          "dependency",
          "release",
          "research",
        ]),
        sourceId: z.string().trim().min(1).max(200),
        title: z.string().trim().min(1).max(200),
      }),
    )
    .max(8),
  uncertainty: z.string().trim().min(1).max(1_000),
});

export const projectQaOutputJsonSchema = {
  type: "object",
  additionalProperties: false,
  required: ["schemaVersion", "answer", "citations", "uncertainty"],
  properties: {
    schemaVersion: { type: "string", const: PROJECT_QA_SCHEMA_VERSION },
    answer: { type: "string", minLength: 1, maxLength: 6_000 },
    citations: {
      type: "array",
      maxItems: 8,
      items: {
        type: "object",
        additionalProperties: false,
        required: ["sourceType", "sourceId", "title"],
        properties: {
          sourceType: {
            type: "string",
            enum: [
              "memory",
              "project",
              "milestone",
              "confirmation",
              "risk",
              "dependency",
              "release",
              "research",
            ],
          },
          sourceId: { type: "string", minLength: 1, maxLength: 200 },
          title: { type: "string", minLength: 1, maxLength: 200 },
        },
      },
    },
    uncertainty: { type: "string", minLength: 1, maxLength: 1_000 },
  },
} as const;

export type ProjectQaOutput = z.infer<typeof projectQaOutputSchema>;

export interface ProjectQaEvidence {
  sourceType:
    | "memory"
    | "project"
    | "milestone"
    | "confirmation"
    | "risk"
    | "dependency"
    | "release"
    | "research";
  sourceId: string;
  title: string;
  content: string;
  sourceKind?: string;
  sourceIdDetail?: string;
}

const evidenceCaps: Record<ProjectQaEvidence["sourceType"], number> = {
  memory: 8,
  project: 1,
  milestone: 5,
  confirmation: 5,
  risk: 5,
  dependency: 5,
  release: 4,
  research: 5,
};

function questionTerms(question: string) {
  const normalized = question.trim().toLocaleLowerCase();
  const terms = new Set(
    normalized
      .split(/[\s,，。！？?、:：;；()（）]+/)
      .map((item) => item.trim())
      .filter((item) => item.length >= 2),
  );
  for (let index = 0; index < normalized.length - 1 && terms.size < 64; index += 1) {
    const pair = normalized.slice(index, index + 2);
    if (!/\s/.test(pair)) terms.add(pair);
  }
  return [...terms];
}

function relevanceScore(evidence: ProjectQaEvidence, terms: string[]) {
  const title = evidence.title.toLocaleLowerCase();
  const content = evidence.content.toLocaleLowerCase();
  return terms.reduce(
    (score, term) =>
      score + (title.includes(term) ? 4 : 0) + (content.includes(term) ? 1 : 0),
    0,
  );
}

export function selectProjectQaEvidence(
  evidence: ProjectQaEvidence[],
  question: string,
): ProjectQaEvidence[] {
  const terms = questionTerms(question);
  const seen = new Set<string>();
  const deduplicated = evidence.filter((item) => {
    const key = `${item.sourceType}:${item.sourceId}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
  const selected = (Object.keys(evidenceCaps) as ProjectQaEvidence["sourceType"][]).flatMap(
    (sourceType) =>
      deduplicated
        .map((item, index) => ({ item, index }))
        .filter(({ item }) => item.sourceType === sourceType)
        .sort(
          (left, right) =>
            relevanceScore(right.item, terms) -
              relevanceScore(left.item, terms) ||
            left.index - right.index,
        )
        .slice(0, evidenceCaps[sourceType])
        .map(({ item }) => item),
  );
  let contentCharacters = 0;
  return selected.filter((item) => {
    if (item.content.length > 20_000 || contentCharacters + item.content.length > 240_000)
      return false;
    contentCharacters += item.content.length;
    return true;
  });
}

export function validateProjectQaOutput(
  output: unknown,
  evidence: ProjectQaEvidence[] | ProjectMemorySearchResult[],
): ProjectQaOutput {
  const parsed = projectQaOutputSchema.safeParse(output);
  if (!parsed.success)
    throw new AppError(
      "external_service",
      "项目问答输出未通过固定 Schema 校验",
    );
  const normalizedEvidence: ProjectQaEvidence[] = evidence.map((item) =>
    "projectId" in item
      ? {
          sourceType: "memory",
          sourceId: item.id,
          title: item.title,
          content: item.content,
          sourceKind: item.sourceKind,
          sourceIdDetail: item.sourceId,
        }
      : item,
  );
  const byKey = new Map(
    normalizedEvidence.map((item) => [
      `${item.sourceType}:${item.sourceId}`,
      item,
    ]),
  );
  const seen = new Set<string>();
  for (const citation of parsed.data.citations) {
    const key = `${citation.sourceType}:${citation.sourceId}`;
    const source = byKey.get(key);
    if (!source || source.title !== citation.title || seen.has(key)) {
      throw new AppError(
        "external_service",
        "项目问答引用了未检索到的证据，已拒绝显示",
      );
    }
    seen.add(key);
  }
  if (evidence.length > 0 && parsed.data.citations.length === 0) {
    throw new AppError(
      "external_service",
      "项目问答未提供必要的证据引用，已拒绝显示",
    );
  }
  return parsed.data;
}
