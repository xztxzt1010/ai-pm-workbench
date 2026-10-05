import { beforeEach, describe, expect, it, vi } from "vitest";

const { invokeMock, randomUuidMock } = vi.hoisted(() => ({
  invokeMock: vi.fn(),
  randomUuidMock: vi.fn(() => "proposal-1"),
}));
vi.mock("@tauri-apps/api/core", () => ({ invoke: invokeMock }));

import {
  confirmAgentToolProposal,
  listAgentToolProposals,
  saveDependencyUpdateProposals,
  saveReleasePreparationProposals,
  saveRiskUpdateProposals,
  saveResearchPlanUpdateProposals,
} from "@/services/agent-tool-proposal-service";

const row = {
  id: "proposal-1",
  projectId: "project-1",
  targetType: "research_plan",
  targetId: "plan-1",
  agentRunId: "run-1",
  agentDefinitionId: "plan-engineer:v2",
  toolKey: "update_research_plan",
  expectedTargetUpdatedAt: "1000",
  payloadJson: '{"objective":"New objective"}',
  evidenceJson:
    '[{"sourceType":"plan","sourceId":"plan-1","field":"objective","quote":"Old objective"}]',
  rationale: "Improve focus",
  status: "pending_confirmation",
  createdAt: "1001",
  updatedAt: "1001",
};

describe("agent tool proposal service", () => {
  beforeEach(() => {
    invokeMock.mockReset();
    vi.stubGlobal("crypto", { randomUUID: randomUuidMock });
  });

  it("does not query proposal storage in browser preview", async () => {
    await expect(listAgentToolProposals(false, "project-1")).resolves.toEqual([]);
    expect(invokeMock).not.toHaveBeenCalled();
  });

  it("persists a validated generation as a pending proposal batch", async () => {
    invokeMock.mockResolvedValue([row]);
    const saved = await saveResearchPlanUpdateProposals(
      true,
      "project-1",
      "run-1",
      [{
        planId: "plan-1",
        expectedUpdatedAt: "1000",
        changes: { objective: "New objective" },
        rationale: "Improve focus",
        citations: [{ sourceType: "plan", sourceId: "plan-1", field: "objective", quote: "Old objective" }],
      }],
    );
    expect(saved[0].changes).toEqual({ objective: "New objective" });
    expect(invokeMock).toHaveBeenCalledWith(
      "save_research_plan_update_proposals",
      expect.objectContaining({
        request: expect.objectContaining({
          projectId: "project-1",
          runId: "run-1",
          proposals: [expect.objectContaining({ id: "proposal-1" })],
        }),
      }),
    );
  });

  it("sends explicit user confirmation to the deterministic executor", async () => {
    invokeMock.mockResolvedValue({ status: "executed" });
    await expect(
      confirmAgentToolProposal(true, "project-1", "proposal-1"),
    ).resolves.toBe("executed");
    expect(invokeMock).toHaveBeenCalledWith("confirm_agent_tool_proposal", {
      projectId: "project-1",
      proposalId: "proposal-1",
      userConfirmed: true,
    });
  });

  it("persists risk remediation proposals through the dedicated command", async () => {
    invokeMock.mockResolvedValue([
      {
        ...row,
        targetType: "project_risk",
        targetId: "risk-1",
        agentDefinitionId: "risk-review:v2",
        toolKey: "update_project_risk",
        payloadJson: '{"mitigation":"Daily review"}',
        evidenceJson: '[{"field":"severity","quote":"high"}]',
      },
    ]);
    const saved = await saveRiskUpdateProposals(true, "project-1", "run-2", [
      {
        riskId: "risk-1",
        expectedUpdatedAt: "1000",
        priority: "immediate",
        changes: { mitigation: "Daily review" },
        rationale: "Reduce exposure",
        citations: [{ field: "severity", quote: "high" }],
      },
    ]);
    expect(saved[0]).toMatchObject({
      targetType: "project_risk",
      changes: { mitigation: "Daily review" },
    });
    expect(invokeMock).toHaveBeenCalledWith(
      "save_project_risk_update_proposals",
      expect.objectContaining({
        request: expect.objectContaining({ projectId: "project-1", runId: "run-2" }),
      }),
    );
  });

  it("persists dependency remediation through its dedicated command", async () => {
    invokeMock.mockResolvedValue([{ ...row, targetType: "project_dependency", targetId: "dep-1", agentDefinitionId: "dependency-remediation:v1", toolKey: "update_project_dependency", payloadJson: '{"owner":"Legal"}', evidenceJson: '[{"field":"status","quote":"blocked"}]' }]);
    const saved = await saveDependencyUpdateProposals(true, "project-1", "run-3", [{ dependencyId: "dep-1", expectedUpdatedAt: "1000", priority: "immediate", changes: { owner: "Legal" }, rationale: "Unblock approval", citations: [{ field: "status", quote: "blocked" }] }]);
    expect(saved[0]).toMatchObject({ targetType: "project_dependency", changes: { owner: "Legal" } });
    expect(invokeMock).toHaveBeenCalledWith("save_project_dependency_update_proposals", expect.objectContaining({ request: expect.objectContaining({ projectId: "project-1", runId: "run-3" }) }));
  });
  it("persists release preparation through its dedicated command",async()=>{invokeMock.mockResolvedValue([{...row,targetType:"release",targetId:"release-1",agentDefinitionId:"release-preparation:v1",toolKey:"update_release_preparation",payloadJson:'{"rollbackPlan":"verify restore"}',evidenceJson:'[{"field":"checklist","quote":"backup"}]'}]);const saved=await saveReleasePreparationProposals(true,"project-1","run-4",[{releaseId:"release-1",expectedUpdatedAt:"1000",priority:"immediate",changes:{rollbackPlan:"verify restore"},rationale:"safe rollback",citations:[{field:"checklist",quote:"backup"}]}]);expect(saved[0].targetType).toBe("release");expect(invokeMock).toHaveBeenCalledWith("save_release_preparation_proposals",expect.anything());});

  it("rejects damaged persisted payloads", async () => {
    invokeMock.mockResolvedValue([{ ...row, payloadJson: "[]" }]);
    await expect(listAgentToolProposals(true, "project-1")).rejects.toThrow(/损坏/);
  });
});
