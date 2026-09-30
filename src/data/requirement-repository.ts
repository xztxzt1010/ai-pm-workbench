import { openDesktopDatabase } from "@/data/desktop-database"
import { AppError, normalizeAppError } from "@/domain/app-error"
import type { RequirementContent, RequirementDocument, RequirementEvidence, RequirementStatus } from "@/domain/models"

const BROWSER_KEY = "assistant-product-manager.requirements.v1"

type RequirementRow = {
  id: string
  meeting_id: string
  project_id: string | null
  current_version_id: string | null
  title: string
  status: RequirementStatus
  created_at: string
  updated_at: string
  version_id: string
  version_number: number
  version_title: string
  content_json: string
  evidence_json: string
  source: "ai" | "user"
  is_confirmed: number
  version_created_at: string
}

export interface RequirementDraftInput {
  meetingId: string
  projectId?: string
  title: string
  content: RequirementContent
  evidence: RequirementEvidence[]
  source?: "ai" | "user"
  researchCandidateId?: string
}

export interface RequirementRepository {
  listByMeeting(meetingId: string): Promise<RequirementDocument[]>
  listByProject(projectId: string, limit?: number): Promise<RequirementDocument[]>
  createDraft(input: RequirementDraftInput): Promise<RequirementDocument>
  confirm(cardId: string): Promise<RequirementDocument>
  submitForConfirmation(cardId: string): Promise<RequirementDocument>
  deleteByMeeting(meetingId: string): Promise<void>
  revise(cardId: string, input: Pick<RequirementDraftInput, "title" | "content" | "evidence">): Promise<RequirementDocument>
  archive(cardId: string): Promise<RequirementDocument>
}

function validateDraftInput(input: Pick<RequirementDraftInput, "title" | "content" | "evidence">) {
  if (!input.title.trim() || !input.content.description.trim()) throw new AppError("validation", "需求标题和描述不能为空")
  if (!input.evidence.length || input.evidence.some((item) => !item.paragraphId.trim() || !item.quote.trim() || item.startOffset < 0 || item.endOffset <= item.startOffset || (item.sourceType === "research_entry" && (!item.sourceId?.trim() || item.paragraphId !== `research:${item.sourceId}`)) || (item.sourceType !== undefined && item.sourceType !== "meeting_paragraph" && item.sourceType !== "research_entry"))) {
    throw new AppError("validation", "需求版本必须包含至少一条有效原文证据")
  }
  if (new Set(input.evidence.map((item) => item.paragraphId)).size !== input.evidence.length) throw new AppError("validation", "同一原文段落不能重复作为证据")
}

function mapRow(row: RequirementRow): RequirementDocument {
  const currentVersion = {
    id: row.version_id,
    requirementCardId: row.id,
    versionNumber: row.version_number,
    title: row.version_title || row.title,
    content: JSON.parse(row.content_json) as RequirementContent,
    evidence: JSON.parse(row.evidence_json) as RequirementEvidence[],
    source: row.source,
    isConfirmed: Boolean(row.is_confirmed),
    createdAt: row.version_created_at,
  }
  return {
    card: {
      id: row.id,
      meetingId: row.meeting_id,
      projectId: row.project_id ?? undefined,
      currentVersionId: row.current_version_id ?? undefined,
      title: row.title,
      status: row.status,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    },
    currentVersion,
    versions: [currentVersion],
  }
}

async function desktopVersions(cardId: string) {
  const db = await openDesktopDatabase()
  const rows = await db.select<Array<{ id: string; requirement_card_id: string; version_number: number; title: string; content_json: string; evidence_json: string; source: "ai" | "user"; is_confirmed: number; created_at: string }>>(
    "SELECT * FROM requirement_versions WHERE requirement_card_id = $1 ORDER BY version_number DESC",
    [cardId],
  )
  return rows.map((row) => ({ id: row.id, requirementCardId: row.requirement_card_id, versionNumber: row.version_number, title: row.title, content: JSON.parse(row.content_json) as RequirementContent, evidence: JSON.parse(row.evidence_json) as RequirementEvidence[], source: row.source, isConfirmed: Boolean(row.is_confirmed), createdAt: row.created_at }))
}

