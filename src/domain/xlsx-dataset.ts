import type { SheetData } from "read-excel-file/browser"

import { AppError } from "@/domain/app-error"

const MAX_ROWS = 100_000
const MAX_COLUMNS = 200

export interface NormalizedXlsxSheet {
  rowsJson: string
  rowCount: number
  columnCount: number
}

function normalizeHeader(value: unknown, index: number) {
  if (value === null || value === undefined || String(value).trim() === "") throw new AppError("validation", `XLSX 第 ${index + 1} 列表头为空`)
  return String(value).trim()
}

function normalizeCell(value: unknown): string | number | boolean | null {
  if (value === null || value === undefined) return null
  if (value instanceof Date) return value.toISOString()
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") return value
  throw new AppError("validation", "XLSX 包含不支持的单元格类型")
}

export function normalizeXlsxSheet(data: SheetData): NormalizedXlsxSheet {
  if (!data.length) throw new AppError("validation", "XLSX 工作表为空")
  const columnCount = Math.max(...data.map((row) => row.length))
  if (!columnCount) throw new AppError("validation", "XLSX 工作表没有列")
  if (columnCount > MAX_COLUMNS) throw new AppError("validation", `XLSX 最多支持 ${MAX_COLUMNS} 列`)
  const headers = Array.from({ length: columnCount }, (_, index) => normalizeHeader(data[0]?.[index], index))
  if (new Set(headers).size !== headers.length) throw new AppError("validation", "XLSX 表头不能重复")
  const sourceRows = data.slice(1).filter((row) => row.some((value) => value !== null && value !== undefined && String(value).trim() !== ""))
  if (sourceRows.length > MAX_ROWS) throw new AppError("validation", `XLSX 最多支持 ${MAX_ROWS.toLocaleString()} 行数据`)
  const rows = sourceRows.map((row) => Object.fromEntries(headers.map((header, index) => [header, normalizeCell(row[index])])))
  return { rowsJson: JSON.stringify(rows), rowCount: rows.length, columnCount }
}
