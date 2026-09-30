import { useEffect, useMemo, useState, type FormEvent, type ReactNode } from "react"
import { ArchiveIcon, CheckCircleIcon, FileSearchIcon, FileTextIcon, FileUpIcon, PencilIcon, PlusIcon, SearchIcon, SparklesIcon, Trash2Icon } from "lucide-react"
import { open } from "@tauri-apps/plugin-dialog"
import { format, parseISO } from "date-fns"
import { zhCN } from "date-fns/locale"
import { toast } from "sonner"

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog"
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty"
import { Field, FieldDescription, FieldGroup, FieldLabel } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { ScrollArea } from "@/components/ui/scroll-area"
import { Select, SelectContent, SelectGroup, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Skeleton } from "@/components/ui/skeleton"
import { Textarea } from "@/components/ui/textarea"
import { getMeetingRepository } from "@/data/meeting-repository"
import { loadProviderConfig } from "@/data/provider-settings"
import { getRequirementRepository, type RequirementDraftInput } from "@/data/requirement-repository"
import { AppError } from "@/domain/app-error"
import { buildMeetingAnalysisInput, type MeetingAnalysisOutput } from "@/domain/meeting-analysis"
import type { Meeting, MeetingDocument, Project, RequirementDocument } from "@/domain/models"
import { requirementVersionSummary } from "@/domain/requirement-rules"
import { MeetingImportService, type MeetingImportResult } from "@/services/meeting-import-service"
import { generateMeetingAnalysis } from "@/services/structured-generation-service"
import { cn } from "@/lib/utils"

function errorMessage(error: unknown) {
  return error instanceof AppError || error instanceof Error ? error.message : "会议操作失败，请重试"
}

function AnalysisPreview({ output, busy, enabled, onRun, onCreateDraft }: { output?: MeetingAnalysisOutput; busy: boolean; enabled: boolean; onRun: () => void; onCreateDraft: (item: MeetingAnalysisOutput["requirements"][number]) => Promise<void> }) {
  const [creatingId, setCreatingId] = useState<string>()

  async function createDraft(item: MeetingAnalysisOutput["requirements"][number]) {
    setCreatingId(item.id)
    try { await onCreateDraft(item) } finally { setCreatingId(undefined) }
  }

  return <Card>
    <CardHeader>
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div><CardTitle>AI 需求分析草稿</CardTitle><CardDescription>只读取当前会议稳定段落；结果先作为草稿预览，不会自动写入正式需求或版本。</CardDescription></div>
        <Button size="sm" disabled={!enabled || busy} onClick={onRun}><SparklesIcon data-icon="inline-start" />{busy ? "分析中…" : "运行需求分析"}</Button>
      </div>
    </CardHeader>
    <CardContent className="flex flex-col gap-3">
      {!enabled ? <Alert><AlertTitle>当前不能运行 AI</AlertTitle><AlertDescription>请在桌面应用中配置并测试 Provider；浏览器预览不会调用模型。</AlertDescription></Alert> : null}
      {output ? <>
        <div className="flex flex-wrap gap-2"><Badge variant="secondary">摘要 {output.summary.length}</Badge><Badge variant="outline">主题 {output.topics.length}</Badge><Badge variant="outline">需求 {output.requirements.length}</Badge><Badge variant="outline">行动项 {output.actionItems.length}</Badge><Badge variant="outline">风险 {output.risks.length}</Badge></div>
        {output.summary.length ? <div className="rounded-lg border p-3"><p className="mb-2 text-sm font-medium">摘要</p><ul className="list-disc space-y-1 pl-5 text-sm">{output.summary.slice(0, 5).map((item) => <li key={item.id}>{item.text}</li>)}</ul></div> : null}
        {output.requirements.length ? <div className="rounded-lg border p-3"><p className="mb-2 text-sm font-medium">需求草稿候选</p><div className="flex flex-col gap-2">{output.requirements.slice(0, 10).map((item) => <div key={item.id} className="rounded-md bg-muted/40 p-2 text-sm"><div className="flex flex-wrap items-center gap-2"><span className="font-medium">{item.title}</span><Badge variant="outline">{item.classification}</Badge><span className="text-xs text-muted-foreground">证据 {item.evidence.length} 条</span><Button type="button" size="sm" variant="outline" className="ml-auto" disabled={creatingId !== undefined} onClick={() => { void createDraft(item) }}>{creatingId === item.id ? "保存中…" : "转为人工草稿"}</Button></div><p className="mt-1 text-muted-foreground">{item.text}</p></div>)}</div></div> : null}
      </> : <p className="text-sm text-muted-foreground">尚未运行分析。运行前会再次确认当前 Provider 配置，分析失败不会修改会议原文。</p>}
    </CardContent>
  </Card>
}

function HighlightedText({ text, query }: { text: string; query: string }) {
  const normalizedQuery = query.trim()
  if (!normalizedQuery) return text
  const lowerText = text.toLocaleLowerCase()
  const lowerQuery = normalizedQuery.toLocaleLowerCase()
  const parts: ReactNode[] = []
  let cursor = 0
  let index = lowerText.indexOf(lowerQuery)
  while (index >= 0) {
    parts.push(text.slice(cursor, index))
    parts.push(<mark key={`${index}-${cursor}`} className="rounded-sm bg-accent text-accent-foreground">{text.slice(index, index + normalizedQuery.length)}</mark>)
    cursor = index + normalizedQuery.length
    index = lowerText.indexOf(lowerQuery, cursor)
  }
  parts.push(text.slice(cursor))
  return parts
}

