import { useEffect, useRef, useState } from "react";
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
import { loadProviderConfig } from "@/data/provider-settings";
import { buildResearchPlanReviewSources } from "@/domain/research-plan-review-agent";
import { releaseRecordToReviewSource } from "@/domain/release-review-agent";
import {
  buildAgentOrchestration,
  buildAgentOrchestrationTasks,
  type OrchestrationStage,
} from "@/domain/agent-orchestration";
import {
  runAgentOrchestration,
  type AgentOrchestrationStageResult,
} from "@/domain/agent-orchestration-runner";
import {
  listProjectMemories,
  listProjectMemoryConflicts,
  listProjectMemorySources,
} from "@/services/project-memory-service";
import { listResearchEntries } from "@/services/research-entry-service";
import { listResearchPlans } from "@/services/research-plan-service";
import { listProjectRisks } from "@/services/project-risk-service";
import { listCompetitorProfiles } from "@/services/competitor-profile-service";
import { listReleases } from "@/services/release-service";
import { listAgentDefinitions } from "@/services/agent-definition-service";
import {
  generateCompetitorReview,
  generateKnowledgeReview,
  generatePlanEngineer,
  generateReleaseReview,
  generateResearchInsights,
  generateResearchPlanReview,
  generateRiskReview,
} from "@/services/structured-generation-service";

type StageSummary = {
  runId: string;
  durationMs: number;
  findingCount: number;
  limitationCount: number;
};

function summarize(result: {
  runId: string;
  durationMs: number;
  output: unknown;
}): StageSummary {
  const output = result.output as { findings?: unknown; limitations?: unknown };
  return {
    runId: result.runId,
    durationMs: result.durationMs,
    findingCount: Array.isArray(output.findings) ? output.findings.length : 0,
    limitationCount: Array.isArray(output.limitations)
      ? output.limitations.length
      : 0,
  };
}

const labels: Record<string, string> = {
  "research-plan-review:v1": "研究计划审阅",
  "plan-engineer:v1": "计划工程师",
  "knowledge-review:v1": "知识管理审阅",
  "research-insight:v1": "研究洞察审阅",
  "risk-review:v1": "风险审阅",
  "competitor-review:v1": "竞品审阅",
  "release-review:v1": "发布复盘审阅",
};

