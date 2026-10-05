import type { DuplicateMeetingSource, MeetingRepository } from "@/data/meeting-repository"
import { prepareFileMeeting, preparePasteMeeting, type FileMeetingInput, type PasteMeetingInput } from "@/domain/meeting-import"
import type { MeetingDocument } from "@/domain/models"

export type MeetingImportResult =
  | { status: "created"; document: MeetingDocument }
  | { status: "duplicate"; document: MeetingDocument; duplicate: DuplicateMeetingSource; sourcePath?: string }

export type PasteImportResult = MeetingImportResult

export class MeetingImportService {
  constructor(private readonly repository: MeetingRepository) {}

  async importPaste(input: PasteMeetingInput): Promise<PasteImportResult> {
    const document = await preparePasteMeeting(input)
    const duplicate = await this.repository.findDuplicate(
      document.meeting.projectId!,
      document.source.contentHash,
    )
    if (duplicate) return { status: "duplicate", document, duplicate }
    await this.repository.create(document)
    return { status: "created", document }
  }

  async importTextFile(input: FileMeetingInput): Promise<MeetingImportResult> {
    const inspection = await this.repository.inspectTextFile(input.sourcePath)
    const document = await prepareFileMeeting(input, inspection)
    const duplicate = await this.repository.findDuplicate(
      document.meeting.projectId!,
      document.source.contentHash,
    )
    if (duplicate) return { status: "duplicate", document, duplicate, sourcePath: input.sourcePath }
    await this.repository.createFile(input.sourcePath, document)
    return { status: "created", document }
  }

  async keepDuplicate(result: Extract<MeetingImportResult, { status: "duplicate" }>) {
    if (result.sourcePath) await this.repository.createFile(result.sourcePath, result.document)
    else await this.repository.create(result.document)
    return result.document
  }

  getDocument(meetingId: string) {
    return this.repository.getDocument(meetingId)
  }

  deleteMeeting(meetingId: string) {
    return this.repository.delete(meetingId)
  }

  async retryDocx(meetingId: string) {
    await this.repository.retryDocx(meetingId)
    return this.repository.getDocument(meetingId)
  }
}
