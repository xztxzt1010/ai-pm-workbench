import { invoke } from "@tauri-apps/api/core"
import { AppError } from "@/domain/app-error"
import type { ReleaseStatus } from "@/domain/release"
export interface ReleaseRecord { id: string; projectId: string; title: string; scopeJson: string; checklistJson: string; rollbackPlan: string; result: string; retrospective: string; followUpJson: string; status: ReleaseStatus; targetDate: string; createdAt: string; updatedAt: string }
function requireDesktop(value: boolean) { if (!value) throw new AppError("permission", "发布复盘仅在桌面应用中保存") }
export async function createRelease(desktopRuntime: boolean, input: { id: string; projectId: string; title: string; scopeJson: string; checklistJson: string; rollbackPlan: string; result: string; retrospective: string; followUpJson: string; targetDate: string }): Promise<ReleaseRecord> { requireDesktop(desktopRuntime); return invoke<ReleaseRecord>("create_release", { request: input }) }
export async function listReleases(desktopRuntime: boolean, projectId: string): Promise<ReleaseRecord[]> { if (!desktopRuntime) return []; return invoke<ReleaseRecord[]>("list_releases", { projectId }) }
export async function updateReleaseStatus(desktopRuntime: boolean, projectId: string, releaseId: string, status: ReleaseStatus) { requireDesktop(desktopRuntime); await invoke("update_release_status", { projectId, releaseId, status }) }
