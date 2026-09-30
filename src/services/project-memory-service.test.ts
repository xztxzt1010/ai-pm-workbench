import { beforeEach, describe, expect, it, vi } from "vitest"

const { invokeMock } = vi.hoisted(() => ({ invokeMock: vi.fn() }))
vi.mock("@tauri-apps/api/core", () => ({ invoke: invokeMock }))

import {
  createProjectMemoryCandidate,
  createProjectMemoryConflict,
  deleteProjectMemoryConflict,
  listProjectMemories,
  listProjectMemoryConflicts,
  listProjectMemorySources,
  rebuildProjectMemoryIndex,
  reviewProjectMemoryCandidate,
  searchProjectMemories,
} from "@/services/project-memory-service"

describe("project memory service", () => {
  beforeEach(() => invokeMock.mockReset())

  it("keeps browser preview free of desktop memory calls", async () => {
    await expect(searchProjectMemories(false, "p1", "billing")).resolves.toEqual([])
    await expect(listProjectMemories(false, "p1")).resolves.toEqual([])
    await expect(listProjectMemorySources(false, "p1", "m1")).resolves.toEqual([])
    await expect(listProjectMemoryConflicts(false, "p1", "m1")).resolves.toEqual([])
    await expect(createProjectMemoryCandidate(false, { id: "m1", projectId: "p1", title: "x", content: "y" })).rejects.toMatchObject({ code: "permission" })
    await expect(reviewProjectMemoryCandidate(false, "m1", "confirm")).rejects.toMatchObject({ code: "permission" })
    await expect(createProjectMemoryConflict(false, "p1", "m1", "m2", "conflicts")).rejects.toMatchObject({ code: "permission" })
    await expect(deleteProjectMemoryConflict(false, "p1", "m1", "m2", "conflicts")).rejects.toMatchObject({ code: "permission" })
    await rebuildProjectMemoryIndex(false)
    expect(invokeMock).not.toHaveBeenCalled()
  })

  it("queries one project and parses a safe source locator", async () => {
    invokeMock.mockResolvedValue([{ id: "m1", projectId: "p1", memoryType: "confirmed_memory", status: "confirmed", title: "Billing", content: "Exports are required", sourceKind: "meeting", sourceId: "meeting-1", sourceLocatorJson: "{\"paragraphId\":\"p-1\"}", createdBy: "user", updatedAt: "1" }])
    const results = await searchProjectMemories(true, "p1", "billing exports", "confirmed", 10)
    expect(results[0].sourceLocator).toEqual({ paragraphId: "p-1" })
    expect(invokeMock).toHaveBeenCalledWith("search_project_memories", { projectId: "p1", query: "billing exports", status: "confirmed", limit: 10 })
  })

  it("falls back to an empty locator for malformed legacy JSON", async () => {
    invokeMock.mockResolvedValue([{ id: "m1", projectId: "p1", memoryType: "confirmed_memory", status: "confirmed", title: "Billing", content: "x", sourceKind: "manual", sourceLocatorJson: "not-json", createdBy: "user", updatedAt: "1" }])
    expect((await searchProjectMemories(true, "p1", "billing"))[0].sourceLocator).toEqual({})
  })

  it("requests an explicit index rebuild", async () => {
    invokeMock.mockResolvedValue(undefined)
    await rebuildProjectMemoryIndex(true)
    expect(invokeMock).toHaveBeenCalledWith("rebuild_project_memory_index")
  })

  it("creates a pending candidate with safe defaults", async () => {
    invokeMock.mockResolvedValue({ id: "m1", projectId: "p1", memoryType: "pending_candidate", status: "pending", title: "Scope", content: "Desktop first", sourceKind: "manual", sourceLocatorJson: "{}", createdBy: "user", updatedAt: "1" })
    const result = await createProjectMemoryCandidate(true, { id: "m1", projectId: "p1", title: "Scope", content: "Desktop first" })
    expect(result.status).toBe("pending")
    expect(invokeMock).toHaveBeenCalledWith("create_project_memory_candidate", { request: expect.objectContaining({ memoryType: "pending_candidate", sourceKind: "manual", sourceLocatorJson: "{}", createdBy: "user" }) })
  })

  it("lists and reviews project memories explicitly", async () => {
    invokeMock.mockResolvedValueOnce([]).mockResolvedValueOnce(undefined)
    await listProjectMemories(true, "p1", "pending", 12)
    await reviewProjectMemoryCandidate(true, "m1", "confirm")
    expect(invokeMock).toHaveBeenNthCalledWith(1, "list_project_memories", { projectId: "p1", status: "pending", limit: 12 })
    expect(invokeMock).toHaveBeenNthCalledWith(2, "review_project_memory_candidate", { memoryId: "m1", action: "confirm" })
  })

  it("loads sources within an explicit project boundary", async () => {
    invokeMock.mockResolvedValue([{ id: "s1", sourceKind: "meeting", sourceId: "meeting-1", locatorJson: "{\"paragraphId\":\"p-1\"}", quote: "Desktop first", createdAt: "1" }])
    const sources = await listProjectMemorySources(true, "p1", "m1")
    expect(sources[0].locator).toEqual({ paragraphId: "p-1" })
    expect(invokeMock).toHaveBeenCalledWith("list_project_memory_sources", { projectId: "p1", memoryId: "m1" })
  })

  it("creates, lists, and removes explicit memory relations", async () => {
    invokeMock.mockResolvedValueOnce(undefined).mockResolvedValueOnce([{ memoryId: "m1", conflictsWithMemoryId: "m2", relationType: "conflicts", direction: "outgoing", relatedMemoryId: "m2", relatedTitle: "Other", relatedStatus: "confirmed", createdAt: "1" }]).mockResolvedValueOnce(undefined)
    await createProjectMemoryConflict(true, "p1", "m1", "m2", "conflicts")
    const relations = await listProjectMemoryConflicts(true, "p1", "m1")
    await deleteProjectMemoryConflict(true, "p1", "m1", "m2", "conflicts")
    expect(relations[0].relatedTitle).toBe("Other")
    expect(invokeMock).toHaveBeenNthCalledWith(1, "create_project_memory_conflict", { projectId: "p1", memoryId: "m1", relatedMemoryId: "m2", relationType: "conflicts" })
    expect(invokeMock).toHaveBeenNthCalledWith(2, "list_project_memory_conflicts", { projectId: "p1", memoryId: "m1" })
    expect(invokeMock).toHaveBeenNthCalledWith(3, "delete_project_memory_conflict", { projectId: "p1", memoryId: "m1", relatedMemoryId: "m2", relationType: "conflicts" })
  })
})
