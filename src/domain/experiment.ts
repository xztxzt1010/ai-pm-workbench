import { z } from "zod"

import { AppError } from "@/domain/app-error"

export const EXPERIMENT_SCHEMA_VERSION = "1.0.0"
export const experimentSchema = z.object({
  schemaVersion: z.literal(EXPERIMENT_SCHEMA_VERSION),
  id: z.string().min(1).max(200),
  projectId: z.string().min(1).max(200),
  name: z.string().trim().min(1).max(200),
  hypothesis: z.string().trim().min(1).max(2_000),
  primaryMetric: z.string().trim().min(1).max(200),
  samplePlan: z.string().trim().min(1).max(2_000),
  startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  endDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  status: z.enum(["draft", "running", "completed", "cancelled"]),
  conclusion: z.string().max(2_000),
  decision: z.string().max(2_000),
}).strict()
export type Experiment = z.infer<typeof experimentSchema>

export const experimentResultSchema = z.object({
  schemaVersion: z.literal(EXPERIMENT_SCHEMA_VERSION),
  experimentId: z.string().min(1).max(200),
  control: z.object({ name: z.string().min(1).max(100), successes: z.number().int().min(0), trials: z.number().int().positive() }).strict(),
  treatment: z.object({ name: z.string().min(1).max(100), successes: z.number().int().min(0), trials: z.number().int().positive() }).strict(),
  importedAt: z.string().datetime(),
}).strict()
export type ExperimentResult = z.infer<typeof experimentResultSchema>
export interface ExperimentAnalysis { controlRate: number; treatmentRate: number; absoluteLift: number; relativeLift: number; zScore: number; significance: "insufficient_sample" | "not_significant" | "directional" | "significant"; explanation: string }

export function validateExperiment(value: unknown): Experiment {
  const result = experimentSchema.safeParse(value)
  if (!result.success) throw new AppError("validation", `实验定义无效：${result.error.issues[0]?.message ?? "未知错误"}`)
  if (result.data.endDate < result.data.startDate) throw new AppError("validation", "实验结束日期不能早于开始日期")
  return result.data
}

export function validateExperimentResult(value: unknown): ExperimentResult {
  const result = experimentResultSchema.safeParse(value)
  if (!result.success) throw new AppError("validation", "实验结果未通过 Schema 校验")
  if (result.data.control.successes > result.data.control.trials || result.data.treatment.successes > result.data.treatment.trials) throw new AppError("validation", "成功数不能超过样本数")
  return result.data
}

export function analyzeExperiment(result: ExperimentResult): ExperimentAnalysis {
  const controlRate = result.control.successes / result.control.trials; const treatmentRate = result.treatment.successes / result.treatment.trials; const absoluteLift = treatmentRate - controlRate; const relativeLift = controlRate ? absoluteLift / controlRate : 0
  const pooled = (result.control.successes + result.treatment.successes) / (result.control.trials + result.treatment.trials)
  const standardError = Math.sqrt(pooled * (1 - pooled) * (1 / result.control.trials + 1 / result.treatment.trials))
  const zScore = standardError ? absoluteLift / standardError : 0
  const minimum = Math.min(result.control.trials, result.treatment.trials)
  const significance = minimum < 30 ? "insufficient_sample" : Math.abs(zScore) >= 1.96 ? "significant" : Math.abs(zScore) >= 1 ? "directional" : "not_significant"
  const explanation = significance === "insufficient_sample" ? "两组最小样本量小于 30，结果只能作为探索性信号。" : significance === "significant" ? "按双侧近似 z 检验，|z| ≥ 1.96；仍需结合业务风险和实验设计做最终决策。" : significance === "directional" ? "结果有方向性信号，但未达到约定显著性阈值。" : "未观察到达到约定阈值的差异，不能据此宣称方案优胜。"
  return { controlRate, treatmentRate, absoluteLift, relativeLift, zScore, significance, explanation }
}
