import { describe, expect, it, vi } from "vitest"
import { listProjectRisks, updateProjectRiskStatus } from "./project-risk-service"

const invoke = vi.hoisted(() => vi.fn())
vi.mock("@tauri-apps/api/core", () => ({ invoke }))

describe("project risk service", () => {
  it("does not invoke browser reads", async () => { expect(await listProjectRisks(false, "p1")).toEqual([]); expect(invoke).not.toHaveBeenCalled() })
  it("rejects browser writes", async () => { await expect(updateProjectRiskStatus(false, "p1", "r1", "closed")).rejects.toThrow("仅在桌面") })
})
