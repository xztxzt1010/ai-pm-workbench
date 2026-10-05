import { describe, expect, it } from "vitest"
import { validateResearchPlanDraft } from "./research-plan"
describe("research plan", () => { it("validates interview outline", () => expect(validateResearchPlanDraft({ title: " t ", objective: "o", targetPersona: "p", questions: [" q "], startDate: "2026-07-16", endDate: "2026-07-17" }).questions).toEqual(["q"])) })
