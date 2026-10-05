import { describe, expect, it } from "vitest"
import { validateCompetitorProfileDraft } from "./competitor-profile"
describe("competitor profile", () => { it("normalizes cited profile", () => expect(validateCompetitorProfileDraft({ name: " Acme ", sourceRef: "https://example.com", accessedAt: "2026-07-16", strengths: "fast", weaknesses: "cost", positioning: "enterprise" }).name).toBe("Acme")) })
