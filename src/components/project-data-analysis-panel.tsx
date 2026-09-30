import { useEffect, useMemo, useState, type ChangeEvent } from "react"
import { BarChart3Icon, DownloadIcon, UploadIcon } from "lucide-react"
import { toast } from "sonner"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Textarea } from "@/components/ui/textarea"
import { parseDataset, runDeterministicAnalysis, type AnalysisResult, type Dataset } from "@/domain/dataset-analysis"
import { runCohort, runFunnel, runTrend, type CohortPoint, type FunnelStep, type TrendPoint } from "@/domain/advanced-analysis"
import { analysisToCsv } from "@/domain/analysis-export"
import { analysisToSvg } from "@/domain/analysis-chart-export"
import { normalizeXlsxSheet } from "@/domain/xlsx-dataset"
import { loadProviderConfig } from "@/data/provider-settings"
import { getRequirementRepository } from "@/data/requirement-repository"
import { createAnalysisDataset, createAnalysisInsight, createAnalysisRun, listAnalysisInsights, listExperiments, reviewAnalysisInsight, type AnalysisInsightRecord, type ExperimentRecord } from "@/services/product-document-service"
import { generateAnalysisExplanation } from "@/services/structured-generation-service"
import type { ProviderConfig } from "@/domain/provider-rules"
import type { Sheet } from "read-excel-file/browser"

