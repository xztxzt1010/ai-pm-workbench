import { describe, expect, it, vi } from "vitest";
import { runAgentOrchestration } from "@/domain/agent-orchestration-runner";

describe("agent orchestration runner", () => {
  it("executes read-only stages in declared order", async () => {
    const order: string[] = [];
    const result = await runAgentOrchestration([
      {
        agentDefinitionId: "first:v1",
        execute: async () => {
          order.push("first");
          return 1;
        },
      },
      {
        agentDefinitionId: "second:v1",
        execute: async () => {
          order.push("second");
          return 2;
        },
      },
    ]);
    expect(order).toEqual(["first", "second"]);
    expect(result.status).toBe("succeeded");
    expect(result.stages.map((stage) => stage.status)).toEqual([
      "succeeded",
      "succeeded",
    ]);
  });

  it("stops after a failure by default and marks later stages skipped", async () => {
    const later = vi.fn();
    const result = await runAgentOrchestration([
      {
        agentDefinitionId: "first:v1",
        execute: async () => {
          throw new Error("provider unavailable");
        },
      },
      { agentDefinitionId: "second:v1", execute: later },
    ]);
    expect(result.status).toBe("failed");
    expect(result.stages.map((stage) => stage.status)).toEqual([
      "failed",
      "skipped",
    ]);
    expect(later).not.toHaveBeenCalled();
  });

  it("can continue explicitly and reports all failures without retrying", async () => {
    const result = await runAgentOrchestration(
      [
        {
          agentDefinitionId: "first:v1",
          execute: async () => {
            throw new Error("first failed");
          },
        },
        { agentDefinitionId: "second:v1", execute: async () => "ok" },
        {
          agentDefinitionId: "third:v1",
          execute: async () => {
            throw new Error("third failed");
          },
        },
      ],
      { stopOnError: false },
    );
    expect(result.status).toBe("failed");
    expect(result.stages.map((stage) => stage.status)).toEqual([
      "failed",
      "succeeded",
      "failed",
    ]);
  });
  it("marks remaining stages cancelled when the signal is aborted", async () => {
    const controller = new AbortController();
    const result = await runAgentOrchestration(
      [
        {
          agentDefinitionId: "first:v1",
          execute: async () => {
            controller.abort();
            return "done";
          },
        },
        { agentDefinitionId: "second:v1", execute: async () => "never" },
      ],
      { signal: controller.signal },
    );
    expect(result.status).toBe("cancelled");
    expect(result.stages.map((stage) => stage.status)).toEqual([
      "succeeded",
      "cancelled",
    ]);
  });
});
