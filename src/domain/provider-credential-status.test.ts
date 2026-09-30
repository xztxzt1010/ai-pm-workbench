import { describe, expect, it } from "vitest"

import { providerCredentialUiState } from "@/domain/provider-credential-status"

describe("provider credential status", () => {
  it("keeps invalid credentials replaceable and deletable", () => {
    expect(providerCredentialUiState("invalid")).toEqual({
      hasStoredCredential: true,
      invalid: true,
      placeholder: "已保存的 Key 无效（输入新值可替换）",
    })
  })

  it("only exposes the delete action for stored credentials", () => {
    expect(providerCredentialUiState("valid").hasStoredCredential).toBe(true)
    expect(providerCredentialUiState("missing").hasStoredCredential).toBe(false)
    expect(providerCredentialUiState("unavailable").hasStoredCredential).toBe(false)
  })

  it("does not collapse an unavailable status into a missing credential message", () => {
    expect(providerCredentialUiState("unavailable").placeholder).toBe("无法读取凭据状态")
    expect(providerCredentialUiState("missing").placeholder).toBe("仅写入 Windows 凭据存储")
  })
})
