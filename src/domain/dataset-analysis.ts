import { AppError } from "@/domain/app-error"

export type DatasetValue = string | number | boolean | null
export type DatasetFieldType = "number" | "boolean" | "date" | "text" | "mixed"
export interface DatasetField { name: string; type: DatasetFieldType; missingCount: number; invalidCount: number; uniqueCount: number }
export interface Dataset { columns: string[]; rows: Record<string, DatasetValue>[]; fields: DatasetField[]; duplicateRowCount: number; sourceType: "csv" | "json" }
export interface NumericSummary { field: string; count: number; missingCount: number; mean: number; min: number; max: number }
export interface CategoricalSummary { field: string; values: Array<{ value: string; count: number }> }
export interface AnalysisResult { rowCount: number; duplicateRowCount: number; numeric: NumericSummary[]; categorical: CategoricalSummary[] }

const MAX_BYTES = 10 * 1024 * 1024
const MAX_ROWS = 100_000
const MAX_COLUMNS = 200

function parseScalar(value: string): DatasetValue {
  const trimmed = value.trim()
  if (!trimmed || /^(null|na|n\/a)$/i.test(trimmed)) return null
  if (/^(true|false)$/i.test(trimmed)) return trimmed.toLowerCase() === "true"
  if (/^-?(?:\d+\.?\d*|\.\d+)$/.test(trimmed)) return Number(trimmed)
  return trimmed
}

function parseCsv(text: string): string[][] {
  const rows: string[][] = []; let row: string[] = []; let cell = ""; let quoted = false
  for (let index = 0; index < text.length; index += 1) {
    const char = text[index]
    if (char === '"') { if (quoted && text[index + 1] === '"') { cell += '"'; index += 1 } else quoted = !quoted }
    else if (char === "," && !quoted) { row.push(cell); cell = "" }
    else if ((char === "\n" || char === "\r") && !quoted) { if (char === "\r" && text[index + 1] === "\n") index += 1; row.push(cell); if (row.some((value) => value.trim())) rows.push(row); row = []; cell = "" }
    else cell += char
  }
  if (cell || row.length) { row.push(cell); if (row.some((value) => value.trim())) rows.push(row) }
  return rows
}

function fieldType(values: DatasetValue[]): DatasetFieldType {
  const nonMissing = values.filter((value) => value !== null)
  if (!nonMissing.length) return "text"
  if (nonMissing.every((value) => typeof value === "number")) return "number"
  if (nonMissing.every((value) => typeof value === "boolean")) return "boolean"
  if (nonMissing.every((value) => typeof value === "string" && /^\d{4}-\d{2}-\d{2}(?:T.*)?$/.test(value))) return "date"
  if (nonMissing.every((value) => typeof value === "string")) return "text"
  return "mixed"
}

function buildDataset(columns: string[], rows: Record<string, DatasetValue>[], sourceType: Dataset["sourceType"]): Dataset {
  const fields = columns.map((name) => {
    const values = rows.map((row) => row[name]); const type = fieldType(values)
    return { name, type, missingCount: values.filter((value) => value === null).length, invalidCount: type === "mixed" ? values.filter((value) => value !== null).length : 0, uniqueCount: new Set(values.map((value) => JSON.stringify(value))).size }
  })
  const seen = new Set<string>(); let duplicateRowCount = 0
  for (const row of rows) { const key = JSON.stringify(columns.map((column) => row[column])); if (seen.has(key)) duplicateRowCount += 1; seen.add(key) }
  return { columns, rows, fields, duplicateRowCount, sourceType }
}

export function parseDataset(text: string, sourceType: "csv" | "json"): Dataset {
  if (new TextEncoder().encode(text).length > MAX_BYTES) throw new AppError("validation", "数据集不能超过 10 MB")
  if (sourceType === "csv") {
    const raw = parseCsv(text); if (raw.length < 2) throw new AppError("validation", "CSV 至少需要表头和一行数据")
    const columns = raw[0].map((name, index) => name.trim() || `column_${index + 1}`)
    if (columns.length > MAX_COLUMNS || new Set(columns).size !== columns.length) throw new AppError("validation", "CSV 列名必须唯一且不超过 200 列")
    const rows = raw.slice(1, MAX_ROWS + 1).map((values) => Object.fromEntries(columns.map((column, index) => [column, parseScalar(values[index] ?? "")])) as Record<string, DatasetValue>)
    if (raw.length - 1 > MAX_ROWS) throw new AppError("validation", "数据集不能超过 100,000 行")
    return buildDataset(columns, rows, sourceType)
  }
  let parsed: unknown
  try { parsed = JSON.parse(text) } catch { throw new AppError("validation", "JSON 数据集格式无效") }
  if (!Array.isArray(parsed) || !parsed.length || !parsed.every((row) => row && typeof row === "object" && !Array.isArray(row))) throw new AppError("validation", "JSON 数据集必须是对象数组")
  const columns = [...new Set(parsed.flatMap((row) => Object.keys(row as object)))]
  if (columns.length > MAX_COLUMNS || parsed.length > MAX_ROWS) throw new AppError("validation", "JSON 数据集超出行数或列数上限")
  const rows = parsed.map((row) => Object.fromEntries(columns.map((column) => { const value = (row as Record<string, unknown>)[column]; return [column, typeof value === "string" || typeof value === "number" || typeof value === "boolean" || value === null ? value : JSON.stringify(value)] })) as Record<string, DatasetValue>)
  return buildDataset(columns, rows, sourceType)
}

export function runDeterministicAnalysis(dataset: Dataset): AnalysisResult {
  const numeric: NumericSummary[] = []; const categorical: CategoricalSummary[] = []
  for (const field of dataset.fields) {
    const values = dataset.rows.map((row) => row[field.name]); const numbers = values.filter((value): value is number => typeof value === "number" && Number.isFinite(value))
    if (field.type === "number") { const sum = numbers.reduce((total, value) => total + value, 0); numeric.push({ field: field.name, count: numbers.length, missingCount: values.length - numbers.length, mean: numbers.length ? sum / numbers.length : 0, min: numbers.length ? Math.min(...numbers) : 0, max: numbers.length ? Math.max(...numbers) : 0 }) }
    else if (field.type === "text" || field.type === "boolean") { const counts = new Map<string, number>(); for (const value of values) if (value !== null) counts.set(String(value), (counts.get(String(value)) ?? 0) + 1); categorical.push({ field: field.name, values: [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).slice(0, 10).map(([value, count]) => ({ value, count })) }) }
  }
  return { rowCount: dataset.rows.length, duplicateRowCount: dataset.duplicateRowCount, numeric, categorical }
}
