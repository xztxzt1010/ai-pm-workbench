import { z } from "zod"

import { AppError } from "@/domain/app-error"

export const PRD_DRAFT_SCHEMA_VERSION = "1.0.0"

export const prdDraftOutputSchema = z.object({
  schemaVersion: z.literal(PRD_DRAFT_SCHEMA_VERSION),
  title: z.string().trim().min(1).max(200),
  contentMarkdown: z.string().trim().min(1).max(200_000),
  citations: z.array(z.object({
    requirementId: z.string().trim().min(1).max(200),
    versionId: z.string().trim().min(1).max(200),
    title: z.string().trim().min(1).max(200),
  })).min(1).max(50),
})

export const prdDraftOutputJsonSchema = {
  type: "object",
  additionalProperties: false,
  required: ["schemaVersion", "title", "contentMarkdown", "citations"],
  properties: {
    schemaVersion: { type: "string", const: PRD_DRAFT_SCHEMA_VERSION },
    title: { type: "string", minLength: 1, maxLength: 200 },
    contentMarkdown: { type: "string", minLength: 1, maxLength: 200_000 },
    citations: { type: "array", minItems: 1, maxItems: 50, items: { type: "object", additionalProperties: false, required: ["requirementId", "versionId", "title"], properties: { requirementId: { type: "string", minLength: 1, maxLength: 200 }, versionId: { type: "string", minLength: 1, maxLength: 200 }, title: { type: "string", minLength: 1, maxLength: 200 } } } },
  },
} as const

export interface PrdRequirementEvidence {
  requirementId: string
  versionId: string
  title: string
  description: string
  targetUsers: string
  scenario: string
  painPoint: string
  acceptanceCriteria: string[]
}

export type PrdDraftOutput = z.infer<typeof prdDraftOutputSchema>

export function validatePrdDraftOutput(output: unknown, requirements: PrdRequirementEvidence[]): PrdDraftOutput {
  const parsed = prdDraftOutputSchema.safeParse(output)
  if (!parsed.success) throw new AppError("external_service", "PRD Agent 输出未通过固定 Schema 校验")
  const byKey = new Map(requirements.map((item) => [`${item.requirementId}:${item.versionId}`, item]))
  const seen = new Set<string>()
  for (const citation of parsed.data.citations) {
    const key = `${citation.requirementId}:${citation.versionId}`
    const requirement = byKey.get(key)
    if (!requirement || requirement.title !== citation.title || seen.has(key)) throw new AppError("external_service", "PRD 草稿引用了未确认或不存在的需求，已拒绝显示")
    seen.add(key)
  }
  return parsed.data
}
