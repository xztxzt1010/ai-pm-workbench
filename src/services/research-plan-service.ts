import { invoke } from "@tauri-apps/api/core"
import { AppError } from "@/domain/app-error"
import type { ResearchPlanStatus } from "@/domain/research-plan"
export interface ResearchPlanRecord { id: string; projectId: string; title: string; objective: string; targetPersona: string; questionsJson: string; status: ResearchPlanStatus; startDate: string; endDate: string; createdAt: string; updatedAt: string }
function requireDesktop(value: boolean) { if (!value) throw new AppError("permission", "研究计划仅在桌面应用中保存") }
export async function createResearchPlan(desktopRuntime: boolean, input: { id: string; projectId: string; title: string; objective: string; targetPersona: string; questionsJson: string; startDate: string; endDate: string }): Promise<ResearchPlanRecord> { requireDesktop(desktopRuntime); return invoke<ResearchPlanRecord>("create_research_plan", { request: input }) }
export async function listResearchPlans(desktopRuntime: boolean, projectId: string): Promise<ResearchPlanRecord[]> { if (!desktopRuntime) return []; return invoke<ResearchPlanRecord[]>("list_research_plans", { projectId }) }
export async function updateResearchPlanStatus(desktopRuntime: boolean, projectId: string, planId: string, status: ResearchPlanStatus) { requireDesktop(desktopRuntime); await invoke("update_research_plan_status", { projectId, planId, status }) }
