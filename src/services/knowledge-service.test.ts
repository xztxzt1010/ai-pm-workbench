// @vitest-environment jsdom

import { beforeEach, describe, expect, it, vi } from "vitest"

const { invokeMock } = vi.hoisted(() => ({ invokeMock: vi.fn() }))
vi.mock("@tauri-apps/api/core", () => ({ invoke: invokeMock }))

import {
  addKnowledgeSource,
  createKnowledgeItem,
  createKnowledgeRelation,
  exportKnowledgeScopeMarkdown,
  listKnowledgeItems,
  reviewKnowledgeItem,
} from "@/services/knowledge-service"

const timestamp = "2026-07-17T12:00:00.000Z"
const item = {
  id: "knowledge-1",
  itemType: "product_idea" as const,
  status: "draft" as const,
  domain: "project" as const,
  projectId: "project-1",
  title: "统一入口",
  contentMarkdown: "# 想法",
  contentVersion: 1,
  createdBy: "user" as const,
  createdAt: timestamp,
  updatedAt: timestamp,
}

describe("knowledge service", () => {
  beforeEach(() => {
    invokeMock.mockReset()
    localStorage.clear()
  })

  it("creates a project-scoped owned record through a fixed command", async () => {
    invokeMock.mockResolvedValue(item)
    await expect(createKnowledgeItem(true, {
      id: item.id,
      itemType: item.itemType,
      domain: "project",
      projectId: "project-1",
      title: item.title,
      contentMarkdown: item.contentMarkdown,
      createdBy: "user",
    })).resolves.toEqual(item)
    expect(invokeMock).toHaveBeenCalledWith("create_knowledge_item", { request: expect.objectContaining({ domain: "project", projectId: "project-1" }) })
  })

  it("rejects invalid domain combinations before invoking Rust", async () => {
    await expect(createKnowledgeItem(true, { ...item, domain: "personal", projectId: "project-1" })).rejects.toThrow(/个人知识/)
    expect(invokeMock).not.toHaveBeenCalled()
  })

  it("persists browser-local knowledge without invoking Tauri", async () => {
    await expect(listKnowledgeItems(false, { domain: "personal" })).resolves.toEqual([])
    await expect(createKnowledgeItem(false, { ...item })).resolves.toMatchObject({ id: item.id, status: "draft" })
    await expect(listKnowledgeItems(false, { domain: "project", projectId: "project-1" })).resolves.toHaveLength(1)
    expect(invokeMock).not.toHaveBeenCalled()
  })

  it("exports the current knowledge scope as a bounded review document", async () => {
    await createKnowledgeItem(false, { ...item })
    await expect(exportKnowledgeScopeMarkdown(false, { domain: "project", projectId: "project-1" })).resolves.toContain("记录数：1")
    await expect(exportKnowledgeScopeMarkdown(false, { domain: "project", projectId: "project-1" })).resolves.toContain(item.title)
    await expect(exportKnowledgeScopeMarkdown(false, { domain: "personal" })).rejects.toThrow()
  })

  it("parses source locators and relation evidence without exposing raw JSON", async () => {
    invokeMock.mockResolvedValueOnce({
      id: "source-1",
      itemId: item.id,
      sourceKind: "markdown",
      sourceRef: "notes/a.md",
      sourceVersion: "1",
      contentHash: "a".repeat(64),
      title: "来源",
      locatorJson: "{\"heading\":\"范围\"}",
      capturedAt: timestamp,
      createdAt: timestamp,
    })
    await expect(addKnowledgeSource(true, {
      id: "source-1",
      itemId: item.id,
      domain: "project",
      projectId: "project-1",
      sourceKind: "markdown",
      sourceRef: "notes/a.md",
      sourceVersion: "1",
      contentHash: "a".repeat(64),
      title: "来源",
      locator: { heading: "范围" },
      capturedAt: timestamp,
    })).resolves.toMatchObject({ locator: { heading: "范围" } })

    invokeMock.mockResolvedValueOnce({
      id: "relation-1",
      fromItemId: item.id,
      toItemId: "knowledge-2",
      relationType: "supports",
      status: "draft",
      evidenceJson: "[{\"sourceId\":\"source-1\"}]",
      createdBy: "user",
      createdAt: timestamp,
      updatedAt: timestamp,
    })
    await expect(createKnowledgeRelation(true, {
      id: "relation-1",
      fromItemId: item.id,
      toItemId: "knowledge-2",
      domain: "project",
      projectId: "project-1",
      relationType: "supports",
      evidence: [{ sourceId: "source-1" }],
      createdBy: "user",
    })).resolves.toMatchObject({ evidence: [{ sourceId: "source-1" }] })
  })

  it("rejects credential-bearing or non-HTTPS external sources before persistence", async () => {
    const base = {
      id: "source-external",
      itemId: item.id,
      domain: "project" as const,
      projectId: "project-1",
      sourceKind: "external_url" as const,
      sourceVersion: "v1",
      contentHash: "a".repeat(64),
      title: "External",
      locator: {},
      capturedAt: timestamp,
    }
    await expect(addKnowledgeSource(true, { ...base, sourceRef: "http://example.com" })).rejects.toThrow(/HTTPS/)
    await expect(addKnowledgeSource(true, { ...base, sourceRef: "https://user:secret@example.com" })).rejects.toThrow(/凭据/)
    expect(invokeMock).not.toHaveBeenCalled()
  })

  it("uses an explicit state action and returns the validated state", async () => {
    invokeMock.mockResolvedValue({ ...item, status: "confirmed", confirmedAt: timestamp })
    await expect(reviewKnowledgeItem(true, { itemId: item.id, domain: "project", projectId: "project-1", action: "confirm" })).resolves.toMatchObject({ status: "confirmed" })
  })
})
