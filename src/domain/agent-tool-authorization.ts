export interface AgentToolPolicy {
  businessWriteAccess?: boolean;
  dataScope?: unknown;
  allowedTools?: unknown;
}

export interface ToolAuthorizationRequest {
  tool: string;
  scopeMode?: "runtime" | "preview";
  projectId?: string;
  activeProjectId?: string;
  writesBusinessData?: boolean;
  userConfirmed?: boolean;
}

export interface PendingAgentToolProposal {
  status: "pending_confirmation";
  tool: string;
  projectId?: string;
  reason: string;
}

export function authorizeAgentTool(
  policy: AgentToolPolicy,
  request: ToolAuthorizationRequest,
): { allowed: true } | { allowed: false; reason: string; proposal?: PendingAgentToolProposal } {
  if (!request.tool.trim())
    return { allowed: false, reason: "工具标识不能为空" };
  const tools = Array.isArray(policy.allowedTools) ? policy.allowedTools : [];
  if (!tools.includes(request.tool))
    return { allowed: false, reason: `工具未授权：${request.tool}` };
  if (request.writesBusinessData && policy.businessWriteAccess !== true)
    return { allowed: false, reason: "Agent 没有业务写入权限" };
  if (request.writesBusinessData && request.userConfirmed !== true) {
    const reason = "高风险业务写入只能形成待确认提案，必须由用户确认后执行";
    return {
      allowed: false,
      reason,
      proposal: {
        status: "pending_confirmation",
        tool: request.tool,
        projectId: request.projectId,
        reason,
      },
    };
  }
  if (
    policy.dataScope === "current_project" ||
    String(policy.dataScope).startsWith("current_project")
  ) {
    if (request.scopeMode === "preview") return { allowed: true };
    if (
      !request.projectId ||
      !request.activeProjectId ||
      request.projectId !== request.activeProjectId
    )
      return { allowed: false, reason: "工具调用不在当前项目范围内" };
  }
  return { allowed: true };
}
