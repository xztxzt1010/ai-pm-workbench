import { AppError } from "@/domain/app-error";

export interface AgentOrchestrationTask<T = unknown> {
  agentDefinitionId: string;
  execute: (signal?: AbortSignal) => Promise<T>;
}

export type AgentOrchestrationStageStatus =
  "succeeded" | "failed" | "skipped" | "cancelled";

export interface AgentOrchestrationStageResult<T = unknown> {
  agentDefinitionId: string;
  status: AgentOrchestrationStageStatus;
  value?: T;
  error?: string;
}

export interface AgentOrchestrationRunResult<T = unknown> {
  status: "succeeded" | "failed" | "cancelled";
  stages: AgentOrchestrationStageResult<T>[];
}

export interface AgentOrchestrationRunOptions {
  stopOnError?: boolean;
  signal?: AbortSignal;
}

/**
 * Runs already-authorized, read-only agent tasks in the declared order.
 * This runner owns control flow only; it never writes business data or retries
 * a failed provider request implicitly.
 */
export async function runAgentOrchestration<T = unknown>(
  tasks: AgentOrchestrationTask<T>[],
  options: AgentOrchestrationRunOptions = {},
): Promise<AgentOrchestrationRunResult<T>> {
  if (!tasks.length)
    throw new AppError("validation", "Agent 编排至少需要一个阶段");
  const stopOnError = options.stopOnError ?? true;
  const stages: AgentOrchestrationStageResult<T>[] = [];
  let failed = false;
  let cancelled = false;

  for (const task of tasks) {
    if (options.signal?.aborted) {
      cancelled = true;
      stages.push({
        agentDefinitionId: task.agentDefinitionId,
        status: "cancelled",
        error: "用户取消了编排",
      });
      continue;
    }
    if (failed && stopOnError) {
      stages.push({
        agentDefinitionId: task.agentDefinitionId,
        status: "skipped",
        error: "前一阶段失败，按停止策略跳过",
      });
      continue;
    }
    try {
      stages.push({
        agentDefinitionId: task.agentDefinitionId,
        status: "succeeded",
        value: await task.execute(options.signal),
      });
    } catch (error) {
      if (options.signal?.aborted) {
        cancelled = true;
        stages.push({
          agentDefinitionId: task.agentDefinitionId,
          status: "cancelled",
          error: "用户取消了编排",
        });
        continue;
      }
      failed = true;
      stages.push({
        agentDefinitionId: task.agentDefinitionId,
        status: "failed",
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }
  return {
    status: cancelled ? "cancelled" : failed ? "failed" : "succeeded",
    stages,
  };
}
