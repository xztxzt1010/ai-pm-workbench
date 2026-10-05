import { useEffect, useState, type FormEvent } from "react";
import {
  CalendarCheckIcon,
  PencilIcon,
  PlusIcon,
  Trash2Icon,
  XIcon,
} from "lucide-react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty";
import { Field, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Progress } from "@/components/ui/progress";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { Textarea } from "@/components/ui/textarea";
import { createMilestone } from "@/data/workspace-store";
import { ProjectMemoryPanel } from "@/components/project-memory-panel";
import { ProjectKnowledgeReviewPanel } from "@/components/project-knowledge-review-panel";
import { ProjectAgentOrchestrationPanel } from "@/components/project-agent-orchestration-panel";
import { ProjectQaPanel } from "@/components/project-qa-panel";
import { ProjectDocumentPanel } from "@/components/project-document-panel";
import { DesignBriefPanel } from "@/components/design-brief-panel";
import { ProjectDataAnalysisPanel } from "@/components/project-data-analysis-panel";
import { ProjectExperimentPanel } from "@/components/project-experiment-panel";
import { ProjectMetricPanel } from "@/components/project-metric-panel";
import { ProjectVocPanel } from "@/components/project-voc-panel";
import { ProjectDecisionPanel } from "@/components/project-decision-panel";
import { ProjectRiskPanel } from "@/components/project-risk-panel";
import { ProjectDependencyPanel } from "@/components/project-dependency-panel";
import { ProjectResearchPanel } from "@/components/project-research-panel";
import { ProjectResearchSearchPanel } from "@/components/project-research-search-panel";
import { ProjectCompetitorPanel } from "@/components/project-competitor-panel";
import { ProjectReleasePanel } from "@/components/project-release-panel";
import { ProjectResearchPlanPanel } from "@/components/project-research-plan-panel";
import { ProjectResearchInsightPanel } from "@/components/project-research-insight-panel";
import { ProjectContextCenter } from "@/components/project-context-center";
import type {
  ConfirmationItem,
  ConfirmationStatus,
  Milestone,
  Priority,
  Project,
  ProjectStatus,
  WorkspaceData,
} from "@/domain/models";
import { cn } from "@/lib/utils";
import { validateProjectDraft } from "@/domain/project-rules";
import { parseProjectList, serializeProjectList } from "@/domain/project-rules";

const projectStatusLabels: Record<ProjectStatus, string> = {
  planning: "规划中",
  active: "进行中",
  paused: "已暂停",
  completed: "已完成",
};

const confirmationStatusLabels: Record<ConfirmationStatus, string> = {
  pending: "待确认",
  confirmed: "已完成",
  postponed: "已延期",
  cancelled: "已取消",
};

type ProjectDetailSheetProps = {
  project?: Project;
  data: WorkspaceData;
  desktopRuntime: boolean;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onUpdateProject: (project: Project) => void;
  onCreateMilestone: (milestone: Milestone) => void;
  onUpdateMilestone: (milestone: Milestone) => void;
  onDeleteMilestone: (id: string) => void;
  onUpdateConfirmation: (item: ConfirmationItem) => void;
  onArchiveProject: () => void;
  onRestoreProject: () => void;
  focusedConfirmationId?: string;
};

export const PROJECT_WORKSPACE_SHEET_CLASS_NAME =
  "data-[side=right]:w-full data-[side=right]:sm:max-w-2xl data-[side=right]:lg:max-w-4xl";

