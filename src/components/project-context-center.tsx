import { useCallback, useEffect, useState } from "react";
import {
  DownloadIcon,
  LocateFixedIcon,
  RefreshCwIcon,
  TriangleAlertIcon,
} from "lucide-react";
import { toast } from "sonner";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import type { ConfirmationItem, Milestone, Project } from "@/domain/models";
import {
  renderProjectContextMarkdown,
  type ProjectContextSection,
  type ProjectContextSectionKey,
  type ProjectContextSnapshot,
  type ProjectContextSource,
  type ProjectContextStatus,
} from "@/domain/project-context";
import { cn } from "@/lib/utils";
import { loadProjectContext } from "@/services/project-context-service";

const statusLabels: Record<ProjectContextStatus, string> = {
  available: "已有",
  stale: "过期",
  missing: "缺失",
};

function displayTime(value?: string) {
  if (!value) return "—";
  const timestamp = new Date(value);
  return Number.isNaN(timestamp.getTime())
    ? value
    : timestamp.toLocaleString("zh-CN", {
        dateStyle: "medium",
        timeStyle: "short",
      });
}

// 卡片级定位只指向固定模块，不按标题猜测，也不优先落到某条来源记录。
const sectionTargetIds: Record<ProjectContextSectionKey, string> = {
  goal: "project-settings",
  development: "project-settings",
  requirements: "project-documents",
  prd: "project-documents",
  technical_solution: "project-knowledge",
  testing: "project-releases",
  risks: "project-risks",
  decisions: "project-decisions",
};

function isInsideInteractive(target: EventTarget | null) {
  if (!(target instanceof HTMLElement)) return true;
  return Boolean(
    target.closest(
      'button, a, input, textarea, select, [contenteditable="true"]',
    ),
  );
}

function locateSection(item: ProjectContextSection) {
  const target = document.getElementById(sectionTargetIds[item.key]);
  if (!target) {
    toast.info("该模块尚未挂载，无法定位");
    return;
  }
  window.requestAnimationFrame(() =>
    target.scrollIntoView({ behavior: "smooth", block: "start" }),
  );
}

