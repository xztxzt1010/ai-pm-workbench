import { describe, expect, it } from "vitest"

import {
  MEETING_ANALYSIS_SCHEMA_VERSION,
  MEETING_ANALYST_AGENT_POLICY,
  buildMeetingAnalysisInput,
  meetingAnalysisIdempotencyKey,
  meetingAnalysisOutputSchema,
  validateMeetingAnalysisOutput,
  type MeetingAnalysisOutput,
} from "@/domain/meeting-analysis"
import type { MeetingDocument } from "@/domain/models"

const document: MeetingDocument = {
  meeting: { id: "meeting-1", projectId: "project-1", title: "Review", meetingDate: "2026-07-14", sourceType: "paste", status: "pending_analysis", createdAt: "2026-07-14", updatedAt: "2026-07-14" },
  source: { id: "source-1", meetingId: "meeting-1", sourceType: "paste", contentHash: "source-hash", parsedText: "Ship offline search.\nAsk for audit trail.", mimeType: "text/plain", byteSize: 41, parseStatus: "parsed", createdAt: "2026-07-14", updatedAt: "2026-07-14" },
  paragraphs: [
    { id: "source-1:p1", meetingId: "meeting-1", sourceId: "source-1", ordinal: 1, text: "Ship offline search.", startOffset: 0, endOffset: 20, contentHash: "p1", createdAt: "2026-07-14" },
    { id: "source-1:p2", meetingId: "meeting-1", sourceId: "source-1", ordinal: 2, text: "Ask for audit trail.", startOffset: 21, endOffset: 41, contentHash: "p2", createdAt: "2026-07-14" },
  ],
}

function validOutput(): MeetingAnalysisOutput {
  return {
    schemaVersion: MEETING_ANALYSIS_SCHEMA_VERSION,
    projectId: "project-1",
    meetingId: "meeting-1",
    summary: [{ id: "summary-1", text: "Offline search is required", classification: "fact", confidence: 0.96, evidence: [{ paragraphId: "source-1:p1", quote: "offline search", startOffset: 5, endOffset: 19 }] }],
    topics: [],
    verbatimQuotes: [],
    decisions: [],
    openQuestions: [],
    requirements: [{ id: "requirement-1", text: "Support offline search", title: "Offline search", targetUsers: "Product managers", scenario: "Review meetings", painPoint: "Network access is unreliable", acceptanceCriteria: ["Search works without a network"], classification: "fact", confidence: 0.91, evidence: [{ paragraphId: "source-1:p1", quote: "Ship offline search.", startOffset: 0, endOffset: 20 }] }],
    actionItems: [],
    risks: [],
    dependencies: [],
    conflicts: [],
  }
}

describe("meeting analysis contract eval", () => {
  it("builds a project-scoped input and a stable idempotency key", () => {
    const input = buildMeetingAnalysisInput(document)
    expect(input.paragraphs.map((paragraph) => paragraph.id)).toEqual(["source-1:p1", "source-1:p2"])
    expect(meetingAnalysisIdempotencyKey(input)).toBe("1.0.0:project-1:meeting-1:source-hash")
    expect(MEETING_ANALYST_AGENT_POLICY).toMatchObject({ dataScope: "current_project_meeting", businessWriteAccess: false })
    expect(MEETING_ANALYST_AGENT_POLICY.allowedTools).toEqual(["read_current_meeting_paragraphs"])
  })

  it("accepts structured output whose evidence exactly matches stable paragraphs", () => {
    const input = buildMeetingAnalysisInput(document)
    expect(validateMeetingAnalysisOutput(input, validOutput()).requirements[0].title).toBe("Offline search")
  })

  it("rejects facts without evidence", () => {
    const output = validOutput()
    output.summary[0].evidence = []
    expect(meetingAnalysisOutputSchema.safeParse(output).success).toBe(false)
  })

  it("rejects fabricated quotes and paragraphs outside the meeting", () => {
    const input = buildMeetingAnalysisInput(document)
    const fabricated = validOutput()
    fabricated.summary[0].evidence[0].quote = "online search"
    expect(() => validateMeetingAnalysisOutput(input, fabricated)).toThrow("不匹配")

    const outOfScope = validOutput()
    outOfScope.summary[0].evidence[0].paragraphId = "another-source:p1"
    expect(() => validateMeetingAnalysisOutput(input, outOfScope)).toThrow("范围外")
  })

  it("rejects project or meeting scope escalation", () => {
    const input = buildMeetingAnalysisInput(document)
    const output = validOutput()
    output.projectId = "project-2"
    expect(() => validateMeetingAnalysisOutput(input, output)).toThrow("超出当前项目")
  })

  it("allows explicitly classified suggestions without source evidence", () => {
    const output = validOutput()
    output.risks = [{ id: "risk-1", text: "Consider an encrypted local index", classification: "suggestion", confidence: 0.5, evidence: [] }]
    expect(validateMeetingAnalysisOutput(buildMeetingAnalysisInput(document), output).risks[0].classification).toBe("suggestion")
  })
})
