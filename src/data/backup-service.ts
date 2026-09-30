import { invoke } from "@tauri-apps/api/core"
import { confirm, open, save } from "@tauri-apps/plugin-dialog"

import { closeDesktopDatabase } from "@/data/desktop-database"

export interface BackupInfo {
  path: string
  fileName: string
  size: number
  createdAtEpochMs: number
}

export function listBackups() {
  return invoke<BackupInfo[]>("list_backups")
}

export function createBackup() {
  return invoke<BackupInfo>("create_backup")
}

export async function exportBackup(backup: BackupInfo) {
  const target = await save({
    title: "导出产品经理工作台备份",
    defaultPath: backup.fileName,
    filters: [{ name: "SQLite 数据库备份", extensions: ["db"] }],
  })
  if (!target) return false
  await invoke("export_backup", { sourcePath: backup.path, targetPath: target })
  return true
}

export async function selectAndRestoreBackup() {
  const source = await open({
    title: "选择要恢复的工作台备份",
    multiple: false,
    directory: false,
    filters: [{ name: "SQLite 数据库备份", extensions: ["db", "sqlite", "sqlite3"] }],
  })
  if (!source || Array.isArray(source)) return false
  const approved = await confirm(
    "恢复会替换当前工作台数据。应用会先自动保存当前数据库，然后重启。是否继续？",
    { title: "恢复本地数据", kind: "warning", okLabel: "恢复并重启", cancelLabel: "取消" },
  )
  if (!approved) return false
  await closeDesktopDatabase()
  await invoke("restore_backup", { sourcePath: source })
  return true
}
