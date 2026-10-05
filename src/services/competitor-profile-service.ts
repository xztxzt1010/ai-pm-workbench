import { invoke } from "@tauri-apps/api/core"
import { AppError } from "@/domain/app-error"
export interface CompetitorProfileRecord { id: string; projectId: string; name: string; sourceRef: string; accessedAt: string; strengths: string; weaknesses: string; positioning: string; createdAt: string; updatedAt: string }
function requireDesktop(value: boolean) { if (!value) throw new AppError("permission", "竞品档案仅在桌面应用中保存") }
export async function createCompetitorProfile(desktopRuntime: boolean, input: { id: string; projectId: string; name: string; sourceRef: string; accessedAt: string; strengths: string; weaknesses: string; positioning: string }): Promise<CompetitorProfileRecord> { requireDesktop(desktopRuntime); return invoke<CompetitorProfileRecord>("create_competitor_profile", { request: input }) }
export async function listCompetitorProfiles(desktopRuntime: boolean, projectId: string): Promise<CompetitorProfileRecord[]> { if (!desktopRuntime) return []; return invoke<CompetitorProfileRecord[]>("list_competitor_profiles", { projectId }) }
