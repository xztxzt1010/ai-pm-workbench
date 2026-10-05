import { describe, expect, it } from "vitest";
import { validateDependencyRemediationOutput, type DependencyRemediationOutput, type DependencyRemediationSource } from "./dependency-remediation-agent";

const source: DependencyRemediationSource = {
  id: "dep-1", projectId: "project-1", title: "法务审批", description: "隐私条款待确认",
  dependencyType: "approval", owner: "PM", dueDate: "2026-07-18", status: "blocked",
  resolution: "提供最小数据方案", createdAt: "90", updatedAt: "100",
};
const valid: DependencyRemediationOutput = {
  schemaVersion: "1.0.0", proposals: [{ dependencyId: "dep-1", expectedUpdatedAt: "100", priority: "immediate",
    changes: { owner: "Legal", resolution: "Legal 每日复核最小数据方案" }, rationale: "审批阻塞发布",
    citations: [{ field: "status", quote: "blocked" }, { field: "resolution", quote: "提供最小数据方案" }] }], limitations: [],
};

describe("dependency remediation agent fixed eval", () => {
  it("accepts exact whitelisted changes", () => expect(validateDependencyRemediationOutput(valid, [source]).proposals[0].changes).toEqual({ owner: "Legal", resolution: "Legal 每日复核最小数据方案" }));
  it("rejects stale snapshots", () => { const output = structuredClone(valid); output.proposals[0].expectedUpdatedAt = "99"; expect(() => validateDependencyRemediationOutput(output, [source])).toThrow(); });
  it("rejects status changes", () => { const output = structuredClone(valid) as unknown as { proposals: Array<{ changes: Record<string, string> }> }; output.proposals[0].changes.status = "resolved"; expect(() => validateDependencyRemediationOutput(output, [source])).toThrow(); });
  it("rejects resolved targets, inexact evidence, and no-ops", () => {
    expect(() => validateDependencyRemediationOutput(valid, [{ ...source, status: "resolved" }])).toThrow();
    const inexact = structuredClone(valid); inexact.proposals[0].citations[0].quote = "ready"; expect(() => validateDependencyRemediationOutput(inexact, [source])).toThrow();
    const noOp = structuredClone(valid); noOp.proposals[0].changes = { owner: "PM" }; expect(() => validateDependencyRemediationOutput(noOp, [source])).toThrow();
  });
});
