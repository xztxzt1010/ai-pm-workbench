// @vitest-environment jsdom

import { beforeEach, describe, expect, it } from "vitest"

import { loadOnboardingCompleted, persistOnboardingCompleted } from "@/data/onboarding-state"

describe("onboarding state", () => {
  beforeEach(() => localStorage.clear())

  it("starts incomplete and persists completion in browser preview", async () => {
    expect(await loadOnboardingCompleted(false)).toBe(false)
    await persistOnboardingCompleted(true, false)
    expect(await loadOnboardingCompleted(false)).toBe(true)
    expect(localStorage.getItem("assistant-product-manager.onboarding.v1")).not.toContain("apiKey")
  })
})
