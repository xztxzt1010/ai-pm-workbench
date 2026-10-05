import { describe, expect, it, vi } from "vitest"
import { listResearchInsights } from "./research-insight-service"
const invoke = vi.hoisted(() => vi.fn()); vi.mock("@tauri-apps/api/core", () => ({ invoke }))
describe("research insight service", () => { it("keeps browser read-only", async () => { expect(await listResearchInsights(false, "p")).toEqual([]); expect(invoke).not.toHaveBeenCalled() }) })
