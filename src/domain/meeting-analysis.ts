import { z } from "zod"

import { AppError } from "@/domain/app-error"
import type { MeetingDocument } from "@/domain/models"

export const MEETING_ANALYSIS_SCHEMA_VERSION = "1.0.0"

export const MEETING_ANALYST_AGENT_POLICY = Object.freeze({
  agentId: "meeting-requirement-analyst",
  dataScope: "current_project_meeting" as const,
  allowedTools: ["read_current_meeting_paragraphs"] as const,
  businessWriteAccess: false,
})

const nonEmptyText = z.string().trim().min(1)

export const analysisEvidenceSchema = z.object({
  paragraphId: nonEmptyText,
  quote: nonEmptyText.max(4_000),
  startOffset: z.number().int().nonnegative(),
  endOffset: z.number().int().positive(),
})

export const analysisClassificationSchema = z.enum(["fact", "inference", "suggestion"])

const conclusionShape = {
  id: nonEmptyText,
  text: nonEmptyText.max(10_000),
  classification: analysisClassificationSchema,
  confidence: z.number().min(0).max(1),
  evidence: z.array(analysisEvidenceSchema).max(20),
}

export const analysisConclusionSchema = z.object(conclusionShape)

export const analysisRequirementSchema = z.object({
  ...conclusionShape,
  title: nonEmptyText.max(300),
  targetUsers: z.string().trim().max(2_000),
  scenario: z.string().trim().max(4_000),
  painPoint: z.string().trim().max(4_000),
  acceptanceCriteria: z.array(nonEmptyText.max(2_000)).max(50),
})

export const analysisActionItemSchema = z.object({
  ...conclusionShape,
  title: nonEmptyText.max(300),
  owner: z.string().trim().max(300),
  dueDate: z.iso.date().optional(),
})

const outputItemGroups = ["summary", "topics", "verbatimQuotes", "decisions", "openQuestions", "requirements", "actionItems", "risks", "dependencies", "conflicts"] as const

export const meetingAnalysisOutputSchema = z.object({
  schemaVersion: z.literal(MEETING_ANALYSIS_SCHEMA_VERSION),
  projectId: nonEmptyText,
  meetingId: nonEmptyText,
  summary: z.array(analysisConclusionSchema).max(20),
  topics: z.array(analysisConclusionSchema).max(100),
  verbatimQuotes: z.array(analysisConclusionSchema).max(200),
  decisions: z.array(analysisConclusionSchema).max(200),
  openQuestions: z.array(analysisConclusionSchema).max(200),
  requirements: z.array(analysisRequirementSchema).max(200),
  actionItems: z.array(analysisActionItemSchema).max(200),
  risks: z.array(analysisConclusionSchema).max(200),
  dependencies: z.array(analysisConclusionSchema).max(200),
  conflicts: z.array(analysisConclusionSchema).max(200),
}).superRefine((output, context) => {
  const seenIds = new Set<string>()
  for (const group of outputItemGroups) {
    output[group].forEach((item, index) => {
      if (seenIds.has(item.id)) context.addIssue({ code: "custom", message: "分析条目 ID 不能重复", path: [group, index, "id"] })
      seenIds.add(item.id)
      if (item.classification === "fact" && item.evidence.length === 0) {
        context.addIssue({ code: "custom", message: "事实结论必须包含原文证据", path: [group, index, "evidence"] })
      }
      if (group === "verbatimQuotes" && item.classification !== "fact") {
        context.addIssue({ code: "custom", message: "原话只能标记为事实", path: [group, index, "classification"] })
      }
    })
  }
})

export const meetingAnalysisOutputJsonSchema = z.toJSONSchema(meetingAnalysisOutputSchema)

