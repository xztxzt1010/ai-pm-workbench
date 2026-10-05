import { AppError } from "@/domain/app-error"
import type { Dataset } from "@/domain/dataset-analysis"

export interface FunnelStep { field: string; count: number; rateFromPrevious: number }
export interface TrendPoint { period: string; count: number; value: number }
export interface CohortPoint { cohort: string; count: number; mean: number }

function included(value: unknown) { return value === true || value === 1 || value === "true" || value === "1" }
function requireFields(dataset: Dataset, fields: string[]) { for (const field of fields) if (!dataset.columns.includes(field)) throw new AppError("validation", `分析字段不存在：${field}`) }

export function runFunnel(dataset: Dataset, fields: string[]): FunnelStep[] {
  if (fields.length < 2 || fields.length > 10 || new Set(fields).size !== fields.length) throw new AppError("validation", "漏斗至少需要 2 个且不重复的步骤")
  requireFields(dataset, fields)
  let previous = dataset.rows.length
  return fields.map((field) => { const count = dataset.rows.filter((row) => included(row[field])).length; const step = { field, count, rateFromPrevious: previous ? count / previous : 0 }; previous = Math.min(previous, count); return step })
}

export function runTrend(dataset: Dataset, dateField: string, valueField?: string): TrendPoint[] {
  requireFields(dataset, [dateField, ...(valueField ? [valueField] : [])])
  const groups = new Map<string, { count: number; sum: number }>()
  for (const row of dataset.rows) {
    const raw = row[dateField]; if (typeof raw !== "string" || !raw.trim()) continue
    const period = raw.slice(0, 10); const group = groups.get(period) ?? { count: 0, sum: 0 }; group.count += 1
    if (valueField && typeof row[valueField] === "number" && Number.isFinite(row[valueField])) group.sum += row[valueField]
    groups.set(period, group)
  }
  return [...groups.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([period, group]) => ({ period, count: group.count, value: valueField ? group.sum : group.count }))
}

export function runCohort(dataset: Dataset, cohortField: string, valueField: string): CohortPoint[] {
  requireFields(dataset, [cohortField, valueField])
  const groups = new Map<string, number[]>()
  for (const row of dataset.rows) { const cohort = row[cohortField]; const value = row[valueField]; if (cohort === null || typeof value !== "number" || !Number.isFinite(value)) continue; const key = String(cohort); groups.set(key, [...(groups.get(key) ?? []), value]) }
  return [...groups.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([cohort, values]) => ({ cohort, count: values.length, mean: values.reduce((sum, value) => sum + value, 0) / values.length }))
}
