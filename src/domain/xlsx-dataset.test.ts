import { describe, expect, it } from "vitest"
import type { SheetData } from "read-excel-file/browser"

import { normalizeXlsxSheet } from "@/domain/xlsx-dataset"

describe("xlsx dataset normalization", () => {
  it("converts typed rows to deterministic JSON records", () => {
    const result = normalizeXlsxSheet([["date", "amount", "active"], [new Date("2026-07-16T00:00:00.000Z"), 12.5, true], [null, null, null]] as unknown as SheetData)
    expect(result).toMatchObject({ rowCount: 1, columnCount: 3 })
    expect(JSON.parse(result.rowsJson)).toEqual([{ date: "2026-07-16T00:00:00.000Z", amount: 12.5, active: true }])
  })

  it("rejects empty or duplicate headers instead of silently overwriting cells", () => {
    expect(() => normalizeXlsxSheet([["id", "id"], [1, 2]])).toThrow("表头不能重复")
    expect(() => normalizeXlsxSheet([["id", null], [1, 2]])).toThrow("第 2 列表头为空")
  })
})
