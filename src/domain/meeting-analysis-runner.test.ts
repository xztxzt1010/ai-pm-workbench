import { describe, expect, it } from "vitest"

import type { MeetingAnalysisInput, MeetingAnalysisOutput } from "@/domain/meeting-analysis"
import {
  aggregateMeetingAnalysisOutputs,
  createMeetingAnalysisRun,
  executePendingAnalysisChunks,
  finalizeMeetingAnalysisRun,
  planMeetingAnalysisChunks,
} from "@/domain/meeting-analysis-runner"

const input: MeetingAnalysisInput = {
  schemaVersion: "1.0.0",
  projectId: "project-1",
  meetingId: "meeting-1",
  sourceId: "source-1",
  sourceHash: "hash-1",
  paragraphs: [1, 2, 3, 4].map((ordinal) => ({ id: `source-1:p${ordinal}`, ordinal, text: `Paragraph ${ordinal}`, startOffset: (ordinal - 1) * 12, endOffset: ordinal * 12 - 1 })),
}

function outputFor(chunkIndex: number, chunkInput: MeetingAnalysisInput): MeetingAnalysisOutput {
  const paragraph = chunkInput.paragraphs[0]
  return {
    schemaVersion: "1.0.0", projectId: chunkInput.projectId, meetingId: chunkInput.meetingId,
    summary: [{ id: `summary-${chunkIndex}`, text: `Summary ${chunkIndex}`, classification: "fact", confidence: 0.8, evidence: [{ paragraphId: paragraph.id, quote: paragraph.text, startOffset: paragraph.startOffset, endOffset: paragraph.endOffset }] }],
    topics: [], verbatimQuotes: [], decisions: [], openQuestions: [], requirements: [], actionItems: [], risks: [], dependencies: [], conflicts: [],
  }
}

describe("meeting analysis chunk runner", () => {
  it("plans deterministic paragraph-bounded chunks", () => {
    const chunks = planMeetingAnalysisChunks(input, 15)
    expect(chunks.map((chunk) => chunk.id)).toEqual(["hash-1:chunk:1-1", "hash-1:chunk:2-2", "hash-1:chunk:3-3", "hash-1:chunk:4-4"])
    expect(chunks.every((chunk) => chunk.input.paragraphs.length === 1)).toBe(true)
  })

  it("keeps successful chunks and retries only the failed chunk", async () => {
    const initial = createMeetingAnalysisRun(input, 15)
    const attempts = new Map<string, number>()
    const first = await executePendingAnalysisChunks(initial, async (chunk) => {
      attempts.set(chunk.id, (attempts.get(chunk.id) ?? 0) + 1)
      if (chunk.index === 1) throw new Error("temporary provider failure")
      return outputFor(chunk.index, chunk.input)
    })
    expect(first.status).toBe("partial")
    expect(first.chunks.filter((chunk) => chunk.status === "succeeded")).toHaveLength(3)
    await expect(Promise.resolve().then(() => finalizeMeetingAnalysisRun(first))).rejects.toThrow("失败分析分段")

    const second = await executePendingAnalysisChunks(first, async (chunk) => {
      attempts.set(chunk.id, (attempts.get(chunk.id) ?? 0) + 1)
      return outputFor(chunk.index, chunk.input)
    }, { retryFailed: true })
    expect(second.status).toBe("completed")
    expect([...attempts.values()]).toEqual([1, 2, 1, 1])
    expect(finalizeMeetingAnalysisRun(second).summary).toHaveLength(4)
  })

  it("deduplicates identical item IDs but rejects conflicting items", () => {
    const first = outputFor(0, input)
    const same = outputFor(0, input)
    expect(aggregateMeetingAnalysisOutputs(input, [first, same]).summary).toHaveLength(1)
    expect(() => aggregateMeetingAnalysisOutputs(input, [first, { ...same, summary: [{ ...same.summary[0], text: "different" }] }])).toThrow("冲突")
  })
})
