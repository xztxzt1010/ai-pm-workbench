import { describe, expect, it } from "vitest"

import type { ConfirmationItem, Project } from "@/domain/models"
import { confirmationItemsForActiveProjects, filterProjectsByVisibility, parseProjectList, serializeProjectList, validateProjectDraft } from "@/domain/project-rules"

const projects: Project[] = [
  { id: "active", name: "Active", goal: "", status: "active", startDate: "2026-07-01", endDate: "2026-07-31", progress: 10, updatedAt: "2026-07-14T00:00:00.000Z" },
  { id: "archived", name: "Archived", goal: "", status: "completed", startDate: "2026-06-01", endDate: "2026-06-30", progress: 100, updatedAt: "2026-07-14T00:00:00.000Z", archivedAt: "2026-07-14T01:00:00.000Z" },
]

const item = (projectId: string): ConfirmationItem => ({
  id: `item-${projectId}`, projectId, title: "Follow up", dueDate: "2026-07-14", priority: "medium", status: "pending", createdAt: "2026-07-14T00:00:00.000Z", updatedAt: "2026-07-14T00:00:00.000Z",
})

describe("project visibility", () => {
  it("filters active, archived and all projects", () => {
    expect(filterProjectsByVisibility(projects, "active").map((project) => project.id)).toEqual(["active"])
    expect(filterProjectsByVisibility(projects, "archived").map((project) => project.id)).toEqual(["archived"])
    expect(filterProjectsByVisibility(projects, "all")).toHaveLength(2)
  })

  it("excludes archived projects from active confirmation workflows", () => {
    expect(confirmationItemsForActiveProjects([item("active"), item("archived")], projects).map((candidate) => candidate.projectId)).toEqual(["active"])
  })

  it("rejects incomplete or inconsistent project drafts", () => {
    expect(validateProjectDraft({ name: " ", goal: "goal", startDate: "2026-07-01", endDate: "2026-07-02", progress: 0 }).valid).toBe(false)
    expect(validateProjectDraft({ name: "Project", goal: "goal", startDate: "2026-07-02", endDate: "2026-07-01", progress: 0 })).toEqual({ valid: false, message: "结束日期不能早于开始日期" })
    expect(validateProjectDraft({ name: "Project", goal: "goal", startDate: "2026-07-01", endDate: "2026-07-02", progress: 101 }).valid).toBe(false)
  })

  it("normalizes line-based metadata lists", () => {
    expect(parseProjectList("North\n South,North，East\n")).toEqual(["North", "South", "East"])
    expect(serializeProjectList([" metric ", "metric", "owner"])).toBe("metric\nowner")
  })
})
