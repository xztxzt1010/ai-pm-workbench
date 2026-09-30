// @vitest-environment jsdom

import { beforeEach, describe, expect, it } from "vitest"

import {
  addBrowserKnowledgeSource,
  createBrowserKnowledge,
  createBrowserKnowledgeRelation,
  getBrowserKnowledgePackage,
  importBrowserKnowledgePackage,
  listBrowserKnowledge,
  listBrowserKnowledgeRelations,
  listBrowserKnowledgeSources,
  reviewBrowserKnowledge,
  reviewBrowserKnowledgeRelation,
  updateBrowserKnowledge,
} from "@/data/browser-knowledge-store"

function createIdea(id: string, projectId = "project-1") {
  return createBrowserKnowledge({
    id,
    itemType: "product_idea",
    domain: "project",
    projectId,
    title: id,
    contentMarkdown: `# ${id}`,
    createdBy: "user",
  })
}

describe("browser knowledge store", () => {
  beforeEach(() => localStorage.clear())

  it("isolates project and personal knowledge", () => {
    createIdea("idea-1", "project-1")
    createIdea("idea-2", "project-2")
    createBrowserKnowledge({
      id: "learning-1",
      itemType: "ai_learning",
      domain: "personal",
      title: "Learning",
      contentMarkdown: "# Learning",
      createdBy: "user",
    })

    expect(listBrowserKnowledge({ domain: "project", projectId: "project-1" }).map((item) => item.id)).toEqual(["idea-1"])
    expect(listBrowserKnowledge({ domain: "personal" }).map((item) => item.id)).toEqual(["learning-1"])
  })

  it("uses content versions to reject stale edits and returns confirmed edits to draft", () => {
    createIdea("idea-1")
    reviewBrowserKnowledge({ itemId: "idea-1", domain: "project", projectId: "project-1", action: "confirm" })
    const updated = updateBrowserKnowledge({
      itemId: "idea-1",
      domain: "project",
      projectId: "project-1",
      expectedContentVersion: 1,
      title: "Updated",
      contentMarkdown: "# Updated",
    })

    expect(updated).toMatchObject({ status: "draft", contentVersion: 2, title: "Updated" })
    expect(() => updateBrowserKnowledge({
      itemId: "idea-1",
      domain: "project",
      projectId: "project-1",
      expectedContentVersion: 1,
      title: "Stale",
      contentMarkdown: "# Stale",
    })).toThrow()
  })

  it("rejects cross-project relations", () => {
    createIdea("idea-1", "project-1")
    createIdea("idea-2", "project-2")
    expect(() => createBrowserKnowledgeRelation({
      id: "relation-1",
      fromItemId: "idea-1",
      toItemId: "idea-2",
      relationType: "relates_to",
      status: "draft",
      evidence: [],
      createdBy: "user",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    })).toThrow()
  })

  it("stores versioned sources and requires an explicit relation review", () => {
    createIdea("idea-1")
    createIdea("idea-2")
    const timestamp = new Date().toISOString()
    addBrowserKnowledgeSource({
      id: "source-1",
      itemId: "idea-1",
      sourceKind: "markdown",
      sourceRef: "notes/idea.md",
      sourceVersion: "v1",
      contentHash: "a".repeat(64),
      title: "Idea notes",
      locator: { note: "Section 2" },
      capturedAt: timestamp,
      createdAt: timestamp,
    })
    createBrowserKnowledgeRelation({
      id: "relation-1",
      fromItemId: "idea-1",
      toItemId: "idea-2",
      relationType: "supports",
      status: "draft",
      evidence: [{ note: "Same user problem" }],
      createdBy: "user",
      createdAt: timestamp,
      updatedAt: timestamp,
    })

    expect(listBrowserKnowledgeSources("idea-1")).toHaveLength(1)
    expect(listBrowserKnowledgeRelations("idea-2")[0].status).toBe("draft")
    reviewBrowserKnowledgeRelation("relation-1", "confirm")
    expect(listBrowserKnowledgeRelations("idea-1")[0]).toMatchObject({ status: "confirmed", confirmedAt: expect.any(String) })
    expect(listBrowserKnowledgeRelations("idea-2")[0].status).toBe("confirmed")
  })

  it("makes imports idempotent by package hash and never overwrites conflicts", () => {
    const item = createIdea("idea-1")
    const exported = getBrowserKnowledgePackage(item.id)
    localStorage.clear()

    expect(importBrowserKnowledgePackage(exported, "a".repeat(64))).toBe("created")
    expect(importBrowserKnowledgePackage(exported, "a".repeat(64))).toBe("unchanged")
    expect(importBrowserKnowledgePackage(exported, "b".repeat(64))).toBe("conflict")
    expect(getBrowserKnowledgePackage(item.id).item.contentMarkdown).toBe("# idea-1")
  })
})
