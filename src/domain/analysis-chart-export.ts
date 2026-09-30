import type { AnalysisResult } from "@/domain/dataset-analysis"
import type { CohortPoint, FunnelStep, TrendPoint } from "@/domain/advanced-analysis"

type ChartResult = AnalysisResult | FunnelStep[] | TrendPoint[] | CohortPoint[]

const SVG_FONT_STACK = "Segoe UI, Microsoft YaHei, Noto Sans CJK SC, sans-serif"

function normalizeXmlText(value: unknown) {
  return Array.from(String(value ?? ""), (character) => {
    const codePoint = character.codePointAt(0) ?? 0
    return codePoint === 0x9 || codePoint === 0xa || codePoint === 0xd || (codePoint >= 0x20 && codePoint <= 0xd7ff) || (codePoint >= 0xe000 && codePoint <= 0xfffd) || (codePoint >= 0x10000 && codePoint <= 0x10ffff) ? character : "�"
  }).join("")
}

function escapeXml(value: unknown) {
  return normalizeXmlText(value).replace(/[&<>"']/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&apos;" })[character] ?? character)
}

function truncateText(value: unknown, maximumCodePoints: number) {
  const characters = Array.from(normalizeXmlText(value))
  return characters.length <= maximumCodePoints ? characters.join("") : `${characters.slice(0, maximumCodePoints - 1).join("")}…`
}

function finiteNumber(value: number) { return Number.isFinite(value) ? (Object.is(value, -0) ? 0 : value) : 0 }

function formatNumber(value: number) { return finiteNumber(value).toLocaleString("en-US", { maximumFractionDigits: 4 }) }

function chartEntries(operator: "summary" | "funnel" | "trend" | "cohort", result: ChartResult): Array<{ label: string; value: number; detail: string }> {
  if (operator === "summary") {
    const summary = result as AnalysisResult
    return [...summary.numeric.map((item) => ({ label: item.field, value: item.mean, detail: `mean ${formatNumber(item.mean)}` })), ...summary.categorical.flatMap((item) => item.values.slice(0, 5).map((value) => ({ label: `${item.field}: ${value.value}`, value: value.count, detail: `count ${formatNumber(value.count)}` })))]
  }
  if (operator === "funnel") return (result as FunnelStep[]).map((item) => ({ label: item.field, value: item.count, detail: `${formatNumber(item.count)} · ${(item.rateFromPrevious * 100).toFixed(1)}%` }))
  if (operator === "trend") return (result as TrendPoint[]).map((item) => ({ label: item.period, value: item.value, detail: `${formatNumber(item.value)} · ${formatNumber(item.count)} rows` }))
  return (result as CohortPoint[]).map((item) => ({ label: item.cohort, value: item.mean, detail: `mean ${formatNumber(item.mean)} · ${formatNumber(item.count)} rows` }))
}

export function analysisToSvg(operator: "summary" | "funnel" | "trend" | "cohort", result: ChartResult, title = "Analysis") {
  const entries = chartEntries(operator, result).slice(0, 40).map((entry) => ({ ...entry, value: finiteNumber(entry.value) }))
  const width = 960; const height = Math.max(280, 150 + entries.length * 32); const left = 270; const right = 170; const barWidth = width - left - right; const max = Math.max(1, ...entries.map((entry) => Math.abs(entry.value)))
  const bars = entries.map((entry, index) => {
    const y = 100 + index * 32
    const widthValue = Math.max(0, Math.min(barWidth, Math.abs(entry.value) / max * barWidth))
    const accessibleLabel = `${truncateText(entry.label, 160)}: ${truncateText(entry.detail, 80)}`
    return `<g role="group"><title>${escapeXml(accessibleLabel)}</title><text x="16" y="${y + 17}" font-size="12" fill="#334155">${escapeXml(truncateText(entry.label, 34))}</text><rect x="${left}" y="${y + 4}" width="${widthValue.toFixed(2)}" height="18" rx="4" fill="#2563eb"/><text x="${width - 16}" y="${y + 17}" font-size="11" text-anchor="end" fill="#0f172a">${escapeXml(truncateText(entry.detail, 24))}</text></g>`
  }).join("")
  return `<?xml version="1.0" encoding="UTF-8"?><svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" role="img" aria-labelledby="chart-title chart-desc" font-family="${SVG_FONT_STACK}"><title id="chart-title">${escapeXml(truncateText(title, 160))}</title><desc id="chart-desc">Deterministic ${escapeXml(operator)} chart exported from calculated analysis results.</desc><rect width="100%" height="100%" fill="#ffffff"/><text x="16" y="32" font-size="20" font-weight="600" fill="#0f172a">${escapeXml(truncateText(title, 64))}</text><text x="16" y="56" font-size="12" fill="#64748b">${escapeXml(operator)} · deterministic result</text>${bars || `<text x="16" y="110" font-size="13" fill="#64748b">No data</text>`}</svg>`
}
