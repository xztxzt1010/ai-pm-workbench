import { describe, expect, it, vi } from "vitest"
import { listResearchRequirementCandidates } from "./research-requirement-candidate-service"
const invoke = vi.hoisted(() => vi.fn()); vi.mock("@tauri-apps/api/core", () => ({ invoke }))
describe("research requirement candidates", () => { it("keeps browser read-only", async () => { expect(await listResearchRequirementCandidates(false, "p")).toEqual([]); expect(invoke).not.toHaveBeenCalled() }) })
