import { isTauri } from "@tauri-apps/api/core"
import Database from "@tauri-apps/plugin-sql"

import type { ConfirmationItem, Meeting, Milestone, NotificationRecord, Project, WorkspaceData } from "@/domain/models"
import { DEFAULT_REMINDER_TIME, isValidReminderTime, notificationSchedules } from "@/domain/notification-rules"

const DATABASE_URL = "sqlite:assistant-product-manager.db"

type ProjectRow = {
  id: string
  name: string
  goal: string
  status: Project["status"]
  start_date: string
  end_date: string
  progress: number
  updated_at: string
  archived_at: string | null
  background: string
  phase: string
  target_users: string
  core_problem: string
  success_metrics: string
  constraints: string
  owner: string
  roles: string
}

type MilestoneRow = {
  id: string
  project_id: string
  title: string
  due_date: string
  progress: number
}

type ConfirmationRow = {
  id: string
  project_id: string
  milestone_id: string | null
  title: string
  due_date: string
  due_time: string | null
  priority: ConfirmationItem["priority"]
  status: ConfirmationItem["status"]
  conclusion: string | null
  notes: string | null
  created_at: string
  updated_at: string
}

type MeetingRow = {
  id: string
  title: string
  meeting_date: string
  project_id: string | null
  source_type: Meeting["sourceType"] | null
  status: Meeting["status"]
  created_at: string
  updated_at: string
}

export function isDesktopRuntime() {
  return isTauri()
}

let databasePromise: Promise<Database> | undefined

export async function openDesktopDatabase() {
  databasePromise ??= Database.load(DATABASE_URL)
  return databasePromise
}

export async function closeDesktopDatabase() {
  if (!databasePromise) return
  const db = await databasePromise
  await db.close()
  databasePromise = undefined
}

export async function loadDesktopWorkspace(): Promise<WorkspaceData> {
  const db = await openDesktopDatabase()
  const [projectRows, milestoneRows, confirmationRows, meetingRows] = await Promise.all([
    db.select<ProjectRow[]>("SELECT * FROM projects ORDER BY updated_at DESC"),
    db.select<MilestoneRow[]>("SELECT * FROM milestones ORDER BY due_date ASC"),
    db.select<ConfirmationRow[]>("SELECT * FROM confirmation_items ORDER BY due_date ASC"),
    db.select<MeetingRow[]>(
      `SELECT meetings.id, meetings.title, meetings.meeting_date, meetings.project_id,
              meetings.status, meetings.created_at, meetings.updated_at, meeting_sources.source_type
       FROM meetings
       LEFT JOIN meeting_sources ON meeting_sources.meeting_id = meetings.id
       GROUP BY meetings.id
       ORDER BY meetings.meeting_date DESC`,
    ),
  ])

  return {
    projects: projectRows.map((row) => ({
      id: row.id,
      name: row.name,
      goal: row.goal,
      status: row.status,
      startDate: row.start_date,
      endDate: row.end_date,
      progress: row.progress,
      updatedAt: row.updated_at,
      archivedAt: row.archived_at ?? undefined,
      background: row.background,
      phase: row.phase,
      targetUsers: row.target_users,
      coreProblem: row.core_problem,
      successMetrics: row.success_metrics,
      constraints: row.constraints,
      owner: row.owner,
      roles: row.roles,
    })),
    milestones: milestoneRows.map((row): Milestone => ({
      id: row.id,
      projectId: row.project_id,
      title: row.title,
      dueDate: row.due_date,
      progress: row.progress,
    })),
    confirmationItems: confirmationRows.map((row): ConfirmationItem => ({
      id: row.id,
      projectId: row.project_id,
      milestoneId: row.milestone_id ?? undefined,
      title: row.title,
      dueDate: row.due_date,
      dueTime: row.due_time ?? undefined,
      priority: row.priority,
      status: row.status,
      conclusion: row.conclusion ?? undefined,
      notes: row.notes ?? undefined,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    })),
    meetings: meetingRows.map((row): Meeting => ({
      id: row.id,
      title: row.title,
      meetingDate: row.meeting_date,
      projectId: row.project_id ?? undefined,
      sourceType: row.source_type ?? "paste",
      status: row.status,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    })),
  }
}

