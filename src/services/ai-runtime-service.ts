import { invoke } from "@tauri-apps/api/core"

export type AiRuntimeState = "starting" | "restarting" | "available" | "degraded" | "stopped" | "preview"

export interface AiRuntimeStatus {
  state: AiRuntimeState
  host?: string
  port?: number
  protocolVersion?: number
  restartCount: number
  message: string
}

export async function loadAiRuntimeStatus(desktopRuntime: boolean): Promise<AiRuntimeStatus> {
  if (!desktopRuntime) {
    return { state: "preview", restartCount: 0, message: "浏览器预览不启动 Sidecar；AI 功能将在桌面应用中启用" }
  }
  return invoke<AiRuntimeStatus>("get_ai_runtime_status")
}