function ProjectForm({
  project,
  onSave,
}: {
  project: Project;
  onSave: (project: Project) => void;
}) {
  const [status, setStatus] = useState<ProjectStatus>(project.status);
  const [metadataLists, setMetadataLists] = useState({
    successMetrics: project.successMetrics ?? "",
    roles: project.roles ?? "",
    constraints: project.constraints ?? "",
  });

  useEffect(() => {
    setStatus(project.status);
    setMetadataLists({
      successMetrics: project.successMetrics ?? "",
      roles: project.roles ?? "",
      constraints: project.constraints ?? "",
    });
  }, [
    project.id,
    project.status,
    project.successMetrics,
    project.roles,
    project.constraints,
  ]);

  function removeMetadataItem(field: keyof typeof metadataLists, item: string) {
    setMetadataLists((current) => ({
      ...current,
      [field]: parseProjectList(current[field])
        .filter((candidate) => candidate !== item)
        .join("\n"),
    }));
  }

  function MetadataEditor({
    field,
    label,
    placeholder,
  }: {
    field: keyof typeof metadataLists;
    label: string;
    placeholder: string;
  }) {
    const items = parseProjectList(metadataLists[field]);
    return (
      <Field>
        <FieldLabel htmlFor={`project-${field}-${project.id}`}>
          {label}
        </FieldLabel>
        <Textarea
          id={`project-${field}-${project.id}`}
          name={field}
          value={metadataLists[field]}
          onChange={(event) =>
            setMetadataLists((current) => ({
              ...current,
              [field]: event.target.value,
            }))
          }
          placeholder={placeholder}
          disabled={Boolean(project.archivedAt)}
        />
        {items.length ? (
          <div className="flex flex-wrap gap-2">
            {items.map((item) => (
              <Button
                key={item}
                type="button"
                variant="outline"
                size="sm"
                disabled={Boolean(project.archivedAt)}
                onClick={() => removeMetadataItem(field, item)}
              >
                {item}
                <XIcon data-icon="inline-end" />
              </Button>
            ))}
          </div>
        ) : null}
      </Field>
    );
  }

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const values = new FormData(event.currentTarget);
    const startDate = String(values.get("startDate"));
    const endDate = String(values.get("endDate"));
    const validation = validateProjectDraft({
      name: String(values.get("name") ?? ""),
      goal: String(values.get("goal") ?? ""),
      startDate,
      endDate,
      progress: Number(values.get("progress")),
    });
    if (!validation.valid) {
      toast.error(validation.message);
      return;
    }
    if (endDate < startDate) {
      toast.error("结束日期不能早于开始日期");
      return;
    }
    onSave({
      ...project,
      name: String(values.get("name")).trim(),
      goal: String(values.get("goal")).trim(),
      startDate,
      endDate,
      progress: Number(values.get("progress")),
      status,
      updatedAt: new Date().toISOString(),
      background: String(values.get("background") ?? "").trim(),
      phase: String(values.get("phase") ?? "").trim(),
      targetUsers: String(values.get("targetUsers") ?? "").trim(),
      coreProblem: String(values.get("coreProblem") ?? "").trim(),
      successMetrics: serializeProjectList([
        String(values.get("successMetrics") ?? ""),
      ]),
      constraints: serializeProjectList([
        String(values.get("constraints") ?? ""),
      ]),
      owner: String(values.get("owner") ?? "").trim(),
      roles: serializeProjectList([String(values.get("roles") ?? "")]),
    });
    toast.success("项目已更新");
  }

  return (
    <form className="flex flex-col gap-4" onSubmit={submit}>
      <FieldGroup>
        <Field>
          <FieldLabel htmlFor={`project-name-${project.id}`}>
            项目名称
          </FieldLabel>
          <Input
            id={`project-name-${project.id}`}
            name="name"
            defaultValue={project.name}
            required
            disabled={Boolean(project.archivedAt)}
          />
        </Field>
        <Field>
          <FieldLabel htmlFor={`project-goal-${project.id}`}>
            项目目标
          </FieldLabel>
          <Textarea
            id={`project-goal-${project.id}`}
            name="goal"
            defaultValue={project.goal}
            required
            disabled={Boolean(project.archivedAt)}
          />
        </Field>
        <Field>
          <FieldLabel htmlFor={`project-background-${project.id}`}>
            项目背景
          </FieldLabel>
          <Textarea
            id={`project-background-${project.id}`}
            name="background"
            defaultValue={project.background}
            placeholder="记录为什么做、已有上下文和关键来源"
            disabled={Boolean(project.archivedAt)}
          />
        </Field>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field>
            <FieldLabel htmlFor={`project-phase-${project.id}`}>
              当前阶段
            </FieldLabel>
            <Input
              id={`project-phase-${project.id}`}
              name="phase"
              defaultValue={project.phase}
              placeholder="例如：验证、设计、开发"
              disabled={Boolean(project.archivedAt)}
            />
          </Field>
          <Field>
            <FieldLabel htmlFor={`project-target-users-${project.id}`}>
              目标用户
            </FieldLabel>
            <Input
              id={`project-target-users-${project.id}`}
              name="targetUsers"
              defaultValue={project.targetUsers}
              placeholder="用户群体或角色"
              disabled={Boolean(project.archivedAt)}
            />
          </Field>
        </div>
        <Field>
          <FieldLabel htmlFor={`project-core-problem-${project.id}`}>
            核心问题
          </FieldLabel>
          <Textarea
            id={`project-core-problem-${project.id}`}
            name="coreProblem"
            defaultValue={project.coreProblem}
            placeholder="用户现在遇到的关键问题"
            disabled={Boolean(project.archivedAt)}
          />
        </Field>
        <MetadataEditor
          field="successMetrics"
          label="成功指标"
          placeholder="每行一个指标，可用逗号分隔"
        />
        <div className="grid gap-4 sm:grid-cols-2">
          <Field>
            <FieldLabel htmlFor={`project-owner-${project.id}`}>
              负责人
            </FieldLabel>
            <Input
              id={`project-owner-${project.id}`}
              name="owner"
              defaultValue={project.owner}
              placeholder="姓名或团队"
              disabled={Boolean(project.archivedAt)}
            />
          </Field>
          <MetadataEditor
            field="roles"
            label="角色与协作者"
            placeholder="每行一个角色，可用逗号分隔"
          />
        </div>
        <MetadataEditor
          field="constraints"
          label="约束与风险"
          placeholder="每行一项约束，可用逗号分隔"
        />
        <div className="grid gap-4 sm:grid-cols-2">
          <Field>
            <FieldLabel htmlFor={`project-start-${project.id}`}>
              开始日期
            </FieldLabel>
            <Input
              id={`project-start-${project.id}`}
              name="startDate"
              type="date"
              defaultValue={project.startDate}
              required
              disabled={Boolean(project.archivedAt)}
            />
          </Field>
          <Field>
            <FieldLabel htmlFor={`project-end-${project.id}`}>
              结束日期
            </FieldLabel>
            <Input
              id={`project-end-${project.id}`}
              name="endDate"
              type="date"
              defaultValue={project.endDate}
              required
              disabled={Boolean(project.archivedAt)}
            />
          </Field>
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field>
            <FieldLabel>状态</FieldLabel>
            <Select
              value={status}
              onValueChange={(value) =>
                setStatus((value ?? "active") as ProjectStatus)
              }
              disabled={Boolean(project.archivedAt)}
            >
              <SelectTrigger className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectGroup>
                  {Object.entries(projectStatusLabels).map(([value, label]) => (
                    <SelectItem key={value} value={value}>
                      {label}
                    </SelectItem>
                  ))}
                </SelectGroup>
              </SelectContent>
            </Select>
          </Field>
          <Field>
            <FieldLabel htmlFor={`project-progress-${project.id}`}>
              总体进度（%）
            </FieldLabel>
            <Input
              id={`project-progress-${project.id}`}
              name="progress"
              type="number"
              min="0"
              max="100"
              defaultValue={project.progress}
              required
              disabled={Boolean(project.archivedAt)}
            />
          </Field>
        </div>
      </FieldGroup>
      {!project.archivedAt ? (
        <div className="flex justify-end">
          <Button type="submit">保存项目</Button>
        </div>
      ) : (
        <p className="text-sm text-muted-foreground">
          该项目已归档，只读查看。
        </p>
      )}
    </form>
  );
}

