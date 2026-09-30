import { analysisToSvg } from "../src/domain/analysis-chart-export"

const longLabel = `新用户激活路径😀${"非常长的中文阶段名称".repeat(8)}`
const svg = analysisToSvg("funnel", [
  { field: longLabel, count: 1_250_000, rateFromPrevious: 1 },
  { field: "完成首次关键操作", count: 375_000, rateFromPrevious: 0.3 },
], "2026 年第三季度新用户激活漏斗与中文长标签视觉验收")

const preview = document.querySelector("#preview")
if (!preview) throw new Error("SVG preview root is missing")
preview.innerHTML = svg
