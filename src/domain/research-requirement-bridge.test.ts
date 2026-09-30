import { describe, expect, it } from "vitest"
import { researchRequirementEvidence } from "./research-requirement-bridge"
describe("research requirement bridge", () => { it("creates explicit non-meeting evidence", () => expect(researchRequirementEvidence("entry-1", "insight")).toMatchObject({ paragraphId: "research:entry-1", sourceType: "research_entry", sourceId: "entry-1" })) })
