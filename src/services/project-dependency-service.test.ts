import { describe, expect, it, vi } from "vitest"
import { listProjectDependencies, updateProjectDependencyStatus } from "./project-dependency-service"
const invoke = vi.hoisted(() => vi.fn()); vi.mock("@tauri-apps/api/core", () => ({ invoke }))
describe("project dependency service", () => { it("returns no browser reads", async () => { expect(await listProjectDependencies(false, "p")).toEqual([]); expect(invoke).not.toHaveBeenCalled() }); it("rejects browser writes", async () => { await expect(updateProjectDependencyStatus(false, "p", "d", "resolved")).rejects.toThrow("仅在桌面") }) })