export const meetingAnalysisInputSchema = z.object({
  schemaVersion: z.literal(MEETING_ANALYSIS_SCHEMA_VERSION),
  projectId: nonEmptyText,
  meetingId: nonEmptyText,
  sourceId: nonEmptyText,
  sourceHash: nonEmptyText,
  paragraphs: z.array(z.object({
    id: nonEmptyText,
    ordinal: z.number().int().positive(),
    text: nonEmptyText.max(100_000),
    startOffset: z.number().int().nonnegative(),
    endOffset: z.number().int().positive(),
  })).min(1),
}).superRefine((input, context) => {
  const paragraphIds = new Set<string>()
  input.paragraphs.forEach((paragraph, index) => {
    if (paragraphIds.has(paragraph.id)) context.addIssue({ code: "custom", message: "输入段落 ID 不能重复", path: ["paragraphs", index, "id"] })
    paragraphIds.add(paragraph.id)
    if (paragraph.endOffset <= paragraph.startOffset || paragraph.endOffset - paragraph.startOffset !== paragraph.text.length) {
      context.addIssue({ code: "custom", message: "输入段落偏移与文本长度不一致", path: ["paragraphs", index] })
    }
  })
})

export type MeetingAnalysisInput = z.infer<typeof meetingAnalysisInputSchema>
export type MeetingAnalysisOutput = z.infer<typeof meetingAnalysisOutputSchema>

export function buildMeetingAnalysisInput(document: MeetingDocument): MeetingAnalysisInput {
  if (!document.meeting.projectId) throw new AppError("validation", "会议必须归属项目后才能运行需求分析")
  return meetingAnalysisInputSchema.parse({
    schemaVersion: MEETING_ANALYSIS_SCHEMA_VERSION,
    projectId: document.meeting.projectId,
    meetingId: document.meeting.id,
    sourceId: document.source.id,
    sourceHash: document.source.contentHash,
    paragraphs: document.paragraphs.map((paragraph) => ({
      id: paragraph.id,
      ordinal: paragraph.ordinal,
      text: paragraph.text,
      startOffset: paragraph.startOffset,
      endOffset: paragraph.endOffset,
    })),
  })
}

function outputItems(output: MeetingAnalysisOutput) {
  return outputItemGroups.flatMap((group) => output[group])
}

export function validateMeetingAnalysisOutput(inputValue: unknown, outputValue: unknown): MeetingAnalysisOutput {
  const input = meetingAnalysisInputSchema.parse(inputValue)
  const output = meetingAnalysisOutputSchema.parse(outputValue)
  if (output.projectId !== input.projectId || output.meetingId !== input.meetingId) {
    throw new AppError("validation", "分析结果超出当前项目或会议数据范围")
  }

  const paragraphs = new Map(input.paragraphs.map((paragraph) => [paragraph.id, paragraph]))
  for (const item of outputItems(output)) {
    const evidenceIds = new Set<string>()
    for (const evidence of item.evidence) {
      if (evidenceIds.has(evidence.paragraphId)) throw new AppError("validation", "同一分析条目不能重复引用相同段落")
      evidenceIds.add(evidence.paragraphId)
      const paragraph = paragraphs.get(evidence.paragraphId)
      if (!paragraph) throw new AppError("validation", "分析结果引用了当前会议范围外的段落")
      if (evidence.startOffset < paragraph.startOffset || evidence.endOffset > paragraph.endOffset || evidence.endOffset <= evidence.startOffset) {
        throw new AppError("validation", "分析证据偏移超出原文段落范围")
      }
      const localStart = evidence.startOffset - paragraph.startOffset
      const localEnd = evidence.endOffset - paragraph.startOffset
      if (paragraph.text.slice(localStart, localEnd) !== evidence.quote) throw new AppError("validation", "分析证据原文与稳定段落不匹配")
    }
  }
  return output
}

export function meetingAnalysisIdempotencyKey(inputValue: unknown) {
  const input = meetingAnalysisInputSchema.parse(inputValue)
  return `${input.schemaVersion}:${input.projectId}:${input.meetingId}:${input.sourceHash}`
}
