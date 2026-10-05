import { invoke } from "@tauri-apps/api/core"

import { AppError } from "@/domain/app-error"
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
import {
  assertEnabledKnowledgeDomain,
  knowledgeItemSchema,
  knowledgeRelationSchema,
  knowledgeSourceSchema,
  type KnowledgeItem,
  type KnowledgeRelation,
  type KnowledgeSource,
} from "@/domain/knowledge-contract"
import { parseKnowledgeMarkdown, renderKnowledgeMarkdown } from "@/domain/knowledge-markdown"

type EnabledKnowledgeDomain = "project" | "personal"

export interface KnowledgeAdapterCandidate {
  targetKind: "meeting" | "product_decision"
  targetId: string
  targetVersion: string
  projectId?: string
  title: string
}

interface KnowledgeSourceRow extends Omit<KnowledgeSource, "locator"> {
  locatorJson: string
}

interface KnowledgeRelationRow extends Omit<KnowledgeRelation, "evidence"> {
  evidenceJson: string
}

function scope(domain: EnabledKnowledgeDomain, projectId?: string) {
  assertEnabledKnowledgeDomain(domain)
  if (domain === "project" && !projectId?.trim()) throw new AppError("validation", "项目知识必须选择项目")
  if (domain === "personal" && projectId) throw new AppError("validation", "个人知识不能绑定项目")
  return { domain, projectId: domain === "project" ? projectId?.trim() : undefined }
}

function parseObject(value: string, label: string): Record<string, unknown> {
  try {
    const parsed: unknown = JSON.parse(value)
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) return parsed as Record<string, unknown>
  } catch {
    // Stable product error below.
  }
  throw new AppError("validation", `${label}不是有效对象`)
}

function parseArray(value: string, label: string): Record<string, unknown>[] {
  try {
    const parsed: unknown = JSON.parse(value)
    if (Array.isArray(parsed) && parsed.every((item) => item && typeof item === "object" && !Array.isArray(item))) {
      return parsed as Record<string, unknown>[]
    }
  } catch {
    // Stable product error below.
  }
  throw new AppError("validation", `${label}不是有效数组`)
}

export async function createKnowledgeItem(
  desktopRuntime: boolean,
  input: {
    id: string
    itemType: KnowledgeItem["itemType"]
    domain: EnabledKnowledgeDomain
    projectId?: string
    title: string
    contentMarkdown: string
    targetKind?: KnowledgeItem["targetKind"]
    targetId?: string
    targetVersion?: string
    createdBy: "user" | "agent"
  },
): Promise<KnowledgeItem> {
  const itemScope = scope(input.domain, input.projectId)
  if (!desktopRuntime) return createBrowserKnowledge({ ...input, ...itemScope })
  const row = await invoke<KnowledgeItem>("create_knowledge_item", { request: { ...input, ...itemScope } })
  return knowledgeItemSchema.parse(row)
}

export async function listKnowledgeItems(
  desktopRuntime: boolean,
  input: {
    domain: EnabledKnowledgeDomain
    projectId?: string
    status?: KnowledgeItem["status"]
    itemType?: KnowledgeItem["itemType"]
    limit?: number
  },
): Promise<KnowledgeItem[]> {
  const itemScope = scope(input.domain, input.projectId)
  if (!desktopRuntime) return listBrowserKnowledge({ ...input, ...itemScope })
  const rows = await invoke<KnowledgeItem[]>("list_knowledge_items", { ...itemScope, status: input.status, itemType: input.itemType, limit: input.limit })
  return rows.map((row) => knowledgeItemSchema.parse(row))
}

export async function listKnowledgeAdapterCandidates(
  desktopRuntime: boolean,
  input: { domain: EnabledKnowledgeDomain; projectId?: string; targetKind: KnowledgeAdapterCandidate["targetKind"] },
): Promise<KnowledgeAdapterCandidate[]> {
  const itemScope = scope(input.domain, input.projectId)
  if (!desktopRuntime) return []
  return invoke<KnowledgeAdapterCandidate[]>("list_knowledge_adapter_candidates", { ...itemScope, targetKind: input.targetKind })
}

