// @vitest-environment jsdom

import { fireEvent, render, screen, waitFor } from "@testing-library/react"
import { beforeEach, describe, expect, it, vi } from "vitest"

import { OnboardingDialog } from "@/components/onboarding-dialog"
import { loadOnboardingCompleted } from "@/data/onboarding-state"

describe("OnboardingDialog", () => {
  beforeEach(() => localStorage.clear())

  it("opens for a new workspace and can complete without enabling AI", async () => {
    render(<OnboardingDialog desktopRuntime={false} reopenToken={0} onOpenSettings={vi.fn()} />)

    expect(await screen.findByText("欢迎使用产品经理工作台")).toBeTruthy()
    fireEvent.click(screen.getByRole("button", { name: "暂时跳过" }))

    await waitFor(async () => expect(await loadOnboardingCompleted(false)).toBe(true))
    expect(localStorage.getItem("assistant-product-manager.provider-config.v1")).not.toMatch(/apiKey|token|secret/i)
  })

  it("can be reopened from settings after completion", async () => {
    localStorage.setItem("assistant-product-manager.onboarding.v1", JSON.stringify({ completed: true }))
    const { rerender } = render(<OnboardingDialog desktopRuntime={false} reopenToken={0} onOpenSettings={vi.fn()} />)
    expect(screen.queryByText("欢迎使用产品经理工作台")).toBeNull()

    rerender(<OnboardingDialog desktopRuntime={false} reopenToken={1} onOpenSettings={vi.fn()} />)
    expect(await screen.findByText("欢迎使用产品经理工作台")).toBeTruthy()
  })
})
