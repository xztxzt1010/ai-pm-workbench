import {
  assertKnowledgeRelationScope,
  knowledgeItemSchema,
  knowledgeRelationSchema,
  knowledgeSourceSchema,
  nextKnowledgeStatus,
  type KnowledgeItem,
  type KnowledgeRelation,
  type KnowledgeSource,
} from "@/domain/knowledge-contract"
import type { KnowledgeMarkdownPackage } from "@/domain/knowledge-markdown"

const STORAGE_KEY = "apm-unified-knowledge-v1"

interface StoredKnowledgePackage extends KnowledgeMarkdownPackage {
  importHash?: string
}

function normalizePackage(value: StoredKnowledgePackage): StoredKnowledgePackage {
  const item = knowledgeItemSchema.parse(value.item)
  const sources = value.sources.map((source) => knowledgeSourceSchema.parse(source))
  const relations = value.relations.map((relation) => knowledgeRelationSchema.parse(relation))
  if (sources.some((source) => source.itemId !== item.id)) throw new Error("浏览器知识来源归属无效")
  if (relations.some((relation) => relation.fromItemId !== item.id && relation.toItemId !== item.id)) {
    throw new Error("浏览器知识关系归属无效")
  }
  return { schemaVersion: "1.0.0", item, sources, relations, importHash: value.importHash }
}

function readStore(): StoredKnowledgePackage[] {
  const raw = localStorage.getItem(STORAGE_KEY)
  if (!raw) return []
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    throw new Error("浏览器知识数据已损坏，请先导出其他数据后清理站点存储")
  }
  if (!Array.isArray(parsed)) throw new Error("浏览器知识数据格式无效")
  return parsed.map((item) => normalizePackage(item as StoredKnowledgePackage))
}

function writeStore(packages: StoredKnowledgePackage[]) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(packages.map(normalizePackage)))
}

function findPackage(packages: StoredKnowledgePackage[], itemId: string) {
  const found = packages.find((entry) => entry.item.id === itemId)
  if (!found) throw new Error("知识条目不存在或已被删除")
  return found
}

function matchesScope(item: KnowledgeItem, domain: "project" | "personal", projectId?: string) {
  return item.domain === domain && (domain === "personal" ? !item.projectId : item.projectId === projectId)
}

export function listBrowserKnowledge(input: {
  domain: "project" | "personal"
  projectId?: string
  status?: KnowledgeItem["status"]
  itemType?: KnowledgeItem["itemType"]
  limit?: number
}) {
  return readStore()
    .map((entry) => entry.item)
    .filter((item) => matchesScope(item, input.domain, input.projectId))
    .filter((item) => !input.status || item.status === input.status)
    .filter((item) => !input.itemType || item.itemType === input.itemType)
    .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))
    .slice(0, Math.min(100, Math.max(1, input.limit ?? 50)))
}

export function createBrowserKnowledge(input: {
  id: string
  itemType: KnowledgeItem["itemType"]
  domain: "project" | "personal"
  projectId?: string
  title: string
  contentMarkdown: string
  targetKind?: KnowledgeItem["targetKind"]
  targetId?: string
  targetVersion?: string
  createdBy: "user" | "agent"
}): KnowledgeItem {
  const packages = readStore()
  if (packages.some((entry) => entry.item.id === input.id)) throw new Error("知识标识已经存在")
  if (input.targetKind && packages.some((entry) => entry.item.targetKind === input.targetKind && entry.item.targetId === input.targetId)) {
    throw new Error("该正式对象已经注册到知识库")
  }
  const timestamp = new Date().toISOString()
  const item = knowledgeItemSchema.parse({
    ...input,
    status: "draft",
    contentVersion: 1,
    createdAt: timestamp,
    updatedAt: timestamp,
  })
  packages.push({ schemaVersion: "1.0.0", item, sources: [], relations: [] })
  writeStore(packages)
  return item
}

export function updateBrowserKnowledge(input: {
  itemId: string
  domain: "project" | "personal"
  projectId?: string
  expectedContentVersion: number
  title: string
  contentMarkdown: string
}): KnowledgeItem {
  const packages = readStore()
  const entry = findPackage(packages, input.itemId)
  if (!matchesScope(entry.item, input.domain, input.projectId)) throw new Error("知识条目不属于当前知识域")
  if (entry.item.contentVersion !== input.expectedContentVersion) throw new Error("知识内容已变化，请刷新后重试")
  if (!(["technical_discussion", "product_idea", "ai_learning"] as const).includes(entry.item.itemType as "technical_discussion" | "product_idea" | "ai_learning")) {
    throw new Error("正式对象适配不能在知识库中编辑正文")
  }
  const timestamp = new Date().toISOString()
  entry.item = knowledgeItemSchema.parse({
    ...entry.item,
    title: input.title,
    contentMarkdown: input.contentMarkdown,
    contentVersion: entry.item.contentVersion + 1,
    status: "draft",
    confirmedAt: undefined,
    archivedAt: undefined,
    archivedFromStatus: undefined,
    updatedAt: timestamp,
  })
  entry.importHash = undefined
  writeStore(packages)
  return entry.item
}

