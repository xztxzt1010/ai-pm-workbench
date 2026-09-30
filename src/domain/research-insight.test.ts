import { describe, expect, it } from "vitest"
import { validateResearchInsightDraft } from "./research-insight"
describe("research insight", () => { it("normalizes evidence", () => expect(validateResearchInsightDraft({ title: " t ", statement: "s", evidence: [" e "] }).evidence).toEqual(["e"])) })
