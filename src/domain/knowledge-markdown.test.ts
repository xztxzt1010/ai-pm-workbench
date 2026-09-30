import { describe, expect, it } from "vitest"

import type { KnowledgeMarkdownPackage } from "@/domain/knowledge-markdown"
import { parseKnowledgeMarkdown, planKnowledgeMarkdownImport, renderKnowledgeMarkdown } from "@/domain/knowledge-markdown"

const timestamp = "2026-07-17T12:00:00.000Z"
const example: KnowledgeMarkdownPackage = {
  schemaVersion: "1.0.0",
  item: {
    id: "knowledge-1",
    itemType: "ai_learning",
    status: "draft",
    domain: "personal",
    title: "Embedding 版本管理",
    contentMarkdown: "# 学习\n索引必须可以重建。",
    contentVersion: 1,
    createdBy: "user",
    createdAt: timestamp,
    updatedAt: timestamp,
  },
  sources: [{
    id: "source-1",
    itemId: "knowledge-1",
    sourceKind: "markdown",
    sourceRef: "notes/embedding.md",
    sourceVersion: "1",
    contentHash: "a".repeat(64),
    title: "Embedding 笔记",
    locator: { heading: "版本管理" },
    capturedAt: timestamp,
    createdAt: timestamp,
  }],
  relations: [],
}

describe("knowledge Markdown package", () => {
  it("round-trips a portable package deterministically", () => {
    const rendered = renderKnowledgeMarkdown(example)
    expect(parseKnowledgeMarkdown(rendered)).toEqual(example)
    expect(renderKnowledgeMarkdown(parseKnowledgeMarkdown(rendered))).toBe(rendered)
  })

  it("treats importing the same package as unchanged", () => {
    expect(planKnowledgeMarkdownImport(example, renderKnowledgeMarkdown(example)).action).toBe("unchanged")
    expect(planKnowledgeMarkdownImport(undefined, renderKnowledgeMarkdown(example)).action).toBe("create")
  })

  it("rejects conflicting IDs and unrelated source ownership", () => {
    const changed = { ...example, item: { ...example.item, title: "冲突标题" } }
    expect(planKnowledgeMarkdownImport(example, renderKnowledgeMarkdown(changed)).action).toBe("conflict")
    expect(() => renderKnowledgeMarkdown({ ...example, sources: [{ ...example.sources[0], itemId: "other" }] })).toThrow(/不属于当前条目/)
  })

  it("rejects malformed and oversized packages", () => {
    expect(() => parseKnowledgeMarkdown("# 普通 Markdown")).toThrow(/缺少/)
    expect(() => parseKnowledgeMarkdown(`<!-- apm-knowledge:v1\n{}\n-->\n\n${"x".repeat(1_000_000)}`)).toThrow(/1 MB/)
  })
})
