import { describe, expect, it } from "vitest"
import { riskReviewState, validateProjectRiskDraft } from "./project-risk"

describe("project risk", () => {
  it("normalizes and validates a risk", () => { expect(validateProjectRiskDraft({ title: "  outage ", description: "desc", severity: "high", probability: "likely", owner: "alice", dueDate: "2026-08-01", mitigation: "fallback" }).title).toBe("outage") })
  it("computes deterministic due state", () => { expect(riskReviewState("2026-07-15", "2026-07-16")).toBe("overdue"); expect(riskReviewState("2026-07-16", "2026-07-16")).toBe("today") })
})
