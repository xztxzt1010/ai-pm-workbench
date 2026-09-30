import { invoke } from "@tauri-apps/api/core"
import { AppError } from "@/domain/app-error"
import type { DependencyStatus, DependencyType } from "@/domain/project-dependency"
export interface ProjectDependencyRecord { id: string; projectId: string; title: string; description: string; dependencyType: DependencyType; owner: string; dueDate: string; status: DependencyStatus; resolution: string; createdAt: string; updatedAt: string }
function requireDesktop(value: boolean) { if (!value) throw new AppError("permission", "依赖管理仅在桌面应用中保存") }
export async function createProjectDependency(desktopRuntime: boolean, input: { id: string; projectId: string; title: string; description: string; dependencyType: DependencyType; owner: string; dueDate: string; resolution: string }): Promise<ProjectDependencyRecord> { requireDesktop(desktopRuntime); return invoke<ProjectDependencyRecord>("create_project_dependency", { request: input }) }
export async function listProjectDependencies(desktopRuntime: boolean, projectId: string): Promise<ProjectDependencyRecord[]> { if (!desktopRuntime) return []; return invoke<ProjectDependencyRecord[]>("list_project_dependencies", { projectId }) }
export async function updateProjectDependencyStatus(desktopRuntime: boolean, projectId: string, dependencyId: string, status: DependencyStatus) { requireDesktop(desktopRuntime); await invoke("update_project_dependency_status", { projectId, dependencyId, status }) }
