import { describe, expect, it } from "vitest"

import { normalizeMeetingText, prepareFileMeeting, preparePasteMeeting } from "@/domain/meeting-import"

const dependencies = {
  now: () => "2026-07-13T12:00:00.000Z",
  uuid: (() => {
    let index = 0
    return () => ["meeting-1", "source-1"][index++]!
  })(),
}

describe("meeting import", () => {
  it("normalizes text and creates stable paragraph positions", async () => {
    const document = await preparePasteMeeting({
      projectId: "project-1",
      title: "  周会  ",
      meetingDate: "2026-07-13",
      text: "\uFEFF第一段  \r\n继续\r\n\r\n  第二段  ",
    }, dependencies)

    expect(document.source.parsedText).toBe("第一段\n继续\n\n第二段")
    expect(document.source.contentHash).toMatch(/^[a-f0-9]{64}$/)
    expect(document.paragraphs).toEqual([
      expect.objectContaining({ id: "source-1:p0001", ordinal: 1, text: "第一段\n继续", startOffset: 0, endOffset: 6 }),
      expect.objectContaining({ id: "source-1:p0002", ordinal: 2, text: "第二段", startOffset: 8, endOffset: 11 }),
    ])
  })

  it("rejects empty content", async () => {
    await expect(preparePasteMeeting({
      projectId: "project-1",
      title: "空会议",
      meetingDate: "2026-07-13",
      text: " \r\n \r\n ",
    })).rejects.toEqual(expect.objectContaining({ code: "validation", message: "会议原文不能为空" }))
  })

  it("normalizes line endings deterministically", () => {
    expect(normalizeMeetingText("a\r\n\r\nb\r\rc")).toBe("a\n\nb\n\nc")
  })

  it("preserves raw file metadata while normalizing parsed text", async () => {
    const document = await prepareFileMeeting({
      projectId: "project-1",
      title: "文件会议",
      meetingDate: "2026-07-13",
      sourcePath: "C:\\meeting\\notes.txt",
    }, {
      fileName: "notes.txt",
      sourceType: "txt",
      mimeType: "text/plain; charset=utf-8",
      byteSize: 18,
      contentHash: "b".repeat(64),
      text: "第一段\r\n\r\n第二段",
    })

    expect(document.source.contentHash).toBe("b".repeat(64))
    expect(document.source.byteSize).toBe(18)
    expect(document.source.parsedText).toBe("第一段\n\n第二段")
    expect(document.source.filePath).toBeUndefined()
  })

  it("creates a traceable failed document when docx parsing fails", async () => {
    const document = await prepareFileMeeting({
      projectId: "project-1",
      title: "损坏文档",
      meetingDate: "2026-07-13",
      sourcePath: "C:\\meeting\\broken.docx",
    }, {
      fileName: "broken.docx",
      sourceType: "docx",
      mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      byteSize: 128,
      contentHash: "c".repeat(64),
      text: "",
      parseError: "文件不是有效的 docx ZIP 容器",
    })

    expect(document.meeting.status).toBe("failed")
    expect(document.source).toEqual(expect.objectContaining({ parseStatus: "failed", parseError: expect.stringContaining("ZIP") }))
    expect(document.paragraphs).toEqual([])
  })
})
