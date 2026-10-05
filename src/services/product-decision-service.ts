import { invoke } from "@tauri-apps/api/core"

import { AppError } from "@/domain/app-error"
import type { ProductDecisionStatus } from "@/domain/product-decision"

export interface ProductDecisionRecord { id: string; projectId: string; status: ProductDecisionStatus; versionNumber: number; title: string; context: string; decision: string; alternativesJson: string; evidenceJson: string; objectionsJson: string; impact: string; reviewDate: string; createdBy: "user" | "agent"; createdAt: string; updatedAt: string }
function requireDesktop(desktopRuntime: boolean) { if (!desktopRuntime) throw new AppError("permission", "决策日志仅在桌面应用中保存") }
export async function createProductDecision(desktopRuntime: boolean, input: { id: string; versionId: string; projectId: string; title: string; context: string; decision: string; alternativesJson: string; evidenceJson: string; objectionsJson: string; impact: string; reviewDate: string; createdBy: "user" | "agent" }): Promise<ProductDecisionRecord> { requireDesktop(desktopRuntime); return invoke<ProductDecisionRecord>("create_product_decision", { request: input }) }
export async function createProductDecisionVersion(desktopRuntime: boolean, input: { versionId: string; projectId: string; decisionId: string; title: string; context: string; decision: string; alternativesJson: string; evidenceJson: string; objectionsJson: string; impact: string; reviewDate: string; createdBy: "user" | "agent" }): Promise<ProductDecisionRecord> { requireDesktop(desktopRuntime); return invoke<ProductDecisionRecord>("create_product_decision_version", { request: input }) }
export async function listProductDecisions(desktopRuntime: boolean, projectId: string): Promise<ProductDecisionRecord[]> { if (!desktopRuntime) return []; return invoke<ProductDecisionRecord[]>("list_product_decisions", { projectId }) }
export async function listProductDecisionVersions(desktopRuntime: boolean, projectId: string, decisionId: string): Promise<ProductDecisionRecord[]> { if (!desktopRuntime) return []; return invoke<ProductDecisionRecord[]>("list_product_decision_versions", { projectId, decisionId }) }
export async function reviewProductDecision(desktopRuntime: boolean, projectId: string, decisionId: string, action: "confirm" | "revisit" | "archive") { requireDesktop(desktopRuntime); await invoke("review_product_decision", { projectId, decisionId, action }) }