export function ProjectDataAnalysisPanel({ projectId, desktopRuntime, readOnly }: { projectId: string; desktopRuntime: boolean; readOnly: boolean }) {
  const [sourceType, setSourceType] = useState<"csv" | "json">("csv")
  const [sourceFormat, setSourceFormat] = useState<"csv" | "json" | "xlsx">("csv")
  const [raw, setRaw] = useState("")
  const [dataset, setDataset] = useState<Dataset>()
  const [analysis, setAnalysis] = useState<AnalysisResult>()
  const [error, setError] = useState("")
  const [title, setTitle] = useState("数据集")
  const [savedCount, setSavedCount] = useState(0)
  const [operator, setOperator] = useState<"summary" | "funnel" | "trend" | "cohort">("summary")
  const [operatorFields, setOperatorFields] = useState("")
  const [advanced, setAdvanced] = useState<FunnelStep[] | TrendPoint[] | CohortPoint[]>()
  const [lastRunId, setLastRunId] = useState("")
  const [insightTitle, setInsightTitle] = useState("")
  const [insightContent, setInsightContent] = useState("")
  const [targetKey, setTargetKey] = useState("project")
  const [requirements, setRequirements] = useState<Array<{ id: string; versionId: string; title: string }>>([])
  const [experiments, setExperiments] = useState<ExperimentRecord[]>([])
  const [insights, setInsights] = useState<AnalysisInsightRecord[]>([])
  const [workbookSheets, setWorkbookSheets] = useState<Sheet[]>([])
  const [selectedSheet, setSelectedSheet] = useState("")
  const [providerConfig, setProviderConfig] = useState<ProviderConfig>({ kind: "none", endpoint: "", model: "", enabled: false, updatedAt: new Date(0).toISOString() })
  const [explanation, setExplanation] = useState<Awaited<ReturnType<typeof generateAnalysisExplanation>>["output"]>()

  useEffect(() => {
    if (!desktopRuntime) return
    void Promise.all([
      getRequirementRepository(true).listByProject(projectId),
      listExperiments(true, projectId),
      listAnalysisInsights(true, projectId),
    ]).then(([nextRequirements, nextExperiments, nextInsights]) => {
      setRequirements(nextRequirements.filter((item) => item.card.status === "confirmed" && item.currentVersion.isConfirmed).map((item) => ({ id: item.card.id, versionId: item.currentVersion.id, title: item.currentVersion.title })))
      setExperiments(nextExperiments)
      setInsights(nextInsights)
    }).catch((caught) => toast.error(caught instanceof Error ? caught.message : "无法读取分析关联数据"))
  }, [desktopRuntime, projectId])

  useEffect(() => { void loadProviderConfig(desktopRuntime).then(setProviderConfig).catch(() => undefined) }, [desktopRuntime])

  const targets = useMemo(() => [
    { key: "project", kind: "project" as const, id: projectId, versionId: "", label: "当前项目" },
    ...requirements.map((item) => ({ key: `requirement:${item.id}:${item.versionId}`, kind: "requirement" as const, id: item.id, versionId: item.versionId, label: `需求 · ${item.title}` })),
    ...experiments.map((item) => ({ key: `experiment:${item.id}:${item.versionNumber}`, kind: "experiment" as const, id: item.id, versionId: String(item.versionNumber), label: `实验 · ${item.name} v${item.versionNumber}` })),
  ], [experiments, projectId, requirements])

  function analyze(value = raw, kind = sourceType) {
    try { const next = parseDataset(value, kind); setDataset(next); setAnalysis(runDeterministicAnalysis(next)); setAdvanced(undefined); setError("") } catch (caught) { setDataset(undefined); setAnalysis(undefined); setError(caught instanceof Error ? caught.message : "数据集解析失败") }
  }

  function runAdvanced() {
    if (!dataset) return
    try { const fields = operatorFields.split(",").map((field) => field.trim()).filter(Boolean); setAdvanced(operator === "funnel" ? runFunnel(dataset, fields) : operator === "trend" ? runTrend(dataset, fields[0], fields[1]) : runCohort(dataset, fields[0], fields[1])); setError("") } catch (caught) { setAdvanced(undefined); setError(caught instanceof Error ? caught.message : "算子执行失败") }
  }

  async function saveDataset() {
    if (!dataset || !analysis || !desktopRuntime) return
    try {
      const rowsJson = JSON.stringify(dataset.rows)
      const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(rowsJson))
      const contentHash = [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("")
      const saved = await createAnalysisDataset(true, { id: crypto.randomUUID(), projectId, title: title.trim() || "数据集", sourceType: dataset.sourceType, sourceFormat, schemaJson: JSON.stringify(dataset.fields), rowsJson, contentHash })
      const runId = crypto.randomUUID()
      await createAnalysisRun(true, { id: runId, projectId, datasetId: saved.id, operator: operator === "summary" ? "summary" : operator, parametersJson: JSON.stringify({ fields: operatorFields.split(",").map((field) => field.trim()).filter(Boolean) }), resultJson: JSON.stringify(operator === "summary" ? analysis : advanced ?? []) })
      setLastRunId(runId); setInsightTitle((current) => current || `${title.trim() || "数据集"}洞察`); setSavedCount((count) => count + 1); toast.success("数据集和分析结果已保存，可以记录洞察")
    } catch (caught) { toast.error(caught instanceof Error ? caught.message : "保存数据集失败") }
  }

  async function saveInsight() {
    const target = targets.find((item) => item.key === targetKey)
    if (!lastRunId || !target) return
    try {
      const saved = await createAnalysisInsight(true, { id: crypto.randomUUID(), linkId: crypto.randomUUID(), projectId, analysisRunId: lastRunId, title: insightTitle, content: insightContent, targetKind: target.kind, targetId: target.id, targetVersionId: target.versionId, createdBy: "user" })
      setInsights((current) => [saved, ...current]); setInsightContent(""); toast.success("分析洞察草稿已保存")
    } catch (caught) { toast.error(caught instanceof Error ? caught.message : "保存分析洞察失败") }
  }

  async function explainAnalysis() {
    if (!lastRunId || !providerConfig.enabled) return
    const result = operator === "summary" ? analysis : advanced
    if (!result) return
    try {
      const generated = await generateAnalysisExplanation(projectId, lastRunId, operator, { fields: operatorFields.split(",").map((field) => field.trim()).filter(Boolean) }, result, providerConfig, desktopRuntime)
      setExplanation(generated.output)
      setInsightContent(`${generated.output.summary}\n${generated.output.findings.map((finding) => `${finding.title}：${finding.explanation} [${finding.evidence.map((citation) => `${citation.path}=${citation.value}`).join("；")}]`).join("\n")}`)
      toast.success("分析解释已生成，请核对证据后再保存洞察")
    } catch (caught) { toast.error(caught instanceof Error ? caught.message : "分析解释生成失败") }
  }

  async function reviewInsight(item: AnalysisInsightRecord, action: "confirm" | "archive") {
    try {
      await reviewAnalysisInsight(true, projectId, item.id, action)
      const status = action === "confirm" ? "confirmed" : "archived"
      setInsights((current) => current.map((candidate) => candidate.id === item.id ? { ...candidate, status } : candidate)); toast.success(action === "confirm" ? "洞察已确认" : "洞察已归档")
    } catch (caught) { toast.error(caught instanceof Error ? caught.message : "审核洞察失败") }
  }

  function exportReport() {
    if (!dataset || !analysis) return
    const report = { generatedAt: new Date().toISOString(), sourceType: dataset.sourceType, columns: dataset.columns, rowCount: dataset.rows.length, diagnostics: dataset.fields, summary: analysis, operator, fields: operatorFields.split(",").map((field) => field.trim()).filter(Boolean), result: advanced ?? null }
    const link = document.createElement("a"); link.href = URL.createObjectURL(new Blob([JSON.stringify(report, null, 2)], { type: "application/json;charset=utf-8" })); link.download = `${title || "analysis"}.json`; link.click(); URL.revokeObjectURL(link.href)
  }

  function exportCsv() {
    if (!dataset || !analysis) return
    const result = operator === "summary" ? analysis : advanced
    if (!result) return
    const link = document.createElement("a"); link.href = URL.createObjectURL(new Blob([analysisToCsv(operator, result)], { type: "text/csv;charset=utf-8" })); link.download = `${title || "analysis"}-${operator}.csv`; link.click(); URL.revokeObjectURL(link.href)
  }

  function exportSvg() {
    if (!dataset || !analysis) return
    const result = operator === "summary" ? analysis : advanced
    if (!result) return
    const link = document.createElement("a"); link.href = URL.createObjectURL(new Blob([analysisToSvg(operator, result, title || "Analysis")], { type: "image/svg+xml;charset=utf-8" })); link.download = `${title || "analysis"}-${operator}.svg`; link.click(); URL.revokeObjectURL(link.href)
  }

  async function importFile(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0]; if (!file) return
    const extension = file.name.toLowerCase().endsWith(".json") ? "json" : file.name.toLowerCase().endsWith(".csv") ? "csv" : file.name.toLowerCase().endsWith(".xlsx") ? "xlsx" : undefined
    if (!extension) { toast.error("仅支持 CSV、JSON 或 XLSX 文件"); event.target.value = ""; return }
    if (file.size > 10 * 1024 * 1024) { toast.error("数据文件不能超过 10 MB"); event.target.value = ""; return }
    try {
      setTitle(file.name.replace(/\.(csv|json|xlsx)$/i, ""))
      if (extension === "xlsx") {
        const { default: readWorkbook } = await import("read-excel-file/browser")
        const sheets = await readWorkbook(file)
        if (!sheets.length) throw new Error("XLSX 没有可读取的工作表")
        if (sheets.length > 50) throw new Error("XLSX 最多支持 50 个工作表")
        setWorkbookSheets(sheets); loadWorkbookSheet(sheets[0].sheet, sheets)
      } else {
        const content = await file.text(); setWorkbookSheets([]); setSelectedSheet(""); setSourceFormat(extension); setSourceType(extension); setRaw(content); analyze(content, extension)
      }
    } catch (caught) { const message = caught instanceof Error ? caught.message : "数据文件解析失败"; setError(message); toast.error(message) }
    event.target.value = ""
  }

  function loadWorkbookSheet(sheetName: string, sheets = workbookSheets) {
    try {
      const sheet = sheets.find((item) => item.sheet === sheetName)
      if (!sheet) throw new Error("XLSX 工作表不存在")
      const normalized = normalizeXlsxSheet(sheet.data)
      setSelectedSheet(sheet.sheet); setSourceFormat("xlsx"); setSourceType("json"); setRaw(normalized.rowsJson); analyze(normalized.rowsJson, "json")
    } catch (caught) { setDataset(undefined); setAnalysis(undefined); setError(caught instanceof Error ? caught.message : "XLSX 工作表解析失败") }
  }

  return <Card>
    <CardHeader><CardTitle><BarChart3Icon className="mr-2 inline size-4" />数据分析预览</CardTitle><CardDescription>本地解析 CSV、JSON 和 XLSX，确定性执行摘要与分析算子；不调用模型计算数值，相同输入会得到相同结果。</CardDescription></CardHeader>
    <CardContent className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2"><select value={sourceType} onChange={(event) => { const kind = event.target.value as "csv" | "json"; setSourceType(kind); setSourceFormat(kind); setWorkbookSheets([]); setSelectedSheet("") }} className="h-9 rounded-md border bg-background px-2 text-sm" aria-label="数据类型"><option value="csv">CSV</option><option value="json">JSON</option></select><label className="inline-flex cursor-pointer items-center gap-2 rounded-md border px-3 py-2 text-sm"><UploadIcon className="size-4" />导入文件<input type="file" accept=".csv,.json,.xlsx,text/csv,application/json,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" className="sr-only" onChange={(event) => void importFile(event)} /></label><Badge variant="outline">来源 {sourceFormat.toUpperCase()}</Badge><input value={title} onChange={(event) => setTitle(event.target.value)} className="h-9 min-w-40 rounded-md border bg-background px-2 text-sm" placeholder="数据集名称" aria-label="数据集名称" /></div>
      {workbookSheets.length ? <div className="flex flex-wrap items-center gap-2 rounded-md border p-2 text-sm"><span>工作表</span><select value={selectedSheet} onChange={(event) => loadWorkbookSheet(event.target.value)} className="h-9 min-w-48 rounded-md border bg-background px-2" aria-label="XLSX 工作表">{workbookSheets.map((sheet) => <option key={sheet.sheet} value={sheet.sheet}>{sheet.sheet}</option>)}</select><span className="text-xs text-muted-foreground">公式不会执行；请导入已保存计算值的工作簿。</span></div> : null}
      <Textarea value={raw} onChange={(event) => setRaw(event.target.value)} rows={8} placeholder={sourceType === "csv" ? "id,amount\n1,10" : '[{"id":1,"amount":10]}'} disabled={readOnly} aria-label="数据集内容" />
      <div className="flex flex-wrap justify-end gap-2"><Button type="button" variant="outline" onClick={() => analyze()} disabled={readOnly || !raw.trim()}>解析并分析</Button><Button type="button" variant="outline" onClick={exportReport} disabled={!dataset || !analysis}><DownloadIcon data-icon="inline-start" />导出 JSON 报告</Button><Button type="button" variant="outline" onClick={exportCsv} disabled={!dataset || !analysis || (operator !== "summary" && !advanced)}><DownloadIcon data-icon="inline-start" />导出 CSV</Button><Button type="button" variant="outline" onClick={exportSvg} disabled={!dataset || !analysis || (operator !== "summary" && !advanced)}><DownloadIcon data-icon="inline-start" />导出 SVG 图表</Button><Button type="button" onClick={() => void saveDataset()} disabled={readOnly || !desktopRuntime || !dataset || !analysis}>保存数据集与结果</Button></div>
      {dataset ? <div className="flex flex-wrap items-center gap-2 rounded-md border p-2"><select value={operator} onChange={(event) => { setOperator(event.target.value as typeof operator); setAdvanced(undefined) }} className="h-9 rounded-md border bg-background px-2 text-sm" aria-label="分析算子"><option value="summary">摘要</option><option value="funnel">漏斗</option><option value="trend">趋势</option><option value="cohort">Cohort</option></select>{operator !== "summary" ? <input value={operatorFields} onChange={(event) => setOperatorFields(event.target.value)} className="h-9 min-w-60 flex-1 rounded-md border bg-background px-2 text-sm" placeholder={operator === "funnel" ? "步骤字段，例如 visit,signup,purchase" : "字段，例如 date,revenue"} aria-label="分析字段" /> : null}{operator !== "summary" ? <Button type="button" size="sm" variant="outline" onClick={runAdvanced}>运行算子</Button> : null}</div> : null}
      {error ? <p className="text-sm text-destructive">{error}</p> : null}
      {dataset && analysis ? <div className="flex flex-col gap-3 rounded-lg border p-3"><div className="flex flex-wrap gap-2"><Badge variant="secondary">{analysis.rowCount} 行</Badge><Badge variant="outline">{dataset.columns.length} 列</Badge><Badge variant={dataset.duplicateRowCount ? "destructive" : "outline"}>重复行 {dataset.duplicateRowCount}</Badge></div><div className="grid gap-2 sm:grid-cols-2">{dataset.fields.map((field) => <div key={field.name} className="rounded-md bg-muted/30 p-2 text-xs"><p className="font-medium">{field.name} · {field.type}</p><p className="text-muted-foreground">缺失 {field.missingCount} · 异常 {field.invalidCount} · 唯一值 {field.uniqueCount}</p></div>)}</div>{analysis.numeric.length ? <div><p className="mb-1 text-sm font-medium">数值摘要</p><div className="flex flex-col gap-1 text-xs">{analysis.numeric.map((item) => <p key={item.field}>{item.field}：均值 {item.mean.toFixed(2)}，范围 {item.min}–{item.max}，有效 {item.count}</p>)}</div></div> : null}{analysis.categorical.length ? <div><p className="mb-1 text-sm font-medium">分类摘要</p><div className="flex flex-col gap-1 text-xs">{analysis.categorical.map((item) => <p key={item.field}>{item.field}：{item.values.map((value) => `${value.value} (${value.count})`).join("、")}</p>)}</div></div> : null}</div> : null}
      {advanced ? <div className="rounded-lg border p-3 text-xs"><p className="mb-2 text-sm font-medium">{operator} 结果</p>{advanced.map((item, index) => { const ratio = "rateFromPrevious" in item ? item.rateFromPrevious : "period" in item ? (Math.max(...advanced.map((point) => "value" in point ? point.value : point.count)) ? item.value / Math.max(...advanced.map((point) => "value" in point ? point.value : point.count)) : 0) : (Math.max(...advanced.map((point) => "mean" in point ? point.mean : 0)) ? item.mean / Math.max(...advanced.map((point) => "mean" in point ? point.mean : 0)) : 0); const label = "field" in item ? `${item.field}：数量 ${item.count}，相对上一步 ${(item.rateFromPrevious * 100).toFixed(1)}%` : "period" in item ? `${item.period}：${item.count} 行，值 ${item.value}` : `${item.cohort}：${item.count} 行，均值 ${item.mean.toFixed(2)}`; return <div key={index} className="mb-2"><p>{label}</p><div className="h-2 rounded bg-primary/20"><div className="h-2 rounded bg-primary" style={{ width: `${Math.max(0, Math.min(100, ratio * 100))}%` }} /></div></div> })}</div> : null}
      {explanation ? <div className="rounded-lg border bg-muted/30 p-3 text-sm"><div className="flex items-center justify-between gap-2"><p className="font-medium">分析解释 Agent 预览</p><Badge variant="outline">只读 · 已引用结果路径</Badge></div><p className="mt-1">{explanation.summary}</p>{explanation.findings.map((finding, index) => <div key={index} className="mt-2"><p className="font-medium">{finding.title}</p><p>{finding.explanation}</p><p className="text-xs text-muted-foreground">{finding.evidence.map((citation) => `${citation.path} = ${citation.value}`).join("；")}</p></div>)}<p className="mt-2 text-xs text-muted-foreground">限制：{explanation.limitations.join("、") || "无"}</p></div> : null}
      {lastRunId ? <div className="flex justify-end"><Button type="button" variant="outline" onClick={() => void explainAnalysis()} disabled={readOnly || !desktopRuntime || !providerConfig.enabled || Boolean(!analysis && !advanced)}>生成分析解释 Agent 预览</Button></div> : null}
      <div className="flex flex-col gap-2 rounded-lg border p-3"><div><p className="text-sm font-medium">保存分析洞察</p><p className="text-xs text-muted-foreground">洞察固定引用刚保存的分析运行；需求和实验关联固定到当前版本，后续变更不会改写历史证据。</p></div><div className="grid gap-2 sm:grid-cols-2"><input value={insightTitle} onChange={(event) => setInsightTitle(event.target.value)} className="h-9 rounded-md border bg-background px-2 text-sm" placeholder="洞察标题" disabled={readOnly || !lastRunId} /><select value={targetKey} onChange={(event) => setTargetKey(event.target.value)} className="h-9 rounded-md border bg-background px-2 text-sm" disabled={readOnly || !lastRunId} aria-label="洞察关联目标">{targets.map((target) => <option key={target.key} value={target.key}>{target.label}</option>)}</select></div><Textarea value={insightContent} onChange={(event) => setInsightContent(event.target.value)} rows={3} placeholder="基于上方真实计算结果记录结论、解释和下一步建议" disabled={readOnly || !lastRunId} /><div className="flex justify-end"><Button type="button" onClick={() => void saveInsight()} disabled={readOnly || !desktopRuntime || !lastRunId || !insightTitle.trim() || !insightContent.trim()}>保存洞察草稿</Button></div></div>
      {insights.length ? <div className="flex flex-col gap-2"><p className="text-sm font-medium">已保存洞察</p>{insights.map((item) => <div key={item.id} className="rounded-md border p-3 text-sm"><div className="flex flex-wrap items-center gap-2"><p className="flex-1 font-medium">{item.title}</p><Badge variant={item.status === "confirmed" ? "secondary" : "outline"}>{item.status === "draft" ? "草稿" : item.status === "confirmed" ? "已确认" : "已归档"}</Badge><Badge variant="outline">{item.targetKind === "project" ? "项目" : item.targetKind === "requirement" ? "需求版本" : `实验 v${item.targetVersionId}`}</Badge></div><p className="mt-1 text-muted-foreground">{item.content}</p>{item.status !== "archived" && !readOnly ? <div className="mt-2 flex justify-end gap-2">{item.status === "draft" ? <Button size="sm" variant="outline" onClick={() => void reviewInsight(item, "confirm")}>人工确认</Button> : null}<Button size="sm" variant="outline" onClick={() => void reviewInsight(item, "archive")}>归档</Button></div> : null}</div>)}</div> : null}
    </CardContent>
  </Card>
}
