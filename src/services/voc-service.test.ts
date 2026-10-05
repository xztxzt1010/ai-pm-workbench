import { beforeEach, describe, expect, it, vi } from "vitest"

const { invokeMock } = vi.hoisted(() => ({ invokeMock: vi.fn() }))
vi.mock("@tauri-apps/api/core", () => ({ invoke: invokeMock }))

import { createVocFeedbackBatch, createVocRequirementCandidate, listVocFeedback, reviewVocRequirementCandidate } from "@/services/voc-service"

describe("VOC service", () => {
  beforeEach(() => invokeMock.mockReset())

  it("keeps browser preview free of VOC database calls", async () => {
    await expect(listVocFeedback(false, "p1")).resolves.toEqual([])
    await expect(createVocRequirementCandidate(false, { id: "c1", projectId: "p1", title: "候选", description: "说明", feedbackIdsJson: '["f1"]' })).rejects.toMatchObject({ code: "permission" })
    expect(invokeMock).not.toHaveBeenCalled()
  })

  it("uses project-scoped candidate review commands", async () => {
    invokeMock.mockResolvedValue(undefined)
    await reviewVocRequirementCandidate(true, "p1", "c1", "accept")
    expect(invokeMock).toHaveBeenCalledWith("review_voc_requirement_candidate", { projectId: "p1", candidateId: "c1", action: "accept" })
  })

  it("sends imports through one batch command", async () => {
    invokeMock.mockResolvedValue([])
    const requests = [{ id: "f1", projectId: "p1", content: "慢", category: "性能", clusterKey: "性能:慢", severity: "high" as const, sourceType: "support" as const, sourceRef: "t1", evidence: "原话", occurredAt: "2026-07-16" }]
    await createVocFeedbackBatch(true, requests)
    expect(invokeMock).toHaveBeenCalledWith("create_voc_feedback_batch", { requests })
  })
})
