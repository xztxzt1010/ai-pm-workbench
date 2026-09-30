import { lazy, Suspense, useEffect, useMemo, useState, type FormEvent } from "react"
import {
  BellIcon,
  BotIcon,
  CalendarCheckIcon,
  CheckIcon,
  ChevronRightIcon,
  FileTextIcon,
  FolderKanbanIcon,
  LayoutDashboardIcon,
  LibraryBigIcon,
  PlusIcon,
  SettingsIcon,
  SparklesIcon,
} from "lucide-react"
import { format, parseISO } from "date-fns"
import { zhCN } from "date-fns/locale"
import { toast } from "sonner"

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
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
import { Field, FieldGroup, FieldLabel } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { Progress } from "@/components/ui/progress"
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Separator } from "@/components/ui/separator"
import { Skeleton } from "@/components/ui/skeleton"
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarInset,
  SidebarMenu,
  SidebarMenuBadge,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarProvider,
  SidebarTrigger,
} from "@/components/ui/sidebar"
import { Textarea } from "@/components/ui/textarea"
import { Toaster } from "@/components/ui/sonner"
import { TooltipProvider } from "@/components/ui/tooltip"
import { completeItem, dueByEndOfToday, isDueToday, isOverdue, postponeItem } from "@/domain/confirmation-rules"
import type { ConfirmationItem, Milestone, Priority, Project, WorkspaceData } from "@/domain/models"
import { activeProjectIds, confirmationItemsForActiveProjects, filterProjectsByVisibility, parseProjectList, type ProjectVisibility } from "@/domain/project-rules"
import { createConfirmation, createProject, loadWorkspace, saveWorkspace } from "@/data/workspace-store"
import {
  deleteMilestone,
  isDesktopRuntime,
  loadDesktopWorkspace,
  persistConfirmationItem,
  persistMilestone,
  persistProject,
} from "@/data/desktop-database"
import { useNotificationScheduler } from "@/hooks/use-notification-scheduler"
import { recoverInterruptedAgentRuns } from "@/services/agent-run-service"
import { listProjectRisks, type ProjectRiskRecord } from "@/services/project-risk-service"
import { listProjectDependencies, type ProjectDependencyRecord } from "@/services/project-dependency-service"
import { listProductDecisions, type ProductDecisionRecord } from "@/services/product-decision-service"
import { listReleases, type ReleaseRecord } from "@/services/release-service"

type Page = "today" | "projects" | "meetings" | "knowledge" | "notifications" | "settings"