export async function reviewKnowledgeItem(
  desktopRuntime: boolean,
  input: {
    itemId: string
    domain: EnabledKnowledgeDomain
    projectId?: string
    action: "confirm" | "archive" | "restore"
  },
): Promise<KnowledgeItem> {
  const itemScope = scope(input.domain, input.projectId)
  if (!desktopRuntime) return reviewBrowserKnowledge({ ...input, ...itemScope })
  const row = await invoke<KnowledgeItem>("review_knowledge_item", { itemId: input.itemId, ...itemScope, action: input.action })
  return knowledgeItemSchema.parse(row)
}

export async function addKnowledgeSource(
  desktopRuntime: boolean,
  input: Omit<KnowledgeSource, "locator" | "createdAt"> & {
    locator: Record<string, unknown>
    domain: EnabledKnowledgeDomain
    projectId?: string
  },
): Promise<KnowledgeSource> {
  const itemScope = scope(input.domain, input.projectId)
  if (input.sourceKind === "external_url") {
    let sourceUrl: URL
    try {
      sourceUrl = new URL(input.sourceRef)
    } catch {
      throw new AppError("validation", "外部来源必须是有效的 HTTPS 地址")
    }
    if (sourceUrl.protocol !== "https:" || sourceUrl.username || sourceUrl.password) {
      throw new AppError("validation", "外部来源只允许不含凭据的 HTTPS 地址")
    }
  }
  if (!desktopRuntime) return addBrowserKnowledgeSource(knowledgeSourceSchema.parse({
    id: input.id,
    itemId: input.itemId,
    sourceKind: input.sourceKind,
    sourceRef: input.sourceRef,
    sourceVersion: input.sourceVersion,
    contentHash: input.contentHash,
    title: input.title,
    locator: input.locator,
    capturedAt: input.capturedAt,
    createdAt: new Date().toISOString(),
  }))
  const row = await invoke<KnowledgeSourceRow>("add_knowledge_source", {
    request: {
      id: input.id,
      itemId: input.itemId,
      sourceKind: input.sourceKind,
      sourceRef: input.sourceRef,
      sourceVersion: input.sourceVersion,
      contentHash: input.contentHash,
      title: input.title,
      capturedAt: input.capturedAt,
      ...itemScope,
      locatorJson: JSON.stringify(input.locator),
    },
  })
  return knowledgeSourceSchema.parse({ ...row, locator: parseObject(row.locatorJson, "知识来源定位") })
}

export async function listKnowledgeSources(
  desktopRuntime: boolean,
  input: { itemId: string; domain: EnabledKnowledgeDomain; projectId?: string },
): Promise<KnowledgeSource[]> {
  const itemScope = scope(input.domain, input.projectId)
  if (!desktopRuntime) return listBrowserKnowledgeSources(input.itemId)
  const rows = await invoke<KnowledgeSourceRow[]>("list_knowledge_sources", { itemId: input.itemId, ...itemScope })
  return rows.map((row) => knowledgeSourceSchema.parse({ ...row, locator: parseObject(row.locatorJson, "知识来源定位") }))
}

export async function createKnowledgeRelation(
  desktopRuntime: boolean,
  input: {
    id: string
    fromItemId: string
    toItemId: string
    domain: EnabledKnowledgeDomain
    projectId?: string
    relationType: KnowledgeRelation["relationType"]
    evidence: Record<string, unknown>[]
    createdBy: "user" | "agent"
  },
): Promise<KnowledgeRelation> {
  const itemScope = scope(input.domain, input.projectId)
  if (!desktopRuntime) {
    const timestamp = new Date().toISOString()
    return createBrowserKnowledgeRelation(knowledgeRelationSchema.parse({
      id: input.id,
      fromItemId: input.fromItemId,
      toItemId: input.toItemId,
      relationType: input.relationType,
      status: "draft",
      evidence: input.evidence,
      createdBy: input.createdBy,
      createdAt: timestamp,
      updatedAt: timestamp,
    }))
  }
  const row = await invoke<KnowledgeRelationRow>("create_knowledge_relation", {
    request: {
      id: input.id,
      fromItemId: input.fromItemId,
      toItemId: input.toItemId,
      relationType: input.relationType,
      createdBy: input.createdBy,
      ...itemScope,
      evidenceJson: JSON.stringify(input.evidence),
    },
  })
  return knowledgeRelationSchema.parse({ ...row, evidence: parseArray(row.evidenceJson, "知识关系证据") })
}

