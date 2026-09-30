import { describe, expect, it } from "vitest"
import { parseDataset, runDeterministicAnalysis } from "../src/domain/dataset-analysis"
import { preparePasteMeeting } from "../src/domain/meeting-import"
import { planMeetingAnalysisChunks } from "../src/domain/meeting-analysis-runner"
import { buildDocumentDiff } from "../src/domain/document-diff"

function elapsedMs(startedAt: number) {
  return Math.round((performance.now() - startedAt) * 100) / 100
}

describe("P9 performance budgets", () => {
  it("parses and analyzes the supported 100,000-row CSV boundary within 8 seconds", () => {
    const rows = Array.from({ length: 100_000 }, (_, index) =>
      `${index},${index % 1000},${index % 2 === 0},${index % 5 === 0},region-${index % 20},2026-07-${String((index % 28) + 1).padStart(2, "0")}`,
    )
    const csv = `id,amount,visited,converted,region,date\n${rows.join("\n")}`
    const startedAt = performance.now()
    const dataset = parseDataset(csv, "csv")
    const analysis = runDeterministicAnalysis(dataset)
    const elapsed = elapsedMs(startedAt)

    expect(dataset.rows).toHaveLength(100_000)
    expect(analysis.rowCount).toBe(100_000)
    expect(analysis.numeric.find((item) => item.field === "amount")?.mean).toBe(499.5)
    expect(elapsed).toBeLessThan(8_000)
    console.log(JSON.stringify({ case: "csv-100k", elapsedMs: elapsed, bytes: new TextEncoder().encode(csv).length }))
  }, 20_000)

  it("normalizes, hashes, segments, and chunks an 8 MB meeting within 8 seconds", async () => {
    const paragraphCount = 4_096
    const paragraphs = Array.from({ length: paragraphCount }, (_, index) =>
      `段落 ${index + 1}：${"产品会议原文。".repeat(100)}`,
    )
    const text = paragraphs.join("\n\n")
    let id = 0
    const startedAt = performance.now()
    const prepared = await preparePasteMeeting(
      { projectId: "performance-project", title: "长会议性能验证", meetingDate: "2026-07-17", text },
      { now: () => "2026-07-17T00:00:00.000Z", uuid: () => `performance-${++id}` },
    )
    const chunks = planMeetingAnalysisChunks({
      schemaVersion: "1.0.0",
      projectId: prepared.meeting.projectId,
      meetingId: prepared.meeting.id,
      sourceHash: prepared.source.contentHash,
      paragraphs: prepared.paragraphs.map(({ id: paragraphId, ordinal, text: paragraphText, startOffset, endOffset }) => ({ id: paragraphId, ordinal, text: paragraphText, startOffset, endOffset })),
    })
    const elapsed = elapsedMs(startedAt)
    const bytes = new TextEncoder().encode(text).length

    expect(bytes).toBeGreaterThan(8 * 1024 * 1024)
    expect(bytes).toBeLessThan(10 * 1024 * 1024)
    expect(prepared.paragraphs).toHaveLength(paragraphCount)
    expect(chunks.length).toBeGreaterThan(350)
    expect(elapsed).toBeLessThan(8_000)
    console.log(JSON.stringify({ case: "meeting-8mb", elapsedMs: elapsed, bytes, paragraphs: paragraphCount, chunks: chunks.length }))
  }, 20_000)

  it("diffs a near-boundary long document within one second", () => {
    const previousLines = Array.from({ length: 19_000 }, (_, index) => `L${index}`)
    const currentLines = [...previousLines]
    currentLines.splice(9_500, 5, "changed-a", "changed-b")
    const previous = previousLines.join("\n")
    const current = currentLines.join("\n")
    const startedAt = performance.now()
    const diff = buildDocumentDiff(previous, current)
    const elapsed = elapsedMs(startedAt)

    expect(previous.length).toBeLessThan(200_000)
    expect(diff.added).toBe(2)
    expect(diff.removed).toBe(5)
    expect(elapsed).toBeLessThan(1_000)
    console.log(JSON.stringify({ case: "document-19k-lines", elapsedMs: elapsed, characters: previous.length }))
  })
})
