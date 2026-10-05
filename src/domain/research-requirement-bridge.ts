import type { RequirementEvidence } from "@/domain/models"

export function researchRequirementEvidence(entryId: string, quote: string): RequirementEvidence {
  const id = entryId.trim(); const text = quote.trim()
  if (!id || !text) throw new Error("研究来源证据不能为空")
  return { paragraphId: `research:${id}`, sourceType: "research_entry", sourceId: id, quote: text, startOffset: 0, endOffset: text.length }
}
