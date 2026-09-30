import { z } from "zod"

import { AppError } from "@/domain/app-error"
import type { DocumentDiff } from "@/domain/document-diff"

export const DOCUMENT_DIFF_REVIEW_SCHEMA_VERSION = "1.0.0"

export const documentDiffReviewSchema = z.object({
  schemaVersion: z.literal(DOCUMENT_DIFF_REVIEW_SCHEMA_VERSION),
  verdict: z.enum(["safe", "needs_review", "high_risk"]),
  summary: z.string().trim().min(1).max(2_000),
  findings: z.array(z.object({
    severity: z.enum(["info", "warning", "critical"]),
    category: z.enum(["scope", "requirement", "acceptance_criteria", "consistency", "ux", "other"]),
    summary: z.string().trim().min(1).max(500),
    recommendation: z.string().trim().min(1).max(1_000),
    evidenceLineIndexes: z.array(z.number().int().min(0).max(1_999)).min(1).max(20),
  }).strict()).max(50),
}).strict()

export const documentDiffReviewJsonSchema = {
  type: "object", additionalProperties: false,
  required: ["schemaVersion", "verdict", "summary", "findings"],
  properties: {
    schemaVersion: { type: "string", const: DOCUMENT_DIFF_REVIEW_SCHEMA_VERSION },
    verdict: { type: "string", enum: ["safe", "needs_review", "high_risk"] },
    summary: { type: "string", minLength: 1, maxLength: 2_000 },
    findings: { type: "array", maxItems: 50, items: { type: "object", additionalProperties: false, required: ["severity", "category", "summary", "recommendation", "evidenceLineIndexes"], properties: {
      severity: { type: "string", enum: ["info", "warning", "critical"] }, category: { type: "string", enum: ["scope", "requirement", "acceptance_criteria", "consistency", "ux", "other"] }, summary: { type: "string", minLength: 1, maxLength: 500 }, recommendation: { type: "string", minLength: 1, maxLength: 1_000 }, evidenceLineIndexes: { type: "array", minItems: 1, maxItems: 20, uniqueItems: true, items: { type: "integer", minimum: 0, maximum: 1_999 } },
    } } },
  },
} as const

export type DocumentDiffReview = z.infer<typeof documentDiffReviewSchema>

export function validateDocumentDiffReview(output: unknown, diff: DocumentDiff): DocumentDiffReview {
  const parsed = documentDiffReviewSchema.safeParse(output)
  if (!parsed.success) throw new AppError("external_service", "文档差异审阅未通过固定 Schema 校验")
  for (const finding of parsed.data.findings) {
    const unique = new Set(finding.evidenceLineIndexes)
    if (unique.size !== finding.evidenceLineIndexes.length || finding.evidenceLineIndexes.some((index) => !diff.lines[index] || diff.lines[index].kind === "context")) {
      throw new AppError("external_service", "差异审阅引用了不存在或未变更的行，已拒绝显示")
    }
  }
  return parsed.data
}