function ImportPasteDialog({ projects, service, onCreated, onDuplicate }: {
  projects: Project[]
  service: MeetingImportService
  onCreated: (document: MeetingDocument) => void
  onDuplicate: (result: Extract<MeetingImportResult, { status: "duplicate" }>) => void
}) {
  const [open, setOpen] = useState(false)
  const [projectId, setProjectId] = useState(projects[0]?.id ?? "")
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string>()
  const [text, setText] = useState("")

  useEffect(() => {
    if (!projectId && projects[0]) setProjectId(projects[0].id)
  }, [projectId, projects])

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const form = new FormData(event.currentTarget)
    setSaving(true)
    setError(undefined)
    try {
      const result = await service.importPaste({
        projectId,
        title: String(form.get("title")),
        meetingDate: String(form.get("meetingDate")),
        text,
      })
      if (result.status === "duplicate") {
        setOpen(false)
        onDuplicate(result)
        return
      }
      onCreated(result.document)
      setText("")
      setOpen(false)
      toast.success("会议原文已保存")
    } catch (submitError) {
      setError(errorMessage(submitError))
    } finally {
      setSaving(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger render={<Button disabled={!projects.length} />}>
        <PlusIcon data-icon="inline-start" />
        粘贴会议原文
      </DialogTrigger>
      <DialogContent className="sm:max-w-2xl">
        <form className="flex max-h-[80vh] flex-col gap-4" onSubmit={submit}>
          <DialogHeader>
            <DialogTitle>粘贴会议原文</DialogTitle>
            <DialogDescription>原文会在本地清洗、计算 SHA-256，并拆成带稳定编号的段落；此步骤不调用 AI。</DialogDescription>
          </DialogHeader>
          {error ? <Alert variant="destructive"><AlertTitle>无法保存会议</AlertTitle><AlertDescription>{error}</AlertDescription></Alert> : null}
          <ScrollArea className="max-h-[55vh] pr-3">
            <FieldGroup>
              <Field>
                <FieldLabel htmlFor="meeting-title">会议标题</FieldLabel>
                <Input id="meeting-title" name="title" maxLength={200} required autoFocus />
              </Field>
              <div className="grid gap-4 sm:grid-cols-2">
                <Field>
                  <FieldLabel>所属项目</FieldLabel>
                  <Select value={projectId} onValueChange={(value) => setProjectId(value ?? "")}>
                    <SelectTrigger className="w-full"><SelectValue placeholder="选择项目" /></SelectTrigger>
                    <SelectContent><SelectGroup>{projects.map((project) => <SelectItem key={project.id} value={project.id}>{project.name}</SelectItem>)}</SelectGroup></SelectContent>
                  </Select>
                </Field>
                <Field>
                  <FieldLabel htmlFor="meeting-date">会议日期</FieldLabel>
                  <Input id="meeting-date" name="meetingDate" type="date" defaultValue={new Date().toISOString().slice(0, 10)} required />
                </Field>
              </div>
              <Field>
                <FieldLabel htmlFor="meeting-text">原文</FieldLabel>
                <Textarea id="meeting-text" value={text} onChange={(event) => setText(event.target.value)} className="min-h-64" required />
                <FieldDescription>{new TextEncoder().encode(text).byteLength.toLocaleString()} 字节，最大 10 MB。</FieldDescription>
              </Field>
            </FieldGroup>
          </ScrollArea>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setOpen(false)}>取消</Button>
            <Button type="submit" disabled={saving}>{saving ? "正在保存…" : "保存原文"}</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

function selectedFileName(path: string) {
  return path.split(/[\\/]/).at(-1) ?? path
}

function ImportFileDialog({ projects, desktopRuntime, service, onCreated, onDuplicate }: {
  projects: Project[]
  desktopRuntime: boolean
  service: MeetingImportService
  onCreated: (document: MeetingDocument) => void
  onDuplicate: (result: Extract<MeetingImportResult, { status: "duplicate" }>) => void
}) {
  const [dialogOpen, setDialogOpen] = useState(false)
  const [projectId, setProjectId] = useState(projects[0]?.id ?? "")
  const [sourcePath, setSourcePath] = useState("")
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string>()

  useEffect(() => {
    if (!projectId && projects[0]) setProjectId(projects[0].id)
  }, [projectId, projects])

  async function chooseFile() {
    setError(undefined)
    try {
      const selected = await open({
        multiple: false,
        directory: false,
        filters: [{ name: "会议文件", extensions: ["txt", "md", "docx"] }],
      })
      if (typeof selected === "string") setSourcePath(selected)
    } catch (chooseError) {
      setError(errorMessage(chooseError))
    }
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!sourcePath) {
      setError("请先选择一个 UTF-8 编码的 txt 或 md 文件")
      return
    }
    const form = new FormData(event.currentTarget)
    setSaving(true)
    setError(undefined)
    try {
      const result = await service.importTextFile({
        projectId,
        title: String(form.get("title")),
        meetingDate: String(form.get("meetingDate")),
        sourcePath,
      })
      if (result.status === "duplicate") {
        setDialogOpen(false)
        onDuplicate(result)
        return
      }
      onCreated(result.document)
      setSourcePath("")
      setDialogOpen(false)
      if (result.document.source.parseStatus === "failed") toast.warning("原文件已保存，但解析失败；可在会议详情中查看原因并重试")
      else toast.success("会议文件已复制到受管目录并保存")
    } catch (submitError) {
      setError(errorMessage(submitError))
    } finally {
      setSaving(false)
    }
  }

  return (
    <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
      <DialogTrigger render={<Button variant="outline" disabled={!desktopRuntime || !projects.length} />}>
        <FileUpIcon data-icon="inline-start" />
        导入文件
      </DialogTrigger>
      <DialogContent className="sm:max-w-xl">
        <form className="flex flex-col gap-4" onSubmit={submit}>
          <DialogHeader>
            <DialogTitle>导入会议文本文件</DialogTitle>
            <DialogDescription>接受不超过 10 MB 的 UTF-8 txt/md 或 docx。应用会校验真实内容和 SHA-256，再复制到受管目录。</DialogDescription>
          </DialogHeader>
          {error ? <Alert variant="destructive"><AlertTitle>无法导入文件</AlertTitle><AlertDescription>{error}</AlertDescription></Alert> : null}
          <FieldGroup>
            <Field>
              <FieldLabel htmlFor="file-meeting-title">会议标题</FieldLabel>
              <Input id="file-meeting-title" name="title" maxLength={200} required autoFocus />
            </Field>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field>
                <FieldLabel>所属项目</FieldLabel>
                <Select value={projectId} onValueChange={(value) => setProjectId(value ?? "")}>
                  <SelectTrigger className="w-full"><SelectValue placeholder="选择项目" /></SelectTrigger>
                  <SelectContent><SelectGroup>{projects.map((project) => <SelectItem key={project.id} value={project.id}>{project.name}</SelectItem>)}</SelectGroup></SelectContent>
                </Select>
              </Field>
              <Field>
                <FieldLabel htmlFor="file-meeting-date">会议日期</FieldLabel>
                <Input id="file-meeting-date" name="meetingDate" type="date" defaultValue={new Date().toISOString().slice(0, 10)} required />
              </Field>
            </div>
            <Field>
              <FieldLabel>源文件</FieldLabel>
              <div className="flex items-center gap-3">
                <Button type="button" variant="outline" onClick={() => { void chooseFile() }}>选择文件</Button>
                <span className="min-w-0 truncate text-sm text-muted-foreground">{sourcePath ? selectedFileName(sourcePath) : "尚未选择文件"}</span>
              </div>
              <FieldDescription>导入后使用应用自己的副本，原文件移动或删除不会影响会议记录。</FieldDescription>
            </Field>
          </FieldGroup>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setDialogOpen(false)}>取消</Button>
            <Button type="submit" disabled={saving || !sourcePath}>{saving ? "正在导入…" : "导入并保存"}</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

function MeetingPreview({ document, search, focusedParagraphId, onSearchChange, onRequestDelete, onRetry, retrying }: {
  document: MeetingDocument
  search: string
  focusedParagraphId?: string
  onSearchChange: (value: string) => void
  onRequestDelete: () => void
  onRetry: () => void
  retrying: boolean
}) {
  const visibleParagraphs = document.paragraphs.filter((paragraph) => (
    !search.trim() || paragraph.text.toLocaleLowerCase().includes(search.trim().toLocaleLowerCase())
  ))

  return (
    <Card className="min-w-0">
      <CardHeader>
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div className="min-w-0">
            <CardTitle>{document.meeting.title}</CardTitle>
            <CardDescription>{document.paragraphs.length} 个稳定段落 · SHA-256 {document.source.contentHash.slice(0, 12)}…</CardDescription>
          </div>
          <div className="flex items-center gap-2">
            <Badge variant="secondary">{document.source.sourceType === "paste" ? "粘贴文本" : document.source.sourceType.toUpperCase()}</Badge>
            <Button variant="ghost" size="icon" aria-label="删除会议" onClick={onRequestDelete}><Trash2Icon /></Button>
          </div>
        </div>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        {document.source.parseStatus === "failed" ? (
          <Alert variant="destructive">
            <AlertTitle>docx 解析失败</AlertTitle>
            <AlertDescription className="flex flex-col items-start gap-3">
              <span>{document.source.parseError ?? "没有可用的错误摘要"}</span>
              <Button variant="outline" disabled={retrying} onClick={onRetry}>{retrying ? "正在重试…" : "重新解析受管原文件"}</Button>
            </AlertDescription>
          </Alert>
        ) : null}
        {document.source.parseStatus !== "failed" ? <>
        <div className="relative">
          <SearchIcon className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input aria-label="搜索会议原文" value={search} onChange={(event) => onSearchChange(event.target.value)} placeholder="搜索原文" className="pl-9" />
        </div>
        {visibleParagraphs.length ? (
          <ScrollArea className="h-[480px] pr-4">
            <div className="flex flex-col gap-3">
              {visibleParagraphs.map((paragraph) => (
                <article id={paragraph.id} key={paragraph.id} className={cn("rounded-lg border p-4", focusedParagraphId === paragraph.id && "ring-2 ring-ring")}>
                  <p className="mb-2 text-xs font-medium text-muted-foreground">¶{paragraph.ordinal} · {paragraph.id}</p>
                  <p className="whitespace-pre-wrap text-sm leading-6"><HighlightedText text={paragraph.text} query={search} /></p>
                </article>
              ))}
            </div>
          </ScrollArea>
        ) : (
          <Empty><EmptyHeader><EmptyMedia variant="icon"><FileSearchIcon /></EmptyMedia><EmptyTitle>没有匹配段落</EmptyTitle><EmptyDescription>尝试缩短关键词或清空搜索。</EmptyDescription></EmptyHeader></Empty>
        )}
        </> : null}
      </CardContent>
    </Card>
  )
}

function RequirementEvidencePicker({ document, selectedIds, onChange, label }: {
  document: MeetingDocument
  selectedIds: string[]
  onChange: (paragraphIds: string[]) => void
  label: string
}) {
  const [candidateId, setCandidateId] = useState(document.paragraphs[0]?.id ?? "")

  useEffect(() => {
    setCandidateId(document.paragraphs[0]?.id ?? "")
  }, [document.meeting.id, document.paragraphs])

  return <Field>
    <FieldLabel>{label}</FieldLabel>
    <div className="flex gap-2">
      <Select value={candidateId} onValueChange={(value) => setCandidateId(value ?? "")}>
        <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
        <SelectContent><SelectGroup>{document.paragraphs.map((paragraph) => <SelectItem key={paragraph.id} value={paragraph.id}>¶{paragraph.ordinal} · {paragraph.text.slice(0, 50)}</SelectItem>)}</SelectGroup></SelectContent>
      </Select>
      <Button type="button" variant="outline" disabled={!candidateId || selectedIds.includes(candidateId)} onClick={() => onChange([...selectedIds, candidateId])}>添加</Button>
    </div>
    {selectedIds.length ? <div className="flex flex-wrap gap-2">
      {selectedIds.map((id) => {
        const paragraph = document.paragraphs.find((item) => item.id === id)
        return <Button key={id} type="button" variant="outline" size="sm" onClick={() => onChange(selectedIds.filter((item) => item !== id))}>移除 ¶{paragraph?.ordinal ?? id.split(":p").at(-1)}</Button>
      })}
    </div> : <FieldDescription>至少添加一段会议原文。</FieldDescription>}
  </Field>
}

function requirementEvidence(document: MeetingDocument, paragraphIds: string[]) {
  return paragraphIds
    .map((paragraphId) => document.paragraphs.find((candidate) => candidate.id === paragraphId))
    .filter((paragraph): paragraph is MeetingDocument["paragraphs"][number] => Boolean(paragraph))
    .map((paragraph) => ({ paragraphId: paragraph.id, quote: paragraph.text, startOffset: paragraph.startOffset, endOffset: paragraph.endOffset }))
}

function RequirementRevisionDialog({ document, requirement, onRevise }: { document: MeetingDocument; requirement: RequirementDocument; onRevise: (cardId: string, input: Pick<RequirementDraftInput, "title" | "content" | "evidence">) => Promise<void> }) {
  const [open, setOpen] = useState(false)
  const [evidenceParagraphIds, setEvidenceParagraphIds] = useState<string[]>(requirement.currentVersion.evidence.filter((item) => item.sourceType !== "research_entry").map((item) => item.paragraphId))
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    if (open) setEvidenceParagraphIds(requirement.currentVersion.evidence.filter((item) => item.sourceType !== "research_entry").map((item) => item.paragraphId))
  }, [open, requirement.currentVersion.id, requirement.currentVersion.evidence])

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const form = new FormData(event.currentTarget)
    const evidence = [
      ...requirement.currentVersion.evidence.filter((item) => item.sourceType === "research_entry"),
      ...requirementEvidence(document, evidenceParagraphIds),
    ]
    setSaving(true)
    try {
      await onRevise(requirement.card.id, {
        title: String(form.get("title") ?? ""),
        content: {
          description: String(form.get("description") ?? "").trim(),
          targetUsers: String(form.get("targetUsers") ?? "").trim(),
          scenario: String(form.get("scenario") ?? "").trim(),
          painPoint: String(form.get("painPoint") ?? "").trim(),
          acceptanceCriteria: String(form.get("acceptanceCriteria") ?? "").split(/\r?\n/).map((item) => item.trim()).filter(Boolean),
        },
        evidence,
      })
      setOpen(false)
      toast.success("需求新版本已保存")
    } catch (error) { toast.error(errorMessage(error)) } finally { setSaving(false) }
  }
  return <Dialog open={open} onOpenChange={setOpen}>
    <DialogTrigger render={<Button variant="outline" size="sm" />}><PencilIcon data-icon="inline-start" />新版本</DialogTrigger>
    <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
      <form className="flex flex-col gap-4" onSubmit={submit}>
        <DialogHeader><DialogTitle>创建需求新版本</DialogTitle><DialogDescription>旧版本会保留，不会被覆盖。</DialogDescription></DialogHeader>
        <FieldGroup>
          <Field><FieldLabel htmlFor={`revise-title-${requirement.card.id}`}>标题</FieldLabel><Input id={`revise-title-${requirement.card.id}`} name="title" defaultValue={requirement.currentVersion.title} required /></Field>
          <Field><FieldLabel htmlFor={`revise-description-${requirement.card.id}`}>需求描述</FieldLabel><Textarea id={`revise-description-${requirement.card.id}`} name="description" defaultValue={requirement.currentVersion.content.description} required /></Field>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field><FieldLabel htmlFor={`revise-users-${requirement.card.id}`}>目标用户</FieldLabel><Input id={`revise-users-${requirement.card.id}`} name="targetUsers" defaultValue={requirement.currentVersion.content.targetUsers} /></Field>
            <Field><FieldLabel htmlFor={`revise-scenario-${requirement.card.id}`}>使用场景</FieldLabel><Input id={`revise-scenario-${requirement.card.id}`} name="scenario" defaultValue={requirement.currentVersion.content.scenario} /></Field>
          </div>
          <Field><FieldLabel htmlFor={`revise-pain-${requirement.card.id}`}>痛点</FieldLabel><Textarea id={`revise-pain-${requirement.card.id}`} name="painPoint" defaultValue={requirement.currentVersion.content.painPoint} /></Field>
          <Field><FieldLabel htmlFor={`revise-criteria-${requirement.card.id}`}>验收标准</FieldLabel><Textarea id={`revise-criteria-${requirement.card.id}`} name="acceptanceCriteria" defaultValue={requirement.currentVersion.content.acceptanceCriteria.join("\n")} placeholder="每行一条" /></Field>
          <RequirementEvidencePicker document={document} selectedIds={evidenceParagraphIds} onChange={setEvidenceParagraphIds} label="新版本证据段落" />
        </FieldGroup>
        <DialogFooter><Button type="button" variant="outline" onClick={() => setOpen(false)}>取消</Button><Button type="submit" disabled={saving}>{saving ? "正在保存…" : "保存新版本"}</Button></DialogFooter>
      </form>
    </DialogContent>
  </Dialog>
}

