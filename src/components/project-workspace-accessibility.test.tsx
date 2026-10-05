// @vitest-environment jsdom

import { cleanup, render, screen } from "@testing-library/react"
import { afterEach, describe, expect, it } from "vitest"

import { PROJECT_WORKSPACE_SHEET_CLASS_NAME } from "@/components/project-detail-sheet"
import { ProjectDependencyPanel } from "@/components/project-dependency-panel"
import { ProjectExperimentPanel } from "@/components/project-experiment-panel"
import { ProjectResearchInsightPanel } from "@/components/project-research-insight-panel"
import { ProjectResearchPanel } from "@/components/project-research-panel"
import { ProjectRiskPanel } from "@/components/project-risk-panel"
import { ProjectVocPanel } from "@/components/project-voc-panel"

afterEach(cleanup)

describe("project workspace accessibility contract", () => {
  it("keeps the project workspace wide at compact and desktop breakpoints", () => {
    expect(PROJECT_WORKSPACE_SHEET_CLASS_NAME).toContain("data-[side=right]:w-full")
    expect(PROJECT_WORKSPACE_SHEET_CLASS_NAME).toContain("data-[side=right]:sm:max-w-2xl")
    expect(PROJECT_WORKSPACE_SHEET_CLASS_NAME).toContain("data-[side=right]:lg:max-w-4xl")
  })

  it("gives every previously anonymous project control an accessible name", () => {
    render(<>
      <ProjectExperimentPanel projectId="project-1" desktopRuntime={false} readOnly={false} />
      <ProjectVocPanel projectId="project-1" desktopRuntime={false} readOnly={false} />
      <ProjectRiskPanel projectId="project-1" desktopRuntime={false} readOnly={false} />
      <ProjectDependencyPanel projectId="project-1" desktopRuntime={false} readOnly={false} />
      <ProjectResearchPanel projectId="project-1" desktopRuntime={false} readOnly={false} />
      <ProjectResearchInsightPanel projectId="project-1" meetings={[]} desktopRuntime={false} readOnly={false} />
    </>)

    for (const name of [
      "实验开始日期",
      "实验结束日期",
      "VOC 数据格式",
      "风险影响程度",
      "风险发生概率",
      "依赖类型",
      "研究类型",
      "关联研究计划",
      "洞察来源研究记录",
      "洞察关联研究计划",
    ]) expect(screen.getByLabelText(name)).toBeTruthy()
  })
})
