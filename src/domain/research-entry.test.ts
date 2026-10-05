import { describe, expect, it } from "vitest"
import { validateResearchEntryDraft } from "./research-entry"
describe("research entry", () => { it("normalizes a cited entry", () => expect(validateResearchEntryDraft({ researchType: "interview", title: " t ", sourceRef: "doc#1", accessedAt: "2026-07-16", insight: "i", personaSuggestion: "p" }).title).toBe("t")) })