function RequirementPanel({ document, requirements, onCreate, onSubmitConfirmation, onConfirm, onRevise, onArchive, onLocateEvidence }: {
  document: MeetingDocument
  requirements: RequirementDocument[]
  onCreate: (input: RequirementDraftInput) => Promise<void>
  onSubmitConfirmation: (cardId: string) => Promise<void>
  onConfirm: (cardId: string) => Promise<void>
  onRevise: (cardId: string, input: Pick<RequirementDraftInput, "title" | "content" | "evidence">) => Promise<void>
  onArchive: (cardId: string) => Promise<void>
  onLocateEvidence: (paragraphId: string) => void
}) {
  const [open, setOpen] = useState(false)
  const [evidenceParagraphIds, setEvidenceParagraphIds] = useState<string[]>(document.paragraphs[0] ? [document.paragraphs[0].id] : [])
  const [saving, setSaving] = useState(false)

  useEffect(() => setEvidenceParagraphIds(document.paragraphs[0] ? [document.paragraphs[0].id] : []), [document.meeting.id, document.paragraphs])

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const form = new FormData(event.currentTarget)
    const evidence = requirementEvidence(document, evidenceParagraphIds)
    setSaving(true)
    try {
      await onCreate({
        meetingId: document.meeting.id,
        projectId: document.meeting.projectId,
        title: String(form.get("title") ?? ""),
        content: {
          description: String(form.get("description") ?? "").trim(),
          targetUsers: String(form.get("targetUsers") ?? "").trim(),
          scenario: String(form.get("scenario") ?? "").trim(),
          painPoint: String(form.get("painPoint") ?? "").trim(),
          acceptanceCriteria: String(form.get("acceptanceCriteria") ?? "").split(/\r?\n/).map((item) => item.trim()).filter(Boolean),
        },
        evidence,
      })
      setOpen(false)
      toast.success("需求草稿已保存")
    } catch (error) {
      toast.error(errorMessage(error))
    } finally {
      setSaving(false)
    }
  }

  return <Card>
    <CardHeader>
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div><CardTitle>需求卡</CardTitle><CardDescription>人工草稿先绑定原文证据，确认后冻结当前版本。</CardDescription></div>
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogTrigger render={<Button size="sm" disabled={!document.paragraphs.length} />}><PlusIcon data-icon="inline-start" />新建需求草稿</DialogTrigger>
          <DialogContent className="sm:max-w-2xl">
            <form className="flex flex-col gap-4" onSubmit={submit}>
              <DialogHeader><DialogTitle>新建需求草稿</DialogTitle><DialogDescription>这是人工录入流程，不调用 AI。至少保留一个会议原文段落作为证据。</DialogDescription></DialogHeader>
              <FieldGroup>
                <Field><FieldLabel htmlFor="requirement-title">标题</FieldLabel><Input id="requirement-title" name="title" required /></Field>
                <Field><FieldLabel htmlFor="requirement-description">需求描述</FieldLabel><Textarea id="requirement-description" name="description" required /></Field>
                <div className="grid gap-4 sm:grid-cols-2">
                  <Field><FieldLabel htmlFor="requirement-users">目标用户</FieldLabel><Input id="requirement-users" name="targetUsers" /></Field>
                  <Field><FieldLabel htmlFor="requirement-scenario">使用场景</FieldLabel><Input id="requirement-scenario" name="scenario" /></Field>
                </div>
                <Field><FieldLabel htmlFor="requirement-pain">痛点</FieldLabel><Textarea id="requirement-pain" name="painPoint" /></Field>
                <Field><FieldLabel htmlFor="requirement-acceptance">验收标准</FieldLabel><Textarea id="requirement-acceptance" name="acceptanceCriteria" placeholder="每行一条" /></Field>
                <RequirementEvidencePicker document={document} selectedIds={evidenceParagraphIds} onChange={setEvidenceParagraphIds} label="原文证据" />
              </FieldGroup>
              <DialogFooter><Button type="button" variant="outline" onClick={() => setOpen(false)}>取消</Button><Button type="submit" disabled={saving}>{saving ? "正在保存…" : "保存草稿"}</Button></DialogFooter>
            </form>
          </DialogContent>
        </Dialog>
      </div>
    </CardHeader>
    <CardContent className="flex flex-col gap-3">
      {requirements.length ? requirements.map((requirement) => <div key={requirement.card.id} className="flex flex-col gap-3 rounded-lg border p-4">
        <div className="flex flex-wrap items-center gap-2"><p className="flex-1 font-medium">{requirement.currentVersion.title}</p><Badge variant={requirement.card.status === "confirmed" ? "secondary" : "outline"}>{requirement.card.status === "confirmed" ? "已确认" : requirement.card.status === "pending_confirmation" ? "待确认" : requirement.card.status === "archived" ? "已归档" : "草稿"}</Badge><Badge variant="outline">v{requirement.currentVersion.versionNumber}</Badge></div>
        <p className="text-sm text-muted-foreground">{requirement.currentVersion.content.description}</p>
        {requirement.currentVersion.evidence.map((evidence) => <blockquote key={evidence.paragraphId} className="flex flex-col items-start gap-2 border-l-2 pl-3 text-sm text-muted-foreground"><span>{evidence.quote}</span>{evidence.sourceType === "research_entry" ? <Badge variant="outline">研究记录 · {evidence.sourceId}</Badge> : <Button type="button" variant="ghost" size="sm" onClick={() => onLocateEvidence(evidence.paragraphId)}>定位原文 ¶{evidence.paragraphId.split(":p").at(-1)}</Button>}</blockquote>)}
        {requirement.currentVersion.versionNumber > 1 && requirement.versions.some((version) => version.isConfirmed && version.id !== requirement.currentVersion.id) ? <Alert><AlertTitle>检测到已确认旧版本</AlertTitle><AlertDescription>当前是新草稿版本，确认前请核对与旧版本的差异。</AlertDescription></Alert> : null}
        {requirement.versions.length > 1 ? <div className="flex flex-col gap-2 rounded-md bg-muted/40 p-3"><p className="text-sm font-medium">版本历史</p>{requirement.versions.slice().sort((a, b) => b.versionNumber - a.versionNumber).map((version) => { const previous = requirement.versions.find((candidate) => candidate.versionNumber === version.versionNumber - 1); const summary = requirementVersionSummary(version, previous); return <div key={version.id} className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground"><Badge variant={version.id === requirement.currentVersion.id ? "secondary" : "outline"}>v{version.versionNumber}</Badge><span className="font-medium text-foreground">{version.title}</span><span>{summary.changes.join("、")}</span><span>证据 {summary.evidenceCount} 条</span>{summary.confirmed ? <span>已确认</span> : null}</div> })}</div> : null}
        <div className="flex flex-wrap justify-end gap-2"><span className="mr-auto text-xs text-muted-foreground">共 {requirement.versions.length} 个版本</span>{requirement.card.status !== "archived" ? <RequirementRevisionDialog document={document} requirement={requirement} onRevise={onRevise} /> : null}{requirement.card.status === "draft" ? <Button size="sm" onClick={() => { void onSubmitConfirmation(requirement.card.id) }}>提交人工确认</Button> : null}{requirement.card.status === "pending_confirmation" && !requirement.currentVersion.isConfirmed ? <Button size="sm" onClick={() => { void onConfirm(requirement.card.id) }}><CheckCircleIcon data-icon="inline-start" />确认当前版本</Button> : null}{requirement.card.status !== "archived" ? <Button variant="ghost" size="sm" onClick={() => { void onArchive(requirement.card.id) }}><ArchiveIcon data-icon="inline-start" />归档</Button> : null}</div>
      </div>) : <Empty><EmptyHeader><EmptyMedia variant="icon"><FileTextIcon /></EmptyMedia><EmptyTitle>还没有需求草稿</EmptyTitle><EmptyDescription>从会议原文创建第一张带证据的人工需求卡。</EmptyDescription></EmptyHeader></Empty>}
    </CardContent>
  </Card>
}

export function MeetingsPage({ meetings, projects, desktopRuntime, onMeetingCreated, onMeetingDeleted, onMeetingUpdated }: {
  meetings: Meeting[]
  projects: Project[]
  desktopRuntime: boolean
  onMeetingCreated: (meeting: Meeting) => void
  onMeetingDeleted: (meetingId: string) => void
  onMeetingUpdated: (meeting: Meeting) => void
}) {
  const service = useMemo(() => new MeetingImportService(getMeetingRepository(desktopRuntime)), [desktopRuntime])
  const requirementRepository = useMemo(() => getRequirementRepository(desktopRuntime), [desktopRuntime])
  const [selectedMeetingId, setSelectedMeetingId] = useState<string>()
  const [document, setDocument] = useState<MeetingDocument>()
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string>()
  const [search, setSearch] = useState("")
  const [focusedParagraphId, setFocusedParagraphId] = useState<string>()
  const [duplicateResult, setDuplicateResult] = useState<Extract<MeetingImportResult, { status: "duplicate" }>>()
  const [deleteCandidate, setDeleteCandidate] = useState<MeetingDocument>()
  const [deleting, setDeleting] = useState(false)
  const [retrying, setRetrying] = useState(false)
  const [requirements, setRequirements] = useState<RequirementDocument[]>([])
  const [analysisOutput, setAnalysisOutput] = useState<MeetingAnalysisOutput>()
  const [analysisBusy, setAnalysisBusy] = useState(false)

  async function openMeeting(meetingId: string) {
    setSelectedMeetingId(meetingId)
    setLoading(true)
    setError(undefined)
    setSearch("")
    setFocusedParagraphId(undefined)
    setAnalysisOutput(undefined)
    try {
      const [meetingDocument, meetingRequirements] = await Promise.all([service.getDocument(meetingId), requirementRepository.listByMeeting(meetingId)])
      setDocument(meetingDocument)
      setRequirements(meetingRequirements)
    } catch (loadError) {
      setDocument(undefined)
      setRequirements([])
      setError(errorMessage(loadError))
    } finally {
      setLoading(false)
    }
  }

  function acceptCreated(created: MeetingDocument) {
    onMeetingCreated(created.meeting)
    setDocument(created)
    setSelectedMeetingId(created.meeting.id)
    setRequirements([])
  }

  async function createRequirement(input: RequirementDraftInput) {
    const created = await requirementRepository.createDraft(input)
    setRequirements((current) => [created, ...current])
  }

  async function confirmRequirement(cardId: string) {
    try {
      const confirmed = await requirementRepository.confirm(cardId)
      setRequirements((current) => current.map((requirement) => requirement.card.id === cardId ? confirmed : requirement))
      toast.success("需求版本已确认")
    } catch (error) {
      toast.error(errorMessage(error))
    }
  }

  async function submitRequirementForConfirmation(cardId: string) {
    try {
      const pending = await requirementRepository.submitForConfirmation(cardId)
      setRequirements((current) => current.map((requirement) => requirement.card.id === cardId ? pending : requirement))
      toast.success("需求草稿已提交人工确认")
    } catch (error) { toast.error(errorMessage(error)) }
  }

  async function reviseRequirement(cardId: string, input: Pick<RequirementDraftInput, "title" | "content" | "evidence">) {
    const revised = await requirementRepository.revise(cardId, input)
    setRequirements((current) => current.map((requirement) => requirement.card.id === cardId ? revised : requirement))
  }

  async function archiveRequirement(cardId: string) {
    try {
      const archived = await requirementRepository.archive(cardId)
      setRequirements((current) => current.map((requirement) => requirement.card.id === cardId ? archived : requirement))
      toast.success("需求卡已归档")
    } catch (error) { toast.error(errorMessage(error)) }
  }

  function locateEvidence(paragraphId: string) {
    setSearch("")
    setFocusedParagraphId(paragraphId)
    window.requestAnimationFrame(() => window.document.getElementById(paragraphId)?.scrollIntoView({ behavior: "smooth", block: "center" }))
  }

  async function keepDuplicate() {
    if (!duplicateResult) return
    try {
      acceptCreated(await service.keepDuplicate(duplicateResult))
      setDuplicateResult(undefined)
      toast.success("已作为新的会议记录保留")
    } catch (keepError) {
      toast.error(errorMessage(keepError))
    }
  }

  async function confirmDelete() {
    if (!deleteCandidate) return
    setDeleting(true)
    try {
      const result = await service.deleteMeeting(deleteCandidate.meeting.id)
      if (!result.deleted) throw new AppError("not_found", "会议记录已不存在")
      await requirementRepository.deleteByMeeting(deleteCandidate.meeting.id)
      onMeetingDeleted(deleteCandidate.meeting.id)
      setDeleteCandidate(undefined)
      setDocument(undefined)
      setSelectedMeetingId(undefined)
      setRequirements([])
      if (result.cleanupWarnings.length) toast.warning(`会议已删除，但有 ${result.cleanupWarnings.length} 个附件清理警告`)
      else toast.success(result.attachmentsRemoved ? "会议及受管附件已删除" : "会议记录已删除")
    } catch (deleteError) {
      toast.error(errorMessage(deleteError))
    } finally {
      setDeleting(false)
    }
  }

  async function retryDocx() {
    if (!document) return
    setRetrying(true)
    try {
      const retried = await service.retryDocx(document.meeting.id)
      setDocument(retried)
      onMeetingUpdated(retried.meeting)
      toast.success("docx 已重新解析")
    } catch (retryError) {
      toast.error(errorMessage(retryError))
      try { setDocument(await service.getDocument(document.meeting.id)) } catch { /* 保留当前错误视图 */ }
    } finally {
      setRetrying(false)
    }
  }

  async function runAnalysis() {
    if (!document || document.source.parseStatus === "failed") return
    setAnalysisBusy(true)
    try {
      const provider = await loadProviderConfig(desktopRuntime)
      const input = buildMeetingAnalysisInput(document)
      const result = await generateMeetingAnalysis(input, provider)
      setAnalysisOutput(result.output)
      toast.success(`分析草稿已生成（${result.durationMs} ms）`)
    } catch (analysisError) {
      toast.error(errorMessage(analysisError))
    } finally {
      setAnalysisBusy(false)
    }
  }

  async function createAiRequirementDraft(item: MeetingAnalysisOutput["requirements"][number]) {
    if (!document) return
    try {
      await createRequirement({
        meetingId: document.meeting.id,
        projectId: document.meeting.projectId,
        title: item.title,
        content: { description: item.text, targetUsers: item.targetUsers, scenario: item.scenario, painPoint: item.painPoint, acceptanceCriteria: item.acceptanceCriteria },
        evidence: item.evidence,
        source: "ai",
      })
      toast.success("AI 候选已保存为人工草稿，请继续核对后再提交确认")
    } catch (draftError) { toast.error(errorMessage(draftError)) }
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div><h1 className="text-2xl font-semibold tracking-tight">会议与需求</h1><p className="mt-1 text-sm text-muted-foreground">先保存可追溯原文，确认后再发送给模型分析。</p></div>
        <div className="flex flex-wrap gap-2">
          <ImportFileDialog projects={projects} desktopRuntime={desktopRuntime} service={service} onCreated={acceptCreated} onDuplicate={setDuplicateResult} />
          <ImportPasteDialog projects={projects} service={service} onCreated={acceptCreated} onDuplicate={setDuplicateResult} />
        </div>
      </div>

      {!desktopRuntime ? <Alert><AlertTitle>文件导入需要桌面应用</AlertTitle><AlertDescription>浏览器预览仍可验证粘贴导入；txt/md/docx 的系统文件选择、受管复制和原子写入仅在桌面运行时启用。</AlertDescription></Alert> : null}

      {!projects.length ? <Alert><AlertTitle>请先创建项目</AlertTitle><AlertDescription>会议必须归属一个项目，以保证后续来源、需求和 Agent 检索不会跨项目泄漏。</AlertDescription></Alert> : null}
      {error ? <Alert variant="destructive"><AlertTitle>无法读取会议</AlertTitle><AlertDescription>{error}</AlertDescription></Alert> : null}

      {meetings.length ? (
        <div className="grid min-w-0 gap-4 lg:grid-cols-[minmax(240px,0.65fr)_minmax(0,1.6fr)]">
          <Card>
            <CardHeader><CardTitle>会议记录</CardTitle><CardDescription>共 {meetings.length} 条，按日期查看原文。</CardDescription></CardHeader>
            <CardContent className="flex flex-col gap-2">
              {meetings.map((meeting) => (
                <Button key={meeting.id} variant={selectedMeetingId === meeting.id ? "secondary" : "ghost"} className="h-auto justify-start py-3 text-left" onClick={() => { void openMeeting(meeting.id) }}>
                  <FileTextIcon data-icon="inline-start" />
                  <span className="min-w-0"><span className="block truncate font-medium">{meeting.title}</span><span className="block text-xs text-muted-foreground">{format(parseISO(meeting.meetingDate), "yyyy 年 M 月 d 日", { locale: zhCN })}</span></span>
                </Button>
              ))}
            </CardContent>
          </Card>
          {loading ? <Card><CardHeader><Skeleton className="h-6 w-48" /><Skeleton className="h-4 w-64" /></CardHeader><CardContent className="flex flex-col gap-3"><Skeleton className="h-10 w-full" /><Skeleton className="h-32 w-full" /><Skeleton className="h-32 w-full" /></CardContent></Card> : null}
          {!loading && document ? <div className="flex min-w-0 flex-col gap-4"><MeetingPreview document={document} search={search} focusedParagraphId={focusedParagraphId} onSearchChange={(value) => { setSearch(value); setFocusedParagraphId(undefined) }} onRequestDelete={() => setDeleteCandidate(document)} onRetry={() => { void retryDocx() }} retrying={retrying} /><AnalysisPreview output={analysisOutput} busy={analysisBusy} enabled={desktopRuntime && document.source.parseStatus !== "failed"} onRun={() => { void runAnalysis() }} onCreateDraft={createAiRequirementDraft} /><RequirementPanel document={document} requirements={requirements} onCreate={createRequirement} onSubmitConfirmation={submitRequirementForConfirmation} onConfirm={confirmRequirement} onRevise={reviseRequirement} onArchive={archiveRequirement} onLocateEvidence={locateEvidence} /></div> : null}
          {!loading && !document ? <Empty><EmptyHeader><EmptyMedia variant="icon"><FileTextIcon /></EmptyMedia><EmptyTitle>选择一条会议查看原文</EmptyTitle><EmptyDescription>原文按稳定段落编号展示，可搜索并高亮定位。</EmptyDescription></EmptyHeader></Empty> : null}
        </div>
      ) : (
        <Card>
          <CardHeader><CardTitle>会议原文</CardTitle><CardDescription>支持粘贴文本以及桌面端 txt、md、docx 文件，并保留可追踪来源。</CardDescription></CardHeader>
          <CardContent><Empty><EmptyHeader><EmptyMedia variant="icon"><FileTextIcon /></EmptyMedia><EmptyTitle>还没有会议记录</EmptyTitle><EmptyDescription>使用右上角粘贴原文或导入文本文件；系统会在本地生成哈希和稳定段落，不调用 AI。</EmptyDescription></EmptyHeader></Empty></CardContent>
        </Card>
      )}

      <Dialog open={Boolean(duplicateResult)} onOpenChange={(open) => { if (!open) setDuplicateResult(undefined) }}>
        <DialogContent>
          <DialogHeader><DialogTitle>检测到相同会议原文</DialogTitle><DialogDescription>同一项目中的“{duplicateResult?.duplicate.meetingTitle}”具有相同 SHA-256。请选择复用已有会议，或明确保留一条新记录。</DialogDescription></DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => {
              const meetingId = duplicateResult?.duplicate.meetingId
              setDuplicateResult(undefined)
              if (meetingId) void openMeeting(meetingId)
            }}>复用已有会议</Button>
            <Button onClick={() => { void keepDuplicate() }}>保留新记录</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={Boolean(deleteCandidate)} onOpenChange={(open) => { if (!open && !deleting) setDeleteCandidate(undefined) }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>删除会议“{deleteCandidate?.meeting.title}”？</DialogTitle>
            <DialogDescription>会议记录、来源和稳定段落会永久删除；应用受管的 txt/md/docx 副本也会清理。原始文件不会被删除，此操作无法撤销。</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" disabled={deleting} onClick={() => setDeleteCandidate(undefined)}>取消</Button>
            <Button variant="destructive" disabled={deleting} onClick={() => { void confirmDelete() }}>{deleting ? "正在删除…" : "确认删除"}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
