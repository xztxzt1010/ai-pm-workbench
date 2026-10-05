import { AppError } from "@/domain/app-error"

export interface AnalysisExplanationEvidence { path: string; label: string; value: number }
export interface AnalysisExplanationFinding { title: string; explanation: string; evidence: AnalysisExplanationEvidence[] }
export interface AnalysisExplanation { schemaVersion: "1.0.0"; summary: string; findings: AnalysisExplanationFinding[]; limitations: string[] }

export const analysisExplanationJsonSchema = {
  type: "object",
  additionalProperties: false,
  required: ["schemaVersion", "summary", "findings", "limitations"],
  properties: {
    schemaVersion: { const: "1.0.0" },
    summary: { type: "string", minLength: 1, maxLength: 1_000 },
    findings: { type: "array", maxItems: 20, items: { type: "object", additionalProperties: false, required: ["title", "explanation", "evidence"], properties: { title: { type: "string", minLength: 1, maxLength: 200 }, explanation: { type: "string", minLength: 1, maxLength: 1_000 }, evidence: { type: "array", minItems: 1, maxItems: 10, items: { type: "object", additionalProperties: false, required: ["path", "label", "value"], properties: { path: { type: "string", pattern: "^\\$" }, label: { type: "string", minLength: 1, maxLength: 200 }, value: { type: "number" } } } } } } },
    limitations: { type: "array", maxItems: 10, items: { type: "string", minLength: 1, maxLength: 300 } },
  },
} as const

function readPath(result: unknown, path: string): unknown {
  if (!path.startsWith("$")) return undefined
  const tokens = path.slice(1).match(/^(?:\.[A-Za-z_$][\w$]*|\[\d+\])*/)?.[0]
  if (tokens === undefined || tokens.length !== path.length - 1) return undefined
  let current = result
  for (const token of tokens.match(/\.([A-Za-z_$][\w$]*)|\[(\d+)\]/g) ?? []) {
    const property = token.startsWith("[") ? Number(token.slice(1, -1)) : token.slice(1)
    if (current === null || current === undefined || (typeof property === "number" ? !Array.isArray(current) : typeof current !== "object")) return undefined
    current = (current as Record<string | number, unknown>)[property]
  }
  return current
}

function hasNumber(text: string) { return /\d/.test(text) }

export function validateAnalysisExplanation(output: unknown, result: unknown): AnalysisExplanation {
  if (!output || typeof output !== "object") throw new AppError("validation", "分析解释输出必须是对象")
  const candidate = output as Partial<AnalysisExplanation>
  if (candidate.schemaVersion !== "1.0.0" || typeof candidate.summary !== "string" || !candidate.summary.trim() || hasNumber(candidate.summary)) throw new AppError("validation", "分析解释摘要格式无效：数值必须放在证据字段")
  if (!Array.isArray(candidate.findings) || candidate.findings.length > 20 || !Array.isArray(candidate.limitations) || candidate.limitations.some((item) => typeof item !== "string" || !item.trim() || hasNumber(item))) throw new AppError("validation", "分析解释限制条件格式无效：数值必须放在证据字段")
  const findings = candidate.findings.map((item) => {
    if (!item || typeof item !== "object" || typeof item.title !== "string" || typeof item.explanation !== "string" || hasNumber(item.title) || hasNumber(item.explanation) || !Array.isArray(item.evidence) || !item.evidence.length) throw new AppError("validation", "分析解释必须通过带证据的无数值文本契约")
    const evidence = item.evidence.map((citation) => {
      if (!citation || typeof citation !== "object" || typeof citation.path !== "string" || typeof citation.label !== "string" || hasNumber(citation.label) || typeof citation.value !== "number" || !Number.isFinite(citation.value)) throw new AppError("validation", "分析解释证据格式无效")
      const actual = readPath(result, citation.path)
      if (typeof actual !== "number" || !Object.is(actual, citation.value)) throw new AppError("validation", `分析解释证据未命中真实结果：${citation.path}`)
      return citation
    })
    return { title: item.title, explanation: item.explanation, evidence }
  })
  return { schemaVersion: "1.0.0", summary: candidate.summary, findings, limitations: candidate.limitations }
}
