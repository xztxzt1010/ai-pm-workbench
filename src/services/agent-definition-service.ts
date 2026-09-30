import { invoke } from "@tauri-apps/api/core"

export interface AgentDefinitionPermissions {
  dataScope?: string
  allowedTools?: string[]
  businessWriteAccess?: boolean
  syntheticInputOnly?: boolean
  [key: string]: unknown
}

interface AgentDefinitionRow {
  id: string
  definitionKey: string
  version: number
  name: string
  description: string
  inputSchemaVersion: string
  outputSchemaVersion: string
  permissionsJson: string
  createdAt: string
}

export interface AgentDefinition extends Omit<AgentDefinitionRow, "permissionsJson"> {
  permissions: AgentDefinitionPermissions
}

function parsePermissions(value: string): AgentDefinitionPermissions {
  try {
    const parsed: unknown = JSON.parse(value)
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed as AgentDefinitionPermissions : {}
  } catch {
    return {}
  }
}

export async function listAgentDefinitions(desktopRuntime: boolean): Promise<AgentDefinition[]> {
  if (!desktopRuntime) return []
  const rows = await invoke<AgentDefinitionRow[]>("list_agent_definitions")
  return rows.map(({ permissionsJson, ...row }) => ({ ...row, permissions: parsePermissions(permissionsJson) }))
}
