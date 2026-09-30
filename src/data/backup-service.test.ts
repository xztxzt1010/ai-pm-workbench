import { invoke } from "@tauri-apps/api/core"
import { confirm, open, save } from "@tauri-apps/plugin-dialog"
import { beforeEach, describe, expect, it, vi } from "vitest"

import { closeDesktopDatabase } from "@/data/desktop-database"
import { exportBackup, selectAndRestoreBackup, type BackupInfo } from "@/data/backup-service"

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }))
vi.mock("@tauri-apps/plugin-dialog", () => ({ confirm: vi.fn(), open: vi.fn(), save: vi.fn() }))
vi.mock("@/data/desktop-database", () => ({ closeDesktopDatabase: vi.fn() }))

const backup: BackupInfo = {
  path: "C:\\AppData\\backups\\manual-1.db",
  fileName: "manual-1.db",
  size: 4096,
  createdAtEpochMs: 1,
}

beforeEach(() => vi.resetAllMocks())

describe("backup service", () => {
  it("does not close the database when restore file selection is cancelled", async () => {
    vi.mocked(open).mockResolvedValue(null)

    await expect(selectAndRestoreBackup()).resolves.toBe(false)

    expect(confirm).not.toHaveBeenCalled()
    expect(closeDesktopDatabase).not.toHaveBeenCalled()
    expect(invoke).not.toHaveBeenCalled()
  })

  it("does not close the database when destructive restore confirmation is declined", async () => {
    vi.mocked(open).mockResolvedValue("C:\\Downloads\\backup.db")
    vi.mocked(confirm).mockResolvedValue(false)

    await expect(selectAndRestoreBackup()).resolves.toBe(false)

    expect(closeDesktopDatabase).not.toHaveBeenCalled()
    expect(invoke).not.toHaveBeenCalled()
  })

  it("closes SQLite before invoking the validated desktop restore", async () => {
    const order: string[] = []
    vi.mocked(open).mockResolvedValue("C:\\Downloads\\backup.db")
    vi.mocked(confirm).mockResolvedValue(true)
    vi.mocked(closeDesktopDatabase).mockImplementation(async () => { order.push("close") })
    vi.mocked(invoke).mockImplementation(async () => { order.push("restore") })

    await expect(selectAndRestoreBackup()).resolves.toBe(true)

    expect(order).toEqual(["close", "restore"])
    expect(invoke).toHaveBeenCalledWith("restore_backup", { sourcePath: "C:\\Downloads\\backup.db" })
  })

  it("propagates restore failures instead of reporting success", async () => {
    vi.mocked(open).mockResolvedValue("C:\\Downloads\\corrupt.db")
    vi.mocked(confirm).mockResolvedValue(true)
    vi.mocked(invoke).mockRejectedValue(new Error("备份完整性检查失败"))

    await expect(selectAndRestoreBackup()).rejects.toThrow("备份完整性检查失败")
    expect(closeDesktopDatabase).toHaveBeenCalledOnce()
  })

  it("exports only after the user selects a destination", async () => {
    vi.mocked(save).mockResolvedValue(null)
    await expect(exportBackup(backup)).resolves.toBe(false)
    expect(invoke).not.toHaveBeenCalled()

    vi.mocked(save).mockResolvedValue("D:\\Exports\\manual-1.db")
    await expect(exportBackup(backup)).resolves.toBe(true)
    expect(invoke).toHaveBeenCalledWith("export_backup", {
      sourcePath: backup.path,
      targetPath: "D:\\Exports\\manual-1.db",
    })
  })
})
