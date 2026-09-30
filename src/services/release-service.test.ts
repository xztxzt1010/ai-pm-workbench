import { describe, expect, it, vi } from "vitest"
import { listReleases } from "./release-service"
const invoke = vi.hoisted(() => vi.fn()); vi.mock("@tauri-apps/api/core", () => ({ invoke }))
describe("release service", () => { it("keeps browser read-only", async () => { expect(await listReleases(false, "p")).toEqual([]); expect(invoke).not.toHaveBeenCalled() }) })
