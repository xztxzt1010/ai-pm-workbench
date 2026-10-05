import { describe, expect, it, vi } from "vitest"

import type { MeetingRepository } from "@/data/meeting-repository"
import { MeetingImportService } from "@/services/meeting-import-service"

const input = {
  projectId: "project-1",
  title: "需求评审",
  meetingDate: "2026-07-13",
  text: "第一段\n\n第二段",
}

describe("MeetingImportService", () => {
  it("persists a new unique meeting document", async () => {
    const repository: MeetingRepository = {
      create: vi.fn(),
      inspectTextFile: vi.fn(),
      createFile: vi.fn(),
      delete: vi.fn(),
      retryDocx: vi.fn(),
      findDuplicate: vi.fn().mockResolvedValue(undefined),
      getDocument: vi.fn(),
    }
    const result = await new MeetingImportService(repository).importPaste(input)

    expect(result.status).toBe("created")
    expect(repository.create).toHaveBeenCalledOnce()
  })

  it("returns an explicit duplicate decision without writing", async () => {
    const repository: MeetingRepository = {
      create: vi.fn(),
      inspectTextFile: vi.fn(),
      createFile: vi.fn(),
      delete: vi.fn(),
      retryDocx: vi.fn(),
      findDuplicate: vi.fn().mockResolvedValue({
        meetingId: "existing-meeting",
        meetingTitle: "已有会议",
        sourceId: "existing-source",
      }),
      getDocument: vi.fn(),
    }
    const service = new MeetingImportService(repository)
    const result = await service.importPaste(input)

    expect(result.status).toBe("duplicate")
    expect(repository.create).not.toHaveBeenCalled()
    if (result.status === "duplicate") await service.keepDuplicate(result)
    expect(repository.create).toHaveBeenCalledOnce()
  })

  it("inspects and persists a managed text file", async () => {
    const repository: MeetingRepository = {
      create: vi.fn(),
      inspectTextFile: vi.fn().mockResolvedValue({
        fileName: "review.md",
        sourceType: "md",
        mimeType: "text/markdown; charset=utf-8",
        byteSize: 12,
        contentHash: "a".repeat(64),
        text: "第一段\n\n第二段",
      }),
      createFile: vi.fn(),
      delete: vi.fn(),
      retryDocx: vi.fn(),
      findDuplicate: vi.fn().mockResolvedValue(undefined),
      getDocument: vi.fn(),
    }
    const result = await new MeetingImportService(repository).importTextFile({
      projectId: input.projectId,
      title: input.title,
      meetingDate: input.meetingDate,
      sourcePath: "C:\\meeting\\review.md",
    })

    expect(result.status).toBe("created")
    expect(repository.inspectTextFile).toHaveBeenCalledOnce()
    expect(repository.createFile).toHaveBeenCalledOnce()
    const document = vi.mocked(repository.createFile).mock.calls[0]![1]
    expect(document.source).toEqual(expect.objectContaining({
      sourceType: "md",
      fileName: "review.md",
      contentHash: "a".repeat(64),
    }))
  })

  it("returns attachment cleanup details when deleting", async () => {
    const repository: MeetingRepository = {
      create: vi.fn(),
      inspectTextFile: vi.fn(),
      createFile: vi.fn(),
      delete: vi.fn().mockResolvedValue({ deleted: true, attachmentsRemoved: 1, cleanupWarnings: [] }),
      retryDocx: vi.fn(),
      findDuplicate: vi.fn(),
      getDocument: vi.fn(),
    }

    await expect(new MeetingImportService(repository).deleteMeeting("meeting-1")).resolves.toEqual({
      deleted: true,
      attachmentsRemoved: 1,
      cleanupWarnings: [],
    })
  })

  it("retries docx parsing before reloading the document", async () => {
    const repository: MeetingRepository = {
      create: vi.fn(), inspectTextFile: vi.fn(), createFile: vi.fn(), delete: vi.fn(),
      retryDocx: vi.fn(), findDuplicate: vi.fn(), getDocument: vi.fn().mockResolvedValue({ meeting: { id: "meeting-1" } }),
    }
    await new MeetingImportService(repository).retryDocx("meeting-1")
    expect(repository.retryDocx).toHaveBeenCalledWith("meeting-1")
    expect(repository.getDocument).toHaveBeenCalledWith("meeting-1")
  })
})
