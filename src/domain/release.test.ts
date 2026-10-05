import { describe, expect, it } from "vitest"
import { validateReleaseDraft } from "./release"
describe("release", () => { it("normalizes release lists", () => expect(validateReleaseDraft({ title: " v1 ", scope: [" A "], checklist: [" QA "], rollbackPlan: "r", result: "", retrospective: "", followUp: [], targetDate: "2026-08-01" }).scope).toEqual(["A"])) })
