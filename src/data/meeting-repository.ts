import { invoke } from "@tauri-apps/api/core"

import { openDesktopDatabase } from "@/data/desktop-database"
import { AppError, normalizeAppError } from "@/domain/app-error"
import type { MeetingDocument, MeetingParagraph, MeetingSource, TextMeetingFileInspection } from "@/domain/models"

const BROWSER_DOCUMENTS_KEY = "assistant-product-manager.meeting-documents.v1"

export interface DuplicateMeetingSource {
  meetingId: string
  meetingTitle: string
  sourceId: string
}

export interface MeetingDeletionResult {
  deleted: boolean
  attachmentsRemoved: number
  cleanupWarnings: string[]
}

export interface MeetingRepository {
  create(document: MeetingDocument): Promise<void>
  inspectTextFile(sourcePath: string): Promise<TextMeetingFileInspection>
  createFile(sourcePath: string, document: MeetingDocument): Promise<void>
  delete(meetingId: string): Promise<MeetingDeletionResult>
  retryDocx(meetingId: string): Promise<void>
  findDuplicate(projectId: string, contentHash: string): Promise<DuplicateMeetingSource | undefined>
  getDocument(meetingId: string): Promise<MeetingDocument>
}

type SourceRow = {
  id: string
  meeting_id: string
  source_type: MeetingSource["sourceType"]
  file_name: string | null
  file_path: string | null
  content_hash: string
  parsed_text: string
  mime_type: string
  byte_size: number
  parse_status: MeetingSource["parseStatus"]
  parse_error: string | null
  created_at: string
  updated_at: string | null
}

type ParagraphRow = {
  id: string
  meeting_id: string
  source_id: string
  ordinal: number
  paragraph_text: string
  start_offset: number
  end_offset: number
  content_hash: string
  created_at: string
}

function mapSource(row: SourceRow): MeetingSource {
  return {
    id: row.id,
    meetingId: row.meeting_id,
    sourceType: row.source_type,
    fileName: row.file_name ?? undefined,
    filePath: row.file_path ?? undefined,
    contentHash: row.content_hash,
    parsedText: row.parsed_text,
    mimeType: row.mime_type,
    byteSize: row.byte_size,
    parseStatus: row.parse_status,
    parseError: row.parse_error ?? undefined,
    createdAt: row.created_at,
    updatedAt: row.updated_at ?? row.created_at,
  }
}

function mapParagraph(row: ParagraphRow): MeetingParagraph {
  return {
    id: row.id,
    meetingId: row.meeting_id,
    sourceId: row.source_id,
    ordinal: row.ordinal,
    text: row.paragraph_text,
    startOffset: row.start_offset,
    endOffset: row.end_offset,
    contentHash: row.content_hash,
    createdAt: row.created_at,
  }
}

