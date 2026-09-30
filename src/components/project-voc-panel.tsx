import { useEffect, useMemo, useState } from "react"
import { MessageSquareMoreIcon } from "lucide-react"
import { toast } from "sonner"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import { parseVocFeedback, summarizeVocFeedback, trendVocFeedback, type VocFeedback } from "@/domain/voc-feedback"
import { createVocFeedbackBatch, createVocRequirementCandidate, listVocFeedback, listVocRequirementCandidates, reviewVocRequirementCandidate, type VocFeedbackRecord, type VocRequirementCandidate } from "@/services/voc-service"

const severityLabel = { low: "低", medium: "中", high: "高", critical: "严重" } as const

export function ProjectVocPanel({ projectId, desktopRuntime, readOnly }: { projectId: string; desktopRuntime: boolean; readOnly: boolean }) {
  const [sourceType, setSourceType] = useState<"csv" | "json">("json")
  const [raw, setRaw] = useState("")
  const [preview, setPreview] = useState<VocFeedback[]>([])
  const [feedback, setFeedback] = useState<VocFeedbackRecord[]>([])
  const [candidates, setCandidates] = useState<VocRequirementCandidate[]>([])
  const [selectedIds, setSelectedIds] = useState<string[]>([])
  const [candidateTitle, setCandidateTitle] = useState("")
  const [candidateDescription, setCandidateDescription] = useState("")

  useEffect(() => {
    if (!desktopRuntime) return
    void Promise.all([listVocFeedback(true, projectId), listVocRequirementCandidates(true, projectId)]).then(([items, nextCandidates]) => { setFeedback(items); setCandidates(nextCandidates) }).catch((caught) => toast.error(caught instanceof Error ? caught.message : "无法读取 VOC 数据"))
  }, [desktopRuntime, projectId])

  const clusters = useMemo(() => summarizeVocFeedback(preview.length ? preview : feedback), [feedback, preview])
  const trends = useMemo(() => trendVocFeedback(preview.length ? preview : feedback), [feedback, preview])

  function parse() { try { setPreview(parseVocFeedback(raw, sourceType)); toast.success("VOC 反馈已解析，尚未写入数据库") } catch (caught) { setPreview([]); toast.error(caught instanceof Error ? caught.message : "VOC 解析失败") } }
  async function save() {
    if (!preview.length) return
    try {
      const saved = await createVocFeedbackBatch(true, preview.map((item) => ({ id: crypto.randomUUID(), projectId, ...item })))
      setFeedback((current) => [...saved, ...current]); setPreview([]); setRaw(""); toast.success(`${saved.length} 条 VOC 反馈已原子保存`)
    } catch (caught) { toast.error(caught instanceof Error ? caught.message : "VOC 反馈保存失败") }
  }
  async function createCandidate() {
    if (!selectedIds.length) return
    try {
      const saved = await createVocRequirementCandidate(true, { id: crypto.randomUUID(), projectId, title: candidateTitle, description: candidateDescription, feedbackIdsJson: JSON.stringify(selectedIds) })
      setCandidates((current) => [saved, ...current]); setSelectedIds([]); setCandidateTitle(""); setCandidateDescription(""); toast.success("需求候选草稿已创建，不会直接成为正式需求")
    } catch (caught) { toast.error(caught instanceof Error ? caught.message : "需求候选创建失败") }
  }
  async function review(candidate: VocRequirementCandidate, action: "accept" | "reject") {
    try { await reviewVocRequirementCandidate(true, projectId, candidate.id, action); setCandidates((current) => current.map((item) => item.id === candidate.id ? { ...item, status: action === "accept" ? "accepted" : "rejected" } : item)); toast.success(action === "accept" ? "候选已接受，仍需在需求模块创建正式需求" : "候选已拒绝") } catch (caught) { toast.error(caught instanceof Error ? caught.message : "候选审核失败") }
  }

  return <Card><CardHeader><CardTitle><MessageSquareMoreIcon className="mr-2 inline size-4" />用户之声（VOC）</CardTitle><CardDescription>导入带来源的用户反馈，确定性汇总分类、聚类、趋势和严重程度；反馈只能生成需求候选，不能直接成为正式需求。</CardDescription></CardHeader><CardContent className="flex flex-col gap-3">
    <div className="flex flex-wrap gap-2"><select value={sourceType} onChange={(event) => setSourceType(event.target.value as "csv" | "json")} className="h-9 rounded-md border bg-background px-2 text-sm" aria-label="VOC 数据格式"><option value="json">JSON</option><option value="csv">CSV</option></select><Badge variant="outline">单次最多 500 条</Badge></div>
    <Textarea value={raw} onChange={(event) => setRaw(event.target.value)} rows={6} disabled={readOnly} placeholder={sourceType === "json" ? '[{"content":"导出很慢","category":"性能","severity":"high","source":"support","sourceRef":"ticket-1","occurredAt":"2026-07-16"}]' : "content,category,severity,source,sourceRef,occurredAt\n导出很慢,性能,high,support,ticket-1,2026-07-16"} />
    <div className="flex flex-wrap justify-end gap-2"><Button variant="outline" onClick={parse} disabled={readOnly || !raw.trim()}>解析预览</Button><Button onClick={() => void save()} disabled={readOnly || !desktopRuntime || !preview.length}>原子保存反馈</Button></div>
    {(preview.length || feedback.length) ? <div className="grid gap-2 sm:grid-cols-2"><div className="rounded-md border p-3"><p className="text-sm font-medium">聚类与严重程度</p>{clusters.slice(0, 10).map((cluster) => <p key={cluster.key} className="mt-1 text-xs">{cluster.category} · {cluster.count} 条 · 最高 {severityLabel[cluster.highestSeverity]}</p>)}</div><div className="rounded-md border p-3"><p className="text-sm font-medium">月度趋势</p>{trends.map((trend) => <p key={trend.period} className="mt-1 text-xs">{trend.period} · {trend.count} 条 · 严重 {trend.criticalCount}</p>)}</div></div> : null}
    {feedback.length ? <div className="flex flex-col gap-2"><p className="text-sm font-medium">已保存反馈</p>{feedback.slice(0, 50).map((item) => <label key={item.id} className="flex gap-2 rounded-md border p-2 text-sm"><input type="checkbox" checked={selectedIds.includes(item.id)} onChange={(event) => setSelectedIds((current) => event.target.checked ? [...current, item.id] : current.filter((id) => id !== item.id))} disabled={readOnly} /><span className="flex-1"><span className="font-medium">{item.category} · {severityLabel[item.severity]}</span><br/><span className="text-muted-foreground">{item.content}</span><br/><span className="text-xs text-muted-foreground">来源 {item.sourceType}{item.sourceRef ? ` · ${item.sourceRef}` : ""}{item.evidence ? ` · 证据：${item.evidence}` : ""}</span></span></label>)}</div> : null}
    <div className="rounded-md border p-3"><p className="text-sm font-medium">转为需求候选</p><p className="mb-2 text-xs text-muted-foreground">已选择 {selectedIds.length} 条反馈；候选仍需人工接受，并在需求模块中另行建立带正式证据的需求。</p><div className="grid gap-2 sm:grid-cols-2"><Input value={candidateTitle} onChange={(event) => setCandidateTitle(event.target.value)} placeholder="候选标题" disabled={readOnly} /><Input value={candidateDescription} onChange={(event) => setCandidateDescription(event.target.value)} placeholder="候选说明" disabled={readOnly} /></div><div className="mt-2 flex justify-end"><Button onClick={() => void createCandidate()} disabled={readOnly || !desktopRuntime || !selectedIds.length || !candidateTitle.trim() || !candidateDescription.trim()}>创建候选草稿</Button></div></div>
    {candidates.length ? <div className="flex flex-col gap-2"><p className="text-sm font-medium">需求候选</p>{candidates.map((candidate) => <div key={candidate.id} className="rounded-md border p-3 text-sm"><div className="flex flex-wrap items-center gap-2"><p className="flex-1 font-medium">{candidate.title}</p><Badge variant={candidate.status === "accepted" ? "secondary" : "outline"}>{candidate.status === "draft" ? "草稿" : candidate.status === "accepted" ? "已接受候选" : "已拒绝"}</Badge></div><p className="text-muted-foreground">{candidate.description}</p>{candidate.status === "draft" && !readOnly ? <div className="mt-2 flex justify-end gap-2"><Button size="sm" variant="outline" onClick={() => void review(candidate, "reject")}>拒绝</Button><Button size="sm" onClick={() => void review(candidate, "accept")}>接受候选</Button></div> : null}</div>)}</div> : null}
  </CardContent></Card>
}
