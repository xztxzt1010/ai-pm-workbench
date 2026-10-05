export type ProviderCredentialState = "not_applicable" | "missing" | "valid" | "invalid" | "unavailable"

export interface ProviderCredentialStatus {
  state: "missing" | "valid" | "invalid"
  message: string
}

export function providerCredentialUiState(state: ProviderCredentialState) {
  if (state === "invalid") {
    return {
      hasStoredCredential: true,
      invalid: true,
      placeholder: "已保存的 Key 无效（输入新值可替换）",
    }
  }
  if (state === "valid") {
    return {
      hasStoredCredential: true,
      invalid: false,
      placeholder: "已保存（输入新值可替换）",
    }
  }
  if (state === "unavailable") {
    return {
      hasStoredCredential: false,
      invalid: false,
      placeholder: "无法读取凭据状态",
    }
  }
  return {
    hasStoredCredential: false,
    invalid: false,
    placeholder: "仅写入 Windows 凭据存储",
  }
}
