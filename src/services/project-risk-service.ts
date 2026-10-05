import { invoke } from "@tauri-apps/api/core"
import { AppError } from "@/domain/app-error"
import type { RiskProbability, RiskSeverity, RiskStatus } from "@/domain/project-risk"

export interface ProjectRiskRecord { id: string; projectId: string; title: string; description: string; severity: RiskSeverity; probability: RiskProbability; status: RiskStatus; owner: string; dueDate: string; mitigation: string; createdAt: string; updatedAt: string }
function requireDesktop(desktopRuntime: boolean) { if (!desktopRuntime) throw new AppError("permission", "风险管理仅在桌面应用中保存") }
export async function createProjectRisk(desktopRuntime: boolean, input: { id: string; projectId: string; title: string; description: string; severity: RiskSeverity; probability: RiskProbability; owner: string; dueDate: string; mitigation: string }): Promise<ProjectRiskRecord> { requireDesktop(desktopRuntime); return invoke<ProjectRiskRecord>("create_project_risk", { request: input }) }
export async function listProjectRisks(desktopRuntime: boolean, projectId: string): Promise<ProjectRiskRecord[]> { if (!desktopRuntime) return []; return invoke<ProjectRiskRecord[]>("list_project_risks", { projectId }) }
export async function updateProjectRiskStatus(desktopRuntime: boolean, projectId: string, riskId: string, status: RiskStatus) { requireDesktop(desktopRuntime); await invoke("update_project_risk_status", { projectId, riskId, status }) }