function MilestoneDialog({
  projectId,
  milestone,
  onSave,
}: {
  projectId: string;
  milestone?: Milestone;
  onSave: (milestone: Milestone) => void;
}) {
  const [open, setOpen] = useState(false);

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const values = new FormData(event.currentTarget);
    const next = milestone
      ? {
          ...milestone,
          title: String(values.get("title")).trim(),
          dueDate: String(values.get("dueDate")),
          progress: Number(values.get("progress")),
        }
      : createMilestone({
          projectId,
          title: String(values.get("title")).trim(),
          dueDate: String(values.get("dueDate")),
          progress: Number(values.get("progress")),
        });
    onSave(next);
    setOpen(false);
    toast.success(milestone ? "里程碑已更新" : "里程碑已创建");
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger
        render={<Button variant={milestone ? "ghost" : "outline"} size="sm" />}
      >
        {milestone ? (
          <PencilIcon data-icon="inline-start" />
        ) : (
          <PlusIcon data-icon="inline-start" />
        )}
        {milestone ? "编辑" : "添加里程碑"}
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <form className="flex flex-col gap-4" onSubmit={submit}>
          <DialogHeader>
            <DialogTitle>{milestone ? "编辑里程碑" : "添加里程碑"}</DialogTitle>
            <DialogDescription>
              里程碑用于标记项目中的关键交付节点。
            </DialogDescription>
          </DialogHeader>
          <FieldGroup>
            <Field>
              <FieldLabel htmlFor={`milestone-title-${milestone?.id ?? "new"}`}>
                标题
              </FieldLabel>
              <Input
                id={`milestone-title-${milestone?.id ?? "new"}`}
                name="title"
                defaultValue={milestone?.title}
                required
                autoFocus
              />
            </Field>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field>
                <FieldLabel
                  htmlFor={`milestone-date-${milestone?.id ?? "new"}`}
                >
                  截止日期
                </FieldLabel>
                <Input
                  id={`milestone-date-${milestone?.id ?? "new"}`}
                  name="dueDate"
                  type="date"
                  defaultValue={milestone?.dueDate}
                  required
                />
              </Field>
              <Field>
                <FieldLabel
                  htmlFor={`milestone-progress-${milestone?.id ?? "new"}`}
                >
                  进度（%）
                </FieldLabel>
                <Input
                  id={`milestone-progress-${milestone?.id ?? "new"}`}
                  name="progress"
                  type="number"
                  min="0"
                  max="100"
                  defaultValue={milestone?.progress ?? 0}
                  required
                />
              </Field>
            </div>
          </FieldGroup>
          <DialogFooter>
            <Button type="submit">保存里程碑</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function ConfirmationDialog({
  item,
  milestones,
  onSave,
}: {
  item: ConfirmationItem;
  milestones: Milestone[];
  onSave: (item: ConfirmationItem) => void;
}) {
  const [open, setOpen] = useState(false);
  const [status, setStatus] = useState<ConfirmationStatus>(item.status);
  const [priority, setPriority] = useState<Priority>(item.priority);
  const [milestoneId, setMilestoneId] = useState(item.milestoneId ?? "none");

  useEffect(() => {
    setStatus(item.status);
    setPriority(item.priority);
    setMilestoneId(item.milestoneId ?? "none");
  }, [item]);

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const values = new FormData(event.currentTarget);
    onSave({
      ...item,
      title: String(values.get("title")).trim(),
      dueDate: String(values.get("dueDate")),
      dueTime: String(values.get("dueTime")) || undefined,
      conclusion: String(values.get("conclusion")).trim() || undefined,
      notes: String(values.get("notes")).trim() || undefined,
      milestoneId: milestoneId === "none" ? undefined : milestoneId,
      priority,
      status,
      updatedAt: new Date().toISOString(),
    });
    setOpen(false);
    toast.success("确认事项已更新");
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger render={<Button variant="ghost" size="sm" />}>
        <PencilIcon data-icon="inline-start" />
        编辑
      </DialogTrigger>
      <DialogContent className="sm:max-w-lg">
        <form className="flex flex-col gap-4" onSubmit={submit}>
          <DialogHeader>
            <DialogTitle>编辑确认事项</DialogTitle>
            <DialogDescription>
              结论和备注只由你确认后保存，不由 AI 自动修改。
            </DialogDescription>
          </DialogHeader>
          <FieldGroup>
            <Field>
              <FieldLabel htmlFor={`confirmation-title-${item.id}`}>
                标题
              </FieldLabel>
              <Input
                id={`confirmation-title-${item.id}`}
                name="title"
                defaultValue={item.title}
                required
              />
            </Field>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field>
                <FieldLabel htmlFor={`confirmation-date-${item.id}`}>
                  日期
                </FieldLabel>
                <Input
                  id={`confirmation-date-${item.id}`}
                  name="dueDate"
                  type="date"
                  defaultValue={item.dueDate}
                  required
                />
              </Field>
              <Field>
                <FieldLabel htmlFor={`confirmation-time-${item.id}`}>
                  时间（可选）
                </FieldLabel>
                <Input
                  id={`confirmation-time-${item.id}`}
                  name="dueTime"
                  type="time"
                  defaultValue={item.dueTime}
                />
              </Field>
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field>
                <FieldLabel>状态</FieldLabel>
                <Select
                  value={status}
                  onValueChange={(value) =>
                    setStatus((value ?? "pending") as ConfirmationStatus)
                  }
                >
                  <SelectTrigger className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectGroup>
                      {Object.entries(confirmationStatusLabels).map(
                        ([value, label]) => (
                          <SelectItem key={value} value={value}>
                            {label}
                          </SelectItem>
                        ),
                      )}
                    </SelectGroup>
                  </SelectContent>
                </Select>
              </Field>
              <Field>
                <FieldLabel>优先级</FieldLabel>
                <Select
                  value={priority}
                  onValueChange={(value) =>
                    setPriority((value ?? "medium") as Priority)
                  }
                >
                  <SelectTrigger className="w-full">
                    <SelectValue />
                  </SelectTrigger>
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
            <Field>
              <FieldLabel>关联里程碑</FieldLabel>
              <Select
                value={milestoneId}
                onValueChange={(value) => setMilestoneId(value ?? "none")}
              >
                <SelectTrigger className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectGroup>
                    <SelectItem value="none">不关联里程碑</SelectItem>
                    {milestones.map((milestone) => (
                      <SelectItem key={milestone.id} value={milestone.id}>
                        {milestone.title}
                      </SelectItem>
                    ))}
                  </SelectGroup>
                </SelectContent>
              </Select>
            </Field>
            <Field>
              <FieldLabel htmlFor={`confirmation-conclusion-${item.id}`}>
                确认结论
              </FieldLabel>
              <Textarea
                id={`confirmation-conclusion-${item.id}`}
                name="conclusion"
                defaultValue={item.conclusion}
                placeholder="记录最终决定或验收结论"
              />
            </Field>
            <Field>
              <FieldLabel htmlFor={`confirmation-notes-${item.id}`}>
                备注
              </FieldLabel>
              <Textarea
                id={`confirmation-notes-${item.id}`}
                name="notes"
                defaultValue={item.notes}
                placeholder="补充背景、风险或后续动作"
              />
            </Field>
          </FieldGroup>
          <DialogFooter>
            <Button type="submit">保存事项</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export function ProjectDetailSheet({
  project,
  data,
  desktopRuntime,
  open,
  onOpenChange,
  onUpdateProject,
  onCreateMilestone,
  onUpdateMilestone,
  onDeleteMilestone,
  onUpdateConfirmation,
  onArchiveProject,
  onRestoreProject,
  focusedConfirmationId,
}: ProjectDetailSheetProps) {
  useEffect(() => {
    if (!open || !focusedConfirmationId) return;
    const frame = window.requestAnimationFrame(() => {
      document
        .getElementById(`confirmation-${focusedConfirmationId}`)
        ?.scrollIntoView({ behavior: "smooth", block: "center" });
    });
    return () => window.cancelAnimationFrame(frame);
  }, [focusedConfirmationId, open]);

  if (!project) return null;
  const milestones = data.milestones.filter(
    (item) => item.projectId === project.id,
  );
  const confirmations = data.confirmationItems.filter(
    (item) => item.projectId === project.id,
  );

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className={PROJECT_WORKSPACE_SHEET_CLASS_NAME}>
        <SheetHeader>
          <SheetTitle>{project.name}</SheetTitle>
          <SheetDescription>
            维护项目边界、关键里程碑和需要人工确定的事项。
          </SheetDescription>
        </SheetHeader>
        <ScrollArea className="min-h-0 flex-1 px-4 pb-6">
          <div className="flex flex-col gap-5">
            <ProjectContextCenter
              project={project}
              milestones={milestones}
              confirmations={confirmations}
              desktopRuntime={desktopRuntime}
            />

            <Card id="project-settings">
              <CardHeader>
                <CardTitle>项目设置</CardTitle>
                <CardDescription>修改后会立即写入本地工作区。</CardDescription>
              </CardHeader>
              <CardContent>
                <ProjectForm
                  key={project.id}
                  project={project}
                  onSave={onUpdateProject}
                />
                <Separator className="my-4" />
                <div className="flex justify-end">
                  <Button
                    type="button"
                    variant="outline"
                    onClick={
                      project.archivedAt ? onRestoreProject : onArchiveProject
                    }
                  >
                    {project.archivedAt ? "恢复项目" : "归档项目"}
                  </Button>
                </div>
              </CardContent>
            </Card>

            {parseProjectList(project.successMetrics).length ||
            parseProjectList(project.roles).length ||
            parseProjectList(project.constraints).length ? (
              <Card>
                <CardHeader>
                  <CardTitle>结构化摘要</CardTitle>
                  <CardDescription>
                    多行字段会按条目清洗、去重并展示。
                  </CardDescription>
                </CardHeader>
                <CardContent className="flex flex-col gap-3">
                  {parseProjectList(project.successMetrics).length ? (
                    <div>
                      <p className="mb-2 text-sm font-medium">成功指标</p>
                      <div className="flex flex-wrap gap-2">
                        {parseProjectList(project.successMetrics).map(
                          (item) => (
                            <Badge key={item} variant="secondary">
                              {item}
                            </Badge>
                          ),
                        )}
                      </div>
                    </div>
                  ) : null}
                  {parseProjectList(project.roles).length ? (
                    <div>
                      <p className="mb-2 text-sm font-medium">角色与协作者</p>
                      <div className="flex flex-wrap gap-2">
                        {parseProjectList(project.roles).map((item) => (
                          <Badge key={item} variant="outline">
                            {item}
                          </Badge>
                        ))}
                      </div>
                    </div>
                  ) : null}
                  {parseProjectList(project.constraints).length ? (
                    <div>
                      <p className="mb-2 text-sm font-medium">约束与风险</p>
                      <div className="flex flex-wrap gap-2">
                        {parseProjectList(project.constraints).map((item) => (
                          <Badge key={item} variant="outline">
                            {item}
                          </Badge>
                        ))}
                      </div>
                    </div>
                  ) : null}
                </CardContent>
              </Card>
            ) : null}

            <ProjectMemoryPanel
              projectId={project.id}
              desktopRuntime={desktopRuntime}
              readOnly={Boolean(project.archivedAt)}
            />
            <div id="project-knowledge">
              <ProjectKnowledgeReviewPanel
                projectId={project.id}
                desktopRuntime={desktopRuntime}
                readOnly={Boolean(project.archivedAt)}
              />
            </div>
            <ProjectAgentOrchestrationPanel
              projectId={project.id}
              desktopRuntime={desktopRuntime}
              readOnly={Boolean(project.archivedAt)}
            />
            <ProjectQaPanel
              projectId={project.id}
              desktopRuntime={desktopRuntime}
              readOnly={Boolean(project.archivedAt)}
              businessContext={{
                project: {
                  id: project.id,
                  name: project.name,
                  goal: project.goal,
                  status: project.status,
                  startDate: project.startDate,
                  endDate: project.endDate,
                  progress: project.progress,
                  background: project.background,
                  phase: project.phase,
                  targetUsers: project.targetUsers,
                  coreProblem: project.coreProblem,
                  successMetrics: project.successMetrics,
                  constraints: project.constraints,
                  owner: project.owner,
                },
                milestones: milestones.map(
                  ({ id, title, dueDate, progress }) => ({
                    id,
                    title,
                    dueDate,
                    progress,
                  }),
                ),
                confirmations: confirmations.map(
                  ({ id, title, dueDate, status, conclusion }) => ({
                    id,
                    title,
                    dueDate,
                    status,
                    conclusion,
                  }),
                ),
              }}
            />
            <div id="project-documents">
              <ProjectDocumentPanel
                projectId={project.id}
                desktopRuntime={desktopRuntime}
                readOnly={Boolean(project.archivedAt)}
              />
            </div>
            <DesignBriefPanel
              projectId={project.id}
              desktopRuntime={desktopRuntime}
              readOnly={Boolean(project.archivedAt)}
            />
            <ProjectDataAnalysisPanel
              projectId={project.id}
              desktopRuntime={desktopRuntime}
              readOnly={Boolean(project.archivedAt)}
            />
            <ProjectExperimentPanel
              projectId={project.id}
              desktopRuntime={desktopRuntime}
              readOnly={Boolean(project.archivedAt)}
            />
            <ProjectMetricPanel
              projectId={project.id}
              desktopRuntime={desktopRuntime}
              readOnly={Boolean(project.archivedAt)}
            />
            <ProjectVocPanel
              projectId={project.id}
              desktopRuntime={desktopRuntime}
              readOnly={Boolean(project.archivedAt)}
            />
            <div id="project-decisions">
              <ProjectDecisionPanel
                projectId={project.id}
                desktopRuntime={desktopRuntime}
                readOnly={Boolean(project.archivedAt)}
              />
            </div>
            <div id="project-risks">
              <ProjectRiskPanel
                projectId={project.id}
                desktopRuntime={desktopRuntime}
                readOnly={Boolean(project.archivedAt)}
              />
            </div>
            <ProjectDependencyPanel
              projectId={project.id}
              desktopRuntime={desktopRuntime}
              readOnly={Boolean(project.archivedAt)}
            />
            <ProjectResearchPanel
              projectId={project.id}
              desktopRuntime={desktopRuntime}
              readOnly={Boolean(project.archivedAt)}
            />
            <ProjectResearchSearchPanel
              desktopRuntime={desktopRuntime}
              readOnly={Boolean(project.archivedAt)}
            />
            <ProjectCompetitorPanel
              projectId={project.id}
              desktopRuntime={desktopRuntime}
              readOnly={Boolean(project.archivedAt)}
            />
            <div id="project-releases">
              <ProjectReleasePanel
                projectId={project.id}
                desktopRuntime={desktopRuntime}
                readOnly={Boolean(project.archivedAt)}
              />
            </div>
            <ProjectResearchPlanPanel
              projectId={project.id}
              desktopRuntime={desktopRuntime}
              readOnly={Boolean(project.archivedAt)}
            />
            <ProjectResearchInsightPanel
              projectId={project.id}
              meetings={data.meetings.filter(
                (meeting) => meeting.projectId === project.id,
              )}
              desktopRuntime={desktopRuntime}
              readOnly={Boolean(project.archivedAt)}
            />

            <Card>
              <CardHeader>
                <CardTitle>里程碑</CardTitle>
                <CardDescription>
                  共 {milestones.length} 个关键节点
                </CardDescription>
              </CardHeader>
              <CardContent className="flex flex-col gap-3">
                {!project.archivedAt ? (
                  <MilestoneDialog
                    projectId={project.id}
                    onSave={onCreateMilestone}
                  />
                ) : null}
                {milestones.map((milestone) => (
                  <div
                    key={milestone.id}
                    className="flex flex-col gap-3 rounded-lg border p-3"
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <p className="font-medium">{milestone.title}</p>
                        <p className="text-sm text-muted-foreground">
                          截止 {milestone.dueDate}
                        </p>
                      </div>
                      <Badge variant="secondary">{milestone.progress}%</Badge>
                    </div>
                    <Progress value={milestone.progress} />
                    {!project.archivedAt ? (
                      <div className="flex justify-end gap-2">
                        <MilestoneDialog
                          projectId={project.id}
                          milestone={milestone}
                          onSave={onUpdateMilestone}
                        />
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => onDeleteMilestone(milestone.id)}
                        >
                          <Trash2Icon data-icon="inline-start" />
                          删除
                        </Button>
                      </div>
                    ) : null}
                  </div>
                ))}
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>确认事项</CardTitle>
                <CardDescription>
                  共 {confirmations.length} 项，结论由人工确认后保存
                </CardDescription>
              </CardHeader>
              <CardContent className="flex flex-col gap-3">
                {confirmations.length ? (
                  confirmations.map((item) => (
                    <div
                      id={`confirmation-${item.id}`}
                      key={item.id}
                      className={cn(
                        "flex flex-col gap-3 rounded-lg border p-3",
                        focusedConfirmationId === item.id && "ring-2 ring-ring",
                      )}
                    >
                      <div className="flex flex-wrap items-center gap-2">
                        <p className="flex-1 font-medium">{item.title}</p>
                        <Badge variant="secondary">
                          {confirmationStatusLabels[item.status]}
                        </Badge>
                      </div>
                      <p className="text-sm text-muted-foreground">
                        {item.dueDate}
                        {item.dueTime ? ` ${item.dueTime}` : ""}
                      </p>
                      {item.conclusion ? (
                        <>
                          <Separator />
                          <p className="text-sm">
                            <span className="font-medium">结论：</span>
                            {item.conclusion}
                          </p>
                        </>
                      ) : null}
                      {item.notes ? (
                        <p className="text-sm text-muted-foreground">
                          {item.notes}
                        </p>
                      ) : null}
                      {!project.archivedAt ? (
                        <div className="flex justify-end">
                          <ConfirmationDialog
                            item={item}
                            milestones={milestones}
                            onSave={onUpdateConfirmation}
                          />
                        </div>
                      ) : null}
                    </div>
                  ))
                ) : (
                  <Empty>
                    <EmptyHeader>
                      <EmptyMedia variant="icon">
                        <CalendarCheckIcon />
                      </EmptyMedia>
                      <EmptyTitle>暂无确认事项</EmptyTitle>
                      <EmptyDescription>
                        可从顶部快捷操作添加，并关联到当前项目。
                      </EmptyDescription>
                    </EmptyHeader>
                  </Empty>
                )}
              </CardContent>
            </Card>
          </div>
        </ScrollArea>
      </SheetContent>
    </Sheet>
  );
}
