import { invoke } from "@tauri-apps/api/core"

import { AppError } from "@/domain/app-error"

export type ProjectMemoryType = "formal_fact" | "confirmed_memory" | "pending_candidate" | "inference" | "temporary_context"
export type ProjectMemoryStatus = "pending" | "confirmed" | "rejected" | "expired" | "archived"
export type ProjectMemorySourceKind = "project" | "meeting" | "requirement" | "manual" | "agent"

interface ProjectMemorySearchRow {
  id: string
  projectId: string
  memoryType: ProjectMemoryType
  status: ProjectMemoryStatus
  title: string
  content: string
  sourceKind: ProjectMemorySourceKind
  sourceId?: string
  sourceLocatorJson: string
  validFrom?: string
  validUntil?: string
  conflictGroup?: string
  confidence?: number
  createdBy: "user" | "agent" | "system"
  updatedAt: string
}

export interface ProjectMemorySearchResult extends Omit<ProjectMemorySearchRow, "sourceLocatorJson"> {
  sourceLocator: Record<string, unknown>
}

export interface CreateProjectMemoryCandidateInput {
  id: string
  projectId: string
  title: string
  content: string
  memoryType?: Extract<ProjectMemoryType, "pending_candidate" | "inference" | "temporary_context">
  sourceKind?: ProjectMemorySourceKind
  sourceId?: string
  sourceLocator?: Record<string, unknown>
  confidence?: number
  createdBy?: "user" | "agent"
}

export type ProjectMemoryReviewAction = "confirm" | "reject" | "expire" | "archive"

interface ProjectMemorySourceRow {
  id: string
  sourceKind: ProjectMemorySourceKind
  sourceId?: string
  locatorJson: string
  quote?: string
  createdAt: string
}

export interface ProjectMemorySource extends Omit<ProjectMemorySourceRow, "locatorJson"> {
  locator: Record<string, unknown>
}

export type ProjectMemoryRelationType = "conflicts" | "supersedes"

export interface ProjectMemoryConflict {
  memoryId: string
  conflictsWithMemoryId: string
  relationType: ProjectMemoryRelationType
  direction: "outgoing" | "incoming"
  relatedMemoryId: string
  relatedTitle: string
  relatedStatus: ProjectMemoryStatus
  createdAt: string
}

function parseLocator(value: string): Record<string, unknown> {
  try {
    const parsed: unknown = JSON.parse(value)
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed as Record<string, unknown> : {}
  } catch {
    return {}
  }
}

function parseRow({ sourceLocatorJson, ...row }: ProjectMemorySearchRow): ProjectMemorySearchResult {
  return { ...row, sourceLocator: parseLocator(sourceLocatorJson) }
}

export async function createProjectMemoryCandidate(desktopRuntime: boolean, input: CreateProjectMemoryCandidateInput): Promise<ProjectMemorySearchResult> {
  if (!desktopRuntime) throw new AppError("permission", "项目记忆仅在桌面应用中保存")
  const row = await invoke<ProjectMemorySearchRow>("create_project_memory_candidate", {
    request: {
      ...input,
      memoryType: input.memoryType ?? "pending_candidate",
      sourceKind: input.sourceKind ?? "manual",
      sourceLocatorJson: JSON.stringify(input.sourceLocator ?? {}),
      createdBy: input.createdBy ?? "user",
    },
  })
  return parseRow(row)
}

export async function reviewProjectMemoryCandidate(desktopRuntime: boolean, memoryId: string, action: ProjectMemoryReviewAction): Promise<void> {
  if (!desktopRuntime) throw new AppError("permission", "项目记忆仅在桌面应用中审核")
  await invoke("review_project_memory_candidate", { memoryId, action })
}

export async function listProjectMemories(desktopRuntime: boolean, projectId: string, status?: ProjectMemoryStatus, limit = 20): Promise<ProjectMemorySearchResult[]> {
  if (!desktopRuntime) return []
  const rows = await invoke<ProjectMemorySearchRow[]>("list_project_memories", { projectId, status, limit })
  return rows.map(parseRow)
}

export async function listProjectMemorySources(desktopRuntime: boolean, projectId: string, memoryId: string): Promise<ProjectMemorySource[]> {
  if (!desktopRuntime) return []
  const rows = await invoke<ProjectMemorySourceRow[]>("list_project_memory_sources", { projectId, memoryId })
  return rows.map(({ locatorJson, ...row }) => ({ ...row, locator: parseLocator(locatorJson) }))
}

export async function createProjectMemoryConflict(desktopRuntime: boolean, projectId: string, memoryId: string, relatedMemoryId: string, relationType: ProjectMemoryRelationType): Promise<void> {
  if (!desktopRuntime) throw new AppError("permission", "项目记忆关系仅在桌面应用中保存")
  await invoke("create_project_memory_conflict", { projectId, memoryId, relatedMemoryId, relationType })
}

export async function deleteProjectMemoryConflict(desktopRuntime: boolean, projectId: string, memoryId: string, relatedMemoryId: string, relationType: ProjectMemoryRelationType): Promise<void> {
  if (!desktopRuntime) throw new AppError("permission", "项目记忆关系仅在桌面应用中解除")
  await invoke("delete_project_memory_conflict", { projectId, memoryId, relatedMemoryId, relationType })
}

export async function listProjectMemoryConflicts(desktopRuntime: boolean, projectId: string, memoryId: string): Promise<ProjectMemoryConflict[]> {
  if (!desktopRuntime) return []
  return invoke<ProjectMemoryConflict[]>("list_project_memory_conflicts", { projectId, memoryId })
}

export async function searchProjectMemories(desktopRuntime: boolean, projectId: string, query: string, status?: ProjectMemoryStatus, limit = 20): Promise<ProjectMemorySearchResult[]> {
  if (!desktopRuntime) return []
  const rows = await invoke<ProjectMemorySearchRow[]>("search_project_memories", { projectId, query, status, limit })
  return rows.map(parseRow)
}

export async function rebuildProjectMemoryIndex(desktopRuntime: boolean): Promise<void> {
  if (!desktopRuntime) return
  await invoke("rebuild_project_memory_index")
}
