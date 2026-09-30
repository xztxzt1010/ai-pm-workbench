import { describe, expect, it } from "vitest";
import { authorizeAgentTool } from "./agent-tool-authorization";

describe("agent tool authorization", () => {
  const policy = {
    businessWriteAccess: false,
    dataScope: "current_project",
    allowedTools: ["read_project_risks"],
  };
  it("allows an explicitly whitelisted read within the active project", () => {
    expect(
      authorizeAgentTool(policy, {
        tool: "read_project_risks",
        projectId: "p1",
        activeProjectId: "p1",
      }),
    ).toEqual({ allowed: true });
  });
  it("rejects unknown tools, cross-project scope and writes", () => {
    expect(
      authorizeAgentTool(policy, {
        tool: "delete_project_risk",
        projectId: "p1",
        activeProjectId: "p1",
        writesBusinessData: true,
      }).allowed,
    ).toBe(false);
    const crossProject = authorizeAgentTool(policy, {
      tool: "read_project_risks",
      projectId: "p2",
      activeProjectId: "p1",
    });
    const write = authorizeAgentTool(policy, {
      tool: "read_project_risks",
      projectId: "p1",
      activeProjectId: "p1",
      writesBusinessData: true,
    });
    expect("reason" in crossProject ? crossProject.reason : "").toContain(
      "当前项目",
    );
    expect("reason" in write ? write.reason : "").toContain("写入");
  });
  it("requires explicit user confirmation even when write access exists", () => {
    const writePolicy = {
      businessWriteAccess: true,
      dataScope: "current_project",
      allowedTools: ["update_project_risk"],
    };
    const proposal = authorizeAgentTool(writePolicy, {
      tool: "update_project_risk",
      projectId: "p1",
      activeProjectId: "p1",
      writesBusinessData: true,
    });
    expect("reason" in proposal ? proposal.reason : "").toContain("用户确认");
    expect(
      "proposal" in proposal ? proposal.proposal : undefined,
    ).toMatchObject({
      status: "pending_confirmation",
      tool: "update_project_risk",
      projectId: "p1",
    });
    expect(
      authorizeAgentTool(writePolicy, {
        tool: "update_project_risk",
        projectId: "p1",
        activeProjectId: "p1",
        writesBusinessData: true,
        userConfirmed: true,
      }),
    ).toEqual({ allowed: true });
  });

  it("defers only the concrete project match during a read-only preview", () => {
    expect(
      authorizeAgentTool(policy, {
        tool: "read_project_risks",
        scopeMode: "preview",
      }),
    ).toEqual({ allowed: true });
    expect(
      authorizeAgentTool(policy, {
        tool: "unknown_tool",
        scopeMode: "preview",
      }).allowed,
    ).toBe(false);
  });
});
