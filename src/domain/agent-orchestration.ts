import { authorizeAgentTool } from "./agent-tool-authorization";
import type { AgentOrchestrationTask } from "./agent-orchestration-runner";

export interface OrchestrationDefinition {
  id: string;
  name: string;
  permissions: {
    businessWriteAccess?: boolean;
    dataScope?: unknown;
    allowedTools?: unknown;
  };
}

export interface OrchestrationStage {
  ordinal: number;
  agentDefinitionId: string;
  name: string;
  purpose: string;
  status: "ready" | "blocked";
  reason?: string;
}

export type OrchestrationContext =
  | { previewOnly: true; activeProjectId?: never }
  | { previewOnly?: false; activeProjectId: string };

const ORDER: Array<[string, string, string, string]> = [
  [
    "research-plan-review:v1",
    "研究计划审阅",
    "先确认研究问题、范围和缺口",
    "read_research_plans",
  ],
  [
    "plan-engineer:v1",
    "计划工程师",
    "把研究计划审阅结果整理为范围、排期和覆盖缺口提案",
    "read_research_plans",
  ],
  [
    "knowledge-review:v1",
    "知识管理审阅",
    "核对记忆来源、冲突和待确认知识",
    "read_project_memories",
  ],
  [
    "research-insight:v1",
    "研究洞察审阅",
    "基于已保存研究记录归纳洞察候选",
    "read_research_entries",
  ],
  [
    "risk-review:v1",
    "风险审阅",
    "将当前项目风险和依赖纳入复查",
    "read_project_risks",
  ],
  [
    "competitor-review:v1",
    "竞品审阅",
    "基于已保存竞品档案复查差异",
    "read_competitor_profiles",
  ],
  [
    "release-review:v1",
    "发布复盘审阅",
    "最后检查发布准备、结果和后续行动",
    "read_releases",
  ],
];

export function buildAgentOrchestration(
  definitions: OrchestrationDefinition[],
  context: OrchestrationContext,
): OrchestrationStage[] {
  const byId = new Map(
    definitions.map((definition) => [definition.id, definition]),
  );
  return ORDER.map(([id, name, purpose, requiredTool], index) => {
    const definition = byId.get(id);
    if (!definition)
      return {
        ordinal: index + 1,
        agentDefinitionId: id,
        name,
        purpose,
        status: "blocked",
        reason: "Agent 定义未注册",
      };
    if (definition.permissions.businessWriteAccess !== false)
      return {
        ordinal: index + 1,
        agentDefinitionId: id,
        name,
        purpose,
        status: "blocked",
        reason: "未声明只读权限，不能进入默认编排",
      };
    const authorization = authorizeAgentTool(definition.permissions, {
      tool: requiredTool,
      scopeMode: context.previewOnly ? "preview" : "runtime",
      projectId: context.previewOnly ? undefined : context.activeProjectId,
      activeProjectId: context.previewOnly ? undefined : context.activeProjectId,
    });
    if (!authorization.allowed)
      return {
        ordinal: index + 1,
        agentDefinitionId: id,
        name,
        purpose,
        status: "blocked",
        reason: `未授权工具：${requiredTool}`,
      };
    return {
      ordinal: index + 1,
      agentDefinitionId: id,
      name,
      purpose,
      status: "ready",
    };
  });
}

/** Converts the authorized preview into executable tasks without inventing
 * missing agents. Callers supply the actual provider-bound, read-only work. */
export function buildAgentOrchestrationTasks<T>(
  definitions: OrchestrationDefinition[],
  executors: Record<string, () => Promise<T>>,
  activeProjectId: string,
): AgentOrchestrationTask<T>[] {
  return buildAgentOrchestration(definitions, { activeProjectId })
    .filter(
      (stage) =>
        stage.status === "ready" &&
        typeof executors[stage.agentDefinitionId] === "function",
    )
    .map((stage) => ({
      agentDefinitionId: stage.agentDefinitionId,
      execute: executors[stage.agentDefinitionId],
    }));
}
