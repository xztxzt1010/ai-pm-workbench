import type { ConfirmationItem, Project } from "@/domain/models"

export type ProjectVisibility = "active" | "archived" | "all"

export type ProjectDraftValidation = { valid: true } | { valid: false; message: string }

export function parseProjectList(value?: string) {
  return [...new Set((value ?? "").split(/\r?\n|[,，]/).map((item) => item.trim()).filter(Boolean))]
}

export function serializeProjectList(items: string[]) {
  return parseProjectList(items.join("\n")).join("\n")
}

export function validateProjectDraft(input: { name: string; goal: string; startDate: string; endDate: string; progress: number }): ProjectDraftValidation {
  if (!input.name.trim()) return { valid: false, message: "项目名称不能为空" }
  if (!input.goal.trim()) return { valid: false, message: "项目目标不能为空" }
  if (!input.startDate || !input.endDate) return { valid: false, message: "请填写项目起止日期" }
  if (input.endDate < input.startDate) return { valid: false, message: "结束日期不能早于开始日期" }
  if (!Number.isFinite(input.progress) || input.progress < 0 || input.progress > 100) return { valid: false, message: "项目进度必须在 0 到 100 之间" }
  return { valid: true }
}

export function filterProjectsByVisibility(projects: Project[], visibility: ProjectVisibility) {
  return projects.filter((project) => (
    visibility === "all" || (visibility === "archived" ? Boolean(project.archivedAt) : !project.archivedAt)
  ))
}

export function activeProjectIds(projects: Project[]) {
  return new Set(projects.filter((project) => !project.archivedAt).map((project) => project.id))
}

export function confirmationItemsForActiveProjects(items: ConfirmationItem[], projects: Project[]) {
  const projectIds = activeProjectIds(projects)
  return items.filter((item) => projectIds.has(item.projectId))
}