const SELECT_CURRENT = `SELECT cards.*, versions.id AS version_id, versions.version_number,
  versions.title AS version_title,
  versions.content_json, versions.evidence_json, versions.source, versions.is_confirmed,
  versions.created_at AS version_created_at
  FROM requirement_cards cards
  JOIN requirement_versions versions ON versions.id = cards.current_version_id`

async function desktopGet(cardId: string) {
  const db = await openDesktopDatabase()
  const rows = await db.select<RequirementRow[]>(`${SELECT_CURRENT} WHERE cards.id = $1 LIMIT 1`, [cardId])
  if (!rows[0]) throw new AppError("not_found", "需求卡不存在或已被删除")
  const document = mapRow(rows[0])
  document.versions = await desktopVersions(cardId)
  return document
}

const desktopRepository: RequirementRepository = {
  async listByMeeting(meetingId) {
    const db = await openDesktopDatabase()
    const rows = await db.select<RequirementRow[]>(`${SELECT_CURRENT} WHERE cards.meeting_id = $1 ORDER BY cards.updated_at DESC`, [meetingId])
    return Promise.all(rows.map(async (row) => {
      const document = mapRow(row)
      document.versions = await desktopVersions(row.id)
      return document
    }))
  },
  async listByProject(projectId, limit = 200) {
    const db = await openDesktopDatabase()
    const boundedLimit = Math.max(1, Math.min(200, Math.trunc(limit)))
    const rows = await db.select<RequirementRow[]>(`${SELECT_CURRENT} WHERE cards.project_id = $1 ORDER BY cards.updated_at DESC LIMIT $2`, [projectId, boundedLimit])
    return Promise.all(rows.map(async (row) => {
      const document = mapRow(row)
      document.versions = await desktopVersions(row.id)
      return document
    }))
  },

  async createDraft(input) {
    validateDraftInput(input)
    const title = input.title.trim()
    const timestamp = new Date().toISOString()
    const cardId = crypto.randomUUID()
    const versionId = crypto.randomUUID()
    const db = await openDesktopDatabase()
    await db.execute("BEGIN IMMEDIATE")
    try {
      await db.execute(
        `INSERT INTO requirement_cards (id, meeting_id, project_id, current_version_id, title, status, created_at, updated_at)
         VALUES ($1, $2, $3, $4, $5, 'draft', $6, $6)`,
        [cardId, input.meetingId, input.projectId ?? null, versionId, title, timestamp],
      )
      await db.execute(
        `INSERT INTO requirement_versions (id, requirement_card_id, version_number, title, content_json, evidence_json, source, is_confirmed, created_at)
         VALUES ($1, $2, 1, $3, $4, $5, $6, 0, $7)`,
        [versionId, cardId, title, JSON.stringify(input.content), JSON.stringify(input.evidence), input.source ?? "user", timestamp],
      )
      if (input.researchCandidateId) {
        const linked = await db.execute(
          `UPDATE research_requirement_candidates
           SET requirement_card_id = $1, updated_at = $2
           WHERE id = $3
             AND project_id = $4
             AND status = 'accepted'
             AND requirement_card_id IS NULL
             AND EXISTS (
               SELECT 1 FROM meetings
               WHERE meetings.id = $5
                 AND meetings.project_id = research_requirement_candidates.project_id
             )`,
          [cardId, timestamp, input.researchCandidateId, input.projectId ?? null, input.meetingId],
        )
        if (!linked.rowsAffected) throw new AppError("conflict", "研究需求候选已转换、未接受或项目会议不匹配")
      }
      await db.execute("COMMIT")
      return desktopGet(cardId)
    } catch (error) {
      await db.execute("ROLLBACK").catch(() => undefined)
      throw normalizeAppError(error, "storage", "需求草稿写入失败")
    }
  },

  async confirm(cardId) {
    const db = await openDesktopDatabase()
    await db.execute("BEGIN IMMEDIATE")
    try {
      const result = await db.execute(
        `UPDATE requirement_versions SET is_confirmed = 1
         WHERE id = (SELECT current_version_id FROM requirement_cards WHERE id = $1)
           AND is_confirmed = 0
           AND EXISTS (SELECT 1 FROM requirement_cards WHERE id = $1 AND status = 'pending_confirmation')`,
        [cardId],
      )
      if (!result.rowsAffected) throw new AppError("conflict", "需求卡已确认或不存在")
      await db.execute("UPDATE requirement_cards SET status = 'confirmed', updated_at = $1 WHERE id = $2", [new Date().toISOString(), cardId])
      await db.execute("COMMIT")
      return desktopGet(cardId)
    } catch (error) {
      await db.execute("ROLLBACK").catch(() => undefined)
      if (error instanceof AppError) throw error
      throw normalizeAppError(error, "storage", "确认需求版本失败")
    }
  },
  async submitForConfirmation(cardId) {
    const db = await openDesktopDatabase()
    const result = await db.execute("UPDATE requirement_cards SET status = 'pending_confirmation', updated_at = $1 WHERE id = $2 AND status = 'draft'", [new Date().toISOString(), cardId])
    if (!result.rowsAffected) throw new AppError("conflict", "需求卡不是可提交确认的草稿")
    return desktopGet(cardId)
  },
  async deleteByMeeting(meetingId) {
    const db = await openDesktopDatabase()
    await db.execute("DELETE FROM requirement_cards WHERE meeting_id = $1", [meetingId])
  },
  async revise(cardId, input) {
    validateDraftInput(input)
    const current = await desktopGet(cardId)
    if (current.card.status === "archived") throw new AppError("conflict", "已归档需求不能创建新版本")
    const db = await openDesktopDatabase()
    const versionId = crypto.randomUUID()
    const timestamp = new Date().toISOString()
    const versionNumber = Math.max(...current.versions.map((version) => version.versionNumber)) + 1
    await db.execute("BEGIN IMMEDIATE")
    try {
      await db.execute(
        `INSERT INTO requirement_versions (id, requirement_card_id, version_number, title, content_json, evidence_json, source, is_confirmed, created_at)
         VALUES ($1, $2, $3, $4, $5, $6, 'user', 0, $7)`,
        [versionId, cardId, versionNumber, input.title.trim(), JSON.stringify(input.content), JSON.stringify(input.evidence), timestamp],
      )
      await db.execute("UPDATE requirement_cards SET title = $1, current_version_id = $2, status = 'draft', updated_at = $3 WHERE id = $4", [input.title.trim(), versionId, timestamp, cardId])
      await db.execute("COMMIT")
      return desktopGet(cardId)
    } catch (error) {
      await db.execute("ROLLBACK").catch(() => undefined)
      throw normalizeAppError(error, "storage", "创建需求新版本失败")
    }
  },
  async archive(cardId) {
    const db = await openDesktopDatabase()
    const result = await db.execute("UPDATE requirement_cards SET status = 'archived', updated_at = $1 WHERE id = $2 AND status != 'archived'", [new Date().toISOString(), cardId])
    if (!result.rowsAffected) throw new AppError("conflict", "需求卡已归档或不存在")
    return desktopGet(cardId)
  },
}

