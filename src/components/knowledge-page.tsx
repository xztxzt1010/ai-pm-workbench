import { useEffect, useMemo, useRef, useState, type FormEvent } from "react"
import {
  ArchiveIcon,
  BookOpenIcon,
  CheckCircleIcon,
  DownloadIcon,
  FileInputIcon,
  FileTextIcon,
  GitBranchIcon,
  LightbulbIcon,
  LinkIcon,
  PencilIcon,
  PlusIcon,
  RefreshCwIcon,
  SearchIcon,
  ShieldCheckIcon,
  Undo2Icon,
  XCircleIcon,
} from "lucide-react"
import { toast } from "sonner"

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardAction, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog"
import { Empty, EmptyContent, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty"
import { Field, FieldDescription, FieldError, FieldGroup, FieldLabel } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { ScrollArea } from "@/components/ui/scroll-area"
import { Select, SelectContent, SelectGroup, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Separator } from "@/components/ui/separator"
import { Skeleton } from "@/components/ui/skeleton"
import { Textarea } from "@/components/ui/textarea"
import type { KnowledgeItem, KnowledgeRelation, KnowledgeSource } from "@/domain/knowledge-contract"
import type { Meeting, Project } from "@/domain/models"
import {
  addKnowledgeSource,
  createKnowledgeItem,
  createKnowledgeRelation,
  exportKnowledgeItemMarkdown,
  exportKnowledgeScopeMarkdown,
  importKnowledgeItemMarkdown,
  listKnowledgeAdapterCandidates,
  listKnowledgeItems,
  listKnowledgeRelations,
  listKnowledgeSources,
  reviewKnowledgeItem,
  reviewKnowledgeRelation,
  sha256Text,
  updateKnowledgeItem,
  type KnowledgeAdapterCandidate,
} from "@/services/knowledge-service"

const itemTypeOptions = [
  { value: "meeting_record", label: "会议记录" },
  { value: "technical_discussion", label: "技术讨论" },
  { value: "product_idea", label: "产品想法" },
  { value: "ai_learning", label: "AI 学习" },
  { value: "project_decision", label: "项目决策" },
] as const

const statusOptions = [
  { value: "all", label: "全部状态" },
  { value: "draft", label: "草稿" },
  { value: "confirmed", label: "已确认" },
  { value: "archived", label: "已归档" },
]

const typeFilterOptions = [{ value: "all", label: "全部类型" }, ...itemTypeOptions]
const ownedTypes = new Set<KnowledgeItem["itemType"]>(["technical_discussion", "product_idea", "ai_learning"])

const sourceKindOptions = [
  { value: "manual", label: "人工材料" },
  { value: "markdown", label: "Markdown 文档" },
  { value: "external_url", label: "HTTPS 网页" },
] as const

const relationTypeOptions = [
  { value: "derived_from", label: "派生自" },
  { value: "supports", label: "支持" },
  { value: "contradicts", label: "矛盾" },
  { value: "relates_to", label: "相关" },
  { value: "supersedes", label: "取代" },
] as const

const relationTypeLabels = Object.fromEntries(relationTypeOptions.map((item) => [item.value, item.label])) as Record<KnowledgeRelation["relationType"], string>
const relationStatusLabels: Record<KnowledgeRelation["status"], string> = { draft: "待确认", confirmed: "已确认", rejected: "已拒绝" }

const typeLabels = Object.fromEntries(itemTypeOptions.map((item) => [item.value, item.label])) as Record<KnowledgeItem["itemType"], string>
const statusLabels: Record<KnowledgeItem["status"], string> = { draft: "草稿", confirmed: "已确认", archived: "已归档" }

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : "知识操作失败，请重试"
}

function parseScope(value: string): { domain: "personal" | "project"; projectId?: string } {
  return value === "personal" ? { domain: "personal" } : { domain: "project", projectId: value.slice("project:".length) }
}

function safeExternalSourceUrl(source: KnowledgeSource) {
  if (source.sourceKind !== "external_url") return undefined
  try {
    const url = new URL(source.sourceRef)
    return url.protocol === "https:" && !url.username && !url.password ? url.toString() : undefined
  } catch {
    return undefined
  }
}

