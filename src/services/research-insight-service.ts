import { invoke } from "@tauri-apps/api/core"
import { AppError } from "@/domain/app-error"
import type { ResearchInsightStatus } from "@/domain/research-insight"
export interface ResearchInsightRecord { id: string; projectId: string; planId?: string | null; entryId: string; title: string; statement: string; evidenceJson: string; status: ResearchInsightStatus; createdAt: string; updatedAt: string }
function requireDesktop(value: boolean) { if (!value) throw new AppError("permission", "研究洞察仅在桌面应用中保存") }
export async function createResearchInsight(desktopRuntime: boolean, input: { id: string; projectId: string; planId?: string; entryId: string; title: string; statement: string; evidenceJson: string }): Promise<ResearchInsightRecord> { requireDesktop(desktopRuntime); return invoke<ResearchInsightRecord>("create_research_insight", { request: input }) }
export async function listResearchInsights(desktopRuntime: boolean, projectId: string): Promise<ResearchInsightRecord[]> { if (!desktopRuntime) return []; return invoke<ResearchInsightRecord[]>("list_research_insights", { projectId }) }
export async function reviewResearchInsight(desktopRuntime: boolean, projectId: string, insightId: string, status: "accepted" | "rejected") { requireDesktop(desktopRuntime); await invoke("review_research_insight", { projectId, insightId, status }) }
