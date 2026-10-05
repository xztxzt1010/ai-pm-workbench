import { compareAsc, endOfDay, isSameDay, parseISO, startOfDay } from "date-fns"

import type { ConfirmationItem } from "./models"

export function isActionable(item: ConfirmationItem) {
  return item.status === "pending" || item.status === "postponed"
}

export function isDueToday(item: ConfirmationItem, now = new Date()) {
  return isActionable(item) && isSameDay(parseISO(item.dueDate), now)
}

export function isOverdue(item: ConfirmationItem, now = new Date()) {
  return isActionable(item) && compareAsc(parseISO(item.dueDate), startOfDay(now)) < 0
}

export function dueByEndOfToday(items: ConfirmationItem[], now = new Date()) {
  const todayEnd = endOfDay(now)
  return items
    .filter((item) => isActionable(item) && compareAsc(parseISO(item.dueDate), todayEnd) <= 0)
    .sort((a, b) => compareAsc(parseISO(a.dueDate), parseISO(b.dueDate)))
}

export function postponeItem(item: ConfirmationItem, dueDate: string): ConfirmationItem {
  return {
    ...item,
    dueDate,
    status: "postponed",
    updatedAt: new Date().toISOString(),
  }
}

export function completeItem(item: ConfirmationItem, conclusion = ""): ConfirmationItem {
  return {
    ...item,
    conclusion,
    status: "confirmed",
    updatedAt: new Date().toISOString(),
  }
}
