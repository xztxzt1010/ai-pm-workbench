import { describe, expect, it } from "vitest"
import { dependencyDueState, validateProjectDependencyDraft } from "./project-dependency"
describe("project dependency", () => { it("validates and trims", () => expect(validateProjectDependencyDraft({ title: " x ", description: "d", dependencyType: "external", owner: "o", dueDate: "2026-08-01", resolution: "r" }).title).toBe("x")); it("computes due state", () => expect(dependencyDueState("2026-07-15", "2026-07-16")).toBe("overdue")) })
