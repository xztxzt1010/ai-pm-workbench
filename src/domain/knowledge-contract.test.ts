import { describe, expect, it } from "vitest"

import {
  assertEnabledKnowledgeDomain,
  assertKnowledgeRelationScope,
  knowledgeItemSchema,
  knowledgeRelationSchema,
  nextKnowledgeStatus,
  type KnowledgeItem,
} from "@/domain/knowledge-contract"

const timestamp = "2026-07-17T12:00:00.000Z"

function idea(overrides: Partial<KnowledgeItem> = {}): KnowledgeItem {
  return knowledgeItemSchema.parse({
    id: "knowledge-1",
    itemType: "product_idea",
    status: "draft",
    domain: "project",
    projectId: "project-1",
    title: "统一知识入口",
    contentMarkdown: "# 想法\n统一记录入口。",
    contentVersion: 1,
    createdBy: "user",
    createdAt: timestamp,
    updatedAt: timestamp,
    ...overrides,
  })
}

describe("unified knowledge contract", () => {
  it("separates owned records from formal-object adapters", () => {
    expect(idea().itemType).toBe("product_idea")
    expect(() => idea({ itemType: "meeting_record" })).toThrow(/必须引用正式对象/)
    expect(knowledgeItemSchema.parse({
      ...idea(),
      itemType: "meeting_record",
      contentMarkdown: "",
      targetKind: "meeting",
      targetId: "meeting-1",
      targetVersion: "source-hash",
    }).targetKind).toBe("meeting")
  })

  it("enforces knowledge domains and keeps future domains disabled", () => {
    expect(() => idea({ domain: "personal", projectId: "project-1" })).toThrow(/个人知识/)
    expect(idea({ domain: "personal", projectId: undefined }).domain).toBe("personal")
    expect(() => assertEnabledKnowledgeDomain("team")).toThrow(/V0.x/)
  })

  it("prevents agents from creating confirmed knowledge", () => {
    expect(() => idea({ createdBy: "agent", status: "confirmed", confirmedAt: timestamp })).toThrow(/Agent/)
  })

  it("supports explicit confirm, archive, and restore transitions", () => {
    const confirmed = nextKnowledgeStatus(idea(), "confirm", "2026-07-17T13:00:00.000Z")
    const archived = nextKnowledgeStatus(confirmed, "archive", "2026-07-17T14:00:00.000Z")
    const restored = nextKnowledgeStatus(archived, "restore", "2026-07-17T15:00:00.000Z")
    expect([confirmed.status, archived.status, restored.status]).toEqual(["confirmed", "archived", "confirmed"])
    expect(restored.confirmedAt).toBe(confirmed.confirmedAt)
  })

  it("rejects cross-project relations and unconfirmed agent relations", () => {
    expect(() => assertKnowledgeRelationScope(idea(), idea({ id: "knowledge-2", projectId: "project-2" }))).toThrow(/跨知识域或跨项目/)
    expect(() => knowledgeRelationSchema.parse({
      id: "relation-1",
      fromItemId: "knowledge-1",
      toItemId: "knowledge-2",
      relationType: "supports",
      status: "confirmed",
      evidence: [],
      createdBy: "agent",
      createdAt: timestamp,
      updatedAt: timestamp,
      confirmedAt: timestamp,
    })).toThrow(/Agent/)
  })
})
