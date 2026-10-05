import {
  knowledgeItemSchema,
  knowledgeRelationSchema,
  knowledgeSourceSchema,
  type KnowledgeItem,
  type KnowledgeRelation,
  type KnowledgeSource,
} from "@/domain/knowledge-contract"

const START_MARKER = "<!-- apm-knowledge:v1"
const END_MARKER = "-->"
const MAX_PACKAGE_BYTES = 1_000_000

export interface KnowledgeMarkdownPackage {
  schemaVersion: "1.0.0"
  item: KnowledgeItem
  sources: KnowledgeSource[]
  relations: KnowledgeRelation[]
}

function compareById<T extends { id: string }>(left: T, right: T) {
  return left.id.localeCompare(right.id)
}

function normalizedPackage(input: KnowledgeMarkdownPackage): KnowledgeMarkdownPackage {
  const item = knowledgeItemSchema.parse(input.item)
  const sources = input.sources.map((source) => knowledgeSourceSchema.parse(source)).sort(compareById)
  const relations = input.relations.map((relation) => knowledgeRelationSchema.parse(relation)).sort(compareById)
  if (sources.some((source) => source.itemId !== item.id)) throw new Error("Markdown 包含不属于当前条目的来源")
  if (relations.some((relation) => relation.fromItemId !== item.id && relation.toItemId !== item.id)) {
    throw new Error("Markdown 包含与当前条目无关的关系")
  }
  return { schemaVersion: "1.0.0", item, sources, relations }
}

function packageMetadata(input: KnowledgeMarkdownPackage) {
  const normalized = normalizedPackage(input)
  return {
    schemaVersion: normalized.schemaVersion,
    item: { ...normalized.item, contentMarkdown: "" },
    sources: normalized.sources,
    relations: normalized.relations,
  }
}

export function renderKnowledgeMarkdown(input: KnowledgeMarkdownPackage): string {
  const normalized = normalizedPackage(input)
  const metadata = JSON.stringify(packageMetadata(normalized), null, 2)
  const body = normalized.item.contentMarkdown
  return `${START_MARKER}\n${metadata}\n${END_MARKER}\n\n${body}${body.endsWith("\n") || !body ? "" : "\n"}`
}

export function parseKnowledgeMarkdown(markdown: string): KnowledgeMarkdownPackage {
  if (new TextEncoder().encode(markdown).byteLength > MAX_PACKAGE_BYTES) throw new Error("知识 Markdown 包不能超过 1 MB")
  if (!markdown.startsWith(`${START_MARKER}\n`)) throw new Error("缺少 APM Knowledge v1 元数据")
  const markerEnd = markdown.indexOf(`\n${END_MARKER}`)
  if (markerEnd < 0) throw new Error("知识 Markdown 元数据未闭合")
  const metadataText = markdown.slice(START_MARKER.length + 1, markerEnd)
  let metadata: unknown
  try {
    metadata = JSON.parse(metadataText)
  } catch {
    throw new Error("知识 Markdown 元数据不是有效 JSON")
  }
  if (!metadata || typeof metadata !== "object" || (metadata as { schemaVersion?: unknown }).schemaVersion !== "1.0.0") {
    throw new Error("不支持的知识 Markdown 版本")
  }
  const bodyStart = markerEnd + END_MARKER.length + 1
  const body = markdown.slice(bodyStart).replace(/^\r?\n(?:\r?\n)?/, "").replace(/\r\n/g, "\n").replace(/\n$/, "")
  const raw = metadata as Omit<KnowledgeMarkdownPackage, "item"> & { item: KnowledgeItem }
  return normalizedPackage({
    schemaVersion: "1.0.0",
    item: { ...raw.item, contentMarkdown: body },
    sources: raw.sources,
    relations: raw.relations,
  })
}

function canonicalPackage(input: KnowledgeMarkdownPackage) {
  return JSON.stringify(normalizedPackage(input))
}

export function planKnowledgeMarkdownImport(existing: KnowledgeMarkdownPackage | undefined, incomingMarkdown: string): {
  action: "create" | "unchanged" | "conflict"
  incoming: KnowledgeMarkdownPackage
} {
  const incoming = parseKnowledgeMarkdown(incomingMarkdown)
  if (!existing) return { action: "create", incoming }
  if (existing.item.id !== incoming.item.id) throw new Error("比较导入包时知识标识不一致")
  return {
    action: canonicalPackage(existing) === canonicalPackage(incoming) ? "unchanged" : "conflict",
    incoming,
  }
}
