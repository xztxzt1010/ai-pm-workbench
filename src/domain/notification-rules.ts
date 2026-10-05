import { isActionable } from "./confirmation-rules"
import type { ConfirmationItem } from "./models"

export const DEFAULT_REMINDER_TIME = "09:00"

export function isValidReminderTime(value: string) {
  return /^(?:[01]\d|2[0-3]):[0-5]\d$/.test(value)
}

export interface NotificationSchedule {
  confirmationItemId: string
  itemTitle: string
  scheduledAt: string
  deduplicationKey: string
}

function effectiveReminderTime(item: ConfirmationItem, defaultReminderTime: string) {
  return item.dueTime || (isValidReminderTime(defaultReminderTime) ? defaultReminderTime : DEFAULT_REMINDER_TIME)
}

function localScheduleDate(item: ConfirmationItem, defaultReminderTime: string) {
  const time = effectiveReminderTime(item, defaultReminderTime)
  return new Date(`${item.dueDate}T${time}:00`)
}

export function notificationDeduplicationKey(item: ConfirmationItem, defaultReminderTime = DEFAULT_REMINDER_TIME) {
  return `confirmation:${item.id}:${item.dueDate}:${effectiveReminderTime(item, defaultReminderTime)}`
}

export function buildNotificationSchedule(item: ConfirmationItem, defaultReminderTime = DEFAULT_REMINDER_TIME): NotificationSchedule | undefined {
  if (!isActionable(item)) return undefined
  const date = localScheduleDate(item, defaultReminderTime)
  if (Number.isNaN(date.getTime())) return undefined
  return {
    confirmationItemId: item.id,
    itemTitle: item.title,
    scheduledAt: date.toISOString(),
    deduplicationKey: notificationDeduplicationKey(item, defaultReminderTime),
  }
}

export function dueNotificationSchedules(items: ConfirmationItem[], now = new Date(), defaultReminderTime = DEFAULT_REMINDER_TIME) {
  return notificationSchedules(items, defaultReminderTime)
    .filter((schedule) => new Date(schedule.scheduledAt).getTime() <= now.getTime())
    .sort((a, b) => a.scheduledAt.localeCompare(b.scheduledAt))
}

export function notificationSchedules(items: ConfirmationItem[], defaultReminderTime = DEFAULT_REMINDER_TIME) {
  return items
    .map((item) => buildNotificationSchedule(item, defaultReminderTime))
    .filter((schedule): schedule is NotificationSchedule => Boolean(schedule))
}
