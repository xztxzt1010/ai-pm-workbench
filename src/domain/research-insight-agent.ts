import { AppError } from "@/domain/app-error"

export interface ResearchAgentSource { entryId: string; title: string; insight: string; sourceRef: string }
export interface ResearchAgentCitation { entryId: string; quote: string; sourceRef: string }
export interface ResearchAgentFinding { title: string; statement: string; citations: ResearchAgentCitation[] }
export interface ResearchAgentOutput { schemaVersion: "1.0.0"; findings: ResearchAgentFinding[]; limitations: string[] }

export const researchInsightAgentJsonSchema = { type: "object", additionalProperties: false, required: ["schemaVersion", "findings", "limitations"], properties: { schemaVersion: { const: "1.0.0" }, findings: { type: "array", maxItems: 20, items: { type: "object", additionalProperties: false, required: ["title", "statement", "citations"], properties: { title: { type: "string", minLength: 1, maxLength: 200 }, statement: { type: "string", minLength: 1, maxLength: 1000 }, citations: { type: "array", minItems: 1, maxItems: 10, items: { type: "object", additionalProperties: false, required: ["entryId", "quote", "sourceRef"], properties: { entryId: { type: "string", minLength: 1, maxLength: 200 }, quote: { type: "string", minLength: 1, maxLength: 1000 }, sourceRef: { type: "string", minLength: 1, maxLength: 2000 } } } } } } }, limitations: { type: "array", maxItems: 10, items: { type: "string", minLength: 1, maxLength: 300 } } } } as const

export function validateResearchAgentOutput(output: unknown, sources: ResearchAgentSource[]): ResearchAgentOutput {
  if (!output || typeof output !== "object") throw new AppError("validation", "研究 Agent 输出必须是对象")
  const candidate = output as Partial<ResearchAgentOutput>
  if (candidate.schemaVersion !== "1.0.0" || !Array.isArray(candidate.findings) || candidate.findings.length > 20 || !Array.isArray(candidate.limitations)) throw new AppError("validation", "研究 Agent 输出契约无效")
  const findings = candidate.findings.map((finding) => {
    if (!finding || typeof finding.title !== "string" || !finding.title.trim() || typeof finding.statement !== "string" || !finding.statement.trim() || !Array.isArray(finding.citations) || !finding.citations.length) throw new AppError("validation", "研究洞察必须包含陈述和证据")
    const citations = finding.citations.map((citation) => {
      const source = sources.find((item) => item.entryId === citation.entryId)
      if (!source || citation.sourceRef !== source.sourceRef || !citation.quote.trim() || !source.insight.includes(citation.quote)) throw new AppError("validation", "研究洞察引用未精确命中当前项目研究记录")
      return citation
    })
    return { title: finding.title, statement: finding.statement, citations }
  })
  if (candidate.limitations.some((item) => typeof item !== "string" || !item.trim())) throw new AppError("validation", "研究 Agent 限制条件无效")
  return { schemaVersion: "1.0.0", findings, limitations: candidate.limitations }
}