export function reviewBrowserKnowledge(input: {
  itemId: string
  domain: "project" | "personal"
  projectId?: string
  action: "confirm" | "archive" | "restore"
}): KnowledgeItem {
  const packages = readStore()
  const entry = findPackage(packages, input.itemId)
  if (!matchesScope(entry.item, input.domain, input.projectId)) throw new Error("知识条目不属于当前知识域")
  entry.item = nextKnowledgeStatus(entry.item, input.action, new Date().toISOString())
  entry.importHash = undefined
  writeStore(packages)
  return entry.item
}

export function listBrowserKnowledgeSources(itemId: string) {
  return [...findPackage(readStore(), itemId).sources]
}

export function addBrowserKnowledgeSource(input: KnowledgeSource): KnowledgeSource {
  const packages = readStore()
  const entry = findPackage(packages, input.itemId)
  const source = knowledgeSourceSchema.parse(input)
  if (entry.item.status === "archived") throw new Error("归档知识不能添加来源")
  if (entry.sources.some((candidate) => candidate.id === source.id || (
    candidate.sourceKind === source.sourceKind &&
    candidate.sourceRef === source.sourceRef &&
    candidate.sourceVersion === source.sourceVersion
  ))) throw new Error("该知识来源版本已经存在")
  entry.sources.push(source)
  entry.importHash = undefined
  writeStore(packages)
  return source
}

export function listBrowserKnowledgeRelations(itemId: string) {
  return [...findPackage(readStore(), itemId).relations]
}

export function createBrowserKnowledgeRelation(input: KnowledgeRelation): KnowledgeRelation {
  const packages = readStore()
  const fromEntry = findPackage(packages, input.fromItemId)
  const toEntry = findPackage(packages, input.toItemId)
  assertKnowledgeRelationScope(fromEntry.item, toEntry.item)
  if (fromEntry.item.status === "archived" || toEntry.item.status === "archived") throw new Error("归档知识不能建立关系")
  const relation = knowledgeRelationSchema.parse(input)
  if (packages.some((entry) => entry.relations.some((candidate) => candidate.id === relation.id || (
    candidate.fromItemId === relation.fromItemId &&
    candidate.toItemId === relation.toItemId &&
    candidate.relationType === relation.relationType
  )))) throw new Error("该知识关系已经存在")
  fromEntry.relations.push(relation)
  if (toEntry !== fromEntry) toEntry.relations.push(relation)
  fromEntry.importHash = undefined
  toEntry.importHash = undefined
  writeStore(packages)
  return relation
}

export function reviewBrowserKnowledgeRelation(relationId: string, action: "confirm" | "reject") {
  const packages = readStore()
  const matches = packages.flatMap((entry) => entry.relations.map((relation) => ({ entry, relation }))).filter(({ relation }) => relation.id === relationId)
  if (!matches.length) throw new Error("知识关系不存在")
  if (matches.some(({ relation }) => relation.status !== "draft")) throw new Error("知识关系已经处理")
  const timestamp = new Date().toISOString()
  for (const { entry, relation } of matches) {
    const next = knowledgeRelationSchema.parse({
      ...relation,
      status: action === "confirm" ? "confirmed" : "rejected",
      confirmedAt: action === "confirm" ? timestamp : undefined,
      updatedAt: timestamp,
    })
    entry.relations = entry.relations.map((candidate) => candidate.id === relationId ? next : candidate)
    entry.importHash = undefined
  }
  writeStore(packages)
}

export function getBrowserKnowledgePackage(itemId: string): KnowledgeMarkdownPackage {
  const entry = findPackage(readStore(), itemId)
  return { schemaVersion: "1.0.0", item: entry.item, sources: entry.sources, relations: entry.relations }
}

export function importBrowserKnowledgePackage(input: KnowledgeMarkdownPackage, packageHash: string): "created" | "unchanged" | "conflict" {
  const packages = readStore()
  const existing = packages.find((entry) => entry.item.id === input.item.id)
  if (existing) return existing.importHash === packageHash ? "unchanged" : "conflict"
  if (input.item.itemType === "meeting_record" || input.item.itemType === "project_decision") {
    throw new Error("浏览器本地模式不能验证会议或决策正式对象，请在对应数据运行时导入")
  }
  const timestamp = new Date().toISOString()
  const item = knowledgeItemSchema.parse({
    ...input.item,
    status: "draft",
    createdBy: "user",
    confirmedAt: undefined,
    archivedAt: undefined,
    archivedFromStatus: undefined,
    createdAt: timestamp,
    updatedAt: timestamp,
  })
  const sources = input.sources.map((source) => knowledgeSourceSchema.parse({ ...source, itemId: item.id, createdAt: timestamp }))
  const relations = input.relations.map((relation) => knowledgeRelationSchema.parse({
    ...relation,
    status: "draft",
    createdBy: "user",
    confirmedAt: undefined,
    createdAt: timestamp,
    updatedAt: timestamp,
  }))
  if (relations.length) throw new Error("浏览器单条导入暂不接受指向包外条目的关系")
  packages.push({ schemaVersion: "1.0.0", item, sources, relations, importHash: packageHash })
  writeStore(packages)
  return "created"
}