export function ProjectAgentOrchestrationPanel({
  projectId,
  desktopRuntime,
  readOnly,
}: {
  projectId: string;
  desktopRuntime: boolean;
  readOnly: boolean;
}) {
  const [loading, setLoading] = useState(desktopRuntime);
  const [busy, setBusy] = useState(false);
  const [taskCount, setTaskCount] = useState(0);
  const [results, setResults] = useState<
    AgentOrchestrationStageResult<StageSummary>[]
  >([]);
  const [loaded, setLoaded] = useState(false);
  const [authorizationStages, setAuthorizationStages] = useState<
    OrchestrationStage[]
  >([]);
  const abortRef = useRef<AbortController | undefined>(undefined);

  async function buildTasks() {
    const [plans, entries, memories, risks, profiles, releases, definitions, provider] =
      await Promise.all([
        listResearchPlans(true, projectId),
        listResearchEntries(true, projectId),
        listProjectMemories(true, projectId, undefined, 50),
        listProjectRisks(true, projectId),
        listCompetitorProfiles(true, projectId),
        listReleases(true, projectId),
        listAgentDefinitions(true),
        loadProviderConfig(true),
      ]);
    const enrichedMemories = await Promise.all(
      memories.map(async (memory) => {
        const [sources, conflicts] = await Promise.all([
          listProjectMemorySources(true, projectId, memory.id),
          listProjectMemoryConflicts(true, projectId, memory.id),
        ]);
        return { ...memory, sources, conflicts };
      }),
    );
    const planSources = buildResearchPlanReviewSources(plans, entries);
    const candidateTasks = [
      planSources.length
        ? {
            agentDefinitionId: "research-plan-review:v1",
            execute: async () => {
              const result = await generateResearchPlanReview(
                projectId,
                planSources,
                provider,
                true,
              );
              return summarize(result);
            },
          }
        : null,
      planSources.length
        ? {
            agentDefinitionId: "plan-engineer:v1",
            execute: async () => {
              const result = await generatePlanEngineer(
                projectId,
                planSources,
                provider,
                true,
              );
              return summarize(result);
            },
          }
        : null,
      enrichedMemories.length
        ? {
            agentDefinitionId: "knowledge-review:v1",
            execute: async () => {
              const result = await generateKnowledgeReview(
                projectId,
                enrichedMemories,
                provider,
                true,
              );
              return summarize(result);
            },
          }
        : null,
      entries.length
        ? {
            agentDefinitionId: "research-insight:v1",
            execute: async () => {
              const result = await generateResearchInsights(
                projectId,
                entries.map((entry) => ({
                  entryId: entry.id,
                  title: entry.title,
                  insight: entry.insight,
                  sourceRef: entry.sourceRef,
                })),
                provider,
                true,
              );
              return summarize(result);
            },
          }
        : null,
      risks.length
        ? {
            agentDefinitionId: "risk-review:v1",
            execute: async () => {
              const result = await generateRiskReview(
                projectId,
                risks,
                provider,
                true,
              );
              return summarize(result);
            },
          }
        : null,
      profiles.length
        ? {
            agentDefinitionId: "competitor-review:v1",
            execute: async () => {
              const result = await generateCompetitorReview(
                projectId,
                profiles,
                provider,
                true,
              );
              return summarize(result);
            },
          }
        : null,
      releases.length
        ? {
            agentDefinitionId: "release-review:v1",
            execute: async () => {
              const result = await generateReleaseReview(
                projectId,
                releases.map(releaseRecordToReviewSource),
                provider,
                true,
              );
              return summarize(result);
            },
          }
        : null,
    ].filter((task): task is NonNullable<typeof task> => task !== null);
    const executors = Object.fromEntries(
      candidateTasks.map((task) => [task.agentDefinitionId, task.execute]),
    ) as Record<string, () => Promise<StageSummary>>;
    const stages = buildAgentOrchestration(definitions, {
      activeProjectId: projectId,
    });
    return {
      stages,
      tasks: buildAgentOrchestrationTasks(
        definitions,
        executors,
        projectId,
      ),
    };
  }

  useEffect(() => {
    if (!desktopRuntime) return;
    setLoading(true);
    setLoaded(false);
    setResults([]);
    setAuthorizationStages([]);
    void buildTasks()
      .then(({ tasks, stages }) => {
        setTaskCount(tasks.length);
        setAuthorizationStages(stages);
        setLoaded(true);
      })
      .catch((error) =>
        toast.error(
          error instanceof Error ? error.message : "无法准备 Agent 编排数据",
        ),
      )
      .finally(() => setLoading(false));
  }, [desktopRuntime, projectId]);

  async function run() {
    setBusy(true);
    const controller = new AbortController();
    abortRef.current = controller;
    try {
      const { tasks, stages } = await buildTasks();
      setTaskCount(tasks.length);
      setAuthorizationStages(stages);
      const result = await runAgentOrchestration(tasks, {
        signal: controller.signal,
      });
      setResults(result.stages);
      if (result.status === "cancelled")
        toast.success("编排已取消，未启动后续阶段");
      else if (result.status === "failed")
        toast.error("编排在某个阶段失败，后续阶段已停止");
      else toast.success("只读 Agent 编排已完成");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Agent 编排失败");
    } finally {
      abortRef.current = undefined;
      setBusy(false);
    }
  }

  function cancel() {
    abortRef.current?.abort();
  }

  const blockedStages = authorizationStages.filter(
    (stage) => stage.status === "blocked",
  );

  return (
    <Card>
      <CardHeader>
        <CardTitle>只读 Agent 编排</CardTitle>
        <CardDescription>
          按研究计划 → 计划工程师 → 知识 → 洞察 → 风险 → 竞品 →
          发布顺序运行当前项目的审阅 Agent；只生成建议，不修改业务数据。
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <Badge
            variant={
              results.length &&
              results.every((item) => item.status === "succeeded")
                ? "secondary"
                : "outline"
            }
          >
            {loading
              ? "准备数据中"
              : `可执行 ${taskCount} 个阶段${blockedStages.length ? ` · 权限阻断 ${blockedStages.length}` : ""}`}
          </Badge>
          <Button
            onClick={() => void run()}
            disabled={
              !desktopRuntime ||
              readOnly ||
              loading ||
              busy ||
              !loaded ||
              !taskCount
            }
          >
            {busy ? "编排运行中…" : "运行只读编排"}
          </Button>
          {busy ? (
            <Button variant="outline" onClick={cancel}>
              取消编排
            </Button>
          ) : null}
        </div>
        {blockedStages.length ? (
          <div className="rounded-md border border-destructive/40 bg-destructive/5 p-3 text-sm">
            <p className="font-medium">以下阶段未通过 Agent 定义权限门禁</p>
            <ul className="mt-1 list-inside list-disc text-xs text-muted-foreground">
              {blockedStages.map((stage) => (
                <li key={stage.agentDefinitionId}>
                  {stage.name}：{stage.reason}
                </li>
              ))}
            </ul>
          </div>
        ) : null}
        {!desktopRuntime ? (
          <p className="text-sm text-muted-foreground">
            浏览器预览不读取项目数据，也不会运行 Agent。
          </p>
        ) : null}
        {results.map((stage) => (
          <div
            key={stage.agentDefinitionId}
            className="flex flex-wrap items-center justify-between gap-2 rounded-md border p-2 text-sm"
          >
            <span>
              {labels[stage.agentDefinitionId] ?? stage.agentDefinitionId}
            </span>
            <div className="flex items-center gap-2">
              <Badge
                variant={
                  stage.status === "succeeded"
                    ? "secondary"
                    : stage.status === "failed"
                      ? "destructive"
                      : "outline"
                }
              >
                {stage.status === "succeeded"
                  ? "完成"
                  : stage.status === "failed"
                    ? "失败"
                    : "跳过"}
              </Badge>
              {stage.value ? (
                <span className="text-xs text-muted-foreground">
                  {stage.value.durationMs} ms · 发现 {stage.value.findingCount}{" "}
                  条 · 限制 {stage.value.limitationCount} 条
                </span>
              ) : null}
              {stage.error ? (
                <span className="text-xs text-destructive">{stage.error}</span>
              ) : null}
            </div>
          </div>
        ))}
      </CardContent>
    </Card>
  );
}
