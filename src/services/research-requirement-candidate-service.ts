import { invoke } from "@tauri-apps/api/core"
import { AppError } from "@/domain/app-error"
export interface ResearchRequirementCandidateRecord { id: string; projectId: string; insightId: string; title: string; description: string; status: "draft" | "accepted" | "rejected"; requirementCardId?: string | null; createdAt: string; updatedAt: string }
function requireDesktop(value: boolean) { if (!value) throw new AppError("permission", "研究需求候选仅在桌面应用中保存") }
export async function createResearchRequirementCandidate(desktopRuntime: boolean, input: { id: string; projectId: string; insightId: string; title: string; description: string }): Promise<ResearchRequirementCandidateRecord> { requireDesktop(desktopRuntime); return invoke<ResearchRequirementCandidateRecord>("create_research_requirement_candidate", { request: input }) }
export async function listResearchRequirementCandidates(desktopRuntime: boolean, projectId: string): Promise<ResearchRequirementCandidateRecord[]> { if (!desktopRuntime) return []; return invoke<ResearchRequirementCandidateRecord[]>("list_research_requirement_candidates", { projectId }) }
export async function reviewResearchRequirementCandidate(desktopRuntime: boolean, projectId: string, candidateId: string, status: "accepted" | "rejected") { requireDesktop(desktopRuntime); await invoke("review_research_requirement_candidate", { projectId, candidateId, status }) }