export async function persistProject(project: Project) {
  const db = await openDesktopDatabase()
  await db.execute(
    `INSERT INTO projects
     (id, name, goal, status, start_date, end_date, progress, created_at, updated_at, archived_at,
      background, phase, target_users, core_problem, success_metrics, constraints, owner, roles)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18)
     ON CONFLICT(id) DO UPDATE SET
       name = excluded.name, goal = excluded.goal, status = excluded.status,
       start_date = excluded.start_date, end_date = excluded.end_date,
       progress = excluded.progress, updated_at = excluded.updated_at,
       archived_at = excluded.archived_at, background = excluded.background,
       phase = excluded.phase, target_users = excluded.target_users,
       core_problem = excluded.core_problem, success_metrics = excluded.success_metrics,
       constraints = excluded.constraints, owner = excluded.owner, roles = excluded.roles`,
    [project.id, project.name, project.goal, project.status, project.startDate, project.endDate, project.progress, project.updatedAt, project.updatedAt, project.archivedAt ?? null,
      project.background ?? "", project.phase ?? "", project.targetUsers ?? "", project.coreProblem ?? "", project.successMetrics ?? "", project.constraints ?? "", project.owner ?? "", project.roles ?? ""],
  )
}

export async function persistConfirmationItem(item: ConfirmationItem, database?: Database) {
  const db = database ?? await openDesktopDatabase()
  await db.execute(
    `INSERT INTO confirmation_items
     (id, project_id, milestone_id, title, due_date, due_time, priority, status, conclusion, notes, created_at, updated_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
     ON CONFLICT(id) DO UPDATE SET
       project_id = excluded.project_id, milestone_id = excluded.milestone_id,
       title = excluded.title, due_date = excluded.due_date, due_time = excluded.due_time,
       priority = excluded.priority, status = excluded.status,
       conclusion = excluded.conclusion, notes = excluded.notes, updated_at = excluded.updated_at`,
    [item.id, item.projectId, item.milestoneId ?? null, item.title, item.dueDate, item.dueTime ?? null,
      item.priority, item.status, item.conclusion ?? null, item.notes ?? null, item.createdAt, item.updatedAt],
  )
}

export async function persistMilestone(milestone: Milestone) {
  const db = await openDesktopDatabase()
  const timestamp = new Date().toISOString()
  await db.execute(
    `INSERT INTO milestones
     (id, project_id, title, due_date, progress, created_at, updated_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7)
     ON CONFLICT(id) DO UPDATE SET
       project_id = excluded.project_id, title = excluded.title,
       due_date = excluded.due_date, progress = excluded.progress,
       updated_at = excluded.updated_at`,
    [milestone.id, milestone.projectId, milestone.title, milestone.dueDate, milestone.progress, timestamp, timestamp],
  )
}

export async function deleteMilestone(id: string) {
  const db = await openDesktopDatabase()
  await db.execute("DELETE FROM milestones WHERE id = $1", [id])
}

type NotificationRow = {
  id: string
  confirmation_item_id: string | null
  item_title: string | null
  scheduled_at: string
  delivered_at: string | null
  status: NotificationRecord["status"]
  deduplication_key: string
  error_summary: string | null
  created_at: string
}

function mapNotificationRow(row: NotificationRow): NotificationRecord {
  return {
    id: row.id,
    confirmationItemId: row.confirmation_item_id ?? undefined,
    itemTitle: row.item_title ?? "已删除的确认事项",
    scheduledAt: row.scheduled_at,
    deliveredAt: row.delivered_at ?? undefined,
    status: row.status,
    deduplicationKey: row.deduplication_key,
    errorSummary: row.error_summary ?? undefined,
    createdAt: row.created_at,
  }
}

