import { invoke } from "@tauri-apps/api/core";
import { AppError } from "@/domain/app-error";
import type {
  PlanEngineerProposal,
  ResearchPlanUpdateChanges,
} from "@/domain/plan-engineer-agent";
import type { ResearchPlanReviewCitation } from "@/domain/research-plan-review-agent";
import type {
  ProjectRiskUpdateChanges,
  RiskRemediationProposal,
} from "@/domain/risk-remediation-agent";
import type { RiskReviewCitation } from "@/domain/risk-review-agent";
import type {
  DependencyCitation,
  DependencyRemediationProposal,
  ProjectDependencyUpdateChanges,
} from "@/domain/dependency-remediation-agent";
import type { ReleasePreparationChanges, ReleasePreparationCitation, ReleasePreparationProposal } from "@/domain/release-preparation-agent";

export type AgentToolProposalStatus =
  | "pending_confirmation"
  | "executed"
  | "rejected"
  | "stale";

interface AgentToolProposalRow {
  id: string;
  projectId: string;
  targetType: "research_plan" | "project_risk" | "project_dependency" | "release";
  targetId: string;
  agentRunId: string;
  agentDefinitionId: string;
  toolKey:
    | "update_research_plan"
    | "update_project_risk"
    | "update_project_dependency"
    | "update_release_preparation";
  expectedTargetUpdatedAt: string;
  payloadJson: string;
  evidenceJson: string;
  rationale: string;
  status: AgentToolProposalStatus;
  createdAt: string;
  updatedAt: string;
  reviewedAt?: string;
  executedAt?: string;
}

export interface AgentToolProposal
  extends Omit<AgentToolProposalRow, "payloadJson" | "evidenceJson"> {
  changes:
    | ResearchPlanUpdateChanges
    | ProjectRiskUpdateChanges
    | ProjectDependencyUpdateChanges
    | ReleasePreparationChanges;
  citations:
    | ResearchPlanReviewCitation[]
    | RiskReviewCitation[]
    | DependencyCitation[]
    | ReleasePreparationCitation[];
}

function requireDesktop(desktopRuntime: boolean) {
  if (!desktopRuntime)
    throw new AppError("permission", "Agent 工具提案仅在桌面应用中可用");
}

function parseRow(row: AgentToolProposalRow): AgentToolProposal {
  try {
    const changes = JSON.parse(row.payloadJson) as ResearchPlanUpdateChanges;
    const citations = JSON.parse(row.evidenceJson) as ResearchPlanReviewCitation[];
    if (
      !changes ||
      typeof changes !== "object" ||
      Array.isArray(changes) ||
      !Array.isArray(citations)
    )
      throw new Error();
    const { payloadJson: _payloadJson, evidenceJson: _evidenceJson, ...summary } =
      row;
    return { ...summary, changes, citations };
  } catch {
    throw new AppError("validation", "已保存的 Agent 工具提案数据已损坏");
  }
}

export async function saveResearchPlanUpdateProposals(
  desktopRuntime: boolean,
  projectId: string,
  runId: string,
  proposals: PlanEngineerProposal[],
): Promise<AgentToolProposal[]> {
  requireDesktop(desktopRuntime);
  if (!proposals.length) return [];
  const rows = await invoke<AgentToolProposalRow[]>(
    "save_research_plan_update_proposals",
    {
      request: {
        projectId,
        runId,
        proposals: proposals.map((proposal) => ({
          id: crypto.randomUUID(),
          planId: proposal.planId,
          expectedUpdatedAt: proposal.expectedUpdatedAt,
          changes: proposal.changes,
          rationale: proposal.rationale,
          citations: proposal.citations,
        })),
      },
    },
  );
  return rows.map(parseRow);
}

export async function saveRiskUpdateProposals(
  desktopRuntime: boolean,
  projectId: string,
  runId: string,
  proposals: RiskRemediationProposal[],
): Promise<AgentToolProposal[]> {
  requireDesktop(desktopRuntime);
  if (!proposals.length) return [];
  const rows = await invoke<AgentToolProposalRow[]>(
    "save_project_risk_update_proposals",
    {
      request: {
        projectId,
        runId,
        proposals: proposals.map((proposal) => ({
          id: crypto.randomUUID(),
          riskId: proposal.riskId,
          expectedUpdatedAt: proposal.expectedUpdatedAt,
          changes: proposal.changes,
          rationale: proposal.rationale,
          citations: proposal.citations,
        })),
      },
    },
  );
  return rows.map(parseRow);
}

export async function saveDependencyUpdateProposals(
  desktopRuntime: boolean,
  projectId: string,
  runId: string,
  proposals: DependencyRemediationProposal[],
): Promise<AgentToolProposal[]> {
  requireDesktop(desktopRuntime);
  if (!proposals.length) return [];
  const rows = await invoke<AgentToolProposalRow[]>(
    "save_project_dependency_update_proposals",
    {
      request: {
        projectId,
        runId,
        proposals: proposals.map((proposal) => ({
          id: crypto.randomUUID(),
          dependencyId: proposal.dependencyId,
          expectedUpdatedAt: proposal.expectedUpdatedAt,
          changes: proposal.changes,
          rationale: proposal.rationale,
          citations: proposal.citations,
        })),
      },
    },
  );
  return rows.map(parseRow);
}

export async function saveReleasePreparationProposals(desktopRuntime: boolean, projectId: string, runId: string, proposals: ReleasePreparationProposal[]): Promise<AgentToolProposal[]> {
  requireDesktop(desktopRuntime); if (!proposals.length) return [];
  const rows = await invoke<AgentToolProposalRow[]>("save_release_preparation_proposals", { request: { projectId, runId, proposals: proposals.map((proposal) => ({ id: crypto.randomUUID(), releaseId: proposal.releaseId, expectedUpdatedAt: proposal.expectedUpdatedAt, changes: proposal.changes, rationale: proposal.rationale, citations: proposal.citations })) } });
  return rows.map(parseRow);
}

export async function listAgentToolProposals(
  desktopRuntime: boolean,
  projectId: string,
): Promise<AgentToolProposal[]> {
  if (!desktopRuntime) return [];
  const rows = await invoke<AgentToolProposalRow[]>("list_agent_tool_proposals", {
    projectId,
  });
  return rows.map(parseRow);
}

export async function confirmAgentToolProposal(
  desktopRuntime: boolean,
  projectId: string,
  proposalId: string,
): Promise<AgentToolProposalStatus> {
  requireDesktop(desktopRuntime);
  const result = await invoke<{ status: AgentToolProposalStatus }>(
    "confirm_agent_tool_proposal",
    { projectId, proposalId, userConfirmed: true },
  );
  return result.status;
}

export async function rejectAgentToolProposal(
  desktopRuntime: boolean,
  projectId: string,
  proposalId: string,
): Promise<void> {
  requireDesktop(desktopRuntime);
  await invoke("reject_agent_tool_proposal", { projectId, proposalId });
}
