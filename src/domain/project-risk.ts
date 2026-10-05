export const riskSeverities = ["low", "medium", "high", "critical"] as const
export const riskProbabilities = ["unlikely", "possible", "likely"] as const
export const riskStatuses = ["open", "mitigated", "accepted", "closed"] as const
export type RiskSeverity = typeof riskSeverities[number]
export type RiskProbability = typeof riskProbabilities[number]
export type RiskStatus = typeof riskStatuses[number]

export interface ProjectRiskDraft { title: string; description: string; severity: RiskSeverity; probability: RiskProbability; owner: string; dueDate: string; mitigation: string }

export function validateProjectRiskDraft(input: ProjectRiskDraft): ProjectRiskDraft {
  const value = { ...input, title: input.title.trim(), description: input.description.trim(), owner: input.owner.trim(), dueDate: input.dueDate.trim(), mitigation: input.mitigation.trim() }
  if (!value.title || value.title.length > 200 || value.description.length > 5000 || value.owner.length > 200 || value.mitigation.length > 5000) throw new Error("风险字段长度或必填项无效")
  if (!riskSeverities.includes(value.severity) || !riskProbabilities.includes(value.probability) || !/^\d{4}-\d{2}-\d{2}$/.test(value.dueDate)) throw new Error("风险等级、概率或截止日期无效")
  return value
}

export function riskReviewState(dueDate: string, today: string): "overdue" | "today" | "upcoming" { return dueDate < today ? "overdue" : dueDate === today ? "today" : "upcoming" }
