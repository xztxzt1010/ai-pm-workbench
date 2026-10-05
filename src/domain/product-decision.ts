import { AppError } from "@/domain/app-error"

export type ProductDecisionStatus = "proposed" | "confirmed" | "revisit" | "archived"
export interface ProductDecisionDraft { title: string; context: string; decision: string; alternatives: string[]; evidence: string[]; objections: string[]; impact: string; reviewDate: string }

function normalizeItems(items: string[], label: string) {
  const normalized = [...new Set(items.map((item) => item.trim()).filter(Boolean))]
  if (normalized.length > 50 || normalized.some((item) => item.length > 1_000)) throw new AppError("validation", `${label}最多 50 项且每项不能超过 1,000 字符`)
  return normalized
}

function validateRequiredText(value: string, label: string, maxLength: number) {
  const normalized = value.trim()
  if (!normalized) throw new AppError("validation", `请填写${label}`)
  if (normalized.length > maxLength) throw new AppError("validation", `${label}不能超过 ${maxLength.toLocaleString("zh-CN")} 字符`)
  return normalized
}

export function validateProductDecisionDraft(input: ProductDecisionDraft): ProductDecisionDraft {
  const title = validateRequiredText(input.title, "决策标题", 200)
  const context = validateRequiredText(input.context, "背景与问题", 5_000)
  const decision = validateRequiredText(input.decision, "决策结论", 5_000)
  const impact = validateRequiredText(input.impact, "影响与后续", 3_000)
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.reviewDate) || !Number.isFinite(new Date(`${input.reviewDate}T00:00:00Z`).getTime())) throw new AppError("validation", "复查日期无效")
  return { title, context, decision, alternatives: normalizeItems(input.alternatives, "备选方案"), evidence: normalizeItems(input.evidence, "证据"), objections: normalizeItems(input.objections, "异议"), impact, reviewDate: input.reviewDate }
}

export function nextProductDecisionStatus(current: ProductDecisionStatus, action: "confirm" | "revisit" | "archive"): ProductDecisionStatus {
  if (action === "archive" && current !== "archived") return "archived"
  if (action === "confirm" && (current === "proposed" || current === "revisit")) return "confirmed"
  if (action === "revisit" && current === "confirmed") return "revisit"
  throw new AppError("conflict", "当前决策状态不允许该操作")
}

export function decisionReviewState(reviewDate: string, today: string): "overdue" | "today" | "upcoming" {
  return reviewDate < today ? "overdue" : reviewDate === today ? "today" : "upcoming"
}
