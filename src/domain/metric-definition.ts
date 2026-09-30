import { z } from "zod"

import { AppError } from "@/domain/app-error"
import type { Dataset } from "@/domain/dataset-analysis"

export const METRIC_SCHEMA_VERSION = "1.0.0"
export const metricFormulaSchema = z.discriminatedUnion("operator", [
  z.object({ operator: z.literal("count"), field: z.string().min(1).max(100) }).strict(),
  z.object({ operator: z.enum(["sum", "mean"]), field: z.string().min(1).max(100) }).strict(),
  z.object({ operator: z.literal("conversion"), numeratorField: z.string().min(1).max(100), denominatorField: z.string().min(1).max(100) }).strict(),
])
export const metricDefinitionSchema = z.object({
  schemaVersion: z.literal(METRIC_SCHEMA_VERSION),
  id: z.string().min(1).max(200),
  name: z.string().trim().min(1).max(200),
  description: z.string().max(1_000),
  unit: z.string().max(50),
  formula: metricFormulaSchema,
  sourceDatasetId: z.string().min(1).max(200),
}).strict()
export type MetricDefinition = z.infer<typeof metricDefinitionSchema>
export interface MetricResult { metricId: string; value: number; numerator?: number; denominator?: number; includedRows: number; missingRows: number }

export function validateMetricDefinition(value: unknown): MetricDefinition {
  const result = metricDefinitionSchema.safeParse(value)
  if (!result.success) throw new AppError("validation", `指标定义无效：${result.error.issues[0]?.message ?? "未知错误"}`)
  return result.data
}

function numeric(value: unknown): value is number { return typeof value === "number" && Number.isFinite(value) }
export function calculateMetric(definition: MetricDefinition, dataset: Dataset): MetricResult {
  const field = definition.formula.operator === "conversion" ? undefined : definition.formula.field
  if (field && !dataset.columns.includes(field)) throw new AppError("validation", `指标字段不存在：${field}`)
  if (definition.formula.operator === "conversion" && (!dataset.columns.includes(definition.formula.numeratorField) || !dataset.columns.includes(definition.formula.denominatorField))) throw new AppError("validation", "转化率字段不存在")
  if (definition.formula.operator === "count") {
    const includedRows = dataset.rows.filter((row) => row[field!] !== null).length
    return { metricId: definition.id, value: includedRows, includedRows, missingRows: dataset.rows.length - includedRows }
  }
  if (definition.formula.operator === "sum" || definition.formula.operator === "mean") {
    const values = dataset.rows.map((row) => row[field!]).filter(numeric); const value = values.reduce((sum, item) => sum + item, 0)
    return { metricId: definition.id, value: definition.formula.operator === "mean" && values.length ? value / values.length : value, includedRows: values.length, missingRows: dataset.rows.length - values.length }
  }
  if (definition.formula.operator !== "conversion") throw new AppError("validation", "指标公式不完整")
  const { numeratorField, denominatorField } = definition.formula
  const denominator = dataset.rows.filter((row) => row[denominatorField] === true || row[denominatorField] === 1).length
  const numerator = dataset.rows.filter((row) => (row[denominatorField] === true || row[denominatorField] === 1) && (row[numeratorField] === true || row[numeratorField] === 1)).length
  return { metricId: definition.id, value: denominator ? numerator / denominator : 0, numerator, denominator, includedRows: denominator, missingRows: dataset.rows.length - denominator }
}