function downloadMarkdown(fileName: string, markdown: string) {
  const blob = new Blob([markdown], { type: "text/markdown;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = fileName;
  link.click();
  URL.revokeObjectURL(url);
}

export function ProjectContextCenter({
  project,
  milestones,
  confirmations,
  desktopRuntime,
}: {
  project: Project;
  milestones: Milestone[];
  confirmations: ConfirmationItem[];
  desktopRuntime: boolean;
}) {
  const [snapshot, setSnapshot] = useState<ProjectContextSnapshot>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();

  const refresh = useCallback(async () => {
    setBusy(true);
    setError(undefined);
    try {
      setSnapshot(
        await loadProjectContext({
          project,
          milestones,
          confirmations,
          desktopRuntime,
        }),
      );
    } catch (loadError) {
      const message =
        loadError instanceof Error ? loadError.message : "项目上下文加载失败";
      setError(message);
    } finally {
      setBusy(false);
    }
  }, [confirmations, desktopRuntime, milestones, project]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  function openSource(source: ProjectContextSource) {
    const exactTarget = document.getElementById(source.locator);
    const fallbackId: Partial<Record<ProjectContextSource["kind"], string>> = {
      project: "project-settings",
      requirement: "project-documents",
      product_document: "project-documents",
      knowledge_item: "project-knowledge",
      risk: "project-risks",
      decision: "project-decisions",
      release: "project-releases",
    };
    const target =
      exactTarget ?? document.getElementById(fallbackId[source.kind] ?? "");
    if (!target) {
      toast.info("该来源需要前往对应工作台查看");
      return;
    }
    if (exactTarget instanceof HTMLButtonElement) exactTarget.click();
    window.requestAnimationFrame(() =>
      target.scrollIntoView({ behavior: "smooth", block: "center" }),
    );
    if (!exactTarget)
      toast.info("已定位来源模块；当前记录需要在对应工作台中继续打开");
  }

  function exportMarkdown() {
    if (!snapshot) return;
    downloadMarkdown(
      `${project.name.replace(/[\\/:*?\"<>|]/g, "-")}-项目上下文.md`,
      renderProjectContextMarkdown(snapshot),
    );
    toast.success("项目上下文 Markdown 已导出");
  }

  return (
    <Card id="project-context-center">
      <CardHeader>
        <CardTitle>项目上下文中心</CardTitle>
        <CardDescription>
          八类正式上下文与缺口来自同一份可重建快照；候选材料不会冒充事实。
        </CardDescription>
        <CardAction className="flex items-center gap-2">
          <Button
            type="button"
            size="sm"
            variant="outline"
            onClick={() => void refresh()}
            disabled={busy}
            aria-label="刷新项目上下文"
          >
            <RefreshCwIcon
              data-icon="inline-start"
              className={cn(busy && "animate-spin")}
            />
            刷新
          </Button>
          <Button
            type="button"
            size="sm"
            onClick={exportMarkdown}
            disabled={!snapshot || busy}
          >
            <DownloadIcon data-icon="inline-start" />
            导出 Markdown
          </Button>
        </CardAction>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        {project.archivedAt ? (
          <Alert>
            <TriangleAlertIcon />
            <AlertTitle>归档项目只读</AlertTitle>
            <AlertDescription>
              可以查看和导出上下文，但不能通过本页修改正式来源。
            </AlertDescription>
          </Alert>
        ) : null}
        {!desktopRuntime ? (
          <Alert>
            <TriangleAlertIcon />
            <AlertTitle>浏览器上下文边界</AlertTitle>
            <AlertDescription>
              当前可读取浏览器项目、需求和项目知识；桌面 SQLite 中的
              PRD、风险、决策和发布不会自动同步到浏览器。
            </AlertDescription>
          </Alert>
        ) : null}
        {error ? (
          <Alert variant="destructive">
            <TriangleAlertIcon />
            <AlertTitle>上下文加载失败</AlertTitle>
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        ) : null}
        {snapshot ? (
          <>
            <div className="flex flex-wrap gap-2 text-xs">
              <Badge variant="secondary">
                已有 {snapshot.totals.available}
              </Badge>
              <Badge variant="outline">过期 {snapshot.totals.stale}</Badge>
              <Badge variant="destructive">
                缺失 {snapshot.totals.missing}
              </Badge>
              <span className="self-center text-muted-foreground">
                生成于 {displayTime(snapshot.generatedAt)} · 每类最多展开{" "}
                {snapshot.sourceLimitPerSection} 条来源
              </span>
            </div>
            <div className="grid gap-3 md:grid-cols-2">
              {snapshot.sections.map((item) => (
                <Card
                  key={item.key}
                  size="sm"
                  onClick={(event) => {
                    if (isInsideInteractive(event.target)) return;
                    locateSection(item);
                  }}
                >
                  <CardHeader>
                    <CardTitle>{item.label}</CardTitle>
                    <CardDescription>{item.summary}</CardDescription>
                    <CardAction className="flex flex-col items-end gap-2">
                      <Badge
                        variant={
                          item.status === "available"
                            ? "secondary"
                            : item.status === "missing"
                              ? "destructive"
                              : "outline"
                        }
                      >
                        {statusLabels[item.status]}
                      </Badge>
                      <Button
                        type="button"
                        size="xs"
                        variant="outline"
                        aria-label={`定位到${item.label}模块`}
                        onClick={(event) => {
                          event.stopPropagation();
                          locateSection(item);
                        }}
                      >
                        <LocateFixedIcon data-icon="inline-start" />
                        前往模块
                      </Button>
                    </CardAction>
                  </CardHeader>
                  <CardContent className="flex flex-col gap-2 text-xs">
                    <div className="flex flex-wrap gap-x-4 gap-y-1 text-muted-foreground">
                      <span>更新：{displayTime(item.updatedAt)}</span>
                      {item.owner ? <span>负责人：{item.owner}</span> : null}
                    </div>
                    {item.gap ? (
                      <p className="rounded-md border border-dashed p-2 text-muted-foreground">
                        缺口：{item.gap}
                      </p>
                    ) : null}
                    {item.sources.map((source) => (
                      <div
                        key={`${source.kind}:${source.id}`}
                        className="flex items-start justify-between gap-2 rounded-md border bg-background p-2"
                      >
                        <div className="min-w-0">
                          <p className="truncate font-medium">{source.title}</p>
                          <p className="truncate text-muted-foreground">
                            {source.kind} · v{source.version}
                          </p>
                        </div>
                        <Button
                          type="button"
                          size="xs"
                          variant="ghost"
                          onClick={() => openSource(source)}
                        >
                          打开来源
                        </Button>
                      </div>
                    ))}
                    {item.omittedSourceCount ? (
                      <p className="text-muted-foreground">
                        另有 {item.omittedSourceCount} 条正式来源未展开
                      </p>
                    ) : null}
                    {item.candidateSources.length ? (
                      <p className="font-medium text-muted-foreground">
                        候选材料（非正式事实）
                      </p>
                    ) : null}
                    {item.candidateSources.map((source) => (
                      <div
                        key={`candidate:${source.kind}:${source.id}`}
                        className="flex items-start justify-between gap-2 rounded-md border border-dashed p-2"
                      >
                        <div className="min-w-0">
                          <p className="truncate font-medium">{source.title}</p>
                          <p className="truncate text-muted-foreground">
                            {source.kind} · v{source.version}
                          </p>
                        </div>
                        <Button
                          type="button"
                          size="xs"
                          variant="ghost"
                          onClick={() => openSource(source)}
                        >
                          查看候选
                        </Button>
                      </div>
                    ))}
                  </CardContent>
                </Card>
              ))}
            </div>
          </>
        ) : busy ? (
          <p className="text-sm text-muted-foreground">
            正在构建受限项目上下文…
          </p>
        ) : null}
      </CardContent>
    </Card>
  );
}
