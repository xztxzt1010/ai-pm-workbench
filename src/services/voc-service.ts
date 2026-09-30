import { invoke } from "@tauri-apps/api/core"

import { AppError } from "@/domain/app-error"
import type { VocFeedback, VocSeverity, VocSourceType } from "@/domain/voc-feedback"

export interface VocFeedbackRecord extends VocFeedback { id: string; projectId: string; createdAt: string; updatedAt: string }
export interface VocRequirementCandidate { id: string; projectId: string; title: string; description: string; feedbackIdsJson: string; status: "draft" | "accepted" | "rejected"; createdAt: string; updatedAt: string }

function requireDesktop(desktopRuntime: boolean) { if (!desktopRuntime) throw new AppError("permission", "VOC 数据仅在桌面应用中保存") }

export async function createVocFeedback(desktopRuntime: boolean, input: { id: string; projectId: string; content: string; category: string; clusterKey: string; severity: VocSeverity; sourceType: VocSourceType; sourceRef: string; evidence: string; occurredAt: string }): Promise<VocFeedbackRecord> {
  requireDesktop(desktopRuntime)
  return invoke<VocFeedbackRecord>("create_voc_feedback", { request: input })
}

export async function createVocFeedbackBatch(desktopRuntime: boolean, inputs: Array<{ id: string; projectId: string; content: string; category: string; clusterKey: string; severity: VocSeverity; sourceType: VocSourceType; sourceRef: string; evidence: string; occurredAt: string }>): Promise<VocFeedbackRecord[]> {
  requireDesktop(desktopRuntime)
  return invoke<VocFeedbackRecord[]>("create_voc_feedback_batch", { requests: inputs })
}

export async function listVocFeedback(desktopRuntime: boolean, projectId: string): Promise<VocFeedbackRecord[]> {
  if (!desktopRuntime) return []
  return invoke<VocFeedbackRecord[]>("list_voc_feedback", { projectId })
}

export async function createVocRequirementCandidate(desktopRuntime: boolean, input: { id: string; projectId: string; title: string; description: string; feedbackIdsJson: string }): Promise<VocRequirementCandidate> {
  requireDesktop(desktopRuntime)
  return invoke<VocRequirementCandidate>("create_voc_requirement_candidate", { request: input })
}

export async function listVocRequirementCandidates(desktopRuntime: boolean, projectId: string): Promise<VocRequirementCandidate[]> {
  if (!desktopRuntime) return []
  return invoke<VocRequirementCandidate[]>("list_voc_requirement_candidates", { projectId })
}

export async function reviewVocRequirementCandidate(desktopRuntime: boolean, projectId: string, candidateId: string, action: "accept" | "reject") {
  requireDesktop(desktopRuntime)
  await invoke("review_voc_requirement_candidate", { projectId, candidateId, action })
}
