import { describe, expect, it } from "vitest";
import {
  buildAgentOrchestration,
  buildAgentOrchestrationTasks,
} from "./agent-orchestration";

describe("agent orchestration", () => {
  it("keeps the deterministic dependency order and blocks missing definitions", () => {
    const plan = buildAgentOrchestration(
      [{
        id: "knowledge-review:v1",
        name: "知识",
        permissions: {
          businessWriteAccess: false,
          allowedTools: ["read_project_memories"],
        },
      }],
      { previewOnly: true },
    );
    expect(plan.map((stage) => stage.agentDefinitionId)).toEqual([
      "research-plan-review:v1",
      "plan-engineer:v1",
      "knowledge-review:v1",
      "research-insight:v1",
      "risk-review:v1",
      "competitor-review:v1",
      "release-review:v1",
    ]);
    expect(plan[0].status).toBe("blocked");
    expect(plan[1].status).toBe("blocked");
    expect(plan[2].status).toBe("ready");
  });
  it("blocks definitions that do not explicitly declare read-only access", () => {
    expect(
      buildAgentOrchestration(
        [{ id: "risk-review:v1", name: "风险", permissions: {} }],
        { previewOnly: true },
      )[4].reason,
    ).toContain("只读");
  });
  it("blocks definitions whose required read tool is missing", () => {
    expect(
      buildAgentOrchestration(
        [{
          id: "risk-review:v1",
          name: "risk",
          permissions: { businessWriteAccess: false, allowedTools: [] },
        }],
        { previewOnly: true },
      )[4].reason,
    ).toContain("read_project_risks");
  });
  it("only creates tasks for ready definitions with explicit executors", () => {
    const tasks = buildAgentOrchestrationTasks(
      [
        {
          id: "risk-review:v1",
          name: "risk",
          permissions: {
            businessWriteAccess: false,
            allowedTools: ["read_project_risks"],
          },
        },
      ],
      { "risk-review:v1": async () => "reviewed" },
      "project-1",
    );
    expect(tasks).toHaveLength(1);
    expect(tasks[0].agentDefinitionId).toBe("risk-review:v1");
  });

  it("defers concrete project matching in preview but enforces it at runtime", () => {
    const definitions = [{
      id: "risk-review:v1",
      name: "risk",
      permissions: {
        dataScope: "current_project_open_risks",
        businessWriteAccess: false,
        allowedTools: ["read_project_risks"],
      },
    }];
    expect(buildAgentOrchestration(definitions, { previewOnly: true })[4].status).toBe("ready");
    expect(buildAgentOrchestration(definitions, { activeProjectId: "project-1" })[4].status).toBe("ready");
  });

  it("does not create executable tasks from an unauthorized definition", () => {
    expect(
      buildAgentOrchestrationTasks(
        [{
          id: "risk-review:v1",
          name: "risk",
          permissions: {
            dataScope: "current_project_open_risks",
            businessWriteAccess: true,
            allowedTools: ["read_project_risks"],
          },
        }],
        { "risk-review:v1": async () => "must-not-run" },
        "project-1",
      ),
    ).toEqual([]);
  });
});
