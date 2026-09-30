// @vitest-environment jsdom

import { useState } from "react"
import { cleanup, render, screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import { OnboardingDialog } from "@/components/onboarding-dialog"
import { Button } from "@/components/ui/button"
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet"

afterEach(cleanup)
beforeEach(() => localStorage.clear())

function ControlledSheet() {
  const [open, setOpen] = useState(false)
  return <>
    <Button onClick={() => setOpen(true)}>打开项目工作区</Button>
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetContent>
        <SheetHeader>
          <SheetTitle>键盘测试项目</SheetTitle>
          <SheetDescription>验证焦点陷阱与关闭恢复。</SheetDescription>
        </SheetHeader>
        <label htmlFor="project-name">项目名称</label>
        <input id="project-name" />
        <Button>保存项目</Button>
      </SheetContent>
    </Sheet>
  </>
}

describe("Dialog and Sheet keyboard behavior", () => {
  it("moves focus through onboarding actions and traps it inside the dialog", async () => {
    const user = userEvent.setup()
    render(<OnboardingDialog desktopRuntime={false} reopenToken={0} onOpenSettings={vi.fn()} />)

    const skip = await screen.findByRole("button", { name: "暂时跳过" })
    const next = screen.getByRole("button", { name: "下一步" })
    const close = screen.getByRole("button", { name: "Close" })
    await waitFor(() => expect(document.activeElement).toBe(skip))

    await user.tab()
    expect(document.activeElement).toBe(next)
    await user.tab()
    expect(document.activeElement).toBe(close)
    await user.tab()
    await waitFor(() => expect(document.activeElement).toBe(skip))
    await user.tab({ shift: true })
    await waitFor(() => expect(document.activeElement).toBe(close))
  })

  it("closes a controlled project sheet with Escape and restores its opener", async () => {
    const user = userEvent.setup()
    render(<ControlledSheet />)

    const opener = screen.getByRole("button", { name: "打开项目工作区" })
    await user.click(opener)
    const projectName = await screen.findByRole("textbox", { name: "项目名称" })
    await waitFor(() => expect(document.activeElement).toBe(projectName))

    await user.tab()
    expect(document.activeElement).toBe(screen.getByRole("button", { name: "保存项目" }))
    await user.keyboard("{Escape}")
    await waitFor(() => expect(screen.queryByRole("dialog", { name: "键盘测试项目" })).toBeNull())
    expect(document.activeElement).toBe(opener)
  })
})