export async function reconcileDueNotifications(items: ConfirmationItem[], now = new Date(), defaultReminderTime = DEFAULT_REMINDER_TIME) {
  const db = await openDesktopDatabase()
  const schedules = notificationSchedules(items, defaultReminderTime)
  const activeKeys = new Set(schedules.map((schedule) => schedule.deduplicationKey))
  const pendingRows = await db.select<Array<{ id: string; deduplication_key: string }>>(
    "SELECT id, deduplication_key FROM notifications WHERE status = 'scheduled'",
  )
  for (const row of pendingRows) {
    if (!activeKeys.has(row.deduplication_key)) {
      await db.execute(
        "UPDATE notifications SET status = 'skipped', error_summary = $1 WHERE id = $2 AND status = 'scheduled'",
        ["事项已完成、取消或重新排期", row.id],
      )
    }
  }

  for (const schedule of schedules) {
    await db.execute(
      `INSERT OR IGNORE INTO notifications
       (id, confirmation_item_id, scheduled_at, status, deduplication_key, created_at)
       VALUES ($1, $2, $3, 'scheduled', $4, $5)`,
      [crypto.randomUUID(), schedule.confirmationItemId, schedule.scheduledAt, schedule.deduplicationKey, now.toISOString()],
    )
  }

  const rows = await db.select<NotificationRow[]>(
    `SELECT notifications.*, confirmation_items.title AS item_title
     FROM notifications
     LEFT JOIN confirmation_items ON confirmation_items.id = notifications.confirmation_item_id
     WHERE notifications.status = 'scheduled' AND notifications.scheduled_at <= $1
     ORDER BY notifications.scheduled_at ASC`,
    [now.toISOString()],
  )
  return rows.map(mapNotificationRow)
}

export async function markNotificationResult(id: string, status: "delivered" | "failed", errorSummary?: string) {
  const db = await openDesktopDatabase()
  await db.execute(
    `UPDATE notifications
     SET status = $1, delivered_at = CASE WHEN $1 = 'delivered' THEN $2 ELSE NULL END, error_summary = $3
     WHERE id = $4`,
    [status, new Date().toISOString(), errorSummary ?? null, id],
  )
}

export async function loadNotificationHistory(limit = 100) {
  const db = await openDesktopDatabase()
  const rows = await db.select<NotificationRow[]>(
    `SELECT notifications.*, confirmation_items.title AS item_title
     FROM notifications
     LEFT JOIN confirmation_items ON confirmation_items.id = notifications.confirmation_item_id
     ORDER BY notifications.created_at DESC
     LIMIT $1`,
    [limit],
  )
  return rows.map(mapNotificationRow)
}

export async function loadReminderPaused() {
  const db = await openDesktopDatabase()
  const rows = await db.select<Array<{ value_json: string }>>(
    "SELECT value_json FROM app_settings WHERE key = 'reminders_paused' LIMIT 1",
  )
  if (!rows[0]) return false
  try {
    return JSON.parse(rows[0].value_json) === true
  } catch {
    return false
  }
}

export async function loadDefaultReminderTime() {
  const db = await openDesktopDatabase()
  const rows = await db.select<Array<{ value_json: string }>>(
    "SELECT value_json FROM app_settings WHERE key = 'default_reminder_time' LIMIT 1",
  )
  if (!rows[0]) return DEFAULT_REMINDER_TIME
  try {
    const value = JSON.parse(rows[0].value_json)
    return typeof value === "string" && isValidReminderTime(value) ? value : DEFAULT_REMINDER_TIME
  } catch {
    return DEFAULT_REMINDER_TIME
  }
}

export async function persistDefaultReminderTime(time: string) {
  if (!isValidReminderTime(time)) throw new Error("提醒时间必须是有效的 HH:mm")
  const db = await openDesktopDatabase()
  await db.execute(
    `INSERT INTO app_settings (key, value_json, updated_at)
     VALUES ('default_reminder_time', $1, $2)
     ON CONFLICT(key) DO UPDATE SET value_json = excluded.value_json, updated_at = excluded.updated_at`,
    [JSON.stringify(time), new Date().toISOString()],
  )
}

export async function persistReminderPaused(paused: boolean) {
  const db = await openDesktopDatabase()
  await db.execute(
    `INSERT INTO app_settings (key, value_json, updated_at)
     VALUES ('reminders_paused', $1, $2)
     ON CONFLICT(key) DO UPDATE SET value_json = excluded.value_json, updated_at = excluded.updated_at`,
    [JSON.stringify(paused), new Date().toISOString()],
  )
}
