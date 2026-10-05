import { useEffect, useState, type FormEvent } from "react"
import { AlertTriangleIcon, ArchiveIcon, BrainIcon, CheckIcon, ChevronDownIcon, Clock3Icon, Link2Icon, SearchIcon, UnlinkIcon, XIcon } from "lucide-react"
import { toast } from "sonner"

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Field, FieldGroup, FieldLabel } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import {
  createProjectMemoryCandidate,
  createProjectMemoryConflict,
  deleteProjectMemoryConflict,
  listProjectMemories,
  listProjectMemoryConflicts,
  listProjectMemorySources,
  reviewProjectMemoryCandidate,
  searchProjectMemories,
  type ProjectMemoryReviewAction,
  type ProjectMemoryConflict,
  type ProjectMemoryRelationType,
  type ProjectMemorySearchResult,
  type ProjectMemorySource,
  type ProjectMemoryStatus,
} from "@/services/project-memory-service"

const statusLabels: Record<ProjectMemoryStatus, string> = {
  pending: "待确认",
  confirmed: "已确认",
  rejected: "已拒绝",
  expired: "已过期",
  archived: "已归档",
}

function errorMessage(error: unknown, fallback: string) {
  return error instanceof Error && error.message ? error.message : fallback
}

export function ProjectMemoryPanel({ projectId, desktopRuntime, readOnly }: { projectId: string; desktopRuntime: boolean; readOnly?: boolean }) {
  const [items, setItems] = useState<ProjectMemorySearchResult[]>([])
  const [query, setQuery] = useState("")
  const [loading, setLoading] = useState(false)
  const [reviewingId, setReviewingId] = useState<string>()
  const [expandedId, setExpandedId] = useState<string>()
  const [sourcesByMemory, setSourcesByMemory] = useState<Record<string, ProjectMemorySource[]>>({})
  const [conflictsByMemory, setConflictsByMemory] = useState<Record<string, ProjectMemoryConflict[]>>({})
  const [sourceLoadingId, setSourceLoadingId] = useState<string>()
  const [relationMemoryId, setRelationMemoryId] = useState("")
  const [relatedMemoryId, setRelatedMemoryId] = useState("")
  const [relationType, setRelationType] = useState<ProjectMemoryRelationType>("conflicts")
  const [relationSaving, setRelationSaving] = useState(false)

  async function refresh(nextQuery = query) {
    if (!desktopRuntime) return
    setLoading(true)
    try {
      const results = nextQuery.trim()
        ? await searchProjectMemories(true, projectId, nextQuery.trim(), undefined, 20)
        : await listProjectMemories(true, projectId, undefined, 20)
      setItems(results)
    } catch (error) {
      toast.error(errorMessage(error, "无法读取项目记忆"))
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    setQuery("")
    setExpandedId(undefined)
    setSourcesByMemory({})
    setConflictsByMemory({})
    void refresh("")
    // The project id is the boundary of every memory query.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [desktopRuntime, projectId])

  async function createCandidate(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const form = event.currentTarget
    const values = new FormData(form)
    setLoading(true)
    try {
      await createProjectMemoryCandidate(desktopRuntime, {
        id: crypto.randomUUID(),
        projectId,
        title: String(values.get("title") ?? "").trim(),
        content: String(values.get("content") ?? "").trim(),
      })
      form.reset()
      setQuery("")
      await refresh("")
      toast.success("记忆候选已创建，确认前不会成为永久记忆")
    } catch (error) {
      toast.error(errorMessage(error, "无法创建项目记忆候选"))
    } finally {
      setLoading(false)
    }
  }

  async function review(memoryId: string, action: ProjectMemoryReviewAction) {
    setReviewingId(memoryId)
    try {
      await reviewProjectMemoryCandidate(desktopRuntime, memoryId, action)
      await refresh()
      toast.success(action === "confirm" ? "记忆已由你确认" : "记忆状态已更新")
    } catch (error) {
      toast.error(errorMessage(error, "无法审核项目记忆"))
    } finally {
      setReviewingId(undefined)
    }
  }

  async function toggleSources(memoryId: string) {
    if (expandedId === memoryId) {
      setExpandedId(undefined)
      return
    }
    setExpandedId(memoryId)
    if (sourcesByMemory[memoryId] && conflictsByMemory[memoryId]) return
    setSourceLoadingId(memoryId)
    try {
      const [sources, conflicts] = await Promise.all([
        listProjectMemorySources(desktopRuntime, projectId, memoryId),
        listProjectMemoryConflicts(desktopRuntime, projectId, memoryId),
      ])
      setSourcesByMemory((current) => ({ ...current, [memoryId]: sources }))
      setConflictsByMemory((current) => ({ ...current, [memoryId]: conflicts }))
    } catch (error) {
      setExpandedId(undefined)
      toast.error(errorMessage(error, "无法读取记忆来源"))
    } finally {
      setSourceLoadingId(undefined)
    }
  }

  async function createRelation(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!relationMemoryId || !relatedMemoryId) {
      toast.error("请选择两条不同的项目记忆")
      return
    }
    setRelationSaving(true)
    try {
      await createProjectMemoryConflict(desktopRuntime, projectId, relationMemoryId, relatedMemoryId, relationType)
      setConflictsByMemory({})
      setExpandedId(undefined)
      setRelatedMemoryId("")
      toast.success(relationType === "conflicts" ? "已记录冲突，等待人工处理" : "已记录替代关系，未自动修改原记忆")
    } catch (error) {
      toast.error(errorMessage(error, "无法创建记忆关系"))
    } finally {
      setRelationSaving(false)
    }
  }

  async function removeRelation(itemId: string, conflict: ProjectMemoryConflict) {
    setRelationSaving(true)
    try {
      const originId = conflict.relationType === "supersedes" && conflict.direction === "incoming" ? conflict.relatedMemoryId : itemId
      const targetId = originId === itemId ? conflict.relatedMemoryId : itemId
      await deleteProjectMemoryConflict(desktopRuntime, projectId, originId, targetId, conflict.relationType)
      const next = await listProjectMemoryConflicts(desktopRuntime, projectId, itemId)
      setConflictsByMemory((current) => ({ ...current, [itemId]: next }))
      toast.success("记忆关系已解除")
    } catch (error) {
      toast.error(errorMessage(error, "无法解除记忆关系"))
    } finally {
      setRelationSaving(false)
    }
  }

  if (!desktopRuntime) return (
    <Card>
      <CardHeader><CardTitle>项目记忆</CardTitle><CardDescription>项目内可检索、可审核的长期上下文。</CardDescription></CardHeader>
      <CardContent><Alert><BrainIcon /><AlertTitle>桌面模式功能</AlertTitle><AlertDescription>浏览器预览不会读取或写入本地项目记忆。</AlertDescription></Alert></CardContent>
    </Card>
  )

  return (
    <Card>
      <CardHeader>
        <CardTitle>项目记忆</CardTitle>
        <CardDescription>所有新内容先进入待确认队列；AI 无权直接写成永久事实。</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        {!readOnly ? <form className="rounded-lg border p-3" onSubmit={createCandidate}>
          <FieldGroup>
            <Field><FieldLabel htmlFor={`memory-title-${projectId}`}>候选标题</FieldLabel><Input id={`memory-title-${projectId}`} name="title" maxLength={200} required placeholder="例如：首发范围不包含移动端" /></Field>
            <Field><FieldLabel htmlFor={`memory-content-${projectId}`}>候选内容</FieldLabel><Textarea id={`memory-content-${projectId}`} name="content" required placeholder="记录决定、事实及适用边界；确认后才进入长期记忆。" /></Field>
          </FieldGroup>
          <div className="mt-3 flex justify-end"><Button type="submit" size="sm" disabled={loading}>创建待确认候选</Button></div>
        </form> : null}

        <form className="flex gap-2" onSubmit={(event) => { event.preventDefault(); void refresh() }}>
          <Input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="搜索当前项目记忆" aria-label="搜索项目记忆" />
          <Button type="submit" variant="outline" disabled={loading}><SearchIcon data-icon="inline-start" />搜索</Button>
        </form>

        {!readOnly ? <form className="flex flex-col gap-2 rounded-lg border border-amber-500/30 bg-amber-500/5 p-3" onSubmit={createRelation}>
          <div className="flex items-center gap-2 text-sm font-medium"><AlertTriangleIcon className="size-4 text-amber-600" />人工标记记忆关系</div>
          <p className="text-xs text-muted-foreground">只在当前搜索结果中选择；记录关系不会自动改写内容或状态。</p>
          <div className="grid gap-2 sm:grid-cols-[1fr_auto_1fr_auto]">
            <select className="h-9 min-w-0 rounded-md border bg-background px-2 text-sm" aria-label="关系起点记忆" value={relationMemoryId} onChange={(event) => { setRelationMemoryId(event.target.value); if (event.target.value === relatedMemoryId) setRelatedMemoryId("") }}>
              <option value="">选择记忆</option>{items.filter((item) => item.status !== "archived").map((item) => <option key={item.id} value={item.id}>{item.title}</option>)}
            </select>
            <select className="h-9 rounded-md border bg-background px-2 text-sm" aria-label="关系类型" value={relationType} onChange={(event) => setRelationType(event.target.value as ProjectMemoryRelationType)}><option value="conflicts">冲突</option><option value="supersedes">替代</option></select>
            <select className="h-9 min-w-0 rounded-md border bg-background px-2 text-sm" aria-label="关系目标记忆" value={relatedMemoryId} onChange={(event) => setRelatedMemoryId(event.target.value)}>
              <option value="">选择另一条记忆</option>{items.filter((item) => item.status !== "archived" && item.id !== relationMemoryId).map((item) => <option key={item.id} value={item.id}>{item.title}</option>)}
            </select>
            <Button type="submit" size="sm" variant="outline" disabled={relationSaving || !relationMemoryId || !relatedMemoryId}><Link2Icon data-icon="inline-start" />记录</Button>
          </div>
        </form> : null}

        <div className="flex flex-col gap-3">
          {items.map((item) => (
            <div key={item.id} className="flex flex-col gap-2 rounded-lg border p-3">
              <div className="flex flex-wrap items-center gap-2">
                <p className="min-w-0 flex-1 font-medium">{item.title}</p>
                <Badge variant={item.status === "pending" ? "default" : "secondary"}>{statusLabels[item.status]}</Badge>
              </div>
              <p className="whitespace-pre-wrap text-sm text-muted-foreground">{item.content}</p>
              <p className="text-xs text-muted-foreground">来源：{item.sourceKind} · 创建者：{item.createdBy === "agent" ? "AI 候选" : "用户"}</p>
              <div>
                <Button size="sm" variant="ghost" onClick={() => void toggleSources(item.id)} disabled={sourceLoadingId === item.id}>
                  <ChevronDownIcon className={expandedId === item.id ? "rotate-180 transition-transform" : "transition-transform"} data-icon="inline-start" />
                  {sourceLoadingId === item.id ? "读取来源…" : "来源与定位"}
                </Button>
              </div>
              {expandedId === item.id ? <div className="flex flex-col gap-2 rounded-md bg-muted/50 p-3">
                {(sourcesByMemory[item.id] ?? []).map((source) => {
                  const locatorEntries = Object.entries(source.locator)
                  return <div key={source.id} className="text-xs">
                    <p className="font-medium">{source.sourceKind}{source.sourceId ? ` · ${source.sourceId}` : ""}</p>
                    {locatorEntries.length ? <dl className="mt-1 grid grid-cols-[auto_1fr] gap-x-2 gap-y-1 text-muted-foreground">{locatorEntries.map(([key, value]) => <div key={key} className="contents"><dt>{key}</dt><dd className="break-all">{typeof value === "string" ? value : JSON.stringify(value)}</dd></div>)}</dl> : <p className="mt-1 text-muted-foreground">无外部定位信息</p>}
                    {source.quote ? <p className="mt-2 border-l-2 pl-2 text-muted-foreground">{source.quote}</p> : null}
                  </div>
                })}
                {sourceLoadingId !== item.id && !(sourcesByMemory[item.id]?.length) ? <p className="text-xs text-muted-foreground">未找到可用来源记录。</p> : null}
                {(conflictsByMemory[item.id] ?? []).length ? <div className="mt-1 border-t pt-2">
                  <p className="mb-2 text-xs font-medium">冲突与替代关系</p>
                  {(conflictsByMemory[item.id] ?? []).map((conflict) => <div key={`${conflict.memoryId}:${conflict.conflictsWithMemoryId}`} className="flex items-center gap-2 text-xs">
                    <Badge variant="outline">{conflict.relationType === "conflicts" ? "冲突" : conflict.direction === "outgoing" ? "替代了" : "被替代"}</Badge>
                    <span className="min-w-0 flex-1 truncate">{conflict.relatedTitle} · {statusLabels[conflict.relatedStatus]}</span>
                    {!readOnly ? <Button size="icon-sm" variant="ghost" aria-label="解除记忆关系" disabled={relationSaving} onClick={() => void removeRelation(item.id, conflict)}><UnlinkIcon /></Button> : null}
                  </div>)}
                </div> : null}
              </div> : null}
              {!readOnly && item.status !== "archived" ? <div className="flex flex-wrap justify-end gap-2">
                {item.status === "pending" ? <>
                  <Button size="sm" onClick={() => void review(item.id, "confirm")} disabled={reviewingId === item.id}><CheckIcon data-icon="inline-start" />确认</Button>
                  <Button size="sm" variant="outline" onClick={() => void review(item.id, "reject")} disabled={reviewingId === item.id}><XIcon data-icon="inline-start" />拒绝</Button>
                </> : null}
                {item.status === "confirmed" ? <Button size="sm" variant="outline" onClick={() => void review(item.id, "expire")} disabled={reviewingId === item.id}><Clock3Icon data-icon="inline-start" />标记过期</Button> : null}
                <Button size="sm" variant="ghost" onClick={() => void review(item.id, "archive")} disabled={reviewingId === item.id}><ArchiveIcon data-icon="inline-start" />归档</Button>
              </div> : null}
            </div>
          ))}
          {!loading && !items.length ? <p className="rounded-lg border border-dashed p-4 text-center text-sm text-muted-foreground">当前项目暂无匹配记忆。</p> : null}
          {loading ? <p className="text-center text-sm text-muted-foreground">正在更新项目记忆…</p> : null}
        </div>
      </CardContent>
    </Card>
  )
}
