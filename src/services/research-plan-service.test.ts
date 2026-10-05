import { describe, expect, it, vi } from "vitest"
import { listResearchPlans } from "./research-plan-service"
const invoke = vi.hoisted(() => vi.fn()); vi.mock("@tauri-apps/api/core", () => ({ invoke }))
describe("research plan service", () => { it("keeps browser read-only", async () => { expect(await listResearchPlans(false, "p")).toEqual([]); expect(invoke).not.toHaveBeenCalled() }) })
