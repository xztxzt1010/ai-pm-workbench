import { useEffect, useState } from "react"
import { EyeIcon, SaveIcon } from "lucide-react"
import { toast } from "sonner"

import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Textarea } from "@/components/ui/textarea"
import { createProductDocument, listProductDocuments, type ProductDocument } from "@/services/product-document-service"
import { DEFAULT_DESIGN_BRIEF, validateDesignBrief, type DesignBrief } from "@/domain/design-brief"
import { reviewDesignBrief, type DesignReviewResult } from "@/domain/design-review"
import { AppError } from "@/domain/app-error"

function nodeClass(type: DesignBrief["nodes"][number]["type"], variant?: string) {
  const base = "absolute overflow-hidden whitespace-pre-wrap rounded border px-3 py-2 text-left text-xs"
  if (type === "button") return `${base} ${variant === "primary" ? "bg-primary text-primary-foreground" : "bg-muted"}`
  if (type === "input") return `${base} bg-background text-muted-foreground`
  if (type === "nav" || type === "list" || type === "frame") return `${base} bg-muted/60`
  if (type === "badge") return `${base} rounded-full bg-secondary`
  return `${base} bg-background text-sm font-medium`
}

export function DesignBriefPanel({ projectId, desktopRuntime, readOnly }: { projectId: string; desktopRuntime: boolean; readOnly: boolean }) {
  const [documents, setDocuments] = useState<ProductDocument[]>([])
  const [raw, setRaw] = useState(() => JSON.stringify(DEFAULT_DESIGN_BRIEF, null, 2))
  const [preview, setPreview] = useState<DesignBrief | null>(null)
  const [error, setError] = useState("")
  const [review, setReview] = useState<DesignReviewResult | null>(null)

  async function refresh() {
    if (!desktopRuntime) return
    setDocuments((await listProductDocuments(true, projectId)).filter((document) => document.documentType === "design_brief"))
  }

  useEffect(() => { setPreview(null); setReview(null); setError(""); void refresh() }, [projectId, desktopRuntime])

  function parsePreview() {
    try {
      const value = validateDesignBrief(JSON.parse(raw))
      setPreview(value)
      setReview(reviewDesignBrief(value))
      setError("")
    } catch (caught) {
      const message = caught instanceof AppError ? caught.message : "请输入合法的 JSON 设计 Brief"
      setPreview(null)
      setReview(null)
      setError(message)
    }
  }

  async function save() {
    if (readOnly || !preview || !review || !review.passed) return
    try {
      await createProductDocument(desktopRuntime, { id: `design-${projectId}-${Date.now()}`, projectId, title: preview.title, documentType: "design_brief", contentMarkdown: JSON.stringify(preview, null, 2), changeSummary: "设计 Brief Schema 草稿" })
      await refresh()
      toast.success("设计 Brief 已保存")
    } catch (caught) {
      toast.error(caught instanceof Error ? caught.message : "保存失败")
    }
  }

  return <Card>
    <CardHeader><CardTitle>设计 Brief 与低保真预览</CardTitle><CardDescription>仅允许白名单节点和数值布局；预览不会执行 HTML、脚本或事件代码。</CardDescription></CardHeader>
    <CardContent className="flex flex-col gap-3">
      {!desktopRuntime ? <p className="text-sm text-muted-foreground">浏览器模式仅支持本地预览，桌面模式才会保存版本。</p> : null}
      <Textarea value={raw} onChange={(event) => setRaw(event.target.value)} rows={12} disabled={readOnly} aria-label="Design Brief JSON" />
      {error ? <p className="text-sm text-destructive">{error}</p> : null}
      <div className="flex flex-wrap justify-end gap-2"><Button type="button" variant="outline" onClick={parsePreview}><EyeIcon data-icon="inline-start" />预览</Button><Button type="button" onClick={() => void save()} disabled={readOnly || !preview || !review?.passed || !desktopRuntime}><SaveIcon data-icon="inline-start" />保存版本</Button></div>
      {review ? <div className="rounded-lg border p-3"><div className="flex flex-wrap items-center gap-2"><p className="text-sm font-medium">设计评审</p><span className={review.passed ? "text-xs text-emerald-600" : "text-xs text-destructive"}>{review.passed ? "可保存" : "存在阻断问题，不能保存"}</span><span className="text-xs text-muted-foreground">严重 {review.criticalCount} · 警告 {review.warningCount}</span></div>{review.findings.length ? <div className="mt-2 flex flex-col gap-2">{review.findings.map((finding) => <div key={finding.id} className="rounded-md bg-muted/30 p-2 text-xs"><div className="flex flex-wrap gap-2"><span className={finding.severity === "critical" ? "font-medium text-destructive" : finding.severity === "warning" ? "font-medium text-amber-600" : "font-medium"}>{finding.severity}</span><span>{finding.category}</span>{finding.targetId ? <span className="text-muted-foreground">目标：{finding.targetId}</span> : null}</div><p className="mt-1">{finding.message}</p><p className="text-muted-foreground">建议：{finding.recommendation}</p></div>)}</div> : <p className="mt-2 text-xs text-muted-foreground">未发现结构、状态或无障碍问题。</p>}</div> : null}
      {preview ? <div className="overflow-auto rounded-lg border bg-muted/20 p-3"><div className="relative" style={{ width: preview.viewport.width, height: preview.viewport.height, maxWidth: "100%" }}>{preview.nodes.map((node) => <div key={node.id} className={nodeClass(node.type, node.variant)} style={{ left: node.x, top: node.y, width: node.width, height: node.height }}>{node.label}</div>)}</div></div> : null}
      {documents.length ? <p className="text-xs text-muted-foreground">已保存 {documents.length} 个设计 Brief 文档。</p> : null}
    </CardContent>
  </Card>
}