function projectIdFromLocation() {
  const match = window.location.hash.match(/^#\/projects\/([^/?#]+)$/)
  return match ? decodeURIComponent(match[1]) : undefined
}

function navigateToProject(projectId?: string, replace = false) {
  const url = projectId ? `#/projects/${encodeURIComponent(projectId)}` : "#"
  if (replace) window.history.replaceState(null, "", url)
  else window.history.pushState(null, "", url)
}

const ProjectDetailSheet = lazy(() => import("@/components/project-detail-sheet").then((module) => ({ default: module.ProjectDetailSheet })))
const MeetingsPage = lazy(() => import("@/components/meetings-page").then((module) => ({ default: module.MeetingsPage })))
const KnowledgePage = lazy(() => import("@/components/knowledge-page").then((module) => ({ default: module.KnowledgePage })))
const NotificationsPage = lazy(() => import("@/components/notifications-page").then((module) => ({ default: module.NotificationsPage })))
const SettingsPage = lazy(() => import("@/components/settings-page").then((module) => ({ default: module.SettingsPage })))
const OnboardingDialog = lazy(() => import("@/components/onboarding-dialog").then((module) => ({ default: module.OnboardingDialog })))

const navigation = [
  { id: "today" as const, label: "今日", icon: LayoutDashboardIcon },
  { id: "projects" as const, label: "项目", icon: FolderKanbanIcon },
  { id: "meetings" as const, label: "会议与需求", icon: FileTextIcon },
  { id: "knowledge" as const, label: "记录与知识", icon: LibraryBigIcon },
  { id: "notifications" as const, label: "通知", icon: BellIcon },
  { id: "settings" as const, label: "设置", icon: SettingsIcon },
]

function PageFallback() {
  return (
    <div className="flex flex-col gap-4" aria-label="正在加载页面">
      <Skeleton className="h-8 w-48" />
      <Skeleton className="h-28 w-full" />
      <Skeleton className="h-48 w-full" />
    </div>
  )
}

function AppSidebar({ page, setPage, overdueCount }: { page: Page; setPage: (page: Page) => void; overdueCount: number }) {
  return (
    <Sidebar collapsible="icon">
      <SidebarHeader>
        <div className="flex items-center gap-2 px-2 py-1.5">
          <div className="flex size-8 items-center justify-center rounded-lg bg-primary text-primary-foreground">
            <SparklesIcon className="size-4" />
          </div>
          <div className="min-w-0 group-data-[collapsible=icon]:hidden">
            <p className="truncate text-sm font-medium">产品经理工作台</p>
            <p className="truncate text-xs text-muted-foreground">本地优先 · 个人空间</p>
          </div>
        </div>
      </SidebarHeader>
      <SidebarContent>
        <SidebarGroup>
          <SidebarGroupLabel>工作空间</SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>
              {navigation.map((item) => (
                <SidebarMenuItem key={item.id}>
                  <SidebarMenuButton
                    isActive={page === item.id}
                    onClick={() => setPage(item.id)}
                    tooltip={item.label}
                  >
                    <item.icon />
                    <span>{item.label}</span>
                  </SidebarMenuButton>
                  {item.id === "notifications" && overdueCount > 0 ? (
                    <SidebarMenuBadge>{overdueCount}</SidebarMenuBadge>
                  ) : null}
                </SidebarMenuItem>
              ))}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>
      <SidebarFooter>
        <div className="flex items-center gap-2 px-2 py-1.5 text-xs text-muted-foreground group-data-[collapsible=icon]:hidden">
          <span className="size-2 rounded-full bg-primary" />
          非 AI 功能可离线使用
        </div>
      </SidebarFooter>
    </Sidebar>
  )
}

function NewProjectDialog({ onCreate }: { onCreate: (project: Project) => void }) {
  const [open, setOpen] = useState(false)

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const data = new FormData(event.currentTarget)
    onCreate(createProject({
      name: String(data.get("name")),
      goal: String(data.get("goal")),
      startDate: String(data.get("startDate")),
      endDate: String(data.get("endDate")),
    }))
    setOpen(false)
    toast.success("项目已创建")
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger render={<Button variant="outline" size="sm" />}>
        <PlusIcon data-icon="inline-start" />
        新建项目
      </DialogTrigger>
      <DialogContent className="sm:max-w-lg">
        <form className="flex flex-col gap-4" onSubmit={submit}>
          <DialogHeader>
            <DialogTitle>新建项目</DialogTitle>
            <DialogDescription>建立目标和时间边界，后续可继续添加里程碑。</DialogDescription>
          </DialogHeader>
          <FieldGroup>
            <Field>
              <FieldLabel htmlFor="project-name">名称</FieldLabel>
              <Input id="project-name" name="name" required autoFocus />
            </Field>
            <Field>
              <FieldLabel htmlFor="project-goal">目标</FieldLabel>
              <Textarea id="project-goal" name="goal" required />
            </Field>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field>
                <FieldLabel htmlFor="project-start">开始日期</FieldLabel>
                <Input id="project-start" name="startDate" type="date" required />
              </Field>
              <Field>
                <FieldLabel htmlFor="project-end">结束日期</FieldLabel>
                <Input id="project-end" name="endDate" type="date" required />
              </Field>
            </div>
          </FieldGroup>
          <DialogFooter>
            <Button type="submit">创建项目</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

function NewConfirmationDialog({ projects, onCreate }: { projects: Project[]; onCreate: (item: ConfirmationItem) => void }) {
  const [open, setOpen] = useState(false)
  const [projectId, setProjectId] = useState(projects[0]?.id ?? "")
  const [priority, setPriority] = useState<Priority>("medium")

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const data = new FormData(event.currentTarget)
    onCreate(createConfirmation({
      title: String(data.get("title")),
      projectId,
      dueDate: String(data.get("dueDate")),
      priority,
    }))
    setOpen(false)
    toast.success("确认事项已添加")
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger render={<Button size="sm" />}>
        <CalendarCheckIcon data-icon="inline-start" />
        添加确认事项
      </DialogTrigger>
      <DialogContent className="sm:max-w-lg">
        <form className="flex flex-col gap-4" onSubmit={submit}>
          <DialogHeader>
            <DialogTitle>添加确认事项</DialogTitle>
            <DialogDescription>正式提醒仅由这里设置的日期和状态产生。</DialogDescription>
          </DialogHeader>
          <FieldGroup>
            <Field>
              <FieldLabel htmlFor="confirmation-title">标题</FieldLabel>
              <Input id="confirmation-title" name="title" required autoFocus />
            </Field>
            <Field>
              <FieldLabel>所属项目</FieldLabel>
              <Select value={projectId} onValueChange={(value) => setProjectId(value ?? "")}>
                <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectGroup>
                    {projects.map((project) => <SelectItem key={project.id} value={project.id}>{project.name}</SelectItem>)}
                  </SelectGroup>
                </SelectContent>
              </Select>
            </Field>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field>
                <FieldLabel htmlFor="confirmation-date">确认日期</FieldLabel>
                <Input id="confirmation-date" name="dueDate" type="date" required />
              </Field>
              <Field>
                <FieldLabel>优先级</FieldLabel>
                <Select value={priority} onValueChange={(value) => setPriority((value ?? "medium") as Priority)}>
                  <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectGroup>
                      <SelectItem value="high">高</SelectItem>
                      <SelectItem value="medium">中</SelectItem>
                      <SelectItem value="low">低</SelectItem>
                    </SelectGroup>
                  </SelectContent>
                </Select>
              </Field>
            </div>
          </FieldGroup>
          <DialogFooter>
            <Button type="submit" disabled={!projectId}>添加事项</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

function MetricCard({ label, value, description, icon: Icon }: { label: string; value: number; description: string; icon: typeof BellIcon }) {
  return (
    <Card size="sm">
      <CardHeader>
        <CardDescription>{label}</CardDescription>
        <CardAction><Icon className="size-4 text-muted-foreground" /></CardAction>
        <CardTitle className="text-2xl tabular-nums">{value}</CardTitle>
      </CardHeader>
      <CardContent><p className="text-xs text-muted-foreground">{description}</p></CardContent>
    </Card>
  )
}

function ConfirmationRow({ item, project, onComplete, onPostpone }: {
  item: ConfirmationItem
  project?: Project
  onComplete: (id: string) => void
  onPostpone: (id: string) => void
}) {
  const overdue = isOverdue(item)
  return (
    <div className="flex flex-col gap-3 rounded-lg border p-3 sm:flex-row sm:items-center">
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <p className="font-medium">{item.title}</p>
          <Badge variant={overdue ? "destructive" : "secondary"}>{overdue ? "已逾期" : "今日"}</Badge>
          {item.priority === "high" ? <Badge variant="outline">高优先级</Badge> : null}
        </div>
        <p className="mt-1 text-sm text-muted-foreground">
          {project?.name ?? "未关联项目"} · {format(parseISO(item.dueDate), "M 月 d 日", { locale: zhCN })}
        </p>
      </div>
      <div className="flex gap-2">
        <Button variant="outline" size="sm" onClick={() => onPostpone(item.id)}>延期</Button>
        <Button size="sm" onClick={() => onComplete(item.id)}>
          <CheckIcon data-icon="inline-start" />
          完成
        </Button>
      </div>
    </div>
  )
}

function TodayDashboard({ data, setData }: { data: WorkspaceData; setData: (data: WorkspaceData) => void }) {
  const desktopRuntime = isDesktopRuntime()
  const [risks, setRisks] = useState<ProjectRiskRecord[]>([])
  const [dependencies, setDependencies] = useState<ProjectDependencyRecord[]>([])
  const [decisions, setDecisions] = useState<ProductDecisionRecord[]>([])
  const [releases, setReleases] = useState<ReleaseRecord[]>([])
  const currentProjectIds = useMemo(() => activeProjectIds(data.projects), [data.projects])
  const activeConfirmationItems = useMemo(() => confirmationItemsForActiveProjects(data.confirmationItems, data.projects), [data.confirmationItems, data.projects])
  const todayItems = useMemo(() => dueByEndOfToday(activeConfirmationItems), [activeConfirmationItems])
  const overdueCount = activeConfirmationItems.filter((item) => isOverdue(item)).length
  const dueTodayCount = activeConfirmationItems.filter((item) => isDueToday(item)).length
  const activeProjects = data.projects.filter((project) => project.status === "active" && !project.archivedAt)
  const nextMilestone = data.milestones.filter((item) => currentProjectIds.has(item.projectId)).sort((a, b) => a.dueDate.localeCompare(b.dueDate))[0]
  const today = new Date().toISOString().slice(0, 10)
  useEffect(() => {
    if (!desktopRuntime) return
    const projectIds = data.projects.filter((project) => project.status === "active" && !project.archivedAt).map((project) => project.id)
    void Promise.all(projectIds.map(async (projectId) => Promise.all([listProjectRisks(true, projectId), listProjectDependencies(true, projectId), listProductDecisions(true, projectId), listReleases(true, projectId)]))).then((results) => {
      setRisks(results.flatMap((result) => result[0])); setDependencies(results.flatMap((result) => result[1])); setDecisions(results.flatMap((result) => result[2])); setReleases(results.flatMap((result) => result[3]))
    }).catch(() => toast.error("无法加载跨模块驾驶舱事项"))
  }, [data.projects, desktopRuntime])
  const openRisks = risks.filter((item) => item.status !== "closed")
  const blockedDependencies = dependencies.filter((item) => item.status === "blocked")
  const dueDecisions = decisions.filter((item) => item.status !== "archived" && item.reviewDate <= today)
  const pendingReleases = releases.filter((item) => ["ready", "released"].includes(item.status))
  function projectName(projectId: string) { return data.projects.find((project) => project.id === projectId)?.name ?? "未命名项目" }
  function DashboardDetails({ title, items }: { title: string; items: Array<{ id: string; projectId: string; title: string }> }) {
    return <div className="rounded-md border p-3"><p className="font-medium">{title}</p>{items.length ? <div className="mt-2 flex flex-col gap-1">{items.slice(0, 3).map((item) => <button key={item.id} className="flex items-center justify-between gap-2 rounded px-2 py-1 text-left text-sm hover:bg-muted" onClick={() => navigateToProject(item.projectId)}><span className="truncate">{item.title}</span><span className="shrink-0 text-xs text-muted-foreground">{projectName(item.projectId)}</span></button>)}</div> : <p className="mt-2 text-sm text-muted-foreground">暂无待办</p>}</div>
  }

  function updateItem(id: string, updater: (item: ConfirmationItem) => ConfirmationItem) {
    let updatedItem: ConfirmationItem | undefined
    const confirmationItems = data.confirmationItems.map((item) => {
      if (item.id !== id) return item
      updatedItem = updater(item)
      return updatedItem
    })
    setData({ ...data, confirmationItems })
    if (updatedItem && isDesktopRuntime()) {
      void persistConfirmationItem(updatedItem).catch(() => toast.error("事项已在界面更新，但写入本地数据库失败"))
    }
  }

  return (
    <div className="flex flex-col gap-6">
      <div>
        <p className="text-sm text-muted-foreground">{format(new Date(), "yyyy 年 M 月 d 日 EEEE", { locale: zhCN })}</p>
        <h1 className="mt-1 text-2xl font-semibold tracking-tight">今天需要你确定什么？</h1>
        <p className="mt-1 text-sm text-muted-foreground">优先处理到期事项，AI 建议不会直接修改正式计划。</p>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <MetricCard label="今日待确认" value={dueTodayCount} description="由确认日期确定" icon={CalendarCheckIcon} />
        <MetricCard label="已逾期" value={overdueCount} description="需要完成或重新排期" icon={BellIcon} />
        <MetricCard label="进行中项目" value={activeProjects.length} description="按最近更新时间排序" icon={FolderKanbanIcon} />
        <MetricCard label="待分析会议" value={data.meetings.filter((meeting) => meeting.status === "pending_analysis").length} description="发送模型前需要确认" icon={FileTextIcon} />
      </div>

      <Card>
        <CardHeader><CardTitle>跨模块待办</CardTitle><CardDescription>以下数字由已保存的风险、依赖、决策和发布记录确定性聚合；不会调用模型。</CardDescription></CardHeader>
        <CardContent className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          <div className="rounded-md border p-3"><p className="text-sm text-muted-foreground">开放风险</p><p className="mt-1 text-2xl font-semibold">{openRisks.length}</p><p className="text-xs text-muted-foreground">其中逾期 {openRisks.filter((item) => item.dueDate < today).length}</p></div>
          <div className="rounded-md border p-3"><p className="text-sm text-muted-foreground">阻塞依赖</p><p className="mt-1 text-2xl font-semibold">{blockedDependencies.length}</p><p className="text-xs text-muted-foreground">需负责人处理</p></div>
          <div className="rounded-md border p-3"><p className="text-sm text-muted-foreground">到期决策复查</p><p className="mt-1 text-2xl font-semibold">{dueDecisions.length}</p><p className="text-xs text-muted-foreground">今天及之前</p></div>
          <div className="rounded-md border p-3"><p className="text-sm text-muted-foreground">发布跟进</p><p className="mt-1 text-2xl font-semibold">{pendingReleases.length}</p><p className="text-xs text-muted-foreground">待发布或待复盘</p></div>
        </CardContent>
        <CardContent className="grid gap-3 border-t pt-3 sm:grid-cols-2"><DashboardDetails title="风险明细" items={openRisks.map((item) => ({ id: item.id, projectId: item.projectId, title: item.title }))} /><DashboardDetails title="依赖明细" items={blockedDependencies.map((item) => ({ id: item.id, projectId: item.projectId, title: item.title }))} /><DashboardDetails title="决策复查" items={dueDecisions.map((item) => ({ id: item.id, projectId: item.projectId, title: item.title }))} /><DashboardDetails title="发布跟进" items={pendingReleases.map((item) => ({ id: item.id, projectId: item.projectId, title: item.title }))} /></CardContent>
      </Card>

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1.55fr)_minmax(300px,0.75fr)]">
        <Card>
          <CardHeader>
            <CardTitle>今天必须确定</CardTitle>
            <CardDescription>{todayItems.length ? `共 ${todayItems.length} 项，按日期排序` : "今天没有到期事项"}</CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-3">
            {todayItems.map((item) => (
              <ConfirmationRow
                key={item.id}
                item={item}
                project={data.projects.find((project) => project.id === item.projectId)}
                onComplete={(id) => updateItem(id, (current) => completeItem(current))}
                onPostpone={(id) => {
                  const nextDate = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString().slice(0, 10)
                  updateItem(id, (current) => postponeItem(current, nextDate))
                  toast("已延期到明天")
                }}
              />
            ))}
          </CardContent>
        </Card>

        <div className="flex flex-col gap-4">
          <Card>
            <CardHeader>
              <CardTitle>下一个里程碑</CardTitle>
              <CardDescription>{nextMilestone ? format(parseISO(nextMilestone.dueDate), "M 月 d 日", { locale: zhCN }) : "尚未设置"}</CardDescription>
            </CardHeader>
            {nextMilestone ? (
              <CardContent className="flex flex-col gap-3">
                <p className="font-medium">{nextMilestone.title}</p>
                <Progress value={nextMilestone.progress} />
                <p className="text-xs text-muted-foreground">当前进度 {nextMilestone.progress}%</p>
              </CardContent>
            ) : null}
          </Card>
          <Card>
            <CardHeader>
              <CardTitle>计划工程师建议</CardTitle>
              <CardDescription>规则层先运行，AI 建议层尚未连接</CardDescription>
            </CardHeader>
            <CardContent>
              <Alert>
                <BotIcon />
                <AlertTitle>阶段二建议</AlertTitle>
                <AlertDescription>优先补齐通知调度和数据备份，再进入会议解析，降低桌面数据恢复风险。</AlertDescription>
              </Alert>
            </CardContent>
          </Card>
        </div>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>项目进度</CardTitle>
          <CardDescription>进行中的项目概览</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-3 lg:grid-cols-2">
          {activeProjects.map((project) => (
            <div key={project.id} className="flex flex-col gap-3 rounded-lg border p-4">
              <div className="flex items-start justify-between gap-3">
                <div><p className="font-medium">{project.name}</p><p className="mt-1 line-clamp-2 text-sm text-muted-foreground">{project.goal}</p></div>
                <Badge variant="secondary">进行中</Badge>
              </div>
              <Progress value={project.progress} />
              <div className="flex justify-between text-xs text-muted-foreground"><span>总体进度</span><span>{project.progress}%</span></div>
            </div>
          ))}
        </CardContent>
      </Card>
    </div>
  )
}

function ProjectsPage({ data, setData, desktopRuntime, selectedProjectId, focusedConfirmationId, onSelectProject, onCloseProject }: {
  data: WorkspaceData
  setData: (data: WorkspaceData) => void
  desktopRuntime: boolean
  selectedProjectId?: string
  focusedConfirmationId?: string
  onSelectProject: (projectId: string) => void
  onCloseProject: () => void
}) {
  const [visibility, setVisibility] = useState<ProjectVisibility>("active")
  const selectedProject = data.projects.find((project) => project.id === selectedProjectId)
  const visibleProjects = filterProjectsByVisibility(data.projects, visibility)

  function updateProject(project: Project) {
    setData({ ...data, projects: data.projects.map((item) => item.id === project.id ? project : item) })
    if (isDesktopRuntime()) void persistProject(project).catch(() => toast.error("项目已在界面更新，但写入本地数据库失败"))
  }

  function archiveProject() {
    if (!selectedProject || selectedProject.archivedAt) return
    const updatedAt = new Date().toISOString()
    updateProject({ ...selectedProject, archivedAt: updatedAt, updatedAt })
    toast.success("项目已归档，可在项目列表中只读查看")
  }

  function restoreProject() {
    if (!selectedProject || !selectedProject.archivedAt) return
    updateProject({ ...selectedProject, archivedAt: undefined, updatedAt: new Date().toISOString() })
    toast.success("项目已恢复，可继续编辑和安排工作")
  }

  function createProjectMilestone(milestone: Milestone) {
    setData({ ...data, milestones: [...data.milestones, milestone] })
    if (isDesktopRuntime()) void persistMilestone(milestone).catch(() => toast.error("里程碑已在界面创建，但写入本地数据库失败"))
  }

  function updateProjectMilestone(milestone: Milestone) {
    setData({ ...data, milestones: data.milestones.map((item) => item.id === milestone.id ? milestone : item) })
    if (isDesktopRuntime()) void persistMilestone(milestone).catch(() => toast.error("里程碑已在界面更新，但写入本地数据库失败"))
  }

  function removeProjectMilestone(id: string) {
    const confirmationItems = data.confirmationItems.map((item) => item.milestoneId === id ? { ...item, milestoneId: undefined } : item)
    setData({ ...data, milestones: data.milestones.filter((item) => item.id !== id), confirmationItems })
    if (isDesktopRuntime()) void deleteMilestone(id).catch(() => toast.error("里程碑已从界面移除，但本地数据库删除失败"))
    toast.success("里程碑已删除")
  }

  function updateProjectConfirmation(item: ConfirmationItem) {
    setData({ ...data, confirmationItems: data.confirmationItems.map((current) => current.id === item.id ? item : current) })
    if (isDesktopRuntime()) void persistConfirmationItem(item).catch(() => toast.error("事项已在界面更新，但写入本地数据库失败"))
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div><h1 className="text-2xl font-semibold tracking-tight">项目</h1><p className="mt-1 text-sm text-muted-foreground">管理目标、里程碑与确认事项。</p></div>
        <Select value={visibility} onValueChange={(value) => setVisibility((value ?? "active") as ProjectVisibility)}>
          <SelectTrigger className="w-full sm:w-40" aria-label="项目显示范围"><SelectValue /></SelectTrigger>
          <SelectContent><SelectGroup>
            <SelectItem value="active">未归档</SelectItem>
            <SelectItem value="archived">已归档</SelectItem>
            <SelectItem value="all">全部项目</SelectItem>
          </SelectGroup></SelectContent>
        </Select>
      </div>
      <div className="grid gap-4 lg:grid-cols-2">
        {visibleProjects.map((project) => (
          <Card key={project.id}>
            <CardHeader>
              <CardTitle>{project.name}</CardTitle>
              <CardDescription>{project.goal}</CardDescription>
              {(project.phase || project.owner) ? <div className="flex flex-wrap gap-2 pt-1 text-xs text-muted-foreground">
                {project.phase ? <Badge variant="outline">阶段：{project.phase}</Badge> : null}
                {project.owner ? <Badge variant="outline">负责人：{project.owner}</Badge> : null}
              </div> : null}
              {parseProjectList(project.successMetrics).length ? <div className="flex flex-wrap gap-2 pt-1">{parseProjectList(project.successMetrics).slice(0, 3).map((metric) => <Badge key={metric} variant="outline">指标：{metric}</Badge>)}</div> : null}
              <CardAction><Badge variant="secondary">{project.status === "active" ? "进行中" : project.status}</Badge></CardAction>
            </CardHeader>
            <CardContent className="flex flex-col gap-3">
              <Progress value={project.progress} />
              <div className="flex justify-between text-sm text-muted-foreground"><span>{project.startDate} — {project.endDate}</span><span>{project.progress}%</span></div>
            </CardContent>
            <CardFooter>
              <Button variant="ghost" size="sm" onClick={() => onSelectProject(project.id)}>打开项目<ChevronRightIcon data-icon="inline-end" /></Button>
            </CardFooter>
          </Card>
        ))}
        {!visibleProjects.length ? <Empty className="lg:col-span-2"><EmptyHeader><EmptyMedia variant="icon"><FolderKanbanIcon /></EmptyMedia><EmptyTitle>没有符合条件的项目</EmptyTitle><EmptyDescription>切换显示范围，或创建一个新项目。</EmptyDescription></EmptyHeader></Empty> : null}
      </div>
      <Suspense fallback={null}>
        <ProjectDetailSheet
          project={selectedProject}
          data={data}
          desktopRuntime={desktopRuntime}
          open={Boolean(selectedProject)}
          onOpenChange={(open) => { if (!open) onCloseProject() }}
          onUpdateProject={updateProject}
          onCreateMilestone={createProjectMilestone}
          onUpdateMilestone={updateProjectMilestone}
          onDeleteMilestone={removeProjectMilestone}
          onUpdateConfirmation={updateProjectConfirmation}
          onArchiveProject={archiveProject}
          onRestoreProject={restoreProject}
          focusedConfirmationId={focusedConfirmationId}
        />
      </Suspense>
    </div>
  )
}

export function App() {
  const [page, setPage] = useState<Page>("today")
  const [data, setData] = useState<WorkspaceData>(() => loadWorkspace())
  const [selectedProjectId, setSelectedProjectId] = useState<string | undefined>(() => projectIdFromLocation())
  const [focusedConfirmationId, setFocusedConfirmationId] = useState<string>()
  const [onboardingReopenToken, setOnboardingReopenToken] = useState(0)
  const desktopRuntime = isDesktopRuntime()
  const [desktopDataReady, setDesktopDataReady] = useState(!desktopRuntime)
  const unarchivedProjects = useMemo(() => data.projects.filter((project) => !project.archivedAt), [data.projects])
  const activeConfirmationItems = useMemo(() => confirmationItemsForActiveProjects(data.confirmationItems, data.projects), [data.confirmationItems, data.projects])

  useEffect(() => {
    const handleLocationChange = () => {
      const projectId = projectIdFromLocation()
      setSelectedProjectId(projectId)
      if (projectId) setPage("projects")
    }
    window.addEventListener("popstate", handleLocationChange)
    window.addEventListener("hashchange", handleLocationChange)
    if (selectedProjectId) setPage("projects")
    return () => {
      window.removeEventListener("popstate", handleLocationChange)
      window.removeEventListener("hashchange", handleLocationChange)
    }
  }, [selectedProjectId])

  function openConfirmationItem(confirmationItemId: string) {
    const item = data.confirmationItems.find((candidate) => candidate.id === confirmationItemId)
    if (!item) {
      toast.error("对应确认事项已不存在")
      return
    }
    setSelectedProjectId(item.projectId)
    setFocusedConfirmationId(item.id)
    setPage("projects")
    navigateToProject(item.projectId)
  }

  const notificationScheduler = useNotificationScheduler(
    activeConfirmationItems,
    desktopRuntime && desktopDataReady,
    openConfirmationItem,
  )

  useEffect(() => {
    if (!desktopRuntime) return
    void recoverInterruptedAgentRuns(true)
      .then((result) => {
        if (result.recoveredRuns > 0) toast.warning(`已标记 ${result.recoveredRuns} 个上次中断的 Agent 运行；为避免重复计费，未自动重试`)
      })
      .catch(() => toast.error("无法恢复上次中断的 Agent 运行记录"))
    void loadDesktopWorkspace()
      .then((workspace) => {
        setData(workspace)
        setDesktopDataReady(true)
      })
      .catch(() => toast.error("无法打开本地数据库，当前界面保留浏览器降级数据"))
  }, [desktopRuntime])

  useEffect(() => {
    if (!desktopRuntime) saveWorkspace(data)
  }, [data, desktopRuntime])

  const overdueCount = activeConfirmationItems.filter((item) => isOverdue(item)).length
  const updateData = (next: WorkspaceData) => setData(next)

  return (
    <TooltipProvider>
      <SidebarProvider>
        <AppSidebar page={page} setPage={setPage} overdueCount={overdueCount} />
        <SidebarInset>
          <header className="sticky top-0 flex h-14 items-center gap-3 border-b bg-background/95 px-4 backdrop-blur sm:px-6">
            <SidebarTrigger />
            <Separator orientation="vertical" className="h-4" />
            <div className="flex flex-1 items-center justify-end gap-2">
              <NewProjectDialog onCreate={(project) => {
                setData({ ...data, projects: [...data.projects, project] })
                if (desktopRuntime) void persistProject(project).catch(() => toast.error("项目已在界面创建，但写入本地数据库失败"))
              }} />
              <NewConfirmationDialog projects={unarchivedProjects} onCreate={(item) => {
                setData({ ...data, confirmationItems: [...data.confirmationItems, item] })
                if (desktopRuntime) void persistConfirmationItem(item).catch(() => toast.error("事项已在界面创建，但写入本地数据库失败"))
              }} />
            </div>
          </header>
          <div className="mx-auto w-full max-w-[1500px] p-4 sm:p-6 lg:p-8">
            {page === "today" ? <TodayDashboard data={data} setData={updateData} /> : null}
            {page === "projects" ? (
              <ProjectsPage
                data={data}
                setData={updateData}
                desktopRuntime={desktopRuntime}
                selectedProjectId={selectedProjectId}
                focusedConfirmationId={focusedConfirmationId}
                onSelectProject={(projectId) => {
                  setSelectedProjectId(projectId)
                  setFocusedConfirmationId(undefined)
                  navigateToProject(projectId)
                }}
                onCloseProject={() => {
                  setSelectedProjectId(undefined)
                  setFocusedConfirmationId(undefined)
                  navigateToProject(undefined, true)
                }}
              />
            ) : null}
            {page === "meetings" ? (
              <Suspense fallback={<PageFallback />}>
                <MeetingsPage
                  meetings={data.meetings}
                  projects={unarchivedProjects}
                  desktopRuntime={desktopRuntime}
                  onMeetingCreated={(meeting) => setData((current) => ({
                    ...current,
                    meetings: [meeting, ...current.meetings],
                  }))}
                  onMeetingDeleted={(meetingId) => setData((current) => ({
                    ...current,
                    meetings: current.meetings.filter((meeting) => meeting.id !== meetingId),
                  }))}
                  onMeetingUpdated={(meeting) => setData((current) => ({
                    ...current,
                    meetings: current.meetings.map((candidate) => candidate.id === meeting.id ? meeting : candidate),
                  }))}
                />
              </Suspense>
            ) : null}
            {page === "knowledge" ? (
              <Suspense fallback={<PageFallback />}>
                <KnowledgePage
                  projects={unarchivedProjects}
                  meetings={data.meetings}
                  desktopRuntime={desktopRuntime}
                />
              </Suspense>
            ) : null}
            {page === "notifications" ? (
              <Suspense fallback={<PageFallback />}>
                <NotificationsPage
                  records={notificationScheduler.records}
                  error={notificationScheduler.error}
                  desktopRuntime={desktopRuntime}
                  paused={notificationScheduler.paused}
                  onRefresh={() => { void notificationScheduler.runNow() }}
                  onOpenItem={openConfirmationItem}
                />
              </Suspense>
            ) : null}
            {page === "settings" ? (
              <Suspense fallback={<PageFallback />}>
                <SettingsPage
                  desktopRuntime={desktopRuntime}
                  reminderPaused={notificationScheduler.paused}
                  reminderTime={notificationScheduler.reminderTime}
                  onReminderPausedChange={notificationScheduler.setPaused}
                  onReminderTimeChange={notificationScheduler.setReminderTime}
                  onOpenOnboarding={() => setOnboardingReopenToken((current) => current + 1)}
                />
              </Suspense>
            ) : null}
          </div>
        </SidebarInset>
      </SidebarProvider>
      <Suspense fallback={null}>
        <OnboardingDialog
          desktopRuntime={desktopRuntime}
          reopenToken={onboardingReopenToken}
          onOpenSettings={() => setPage("settings")}
        />
      </Suspense>
      <Toaster position="bottom-right" />
    </TooltipProvider>
  )
}