export async function reviewKnowledgeRelation(
  desktopRuntime: boolean,
  input: {
    relationId: string
    domain: EnabledKnowledgeDomain
    projectId?: string
    action: "confirm" | "reject"
  },
): Promise<void> {
  const itemScope = scope(input.domain, input.projectId)
  if (!desktopRuntime) {
    reviewBrowserKnowledgeRelation(input.relationId, input.action)
    return
  }
  await invoke("review_knowledge_relation", { relationId: input.relationId, ...itemScope, action: input.action })
}

export async function listKnowledgeRelations(
  desktopRuntime: boolean,
  input: { itemId: string; domain: EnabledKnowledgeDomain; projectId?: string },
): Promise<KnowledgeRelation[]> {
  const itemScope = scope(input.domain, input.projectId)
  if (!desktopRuntime) return listBrowserKnowledgeRelations(input.itemId)
  const rows = await invoke<KnowledgeRelationRow[]>("list_knowledge_relations", { itemId: input.itemId, ...itemScope })
  return rows.map((row) => knowledgeRelationSchema.parse({ ...row, evidence: parseArray(row.evidenceJson, "知识关系证据") }))
}

export async function updateKnowledgeItem(
  desktopRuntime: boolean,
  input: {
    itemId: string
    domain: EnabledKnowledgeDomain
    projectId?: string
    expectedContentVersion: number
    title: string
    contentMarkdown: string
  },
): Promise<KnowledgeItem> {
  const itemScope = scope(input.domain, input.projectId)
  if (!desktopRuntime) return updateBrowserKnowledge({ ...input, ...itemScope })
  const row = await invoke<KnowledgeItem>("update_knowledge_item", { request: { ...input, ...itemScope } })
  return knowledgeItemSchema.parse(row)
}

export async function sha256Text(value: string) {
  const bytes = new TextEncoder().encode(value)
  const digest = await crypto.subtle.digest("SHA-256", bytes)
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("")
}

export async function exportKnowledgeItemMarkdown(desktopRuntime: boolean, item: KnowledgeItem) {
  const packageValue = desktopRuntime
    ? {
        schemaVersion: "1.0.0" as const,
        item,
        sources: await listKnowledgeSources(true, { itemId: item.id, domain: item.domain as EnabledKnowledgeDomain, projectId: item.projectId }),
        relations: await listKnowledgeRelations(true, { itemId: item.id, domain: item.domain as EnabledKnowledgeDomain, projectId: item.projectId }),
      }
    : getBrowserKnowledgePackage(item.id)
  return renderKnowledgeMarkdown(packageValue)
}

export async function exportKnowledgeScopeMarkdown(
  desktopRuntime: boolean,
  input: { domain: EnabledKnowledgeDomain; projectId?: string },
) {
  const items = await listKnowledgeItems(desktopRuntime, { ...input, limit: 100 })
  if (!items.length) throw new Error("当前知识域没有可导出的记录")
  const exportedAt = new Date().toISOString()
  const packages = await Promise.all(items.map((item) => exportKnowledgeItemMarkdown(desktopRuntime, item)))
  const header = [
    "# APM 知识域导出",
    "",
    `- 导出时间：${exportedAt}`,
    `- 知识域：${input.domain}`,
    `- 项目 ID：${input.projectId ?? "-"}`,
    `- 记录数：${items.length}`,
    "",
    "> 这是便于审阅和备份的批量文档。单条记录仍可分别导出并重新导入。",
  ].join("\n")
  return `${header}\n\n${packages.map((markdown, index) => `---\n\n## 记录 ${index + 1}：${items[index].title}\n\n${markdown}`).join("\n\n")}\n`
}

export async function importKnowledgeItemMarkdown(desktopRuntime: boolean, markdown: string): Promise<{
  status: "created" | "unchanged" | "conflict"
  item?: KnowledgeItem
}> {
  const parsed = parseKnowledgeMarkdown(markdown)
  assertEnabledKnowledgeDomain(parsed.item.domain)
  const packageHash = await sha256Text(markdown.replace(/\r\n/g, "\n"))
  if (!desktopRuntime) return { status: importBrowserKnowledgePackage(parsed, packageHash), item: parsed.item }
  const result = await invoke<{ status: "created" | "unchanged" | "conflict"; item?: KnowledgeItem }>("import_knowledge_markdown_package", {
    request: { packageHash, package: parsed },
  })
  return { ...result, item: result.item ? knowledgeItemSchema.parse(result.item) : undefined }
}
