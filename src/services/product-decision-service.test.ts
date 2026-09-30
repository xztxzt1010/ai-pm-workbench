import { beforeEach, describe, expect, it, vi } from "vitest"

const { invokeMock } = vi.hoisted(() => ({ invokeMock: vi.fn() }))
vi.mock("@tauri-apps/api/core", () => ({ invoke: invokeMock }))

import { createProductDecision, listProductDecisionVersions, reviewProductDecision } from "@/services/product-decision-service"

describe("product decision service", () => {
  beforeEach(() => invokeMock.mockReset())
  it("keeps browser preview read-only", async () => {
    await expect(listProductDecisionVersions(false, "p1", "d1")).resolves.toEqual([])
    await expect(createProductDecision(false, { id: "d1", versionId: "v1", projectId: "p1", title: "决策", context: "背景", decision: "结论", alternativesJson: "[]", evidenceJson: "[]", objectionsJson: "[]", impact: "影响", reviewDate: "2026-08-01", createdBy: "user" })).rejects.toMatchObject({ code: "permission" })
    expect(invokeMock).not.toHaveBeenCalled()
  })
  it("keeps review scoped to project and decision", async () => {
    invokeMock.mockResolvedValue(undefined)
    await reviewProductDecision(true, "p1", "d1", "confirm")
    expect(invokeMock).toHaveBeenCalledWith("review_product_decision", { projectId: "p1", decisionId: "d1", action: "confirm" })
  })
})