function loadBrowser() {
  try {
    const stored = JSON.parse(localStorage.getItem(BROWSER_KEY) ?? "[]") as RequirementDocument[]
    return stored.map((document) => {
      const legacyTitle = document.card.title
      const versions = (document.versions?.length ? document.versions : [document.currentVersion]).map((version) => ({ ...version, title: version.title || legacyTitle }))
      const currentVersion = { ...document.currentVersion, title: document.currentVersion.title || legacyTitle }
      return { ...document, currentVersion, versions }
    })
  } catch { return [] }
}

function saveBrowser(documents: RequirementDocument[]) {
  localStorage.setItem(BROWSER_KEY, JSON.stringify(documents))
}

const browserRepository: RequirementRepository = {
  async listByMeeting(meetingId) {
    return loadBrowser().filter((document) => document.card.meetingId === meetingId)
  },
  async listByProject(projectId, limit = 200) {
    const boundedLimit = Math.max(1, Math.min(200, Math.trunc(limit)))
    return loadBrowser().filter((document) => document.card.projectId === projectId).slice(0, boundedLimit)
  },
  async createDraft(input) {
    validateDraftInput(input)
    const timestamp = new Date().toISOString()
    const cardId = crypto.randomUUID()
    const versionId = crypto.randomUUID()
    const document: RequirementDocument = {
      card: { id: cardId, meetingId: input.meetingId, projectId: input.projectId, currentVersionId: versionId, title: input.title.trim(), status: "draft", createdAt: timestamp, updatedAt: timestamp },
      currentVersion: { id: versionId, requirementCardId: cardId, versionNumber: 1, title: input.title.trim(), content: input.content, evidence: input.evidence, source: input.source ?? "user", isConfirmed: false, createdAt: timestamp },
      versions: [],
    }
    document.versions = [document.currentVersion]
    saveBrowser([document, ...loadBrowser()])
    return document
  },
  async confirm(cardId) {
    const documents = loadBrowser()
    const index = documents.findIndex((document) => document.card.id === cardId)
    if (index < 0 || documents[index].currentVersion.isConfirmed || documents[index].card.status !== "pending_confirmation") throw new AppError("conflict", "需求卡不是待确认状态或已确认")
    const updated: RequirementDocument = {
      card: { ...documents[index].card, status: "confirmed", updatedAt: new Date().toISOString() },
      currentVersion: { ...documents[index].currentVersion, isConfirmed: true },
      versions: documents[index].versions.map((version) => version.id === documents[index].currentVersion.id ? { ...version, isConfirmed: true } : version),
    }
    documents[index] = updated
    saveBrowser(documents)
    return updated
  },
  async submitForConfirmation(cardId) {
    const documents = loadBrowser()
    const index = documents.findIndex((document) => document.card.id === cardId)
    if (index < 0 || documents[index].card.status !== "draft") throw new AppError("conflict", "需求卡不是可提交确认的草稿")
    documents[index] = { ...documents[index], card: { ...documents[index].card, status: "pending_confirmation", updatedAt: new Date().toISOString() } }
    saveBrowser(documents)
    return documents[index]
  },
  async deleteByMeeting(meetingId) {
    saveBrowser(loadBrowser().filter((document) => document.card.meetingId !== meetingId))
  },
  async revise(cardId, input) {
    validateDraftInput(input)
    const documents = loadBrowser()
    const index = documents.findIndex((document) => document.card.id === cardId)
    if (index < 0 || documents[index].card.status === "archived") throw new AppError("conflict", "已归档需求不能创建新版本")
    const timestamp = new Date().toISOString()
    const version = { id: crypto.randomUUID(), requirementCardId: cardId, versionNumber: Math.max(...documents[index].versions.map((item) => item.versionNumber)) + 1, title: input.title.trim(), content: input.content, evidence: input.evidence, source: "user" as const, isConfirmed: false, createdAt: timestamp }
    const updated: RequirementDocument = { card: { ...documents[index].card, title: input.title.trim(), currentVersionId: version.id, status: "draft", updatedAt: timestamp }, currentVersion: version, versions: [version, ...documents[index].versions] }
    documents[index] = updated
    saveBrowser(documents)
    return updated
  },
  async archive(cardId) {
    const documents = loadBrowser()
    const index = documents.findIndex((document) => document.card.id === cardId)
    if (index < 0 || documents[index].card.status === "archived") throw new AppError("conflict", "需求卡已归档或不存在")
    const updated = { ...documents[index], card: { ...documents[index].card, status: "archived" as const, updatedAt: new Date().toISOString() } }
    documents[index] = updated
    saveBrowser(documents)
    return updated
  },
}

export function getRequirementRepository(desktopRuntime: boolean) {
  return desktopRuntime ? desktopRepository : browserRepository
}
