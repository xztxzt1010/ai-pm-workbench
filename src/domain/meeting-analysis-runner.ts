import { AppError } from "@/domain/app-error"
import {
  MEETING_ANALYSIS_SCHEMA_VERSION,
  type MeetingAnalysisInput,
  type MeetingAnalysisOutput,
  meetingAnalysisIdempotencyKey,
  validateMeetingAnalysisOutput,
} from "@/domain/meeting-analysis"

export const MEETING_ANALYSIS_OUTPUT_GROUPS = ["summary", "topics", "verbatimQuotes", "decisions", "openQuestions", "requirements", "actionItems", "risks", "dependencies", "conflicts"] as const

export interface AnalysisChunk {
  id: string
  index: number
  total: number
  input: MeetingAnalysisInput
}

export type AnalysisChunkStatus = "pending" | "running" | "succeeded" | "failed"

export interface AnalysisChunkRun {
  chunk: AnalysisChunk
  status: AnalysisChunkStatus
  attempts: number
  output?: MeetingAnalysisOutput
  errorSummary?: string
}

export interface MeetingAnalysisRun {
  idempotencyKey: string
  input: MeetingAnalysisInput
  status: "pending" | "running" | "partial" | "completed"
  chunks: AnalysisChunkRun[]
}

export function planMeetingAnalysisChunks(input: MeetingAnalysisInput, maxCharacters = 8_000): AnalysisChunk[] {
  if (!Number.isInteger(maxCharacters) || maxCharacters < 1) throw new AppError("validation", "分析分段大小必须是正整数")
  const planned: MeetingAnalysisInput["paragraphs"][] = []
  let current: MeetingAnalysisInput["paragraphs"] = []
  let currentCharacters = 0
  for (const paragraph of input.paragraphs) {
    const wouldExceed = current.length > 0 && currentCharacters + paragraph.text.length > maxCharacters
    if (wouldExceed) {
      planned.push(current)
      current = []
      currentCharacters = 0
    }
    current.push(paragraph)
    currentCharacters += paragraph.text.length
  }
  if (current.length) planned.push(current)

  return planned.map((paragraphs, index) => {
    const first = paragraphs[0]
    const last = paragraphs[paragraphs.length - 1]
    const chunkInput = { ...input, paragraphs }
    return {
      id: `${input.sourceHash}:chunk:${first.ordinal}-${last.ordinal}`,
      index,
      total: planned.length,
      input: chunkInput,
    }
  })
}

export function createMeetingAnalysisRun(input: MeetingAnalysisInput, maxCharacters = 8_000): MeetingAnalysisRun {
  return {
    idempotencyKey: meetingAnalysisIdempotencyKey(input),
    input,
    status: "pending",
    chunks: planMeetingAnalysisChunks(input, maxCharacters).map((chunk) => ({ chunk, status: "pending", attempts: 0 })),
  }
}

function safeErrorSummary(error: unknown) {
  if (error instanceof AppError && error.code === "validation") return error.message
  return "分析分段失败，可仅重试该分段"
}

function emptyOutput(input: MeetingAnalysisInput): MeetingAnalysisOutput {
  return {
    schemaVersion: MEETING_ANALYSIS_SCHEMA_VERSION,
    projectId: input.projectId,
    meetingId: input.meetingId,
    summary: [], topics: [], verbatimQuotes: [], decisions: [], openQuestions: [], requirements: [], actionItems: [], risks: [], dependencies: [], conflicts: [],
  }
}

function equalJson(left: unknown, right: unknown) {
  return JSON.stringify(left) === JSON.stringify(right)
}

export function aggregateMeetingAnalysisOutputs(input: MeetingAnalysisInput, outputs: MeetingAnalysisOutput[]): MeetingAnalysisOutput {
  const aggregate = emptyOutput(input)
  const seen = new Map<string, unknown>()
  for (const output of outputs) {
    if (output.projectId !== input.projectId || output.meetingId !== input.meetingId) throw new AppError("validation", "聚合结果超出当前项目或会议数据范围")
    for (const group of MEETING_ANALYSIS_OUTPUT_GROUPS) {
      for (const item of output[group]) {
        const previous = seen.get(item.id)
        if (previous && !equalJson(previous, item)) throw new AppError("conflict", "不同分析分段生成了冲突的条目")
        if (!previous) {
          seen.set(item.id, item)
          aggregate[group].push(item as never)
        }
      }
    }
  }
  return validateMeetingAnalysisOutput(input, aggregate)
}

export async function executePendingAnalysisChunks(
  run: MeetingAnalysisRun,
  analyzeChunk: (chunk: AnalysisChunk) => Promise<unknown>,
  options: { retryFailed?: boolean } = {},
): Promise<MeetingAnalysisRun> {
  const retryFailed = options.retryFailed ?? false
  const next: MeetingAnalysisRun = { ...run, status: "running", chunks: run.chunks.map((item) => ({ ...item })) }
  for (const item of next.chunks) {
    const eligible = item.status === "pending" || (retryFailed && item.status === "failed")
    if (!eligible) continue
    item.status = "running"
    item.attempts += 1
    try {
      item.output = validateMeetingAnalysisOutput(item.chunk.input, await analyzeChunk(item.chunk))
      item.status = "succeeded"
      item.errorSummary = undefined
    } catch (error) {
      item.status = "failed"
      item.errorSummary = safeErrorSummary(error)
    }
  }
  const succeeded = next.chunks.filter((item) => item.status === "succeeded")
  const failed = next.chunks.some((item) => item.status === "failed")
  next.status = failed ? (succeeded.length ? "partial" : "pending") : "completed"
  return next
}

export function finalizeMeetingAnalysisRun(run: MeetingAnalysisRun): MeetingAnalysisOutput {
  if (run.status !== "completed" || run.chunks.some((item) => item.status !== "succeeded" || !item.output)) {
    throw new AppError("conflict", "仍有失败分析分段，重试成功后才能完成聚合")
  }
  return aggregateMeetingAnalysisOutputs(run.input, run.chunks.flatMap((item) => item.output ? [item.output] : []))
}
