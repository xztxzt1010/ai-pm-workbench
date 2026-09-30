import { describe, expect, it, vi } from "vitest"
import { listCompetitorProfiles } from "./competitor-profile-service"
const invoke = vi.hoisted(() => vi.fn()); vi.mock("@tauri-apps/api/core", () => ({ invoke }))
describe("competitor profile service", () => { it("keeps browser read-only", async () => { expect(await listCompetitorProfiles(false, "p")).toEqual([]); expect(invoke).not.toHaveBeenCalled() }) })
