export const dependencyTypes = ["internal", "external", "technical", "approval"] as const
export const dependencyStatuses = ["pending", "blocked", "ready", "resolved"] as const
export type DependencyType = typeof dependencyTypes[number]
export type DependencyStatus = typeof dependencyStatuses[number]
export interface ProjectDependencyDraft { title: string; description: string; dependencyType: DependencyType; owner: string; dueDate: string; resolution: string }
export function validateProjectDependencyDraft(input: ProjectDependencyDraft): ProjectDependencyDraft { const value = { ...input, title: input.title.trim(), description: input.description.trim(), owner: input.owner.trim(), dueDate: input.dueDate.trim(), resolution: input.resolution.trim() }; if (!value.title || value.title.length > 200 || value.description.length > 5000 || value.owner.length > 200 || value.resolution.length > 5000 || !dependencyTypes.includes(value.dependencyType) || !/^\d{4}-\d{2}-\d{2}$/.test(value.dueDate)) throw new Error("依赖字段无效"); return value }
export function dependencyDueState(date: string, today: string): "overdue" | "today" | "upcoming" { return date < today ? "overdue" : date === today ? "today" : "upcoming" }
