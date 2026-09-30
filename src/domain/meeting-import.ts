import { AppError } from "@/domain/app-error"
import type { MeetingDocument, MeetingParagraph, MeetingSourceType, TextMeetingFileInspection } from "@/domain/models"

export const MAX_MEETING_TEXT_BYTES = 10 * 1024 * 1024

export interface PasteMeetingInput {
  projectId: string
  title: string
  meetingDate: string
  text: string
}

export interface FileMeetingInput {
  projectId: string
  title: string
  meetingDate: string
  sourcePath: string
}

type MeetingImportDependencies = {
  now: () => string
  uuid: () => string
}

const defaultDependencies: MeetingImportDependencies = {
  now: () => new Date().toISOString(),
  uuid: () => crypto.randomUUID(),
}

export function normalizeMeetingText(input: string) {
  const withoutBom = input.replace(/^\uFEFF/, "").replace(/\r\n?/g, "\n")
  return withoutBom
    .split(/\n\s*\n+/)
    .map((paragraph) => paragraph.split("\n").map((line) => line.trimEnd()).join("\n").trim())
    .filter(Boolean)
    .join("\n\n")
}

export async function sha256Text(text: string) {
  const bytes = new TextEncoder().encode(text)
  const digest = await crypto.subtle.digest("SHA-256", bytes)
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("")
}

async function createParagraphs(
  meetingId: string,
  sourceId: string,
  text: string,
  createdAt: string,
): Promise<MeetingParagraph[]> {
  const paragraphs = text.split("\n\n")
  let offset = 0
  return Promise.all(paragraphs.map(async (paragraph, index) => {
    const startOffset = offset
    const endOffset = startOffset + paragraph.length
    offset = endOffset + 2
    return {
      id: `${sourceId}:p${String(index + 1).padStart(4, "0")}`,
      meetingId,
      sourceId,
      ordinal: index + 1,
      text: paragraph,
      startOffset,
      endOffset,
      contentHash: await sha256Text(paragraph),
      createdAt,
    }
  }))
}

async function prepareMeeting(
  input: Pick<PasteMeetingInput, "projectId" | "title" | "meetingDate">,
  parsedTextInput: string,
  source: {
    sourceType: MeetingSourceType
    contentHash?: string
    fileName?: string
    mimeType: string
    byteSize?: number
  },
  dependencies: MeetingImportDependencies = defaultDependencies,
): Promise<MeetingDocument> {
  const projectId = input.projectId.trim()
  const title = input.title.trim()
  const meetingDate = input.meetingDate.trim()
  const parsedText = normalizeMeetingText(parsedTextInput)
  const normalizedByteSize = new TextEncoder().encode(parsedText).byteLength
  const byteSize = source.byteSize ?? normalizedByteSize

  if (!projectId) throw new AppError("validation", "请选择所属项目")
  if (!title) throw new AppError("validation", "请输入会议标题")
  if (title.length > 200) throw new AppError("validation", "会议标题不能超过 200 个字符")
  if (!/^\d{4}-\d{2}-\d{2}$/.test(meetingDate)) throw new AppError("validation", "请选择有效的会议日期")
  if (!parsedText) throw new AppError("validation", "会议原文不能为空")
  if (byteSize > MAX_MEETING_TEXT_BYTES) throw new AppError("validation", "会议原文不能超过 10 MB")

  const createdAt = dependencies.now()
  const meetingId = dependencies.uuid()
  const sourceId = dependencies.uuid()
  const contentHash = source.contentHash ?? await sha256Text(parsedText)

  return {
    meeting: {
      id: meetingId,
      projectId,
      title,
      meetingDate,
      sourceType: source.sourceType,
      status: "pending_analysis",
      createdAt,
      updatedAt: createdAt,
    },
    source: {
      id: sourceId,
      meetingId,
      sourceType: source.sourceType,
      fileName: source.fileName,
      contentHash,
      parsedText,
      mimeType: source.mimeType,
      byteSize,
      parseStatus: "parsed",
      createdAt,
      updatedAt: createdAt,
    },
    paragraphs: await createParagraphs(meetingId, sourceId, parsedText, createdAt),
  }
}

export function preparePasteMeeting(
  input: PasteMeetingInput,
  dependencies: MeetingImportDependencies = defaultDependencies,
) {
  return prepareMeeting(input, input.text, {
    sourceType: "paste",
    mimeType: "text/plain; charset=utf-8",
  }, dependencies)
}

export function prepareFileMeeting(
  input: FileMeetingInput,
  inspection: TextMeetingFileInspection,
  dependencies: MeetingImportDependencies = defaultDependencies,
) {
  if (inspection.parseError) {
    const projectId = input.projectId.trim()
    const title = input.title.trim()
    const meetingDate = input.meetingDate.trim()
    if (!projectId) throw new AppError("validation", "请选择所属项目")
    if (!title) throw new AppError("validation", "请输入会议标题")
    if (title.length > 200) throw new AppError("validation", "会议标题不能超过 200 个字符")
    if (!/^\d{4}-\d{2}-\d{2}$/.test(meetingDate)) throw new AppError("validation", "请选择有效的会议日期")
    const createdAt = dependencies.now()
    const meetingId = dependencies.uuid()
    const sourceId = dependencies.uuid()
    return Promise.resolve<MeetingDocument>({
      meeting: { id: meetingId, projectId, title, meetingDate, sourceType: inspection.sourceType, status: "failed", createdAt, updatedAt: createdAt },
      source: {
        id: sourceId, meetingId, sourceType: inspection.sourceType, fileName: inspection.fileName,
        contentHash: inspection.contentHash, parsedText: "", mimeType: inspection.mimeType,
        byteSize: inspection.byteSize, parseStatus: "failed", parseError: inspection.parseError,
        createdAt, updatedAt: createdAt,
      },
      paragraphs: [],
    })
  }
  return prepareMeeting(input, inspection.text, {
    sourceType: inspection.sourceType,
    contentHash: inspection.contentHash,
    fileName: inspection.fileName,
    mimeType: inspection.mimeType,
    byteSize: inspection.byteSize,
  }, dependencies)
}
