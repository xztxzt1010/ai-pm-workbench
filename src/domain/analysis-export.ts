import type { AnalysisResult } from "@/domain/dataset-analysis"
import type { CohortPoint, FunnelStep, TrendPoint } from "@/domain/advanced-analysis"

export type ExportableAnalysis = AnalysisResult | FunnelStep[] | TrendPoint[] | CohortPoint[]

function escapeCell(value: unknown) { const text = String(value ?? ""); return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text }

export function analysisToCsv(operator: "summary" | "funnel" | "trend" | "cohort", result: ExportableAnalysis): string {
  let headers: string[]; let rows: unknown[][]
  if (operator === "summary") {
    const summary = result as AnalysisResult
    headers = ["kind", "field", "count", "missingCount", "mean", "min", "max", "value"]
    rows = [...summary.numeric.map((item) => ["numeric", item.field, item.count, item.missingCount, item.mean, item.min, item.max, ""]), ...summary.categorical.flatMap((item) => item.values.map((value) => ["categorical", item.field, value.count, "", "", "", "", value.value]))]
  } else if (operator === "funnel") { headers = ["field", "count", "rateFromPrevious"]; rows = (result as FunnelStep[]).map((item) => [item.field, item.count, item.rateFromPrevious])
  } else if (operator === "trend") { headers = ["period", "count", "value"]; rows = (result as TrendPoint[]).map((item) => [item.period, item.count, item.value])
  } else { headers = ["cohort", "count", "mean"]; rows = (result as CohortPoint[]).map((item) => [item.cohort, item.count, item.mean]) }
  return [headers, ...rows].map((row) => row.map(escapeCell).join(",")).join("\r\n") + "\r\n"
}
