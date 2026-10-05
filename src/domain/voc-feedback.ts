import { AppError } from "@/domain/app-error"
import { parseDataset } from "@/domain/dataset-analysis"

export type VocSeverity = "low" | "medium" | "high" | "critical"
export type VocSourceType = "manual" | "interview" | "survey" | "support" | "import"
export interface VocFeedback { content: string; category: string; severity: VocSeverity; sourceType: VocSourceType; sourceRef: string; evidence: string; occurredAt: string; clusterKey: string }
export interface VocCluster { key: string; category: string; count: number; highestSeverity: VocSeverity; feedback: VocFeedback[] }
export interface VocTrendPoint { period: string; count: number; criticalCount: number }

const severities: VocSeverity[] = ["low", "medium", "high", "critical"]
const sources: VocSourceType[] = ["manual", "interview", "survey", "support", "import"]

function text(value: unknown, fallback = "") { return typeof value === "string" ? value.trim() : value === null || value === undefined ? fallback : String(value).trim() }
function clusterKey(category: string, content: string) { return `${category}:${content.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim().split(/\s+/).slice(0, 6).join(" ") || "empty"}` }

export function parseVocFeedback(raw: string, sourceType: "csv" | "json"): VocFeedback[] {
  const dataset = parseDataset(raw, sourceType)
  if (dataset.rows.length > 500) throw new AppError("validation", "单次最多导入 500 条 VOC 反馈")
  return dataset.rows.map((row, index) => {
    const content = text(row.content ?? row.feedback ?? row.text)
    if (!content || content.length > 5_000) throw new AppError("validation", `第 ${index + 1} 条反馈内容为空或超过 5,000 字符`)
    const category = text(row.category, "未分类") || "未分类"
    const severity = text(row.severity, "medium") as VocSeverity
    const source = text(row.sourceType ?? row.source, "import") as VocSourceType
    if (!severities.includes(severity)) throw new AppError("validation", `第 ${index + 1} 条反馈严重程度无效`)
    if (!sources.includes(source)) throw new AppError("validation", `第 ${index + 1} 条反馈来源无效`)
    const occurredAt = text(row.occurredAt ?? row.date, new Date(0).toISOString())
    const parsedDate = new Date(occurredAt)
    if (!Number.isFinite(parsedDate.getTime()) || (occurredAt !== parsedDate.toISOString() && !/^\d{4}-\d{2}-\d{2}/.test(occurredAt))) throw new AppError("validation", `第 ${index + 1} 条反馈日期无效`)
    return { content, category: category.slice(0, 100), severity, sourceType: source, sourceRef: text(row.sourceRef ?? row.sourceId).slice(0, 200), evidence: text(row.evidence ?? row.quote).slice(0, 2_000), occurredAt, clusterKey: clusterKey(category, content) }
  })
}

export function summarizeVocFeedback(items: VocFeedback[]) {
  const clusters = new Map<string, VocCluster>()
  for (const item of items) { const current = clusters.get(item.clusterKey); if (current) { current.count += 1; current.feedback.push(item); if (severities.indexOf(item.severity) > severities.indexOf(current.highestSeverity)) current.highestSeverity = item.severity } else clusters.set(item.clusterKey, { key: item.clusterKey, category: item.category, count: 1, highestSeverity: item.severity, feedback: [item] }) }
  return [...clusters.values()].sort((a, b) => b.count - a.count || severities.indexOf(b.highestSeverity) - severities.indexOf(a.highestSeverity) || a.key.localeCompare(b.key))
}

export function trendVocFeedback(items: VocFeedback[]): VocTrendPoint[] {
  const groups = new Map<string, VocTrendPoint>()
  for (const item of items) { const period = /^\d{4}-\d{2}/.test(item.occurredAt) ? item.occurredAt.slice(0, 7) : "unknown"; const current = groups.get(period) ?? { period, count: 0, criticalCount: 0 }; current.count += 1; if (item.severity === "critical") current.criticalCount += 1; groups.set(period, current) }
  return [...groups.values()].sort((a, b) => a.period.localeCompare(b.period))
}
