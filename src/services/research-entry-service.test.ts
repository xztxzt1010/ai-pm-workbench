import { describe, expect, it, vi } from "vitest"
import { listResearchEntries } from "./research-entry-service"
const invoke = vi.hoisted(() => vi.fn()); vi.mock("@tauri-apps/api/core", () => ({ invoke }))
describe("research service", () => { it("keeps browser read-only", async () => { expect(await listResearchEntries(false, "p")).toEqual([]); expect(invoke).not.toHaveBeenCalled() }) })