function downloadMarkdown(title: string, markdown: string) {
  const safeName = title.replace(/[<>:"/\\|?*\u0000-\u001f]/g, "_").trim().slice(0, 80) || "knowledge"
  const url = URL.createObjectURL(new Blob([markdown], { type: "text/markdown;charset=utf-8" }))
  const anchor = document.createElement("a")
  anchor.href = url
  anchor.download = `${safeName}.md`
  anchor.click()
  URL.revokeObjectURL(url)
}

function KnowledgeImportDialog({ onImport }: { onImport: (markdown: string) => Promise<void> }) {
  const [open, setOpen] = useState(false)
  const [markdown, setMarkdown] = useState("")
  const [fileName, setFileName] = useState<string>()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string>()
  const fileInput = useRef<HTMLInputElement>(null)

  async function chooseFile(file?: File) {
    if (!file) return
    setError(undefined)
    if (!file.name.toLocaleLowerCase().endsWith(".md")) {
      setError("只支持 .md Markdown 文件；也可以直接粘贴 Markdown 文本")
      return
    }
    if (file.size > 1_000_000) {
      setError("知识 Markdown 文件不能超过 1 MB")
      return
    }
    setMarkdown(await file.text())
    setFileName(file.name)
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setBusy(true)
    setError(undefined)
    try {
      await onImport(markdown)
      setMarkdown("")
      setFileName(undefined)
      setOpen(false)
    } catch (submitError) {
      setError(errorMessage(submitError))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger render={<Button variant="outline" />}><FileInputIcon data-icon="inline-start" />导入 Markdown</DialogTrigger>
      <DialogContent className="sm:max-w-2xl">
        <form onSubmit={(event) => { void submit(event) }}>
          <DialogHeader><DialogTitle>导入知识 Markdown</DialogTitle><DialogDescription>选择单条 APM Knowledge v1 的 .md 文件，或直接粘贴其完整文本。重复包不会重复创建，ID 冲突不会覆盖。</DialogDescription></DialogHeader>
          <FieldGroup className="py-5">
            <Field>
              <FieldLabel>Markdown 文件</FieldLabel>
              <input ref={fileInput} className="hidden" type="file" accept=".md,text/markdown" onChange={(event) => { void chooseFile(event.target.files?.[0]) }} />
              <Button type="button" variant="outline" onClick={() => fileInput.current?.click()}><FileInputIcon data-icon="inline-start" />选择 .md 文件</Button>
              <FieldDescription>{fileName ?? "单文件上限 1 MB；文件内容会显示在下方，确认后才导入。"}</FieldDescription>
            </Field>
            <Field>
              <FieldLabel htmlFor="knowledge-import-markdown">Markdown 文本</FieldLabel>
              <Textarea id="knowledge-import-markdown" value={markdown} onChange={(event) => setMarkdown(event.target.value)} rows={14} maxLength={1_000_000} required />
            </Field>
            {error ? <Field data-invalid><FieldError>{error}</FieldError></Field> : null}
          </FieldGroup>
          <DialogFooter><Button type="button" variant="outline" onClick={() => setOpen(false)}>取消</Button><Button type="submit" disabled={busy || !markdown.trim()}>{busy ? "导入中…" : "确认导入"}</Button></DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

function KnowledgeSourceDialog({
  item,
  desktopRuntime,
  onCreated,
}: {
  item: KnowledgeItem
  desktopRuntime: boolean
  onCreated: (source: KnowledgeSource) => void
}) {
  const [open, setOpen] = useState(false)
  const [sourceKind, setSourceKind] = useState<KnowledgeSource["sourceKind"]>("manual")
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string>()

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const form = new FormData(event.currentTarget)
    const sourceRef = String(form.get("sourceRef"))
    const sourceSnapshot = String(form.get("sourceSnapshot"))
    const locatorNote = String(form.get("locatorNote")).trim()
    setBusy(true)
    setError(undefined)
    try {
      const source = await addKnowledgeSource(desktopRuntime, {
        id: `knowledge-source:${crypto.randomUUID()}`,
        itemId: item.id,
        domain: item.domain as "project" | "personal",
        projectId: item.projectId,
        sourceKind,
        sourceRef,
        sourceVersion: String(form.get("sourceVersion")),
        contentHash: await sha256Text(sourceSnapshot),
        title: String(form.get("title")),
        locator: locatorNote ? { note: locatorNote } : {},
        capturedAt: new Date().toISOString(),
      })
      onCreated(source)
      setOpen(false)
      toast.success("知识来源已添加")
    } catch (submitError) {
      setError(errorMessage(submitError))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger render={<Button variant="outline" size="sm" />}><PlusIcon data-icon="inline-start" />添加来源</DialogTrigger>
      <DialogContent className="sm:max-w-2xl">
        <form onSubmit={(event) => { void submit(event) }}>
          <DialogHeader><DialogTitle>添加知识来源</DialogTitle><DialogDescription>保存来源标识、版本、定位和内容 SHA-256；验证文本只用于计算哈希，不会复制进知识正文。</DialogDescription></DialogHeader>
          <FieldGroup className="py-5">
            <Field><FieldLabel>来源类型</FieldLabel><Select items={sourceKindOptions} value={sourceKind} onValueChange={(value) => setSourceKind((value ?? "manual") as KnowledgeSource["sourceKind"])}><SelectTrigger className="w-full" aria-label="来源类型"><SelectValue /></SelectTrigger><SelectContent><SelectGroup>{sourceKindOptions.map((option) => <SelectItem key={option.value} value={option.value}>{option.label}</SelectItem>)}</SelectGroup></SelectContent></Select></Field>
            <Field><FieldLabel htmlFor="knowledge-source-title">来源标题</FieldLabel><Input id="knowledge-source-title" name="title" maxLength={200} required /></Field>
            <Field><FieldLabel htmlFor="knowledge-source-ref">来源引用</FieldLabel><Input id="knowledge-source-ref" name="sourceRef" type={sourceKind === "external_url" ? "url" : "text"} maxLength={1_000} placeholder={sourceKind === "external_url" ? "https://example.com/document" : "文件名、材料编号或稳定引用"} required /><FieldDescription>网页来源只接受不含账号密码的 HTTPS 地址。</FieldDescription></Field>
            <Field><FieldLabel htmlFor="knowledge-source-version">来源版本</FieldLabel><Input id="knowledge-source-version" name="sourceVersion" maxLength={200} placeholder="例如 2026-07-18、v2 或提交哈希" required /></Field>
            <Field><FieldLabel htmlFor="knowledge-source-locator">精确定位（可选）</FieldLabel><Input id="knowledge-source-locator" name="locatorNote" maxLength={500} placeholder="例如：第 3 节 / 第 12–18 行" /></Field>
            <Field><FieldLabel htmlFor="knowledge-source-snapshot">用于校验的来源文本</FieldLabel><Textarea id="knowledge-source-snapshot" name="sourceSnapshot" rows={8} maxLength={200_000} required /><FieldDescription>系统只保存这段文本的 SHA-256，不保存文本本身；请确保它与所标版本一致。</FieldDescription></Field>
            {error ? <Field data-invalid><FieldError>{error}</FieldError></Field> : null}
          </FieldGroup>
          <DialogFooter><Button type="button" variant="outline" onClick={() => setOpen(false)}>取消</Button><Button type="submit" disabled={busy}>{busy ? "保存中…" : "保存来源"}</Button></DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

function KnowledgeRelationDialog({
  item,
  desktopRuntime,
  onCreated,
}: {
  item: KnowledgeItem
  desktopRuntime: boolean
  onCreated: (relation: KnowledgeRelation) => void
}) {
  const [open, setOpen] = useState(false)
  const [relationType, setRelationType] = useState<KnowledgeRelation["relationType"]>("relates_to")
  const [targetId, setTargetId] = useState("")
  const [candidates, setCandidates] = useState<KnowledgeItem[]>([])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string>()

  useEffect(() => {
    if (!open) return
    setError(undefined)
    void listKnowledgeItems(desktopRuntime, {
      domain: item.domain as "project" | "personal",
      projectId: item.projectId,
      limit: 100,
    }).then((loaded) => {
      setCandidates(loaded.filter((candidate) => candidate.id !== item.id && candidate.status !== "archived"))
      setTargetId("")
    }).catch((loadError) => setError(errorMessage(loadError)))
  }, [desktopRuntime, item, open])

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const form = new FormData(event.currentTarget)
    const evidenceNote = String(form.get("evidenceNote")).trim()
    setBusy(true)
    setError(undefined)
    try {
      const relation = await createKnowledgeRelation(desktopRuntime, {
        id: `knowledge-relation:${crypto.randomUUID()}`,
        fromItemId: item.id,
        toItemId: targetId,
        domain: item.domain as "project" | "personal",
        projectId: item.projectId,
        relationType,
        evidence: evidenceNote ? [{ note: evidenceNote }] : [],
        createdBy: "user",
      })
      onCreated(relation)
      setOpen(false)
      toast.success("候选关系已创建，等待人工确认")
    } catch (submitError) {
      setError(errorMessage(submitError))
    } finally {
      setBusy(false)
    }
  }

  const candidateOptions = candidates.map((candidate) => ({ value: candidate.id, label: `${candidate.title} · ${typeLabels[candidate.itemType]}` }))

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger render={<Button variant="outline" size="sm" />}><GitBranchIcon data-icon="inline-start" />建立关系</DialogTrigger>
      <DialogContent className="sm:max-w-xl">
        <form onSubmit={(event) => { void submit(event) }}>
          <DialogHeader><DialogTitle>建立知识关系</DialogTitle><DialogDescription>只能选择当前知识域中未归档的记录。新关系先作为候选，之后需要人工确认或拒绝。</DialogDescription></DialogHeader>
          <FieldGroup className="py-5">
            <Field data-invalid={!targetId && candidates.length > 0}><FieldLabel>目标记录</FieldLabel><Select items={candidateOptions} value={targetId || null} onValueChange={(value) => setTargetId(value ?? "")}><SelectTrigger className="w-full" aria-label="目标记录" aria-invalid={!targetId && candidates.length > 0}><SelectValue /></SelectTrigger><SelectContent><SelectGroup>{candidateOptions.map((option) => <SelectItem key={option.value} value={option.value}>{option.label}</SelectItem>)}</SelectGroup></SelectContent></Select><FieldDescription>{candidates.length ? "关系方向为当前记录指向所选记录。" : "当前知识域没有其他可关联记录，请先新建记录。"}</FieldDescription></Field>
            <Field><FieldLabel>关系类型</FieldLabel><Select items={relationTypeOptions} value={relationType} onValueChange={(value) => setRelationType((value ?? "relates_to") as KnowledgeRelation["relationType"])}><SelectTrigger className="w-full" aria-label="关系类型"><SelectValue /></SelectTrigger><SelectContent><SelectGroup>{relationTypeOptions.map((option) => <SelectItem key={option.value} value={option.value}>{option.label}</SelectItem>)}</SelectGroup></SelectContent></Select></Field>
            <Field><FieldLabel htmlFor="knowledge-relation-evidence">关系依据（可选）</FieldLabel><Textarea id="knowledge-relation-evidence" name="evidenceNote" rows={5} maxLength={2_000} placeholder="说明为什么两条记录存在该关系；不要填写密钥或敏感凭据。" /></Field>
            {error ? <Field data-invalid><FieldError>{error}</FieldError></Field> : null}
          </FieldGroup>
          <DialogFooter><Button type="button" variant="outline" onClick={() => setOpen(false)}>取消</Button><Button type="submit" disabled={busy || !targetId}>{busy ? "创建中…" : "创建候选关系"}</Button></DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

function KnowledgeCreateDialog({
  projects,
  meetings,
  desktopRuntime,
  defaultScope,
  onCreated,
}: {
  projects: Project[]
  meetings: Meeting[]
  desktopRuntime: boolean
  defaultScope: string
  onCreated: (item: KnowledgeItem) => void
}) {
  const [open, setOpen] = useState(false)
  const [itemType, setItemType] = useState<KnowledgeItem["itemType"]>("product_idea")
  const [scopeValue, setScopeValue] = useState(defaultScope)
  const [content, setContent] = useState("")
  const [candidateId, setCandidateId] = useState("")
  const [candidates, setCandidates] = useState<KnowledgeAdapterCandidate[]>([])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string>()
  const scopeOptions = useMemo(() => [
    { value: "personal", label: "个人知识" },
    ...projects.map((project) => ({ value: `project:${project.id}`, label: `项目 · ${project.name}` })),
  ], [projects])
  const adapter = itemType === "meeting_record" ? "meeting" : itemType === "project_decision" ? "product_decision" : undefined

  useEffect(() => {
    if (!open) return
    setScopeValue(defaultScope)
  }, [defaultScope, open])

  useEffect(() => {
    if (!open || !adapter) {
      setCandidates([])
      setCandidateId("")
      return
    }
    const selectedScope = parseScope(scopeValue)
    if (!desktopRuntime && adapter === "meeting") {
      setCandidates(meetings
        .filter((meeting) => selectedScope.domain === "personal" ? !meeting.projectId : meeting.projectId === selectedScope.projectId)
        .map((meeting) => ({
          targetKind: "meeting",
          targetId: meeting.id,
          targetVersion: meeting.updatedAt,
          projectId: meeting.projectId,
          title: meeting.title,
        })))
      setCandidateId("")
      return
    }
    void listKnowledgeAdapterCandidates(desktopRuntime, { ...selectedScope, targetKind: adapter })
      .then((items) => {
        setCandidates(items)
        setCandidateId("")
      })
      .catch((loadError) => setError(errorMessage(loadError)))
  }, [adapter, desktopRuntime, meetings, open, scopeValue])

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const form = new FormData(event.currentTarget)
    const selectedScope = parseScope(scopeValue)
    const candidate = candidates.find((item) => item.targetId === candidateId)
    setBusy(true)
    setError(undefined)
    try {
      const item = await createKnowledgeItem(desktopRuntime, {
        id: `knowledge:${crypto.randomUUID()}`,
        itemType,
        ...selectedScope,
        title: String(form.get("title")),
        contentMarkdown: ownedTypes.has(itemType) ? content : "",
        targetKind: candidate?.targetKind,
        targetId: candidate?.targetId,
        targetVersion: candidate?.targetVersion,
        createdBy: "user",
      })
      onCreated(item)
      setContent("")
      setCandidateId("")
      setOpen(false)
      toast.success("知识草稿已创建")
    } catch (submitError) {
      setError(errorMessage(submitError))
    } finally {
      setBusy(false)
    }
  }

  const candidateOptions = candidates.map((candidate) => ({ value: candidate.targetId, label: candidate.title }))

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger render={<Button />}><PlusIcon data-icon="inline-start" />新建记录</DialogTrigger>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
        <form onSubmit={(event) => { void submit(event) }}>
          <DialogHeader>
            <DialogTitle>新建知识记录</DialogTitle>
            <DialogDescription>五类记录共享知识身份；会议和决策只注册正式对象，不复制原文。</DialogDescription>
          </DialogHeader>
          <FieldGroup className="py-5">
            <Field>
              <FieldLabel>记录类型</FieldLabel>
              <Select items={itemTypeOptions} value={itemType} onValueChange={(value) => setItemType((value ?? "product_idea") as KnowledgeItem["itemType"])}>
                <SelectTrigger className="w-full" aria-label="记录类型"><SelectValue /></SelectTrigger>
                <SelectContent><SelectGroup>{itemTypeOptions.map((option) => <SelectItem key={option.value} value={option.value}>{option.label}</SelectItem>)}</SelectGroup></SelectContent>
              </Select>
            </Field>
            <Field>
              <FieldLabel>知识域</FieldLabel>
              <Select items={scopeOptions} value={scopeValue} onValueChange={(value) => setScopeValue(value ?? "personal")}>
                <SelectTrigger className="w-full" aria-label="知识域"><SelectValue /></SelectTrigger>
                <SelectContent><SelectGroup>{scopeOptions.map((option) => <SelectItem key={option.value} value={option.value}>{option.label}</SelectItem>)}</SelectGroup></SelectContent>
              </Select>
            </Field>
            {adapter ? (
              <Field data-invalid={!candidateId && candidates.length > 0}>
                <FieldLabel>正式对象</FieldLabel>
                <Select items={candidateOptions} value={candidateId || null} onValueChange={(value) => setCandidateId(value ?? "")}>
                  <SelectTrigger className="w-full" aria-label="正式对象" aria-invalid={!candidateId && candidates.length > 0}><SelectValue /></SelectTrigger>
                  <SelectContent><SelectGroup>{candidateOptions.map((option) => <SelectItem key={option.value} value={option.value}>{option.label}</SelectItem>)}</SelectGroup></SelectContent>
                </Select>
                <FieldDescription>{candidates.length ? "选择尚未注册的正式对象。" : "当前知识域没有可注册对象，请先在会议或项目决策中创建。"}</FieldDescription>
              </Field>
            ) : null}
            <Field>
              <FieldLabel htmlFor="knowledge-title">标题</FieldLabel>
              <Input id="knowledge-title" name="title" maxLength={200} required autoFocus />
            </Field>
            {ownedTypes.has(itemType) ? (
              <Field>
                <FieldLabel htmlFor="knowledge-content">Markdown 正文</FieldLabel>
                <Textarea id="knowledge-content" value={content} onChange={(event) => setContent(event.target.value)} rows={12} maxLength={500_000} required />
                <FieldDescription>支持普通 Markdown；保存后仍是草稿，需要人工确认。</FieldDescription>
              </Field>
            ) : null}
            {error ? <Field data-invalid><FieldError>{error}</FieldError></Field> : null}
          </FieldGroup>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setOpen(false)}>取消</Button>
            <Button type="submit" disabled={busy || Boolean(adapter && !candidateId)}>{busy ? "保存中…" : "保存草稿"}</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

function KnowledgeEditDialog({ item, desktopRuntime, onUpdated }: { item: KnowledgeItem; desktopRuntime: boolean; onUpdated: (item: KnowledgeItem) => void }) {
  const [open, setOpen] = useState(false)
  const [title, setTitle] = useState(item.title)
  const [content, setContent] = useState(item.contentMarkdown)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string>()

  useEffect(() => {
    if (open) {
      setTitle(item.title)
      setContent(item.contentMarkdown)
      setError(undefined)
    }
  }, [item, open])

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setBusy(true)
    setError(undefined)
    try {
      const updated = await updateKnowledgeItem(desktopRuntime, {
        itemId: item.id,
        domain: item.domain as "project" | "personal",
        projectId: item.projectId,
        expectedContentVersion: item.contentVersion,
        title,
        contentMarkdown: content,
      })
      onUpdated(updated)
      setOpen(false)
      toast.success("知识已更新并回到草稿状态")
    } catch (submitError) {
      setError(errorMessage(submitError))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger render={<Button variant="outline" size="sm" />}><PencilIcon data-icon="inline-start" />编辑</DialogTrigger>
      <DialogContent className="sm:max-w-2xl">
        <form onSubmit={(event) => { void submit(event) }}>
          <DialogHeader><DialogTitle>编辑知识记录</DialogTitle><DialogDescription>使用内容版本 {item.contentVersion} 进行并发校验；已确认内容修改后会回到草稿。</DialogDescription></DialogHeader>
          <FieldGroup className="py-5">
            <Field><FieldLabel htmlFor="edit-knowledge-title">标题</FieldLabel><Input id="edit-knowledge-title" value={title} onChange={(event) => setTitle(event.target.value)} maxLength={200} required /></Field>
            <Field><FieldLabel htmlFor="edit-knowledge-content">Markdown 正文</FieldLabel><Textarea id="edit-knowledge-content" value={content} onChange={(event) => setContent(event.target.value)} rows={14} maxLength={500_000} required /></Field>
            {error ? <Field data-invalid><FieldError>{error}</FieldError></Field> : null}
          </FieldGroup>
          <DialogFooter><Button type="button" variant="outline" onClick={() => setOpen(false)}>取消</Button><Button type="submit" disabled={busy}>{busy ? "保存中…" : "保存修改"}</Button></DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

export function KnowledgePage({ projects, meetings, desktopRuntime }: { projects: Project[]; meetings: Meeting[]; desktopRuntime: boolean }) {
  const scopeOptions = useMemo(() => [
    { value: "personal", label: "个人知识" },
    ...projects.map((project) => ({ value: `project:${project.id}`, label: `项目 · ${project.name}` })),
  ], [projects])
  const [scopeValue, setScopeValue] = useState("personal")
  const [statusFilter, setStatusFilter] = useState("all")
  const [typeFilter, setTypeFilter] = useState("all")
  const [query, setQuery] = useState("")
  const [items, setItems] = useState<KnowledgeItem[]>([])
  const [selectedId, setSelectedId] = useState<string>()
  const [sources, setSources] = useState<KnowledgeSource[]>([])
  const [relations, setRelations] = useState<KnowledgeRelation[]>([])
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const selected = items.find((item) => item.id === selectedId)
  const selectedScope = parseScope(scopeValue)

  const visibleItems = useMemo(() => {
    const normalized = query.trim().toLocaleLowerCase()
    if (!normalized) return items
    return items.filter((item) => `${item.title}\n${item.contentMarkdown}`.toLocaleLowerCase().includes(normalized))
  }, [items, query])

  async function loadItems(preferredId?: string) {
    setLoading(true)
    try {
      const loaded = await listKnowledgeItems(desktopRuntime, {
        ...selectedScope,
        status: statusFilter === "all" ? undefined : statusFilter as KnowledgeItem["status"],
        itemType: typeFilter === "all" ? undefined : typeFilter as KnowledgeItem["itemType"],
        limit: 100,
      })
      setItems(loaded)
      setSelectedId((current) => {
        const desired = preferredId ?? current
        return desired && loaded.some((item) => item.id === desired) ? desired : loaded[0]?.id
      })
    } catch (loadError) {
      toast.error(errorMessage(loadError))
      setItems([])
      setSelectedId(undefined)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    void loadItems()
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [desktopRuntime, scopeValue, statusFilter, typeFilter])

  useEffect(() => {
    if (!selected) {
      setSources([])
      setRelations([])
      return
    }
    const scope = { domain: selected.domain as "project" | "personal", projectId: selected.projectId }
    void Promise.all([
      listKnowledgeSources(desktopRuntime, { itemId: selected.id, ...scope }),
      listKnowledgeRelations(desktopRuntime, { itemId: selected.id, ...scope }),
    ]).then(([nextSources, nextRelations]) => {
      setSources(nextSources)
      setRelations(nextRelations)
    }).catch((loadError) => toast.error(errorMessage(loadError)))
  }, [desktopRuntime, selected])

  async function applyAction(action: "confirm" | "archive" | "restore") {
    if (!selected) return
    setBusy(true)
    try {
      const updated = await reviewKnowledgeItem(desktopRuntime, {
        itemId: selected.id,
        domain: selected.domain as "project" | "personal",
        projectId: selected.projectId,
        action,
      })
      await loadItems(updated.id)
      toast.success(action === "confirm" ? "知识已确认" : action === "archive" ? "知识已归档" : "知识已恢复")
    } catch (actionError) {
      toast.error(errorMessage(actionError))
    } finally {
      setBusy(false)
    }
  }

  async function applyRelationAction(relation: KnowledgeRelation, action: "confirm" | "reject") {
    if (!selected) return
    setBusy(true)
    try {
      await reviewKnowledgeRelation(desktopRuntime, {
        relationId: relation.id,
        domain: selected.domain as "project" | "personal",
        projectId: selected.projectId,
        action,
      })
      setRelations(await listKnowledgeRelations(desktopRuntime, {
        itemId: selected.id,
        domain: selected.domain as "project" | "personal",
        projectId: selected.projectId,
      }))
      toast.success(action === "confirm" ? "知识关系已确认" : "知识关系已拒绝")
    } catch (reviewError) {
      toast.error(errorMessage(reviewError))
    } finally {
      setBusy(false)
    }
  }

  async function exportItem(item: KnowledgeItem) {
    try {
      downloadMarkdown(item.title, await exportKnowledgeItemMarkdown(desktopRuntime, item))
      toast.success("Markdown 已导出")
    } catch (exportError) {
      toast.error(errorMessage(exportError))
    }
  }

  async function importMarkdown(markdown: string) {
    const result = await importKnowledgeItemMarkdown(desktopRuntime, markdown)
    if (result.status === "conflict") throw new Error("导入冲突：相同知识 ID 已存在且内容不同，未覆盖现有记录")
    await loadItems(result.item?.id)
    toast.success(result.status === "created" ? "知识 Markdown 已作为草稿导入" : "相同知识包已存在，没有重复导入")
  }

  async function exportScope() {
    try {
      const scopeName = selectedScope.domain === "personal" ? "个人知识" : projects.find((project) => project.id === selectedScope.projectId)?.name ?? "项目知识"
      downloadMarkdown(`${scopeName}-批量导出`, await exportKnowledgeScopeMarkdown(desktopRuntime, selectedScope))
      toast.success("当前知识域已批量导出")
    } catch (exportError) {
      toast.error(errorMessage(exportError))
    }
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">工作记录与知识库</h1>
          <p className="mt-1 text-sm text-muted-foreground">统一管理会议、技术讨论、产品想法、AI 学习和项目决策；AI 输出不会自动成为正式知识。</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <KnowledgeImportDialog onImport={importMarkdown} />
          <Button variant="outline" onClick={() => { void exportScope() }}><DownloadIcon data-icon="inline-start" />导出当前知识域</Button>
          <KnowledgeCreateDialog projects={projects} meetings={meetings} desktopRuntime={desktopRuntime} defaultScope={scopeValue} onCreated={(item) => { void loadItems(item.id) }} />
        </div>
      </div>

      {!desktopRuntime ? <Alert><BookOpenIcon /><AlertTitle>浏览器本地知识空间</AlertTitle><AlertDescription>记录保存在当前浏览器站点存储中，不会自动同步到桌面 SQLite。请定期导出 Markdown；清理浏览器数据会删除这里的记录。</AlertDescription></Alert> : null}

      <Card>
        <CardHeader><CardTitle>筛选知识域</CardTitle><CardDescription>项目与个人知识默认隔离；切换项目不会混入其他项目记录。</CardDescription></CardHeader>
        <CardContent className="grid gap-3 md:grid-cols-[minmax(220px,1fr)_minmax(160px,0.6fr)_minmax(160px,0.6fr)_minmax(220px,1fr)]">
          <Field><FieldLabel>知识域</FieldLabel><Select items={scopeOptions} value={scopeValue} onValueChange={(value) => setScopeValue(value ?? "personal")}><SelectTrigger className="w-full" aria-label="筛选知识域"><SelectValue /></SelectTrigger><SelectContent><SelectGroup>{scopeOptions.map((option) => <SelectItem key={option.value} value={option.value}>{option.label}</SelectItem>)}</SelectGroup></SelectContent></Select></Field>
          <Field><FieldLabel>类型</FieldLabel><Select items={typeFilterOptions} value={typeFilter} onValueChange={(value) => setTypeFilter(value ?? "all")}><SelectTrigger className="w-full" aria-label="筛选记录类型"><SelectValue /></SelectTrigger><SelectContent><SelectGroup>{typeFilterOptions.map((option) => <SelectItem key={option.value} value={option.value}>{option.label}</SelectItem>)}</SelectGroup></SelectContent></Select></Field>
          <Field><FieldLabel>状态</FieldLabel><Select items={statusOptions} value={statusFilter} onValueChange={(value) => setStatusFilter(value ?? "all")}><SelectTrigger className="w-full" aria-label="筛选记录状态"><SelectValue /></SelectTrigger><SelectContent><SelectGroup>{statusOptions.map((option) => <SelectItem key={option.value} value={option.value}>{option.label}</SelectItem>)}</SelectGroup></SelectContent></Select></Field>
          <Field><FieldLabel htmlFor="knowledge-search">当前结果搜索</FieldLabel><div className="relative"><SearchIcon className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" /><Input id="knowledge-search" className="pl-8" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="搜索标题或正文" /></div></Field>
        </CardContent>
      </Card>

      <div className="grid min-h-[520px] gap-4 xl:grid-cols-[minmax(300px,0.8fr)_minmax(0,1.6fr)]">
        <Card>
          <CardHeader><CardTitle>记录</CardTitle><CardDescription>{visibleItems.length} 条当前结果</CardDescription></CardHeader>
          <CardContent>
            {loading ? <div className="flex flex-col gap-3"><Skeleton className="h-20 w-full" /><Skeleton className="h-20 w-full" /><Skeleton className="h-20 w-full" /></div> : visibleItems.length ? (
              <ScrollArea className="h-[520px] pr-3">
                <div className="flex flex-col gap-2">
                  {visibleItems.map((item) => (
                    <Button key={item.id} variant={selectedId === item.id ? "secondary" : "ghost"} className="h-auto w-full justify-start px-3 py-3 text-left" onClick={() => setSelectedId(item.id)}>
                      <span className="flex min-w-0 flex-1 flex-col items-start gap-1">
                        <span className="w-full truncate font-medium">{item.title}</span>
                        <span className="flex flex-wrap gap-1"><Badge variant="outline">{typeLabels[item.itemType]}</Badge><Badge variant="secondary">{statusLabels[item.status]}</Badge><span className="text-xs text-muted-foreground">v{item.contentVersion}</span></span>
                      </span>
                    </Button>
                  ))}
                </div>
              </ScrollArea>
            ) : (
              <Empty><EmptyHeader><EmptyMedia variant="icon"><BookOpenIcon /></EmptyMedia><EmptyTitle>暂无匹配记录</EmptyTitle><EmptyDescription>切换筛选，或新建第一条工作记录。</EmptyDescription></EmptyHeader><EmptyContent><KnowledgeCreateDialog projects={projects} meetings={meetings} desktopRuntime={desktopRuntime} defaultScope={scopeValue} onCreated={(item) => { void loadItems(item.id) }} /></EmptyContent></Empty>
            )}
          </CardContent>
        </Card>

        {selected ? (
          <Card>
            <CardHeader>
              <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
                <div className="min-w-0"><div className="mb-2 flex flex-wrap gap-2"><Badge variant="outline">{typeLabels[selected.itemType]}</Badge><Badge variant="secondary">{statusLabels[selected.status]}</Badge><Badge variant="outline">{selected.domain === "personal" ? "个人域" : "项目域"}</Badge></div><CardTitle>{selected.title}</CardTitle><CardDescription>内容版本 {selected.contentVersion} · 更新于 {new Date(selected.updatedAt).toLocaleString("zh-CN")}</CardDescription></div>
                <div className="flex flex-wrap gap-2">
                  {ownedTypes.has(selected.itemType) && selected.status !== "archived" ? <KnowledgeEditDialog item={selected} desktopRuntime={desktopRuntime} onUpdated={(item) => { void loadItems(item.id) }} /> : null}
                  <Button variant="outline" size="sm" onClick={() => { void exportItem(selected) }}><DownloadIcon data-icon="inline-start" />导出</Button>
                  {selected.status === "draft" ? <Button size="sm" disabled={busy} onClick={() => { void applyAction("confirm") }}><CheckCircleIcon data-icon="inline-start" />确认</Button> : null}
                  {selected.status !== "archived" ? <Button variant="outline" size="sm" disabled={busy} onClick={() => { void applyAction("archive") }}><ArchiveIcon data-icon="inline-start" />归档</Button> : <Button variant="outline" size="sm" disabled={busy} onClick={() => { void applyAction("restore") }}><Undo2Icon data-icon="inline-start" />恢复</Button>}
                </div>
              </div>
            </CardHeader>
            <CardContent className="flex flex-col gap-5">
              {selected.targetKind ? <Alert><FileTextIcon /><AlertTitle>正式对象适配</AlertTitle><AlertDescription>引用 {selected.targetKind} · {selected.targetId} · 版本 {selected.targetVersion}。正文仍由原业务对象持有。</AlertDescription></Alert> : <div className="min-h-48 whitespace-pre-wrap rounded-lg border bg-muted/20 p-4 text-sm leading-6">{selected.contentMarkdown}</div>}
              <Separator />
              <div className="grid gap-4 lg:grid-cols-2">
                <Card>
                  <CardHeader>
                    <CardTitle className="flex items-center gap-2"><FileTextIcon />来源</CardTitle>
                    <CardDescription>{sources.length ? `${sources.length} 个版本化来源` : "人工创建，没有外部来源"}</CardDescription>
                    {selected.status !== "archived" ? <CardAction><KnowledgeSourceDialog item={selected} desktopRuntime={desktopRuntime} onCreated={(source) => setSources((current) => [...current, source])} /></CardAction> : null}
                  </CardHeader>
                  <CardContent>{sources.length ? <div className="flex flex-col gap-3">{sources.map((source) => {
                    const externalUrl = safeExternalSourceUrl(source)
                    return <div key={source.id} className="rounded-lg border p-3"><div className="flex items-start justify-between gap-3"><div className="min-w-0"><p className="font-medium">{source.title}</p><p className="mt-1 break-all text-xs text-muted-foreground">{source.sourceKind} · {source.sourceRef} · 版本 {source.sourceVersion}</p></div>{externalUrl ? <Button variant="ghost" size="sm" render={<a href={externalUrl} target="_blank" rel="noreferrer" />} nativeButton={false}>打开网页</Button> : null}</div><p className="mt-2 break-all text-xs text-muted-foreground">SHA-256 · {source.contentHash}</p>{typeof source.locator.note === "string" ? <p className="mt-1 text-xs text-muted-foreground">定位 · {source.locator.note}</p> : null}</div>
                  })}</div> : <p className="text-sm text-muted-foreground">这条记录由用户直接创建。</p>}</CardContent>
                </Card>
                <Card>
                  <CardHeader>
                    <CardTitle className="flex items-center gap-2"><LinkIcon />关系</CardTitle>
                    <CardDescription>{relations.length ? `${relations.length} 条候选或正式关系` : "尚未建立关系"}</CardDescription>
                    {selected.status !== "archived" ? <CardAction><KnowledgeRelationDialog item={selected} desktopRuntime={desktopRuntime} onCreated={(relation) => setRelations((current) => [...current, relation])} /></CardAction> : null}
                  </CardHeader>
                  <CardContent>{relations.length ? <div className="flex flex-col gap-3">{relations.map((relation) => <div key={relation.id} className="rounded-lg border p-3"><div className="flex flex-wrap items-center gap-2"><Badge variant="outline">{relationTypeLabels[relation.relationType]}</Badge><Badge variant="secondary">{relationStatusLabels[relation.status]}</Badge></div><p className="mt-2 break-all text-xs text-muted-foreground">{relation.fromItemId} → {relation.toItemId}</p>{relation.evidence.length ? <p className="mt-2 text-xs text-muted-foreground">依据 · {relation.evidence.map((item) => typeof item.note === "string" ? item.note : JSON.stringify(item)).join("；")}</p> : null}{relation.status === "draft" ? <div className="mt-3 flex flex-wrap gap-2"><Button size="sm" disabled={busy} onClick={() => { void applyRelationAction(relation, "confirm") }}><ShieldCheckIcon data-icon="inline-start" />确认关系</Button><Button variant="outline" size="sm" disabled={busy} onClick={() => { void applyRelationAction(relation, "reject") }}><XCircleIcon data-icon="inline-start" />拒绝</Button></div> : null}</div>)}</div> : <p className="text-sm text-muted-foreground">可建立同一知识域内的候选关系；所有候选仍需人工确认。</p>}</CardContent>
                </Card>
              </div>
            </CardContent>
            <CardFooter className="justify-between text-xs text-muted-foreground"><span>稳定 ID：{selected.id}</span><Button variant="ghost" size="sm" onClick={() => { void loadItems(selected.id) }}><RefreshCwIcon data-icon="inline-start" />刷新</Button></CardFooter>
          </Card>
        ) : (
          <Card><CardContent className="flex min-h-[520px] items-center justify-center"><Empty><EmptyHeader><EmptyMedia variant="icon"><LightbulbIcon /></EmptyMedia><EmptyTitle>选择一条记录</EmptyTitle><EmptyDescription>查看正文、正式来源、关系和状态操作。</EmptyDescription></EmptyHeader></Empty></CardContent></Card>
        )}
      </div>
    </div>
  )
}
