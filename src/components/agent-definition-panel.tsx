import { useEffect, useState } from "react";
import {
  BrainCircuitIcon,
  LockKeyholeIcon,
  ShieldCheckIcon,
  WrenchIcon,
} from "lucide-react";
import { toast } from "sonner";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import {
  listAgentDefinitions,
  type AgentDefinition,
} from "@/services/agent-definition-service";
import {
  buildAgentOrchestration,
  type OrchestrationStage,
} from "@/domain/agent-orchestration";

function scopeLabel(scope: unknown) {
  if (scope === "none") return "无业务数据";
  if (scope === "current_project_meeting") return "当前项目会议";
  if (scope === "current_project") return "当前项目";
  if (scope === "current_project_open_risks") return "当前项目开放风险";
  if (scope === "current_project_releases") return "当前项目发布记录";
  if (scope === "current_project_competitor_profiles")
    return "当前项目竞品档案";
  if (scope === "current_project_research_plans") return "当前项目研究计划";
  return typeof scope === "string" && scope ? scope : "未声明";
}

export function AgentDefinitionPanel({
  desktopRuntime,
}: {
  desktopRuntime: boolean;
}) {
  const [definitions, setDefinitions] = useState<AgentDefinition[]>([]);
  const [orchestration, setOrchestration] = useState<OrchestrationStage[]>([]);

  useEffect(() => {
    if (!desktopRuntime) return;
    void listAgentDefinitions(true)
      .then(setDefinitions)
      .catch(() => toast.error("无法读取 Agent 定义目录"));
  }, [desktopRuntime]);

  return (
    <Card>
      <CardHeader>
        <CardTitle>Agent 定义中心</CardTitle>
        <CardDescription>
          只读展示每个 Agent
          的职责、数据范围、工具和写权限；本页面不提供直接修改业务数据的入口。
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        {desktopRuntime ? (
          <div className="rounded-lg border border-dashed p-3">
            <div className="flex items-center justify-between gap-3">
              <div>
                <p className="font-medium">只读 Agent 编排预览</p>
                <p className="text-xs text-muted-foreground">
                  按研究 → 知识 → 洞察 → 风险 → 竞品 →
                  发布顺序生成建议，不会自动执行。
                </p>
              </div>
              <Button
                size="sm"
                variant="outline"
                onClick={() =>
                  setOrchestration(
                    buildAgentOrchestration(definitions, { previewOnly: true }),
                  )
                }
                disabled={!definitions.length}
              >
                生成顺序
              </Button>
            </div>
            {orchestration.length ? (
              <div className="mt-3 grid gap-2">
                {orchestration.map((stage) => (
                  <div
                    key={stage.agentDefinitionId}
                    className="flex items-center justify-between rounded-md bg-muted/40 px-3 py-2 text-sm"
                  >
                    <span>
                      {stage.ordinal}. {stage.name}
                    </span>
                    <Badge
                      variant={
                        stage.status === "ready" ? "secondary" : "destructive"
                      }
                    >
                      {stage.status === "ready" ? "可进入" : stage.reason}
                    </Badge>
                  </div>
                ))}
              </div>
            ) : null}
          </div>
        ) : null}
        {!desktopRuntime ? (
          <Alert>
            <BrainCircuitIcon />
            <AlertTitle>桌面模式功能</AlertTitle>
            <AlertDescription>
              浏览器预览不读取本地 Agent 定义目录。
            </AlertDescription>
          </Alert>
        ) : null}
        {desktopRuntime &&
          definitions.map((definition) => {
            const permissions = definition.permissions;
            const tools = Array.isArray(permissions.allowedTools)
              ? permissions.allowedTools
              : [];
            return (
              <div
                key={definition.id}
                className="flex flex-col gap-3 rounded-lg border p-3"
              >
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="font-medium">{definition.name}</p>
                      <Badge variant="outline">v{definition.version}</Badge>
                      {permissions.businessWriteAccess === false ? (
                        <Badge variant="secondary">
                          <LockKeyholeIcon data-icon="inline-start" />
                          无业务写权限
                        </Badge>
                      ) : (
                        <Badge variant="destructive">需审查写权限</Badge>
                      )}
                    </div>
                    <p className="mt-1 text-sm text-muted-foreground">
                      {definition.description}
                    </p>
                  </div>
                  <span className="text-xs text-muted-foreground">
                    {definition.definitionKey}
                  </span>
                </div>
                <div className="grid gap-2 text-sm sm:grid-cols-3">
                  <div className="rounded-md bg-muted/40 p-2">
                    <p className="text-xs text-muted-foreground">数据范围</p>
                    <p className="font-medium">
                      {scopeLabel(permissions.dataScope)}
                    </p>
                  </div>
                  <div className="rounded-md bg-muted/40 p-2">
                    <p className="text-xs text-muted-foreground">
                      输入 / 输出契约
                    </p>
                    <p className="font-medium">
                      {definition.inputSchemaVersion} /{" "}
                      {definition.outputSchemaVersion}
                    </p>
                  </div>
                  <div className="rounded-md bg-muted/40 p-2">
                    <p className="text-xs text-muted-foreground">Eval 状态</p>
                    <p className="font-medium">
                      <ShieldCheckIcon className="mr-1 inline size-4" />
                      定义已注册
                    </p>
                  </div>
                </div>
                <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                  <WrenchIcon className="size-3.5" />
                  允许工具：{tools.length ? tools.join("、") : "无"}
                  {permissions.syntheticInputOnly ? " · 仅固定合成输入" : ""}
                </div>
              </div>
            );
          })}
        {desktopRuntime && !definitions.length ? (
          <p className="text-sm text-muted-foreground">
            暂无已注册的 Agent 定义。
          </p>
        ) : null}
      </CardContent>
    </Card>
  );
}
