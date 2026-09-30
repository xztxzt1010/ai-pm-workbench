// @vitest-environment jsdom

import { fireEvent, render, screen } from "@testing-library/react"
import { beforeEach, describe, expect, it } from "vitest"

import { KnowledgePage } from "@/components/knowledge-page"
import { createBrowserKnowledge } from "@/data/browser-knowledge-store"

describe("KnowledgePage", () => {
  beforeEach(() => localStorage.clear())

  it("explains browser-local storage and exposes the five-record creation flow", async () => {
    render(<KnowledgePage projects={[]} meetings={[]} desktopRuntime={false} />)

    expect(screen.getByRole("heading", { name: "工作记录与知识库" })).toBeTruthy()
    expect(screen.getByText(/不会自动同步到桌面 SQLite/)).toBeTruthy()
    expect(await screen.findByText("暂无匹配记录")).toBeTruthy()

    fireEvent.click(screen.getAllByRole("button", { name: "新建记录" })[0])
    expect(await screen.findByRole("dialog", { name: "新建知识记录" })).toBeTruthy()
    expect(screen.getByText(/五类记录共享知识身份/)).toBeTruthy()
    expect(screen.getByLabelText("Markdown 正文")).toBeTruthy()
  })

  it("exposes source capture and same-scope relation workflows for a saved record", async () => {
    createBrowserKnowledge({ id: "idea-1", itemType: "product_idea", domain: "personal", title: "First idea", contentMarkdown: "# First", createdBy: "user" })
    createBrowserKnowledge({ id: "idea-2", itemType: "ai_learning", domain: "personal", title: "Second note", contentMarkdown: "# Second", createdBy: "user" })
    render(<KnowledgePage projects={[]} meetings={[]} desktopRuntime={false} />)

    expect((await screen.findAllByText("First idea")).length).toBeGreaterThan(0)
    fireEvent.click(screen.getByRole("button", { name: "添加来源" }))
    expect(await screen.findByRole("dialog", { name: "添加知识来源" })).toBeTruthy()
    expect(screen.getByRole("combobox", { name: "来源类型" })).toBeTruthy()
    expect(screen.getByLabelText("用于校验的来源文本")).toBeTruthy()
    fireEvent.click(screen.getByRole("button", { name: "取消" }))

    fireEvent.click(screen.getByRole("button", { name: "建立关系" }))
    expect(await screen.findByRole("dialog", { name: "建立知识关系" })).toBeTruthy()
    expect(screen.getByRole("combobox", { name: "目标记录" })).toBeTruthy()
    expect(screen.getByRole("combobox", { name: "关系类型" })).toBeTruthy()
    expect(screen.getByText(/新关系先作为候选/)).toBeTruthy()
  })
})
