import { z } from "zod"

export const knowledgeItemTypes = [
  "meeting_record",
  "technical_discussion",
  "product_idea",
  "ai_learning",
  "project_decision",
] as const
export const knowledgeStatuses = ["draft", "confirmed", "archived"] as const
export const knowledgeDomains = ["project", "personal", "company", "team"] as const
export const enabledKnowledgeDomains = ["project", "personal"] as const
export const knowledgeTargetKinds = ["meeting", "product_decision"] as const
export const knowledgeSourceKinds = [
  "manual",
  "markdown",
  "meeting",
  "product_document",
  "product_decision",
  "research_entry",
  "project_memory",
  "external_url",
] as const
export const knowledgeRelationTypes = [
  "derived_from",
  "supports",
  "contradicts",
  "relates_to",
  "supersedes",
] as const

const idSchema = z.string().trim().min(1).max(200)
const isoTimestampSchema = z.string().datetime({ offset: true })
const actorSchema = z.enum(["user", "agent", "system"])

export const knowledgeItemSchema = z
  .object({
    id: idSchema,
    itemType: z.enum(knowledgeItemTypes),
    status: z.enum(knowledgeStatuses),
    domain: z.enum(knowledgeDomains),
    projectId: idSchema.optional(),
    scopeId: idSchema.optional(),
    title: z.string().trim().min(1).max(200),
    contentMarkdown: z.string().max(500_000),
    targetKind: z.enum(knowledgeTargetKinds).optional(),
    targetId: idSchema.optional(),
    targetVersion: z.string().trim().min(1).max(200).optional(),
    contentVersion: z.number().int().positive(),
    createdBy: actorSchema,
    createdAt: isoTimestampSchema,
    updatedAt: isoTimestampSchema,
    confirmedAt: isoTimestampSchema.optional(),
    archivedAt: isoTimestampSchema.optional(),
    archivedFromStatus: z.enum(["draft", "confirmed"]).optional(),
  })
  .superRefine((item, context) => {
    if (item.domain === "project" && (!item.projectId || item.scopeId)) {
      context.addIssue({ code: "custom", message: "项目知识必须且只能绑定 projectId" })
    }
    if (item.domain === "personal" && (item.projectId || item.scopeId)) {
      context.addIssue({ code: "custom", message: "个人知识不能绑定项目或未来组织范围" })
    }
    if ((item.domain === "company" || item.domain === "team") && (!item.scopeId || item.projectId)) {
      context.addIssue({ code: "custom", message: "公司/团队知识必须且只能绑定 scopeId" })
    }
    if (item.createdBy === "agent" && item.status !== "draft") {
      context.addIssue({ code: "custom", message: "Agent 只能创建草稿" })
    }
    const referenceTarget = item.itemType === "meeting_record"
      ? "meeting"
      : item.itemType === "project_decision"
        ? "product_decision"
        : undefined
    if (referenceTarget) {
      if (item.targetKind !== referenceTarget || !item.targetId || !item.targetVersion || item.contentMarkdown.trim()) {
        context.addIssue({ code: "custom", message: "会议和项目决策必须引用正式对象且不能复制正文" })
      }
    } else if (item.targetKind || item.targetId || item.targetVersion || !item.contentMarkdown.trim()) {
      context.addIssue({ code: "custom", message: "技术讨论、产品想法和 AI 学习必须自行承载正文" })
    }
    if (item.status === "confirmed" && !item.confirmedAt) {
      context.addIssue({ code: "custom", message: "已确认知识必须记录确认时间" })
    }
    if (item.status === "draft" && item.confirmedAt) {
      context.addIssue({ code: "custom", message: "草稿不能携带确认时间" })
    }
    if (item.status === "archived") {
      if (!item.archivedAt || !item.archivedFromStatus) {
        context.addIssue({ code: "custom", message: "归档知识必须记录归档时间和归档前状态" })
      }
    } else if (item.archivedAt || item.archivedFromStatus) {
      context.addIssue({ code: "custom", message: "非归档知识不能携带归档状态" })
    }
  })

export const knowledgeSourceSchema = z.object({
  id: idSchema,
  itemId: idSchema,
  sourceKind: z.enum(knowledgeSourceKinds),
  sourceRef: z.string().trim().min(1).max(1_000),
  sourceVersion: z.string().trim().min(1).max(200),
  contentHash: z.string().regex(/^[a-f0-9]{64}$/),
  title: z.string().trim().min(1).max(200),
  locator: z.record(z.string(), z.unknown()),
  capturedAt: isoTimestampSchema,
  createdAt: isoTimestampSchema,
})

export const knowledgeRelationSchema = z.object({
  id: idSchema,
  fromItemId: idSchema,
  toItemId: idSchema,
  relationType: z.enum(knowledgeRelationTypes),
  status: z.enum(["draft", "confirmed", "rejected"]),
  evidence: z.array(z.record(z.string(), z.unknown())).max(20),
  createdBy: actorSchema,
  createdAt: isoTimestampSchema,
  updatedAt: isoTimestampSchema,
  confirmedAt: isoTimestampSchema.optional(),
}).superRefine((relation, context) => {
  if (relation.fromItemId === relation.toItemId) {
    context.addIssue({ code: "custom", message: "知识不能与自身建立关系" })
  }
  if (relation.createdBy === "agent" && relation.status !== "draft") {
    context.addIssue({ code: "custom", message: "Agent 关系必须先作为草稿" })
  }
  if ((relation.status === "confirmed") !== Boolean(relation.confirmedAt)) {
    context.addIssue({ code: "custom", message: "关系确认状态和确认时间不一致" })
  }
})

export type KnowledgeItem = z.infer<typeof knowledgeItemSchema>
export type KnowledgeSource = z.infer<typeof knowledgeSourceSchema>
export type KnowledgeRelation = z.infer<typeof knowledgeRelationSchema>

export function assertEnabledKnowledgeDomain(domain: KnowledgeItem["domain"]): asserts domain is "project" | "personal" {
  if (!enabledKnowledgeDomains.includes(domain as "project" | "personal")) {
    throw new Error("V0.x 只允许写入项目域或个人域")
  }
}

export function assertKnowledgeRelationScope(from: KnowledgeItem, to: KnowledgeItem) {
  if (from.domain !== to.domain || from.projectId !== to.projectId || from.scopeId !== to.scopeId) {
    throw new Error("知识关系不能跨知识域或跨项目建立")
  }
}

export function nextKnowledgeStatus(item: KnowledgeItem, action: "confirm" | "archive" | "restore", timestamp: string): KnowledgeItem {
  const now = isoTimestampSchema.parse(timestamp)
  if (action === "confirm" && item.status === "draft") {
    return knowledgeItemSchema.parse({ ...item, status: "confirmed", confirmedAt: now, updatedAt: now })
  }
  if (action === "archive" && item.status !== "archived") {
    return knowledgeItemSchema.parse({
      ...item,
      status: "archived",
      archivedAt: now,
      archivedFromStatus: item.status,
      updatedAt: now,
    })
  }
  if (action === "restore" && item.status === "archived") {
    const restoredStatus = item.archivedFromStatus
    return knowledgeItemSchema.parse({
      ...item,
      status: restoredStatus,
      confirmedAt: restoredStatus === "confirmed" ? item.confirmedAt ?? now : undefined,
      archivedAt: undefined,
      archivedFromStatus: undefined,
      updatedAt: now,
    })
  }
  throw new Error("当前知识状态不允许执行该操作")
}
