import { AppError } from "@/domain/app-error"

export type DocumentDiffKind = "context" | "added" | "removed"
export interface DocumentDiffLine { kind: DocumentDiffKind; text: string; lineNumber: number }
export interface DocumentDiff { changed: boolean; added: number; removed: number; unchanged: number; truncated: boolean; lines: DocumentDiffLine[] }

const MAX_LINES = 20_000
const MAX_OUTPUT_LINES = 2_000

function split(value: string) {
  return value.replace(/\r\n?/g, "\n").split("\n")
}

/** Deterministic, bounded diff for human review. It never evaluates Markdown. */
export function buildDocumentDiff(previous: string, current: string): DocumentDiff {
  if (previous.length > 200_000 || current.length > 200_000) throw new AppError("validation", "文档差异输入不能超过 200 KB")
  const before = split(previous)
  const after = split(current)
  if (before.length > MAX_LINES || after.length > MAX_LINES) throw new AppError("validation", "文档差异最多支持 20,000 行")

  let prefix = 0
  while (prefix < before.length && prefix < after.length && before[prefix] === after[prefix]) prefix += 1
  let beforeEnd = before.length - 1
  let afterEnd = after.length - 1
  while (beforeEnd >= prefix && afterEnd >= prefix && before[beforeEnd] === after[afterEnd]) { beforeEnd -= 1; afterEnd -= 1 }

  const lines: DocumentDiffLine[] = []
  const push = (kind: DocumentDiffKind, text: string, lineNumber: number) => { if (lines.length < MAX_OUTPUT_LINES) lines.push({ kind, text, lineNumber }) }
  for (let index = Math.max(0, prefix - 3); index < prefix; index += 1) push("context", before[index], index + 1)
  for (let index = prefix; index <= beforeEnd; index += 1) push("removed", before[index], index + 1)
  for (let index = prefix; index <= afterEnd; index += 1) push("added", after[index], index + 1)
  for (let index = afterEnd + 1; index < Math.min(after.length, afterEnd + 4); index += 1) push("context", after[index], index + 1)

  const added = Math.max(0, afterEnd - prefix + 1)
  const removed = Math.max(0, beforeEnd - prefix + 1)
  const unchanged = Math.max(0, Math.min(prefix, before.length) + Math.max(0, before.length - beforeEnd - 1))
  return { changed: added > 0 || removed > 0, added, removed, unchanged, truncated: added + removed > MAX_OUTPUT_LINES, lines }
}