const desktopMeetingRepository: MeetingRepository = {
  async create(document) {
    try {
      await invoke("create_meeting_document", { document })
    } catch (error) {
      throw normalizeAppError(error, "storage", "会议原文写入本地数据库失败")
    }
  },

  async inspectTextFile(sourcePath) {
    try {
      return await invoke<TextMeetingFileInspection>("inspect_text_meeting_file", { sourcePath })
    } catch (error) {
      throw normalizeAppError(error, "validation", "无法读取会议文本文件")
    }
  },

  async createFile(sourcePath, document) {
    try {
      const managedPath = await invoke<string>("create_file_meeting_document", { sourcePath, document })
      document.source.filePath = managedPath
    } catch (error) {
      throw normalizeAppError(error, "storage", "会议文件复制或写入本地数据库失败")
    }
  },

  async delete(meetingId) {
    try {
      return await invoke<MeetingDeletionResult>("delete_meeting_document", { meetingId })
    } catch (error) {
      throw normalizeAppError(error, "storage", "删除会议记录失败")
    }
  },

  async retryDocx(meetingId) {
    try {
      await invoke("retry_docx_meeting", { meetingId, updatedAt: new Date().toISOString() })
    } catch (error) {
      throw normalizeAppError(error, "validation", "docx 重新解析失败")
    }
  },

  async findDuplicate(projectId, contentHash) {
    const database = await openDesktopDatabase()
    const rows = await database.select<Array<{
      meeting_id: string
      meeting_title: string
      source_id: string
    }>>(
      `SELECT meetings.id AS meeting_id, meetings.title AS meeting_title, meeting_sources.id AS source_id
       FROM meeting_sources
       JOIN meetings ON meetings.id = meeting_sources.meeting_id
       WHERE meetings.project_id = $1 AND meeting_sources.content_hash = $2
       ORDER BY meeting_sources.created_at DESC
       LIMIT 1`,
      [projectId, contentHash],
    )
    const row = rows[0]
    return row ? { meetingId: row.meeting_id, meetingTitle: row.meeting_title, sourceId: row.source_id } : undefined
  },

  async getDocument(meetingId) {
    const database = await openDesktopDatabase()
    const meetingRows = await database.select<Array<{
      id: string
      project_id: string | null
      title: string
      meeting_date: string
      status: MeetingDocument["meeting"]["status"]
      created_at: string
      updated_at: string
      source_type: MeetingSource["sourceType"]
    }>>(
      `SELECT meetings.id, meetings.project_id, meetings.title, meetings.meeting_date,
              meetings.status, meetings.created_at, meetings.updated_at, meeting_sources.source_type
       FROM meetings
       JOIN meeting_sources ON meeting_sources.meeting_id = meetings.id
       WHERE meetings.id = $1
       ORDER BY meeting_sources.created_at DESC
       LIMIT 1`,
      [meetingId],
    )
    const meetingRow = meetingRows[0]
    if (!meetingRow) throw new AppError("not_found", "会议原文不存在或已被删除")

    const sourceRows = await database.select<SourceRow[]>(
      `SELECT * FROM meeting_sources
       WHERE meeting_id = $1
       ORDER BY created_at DESC
       LIMIT 1`,
      [meetingId],
    )
    const sourceRow = sourceRows[0]
    if (!sourceRow) throw new AppError("not_found", "会议来源不存在或已被删除")
    const paragraphRows = await database.select<ParagraphRow[]>(
      "SELECT * FROM meeting_paragraphs WHERE source_id = $1 ORDER BY ordinal ASC",
      [sourceRow.id],
    )

    return {
      meeting: {
        id: meetingRow.id,
        projectId: meetingRow.project_id ?? undefined,
        title: meetingRow.title,
        meetingDate: meetingRow.meeting_date,
        sourceType: meetingRow.source_type,
        status: meetingRow.status,
        createdAt: meetingRow.created_at,
        updatedAt: meetingRow.updated_at,
      },
      source: mapSource(sourceRow),
      paragraphs: paragraphRows.map(mapParagraph),
    }
  },
}

function loadBrowserDocuments(): MeetingDocument[] {
  try {
    const stored = localStorage.getItem(BROWSER_DOCUMENTS_KEY)
    return stored ? JSON.parse(stored) as MeetingDocument[] : []
  } catch {
    return []
  }
}

function saveBrowserDocuments(documents: MeetingDocument[]) {
  localStorage.setItem(BROWSER_DOCUMENTS_KEY, JSON.stringify(documents))
}

const browserMeetingRepository: MeetingRepository = {
  async create(document) {
    saveBrowserDocuments([...loadBrowserDocuments(), document])
  },

  async inspectTextFile() {
    throw new AppError("permission", "文件导入仅在桌面应用中可用")
  },

  async createFile() {
    throw new AppError("permission", "文件导入仅在桌面应用中可用")
  },

  async delete(meetingId) {
    const documents = loadBrowserDocuments()
    const remaining = documents.filter((document) => document.meeting.id !== meetingId)
    saveBrowserDocuments(remaining)
    return { deleted: remaining.length !== documents.length, attachmentsRemoved: 0, cleanupWarnings: [] }
  },

  async retryDocx() {
    throw new AppError("permission", "docx 重试仅在桌面应用中可用")
  },

  async findDuplicate(projectId, contentHash) {
    const duplicate = loadBrowserDocuments().find((document) => (
      document.meeting.projectId === projectId && document.source.contentHash === contentHash
    ))
    return duplicate ? {
      meetingId: duplicate.meeting.id,
      meetingTitle: duplicate.meeting.title,
      sourceId: duplicate.source.id,
    } : undefined
  },

  async getDocument(meetingId) {
    const document = loadBrowserDocuments().find((candidate) => candidate.meeting.id === meetingId)
    if (!document) throw new AppError("not_found", "会议原文不存在或已被删除")
    return document
  },
}

export function getMeetingRepository(desktopRuntime: boolean) {
  return desktopRuntime ? desktopMeetingRepository : browserMeetingRepository
}
