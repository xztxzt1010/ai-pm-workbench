import type { ConfirmationItem, Milestone, Project, WorkspaceData } from "@/domain/models"

const STORAGE_KEY = "assistant-product-manager.workspace.v1"

const now = new Date().toISOString()
const today = new Date().toISOString().slice(0, 10)
const yesterday = new Date(Date.now() - 86_400_000).toISOString().slice(0, 10)
const nextWeek = new Date(Date.now() + 7 * 86_400_000).toISOString().slice(0, 10)

export const initialWorkspace: WorkspaceData = {
  projects: [
    {
      id: "project-apm",
      name: "Assistant Product Manager",
      goal: "交付可安装、可追踪项目与分析会议需求的个人桌面工作台",
      status: "active",
      startDate: today,
      endDate: nextWeek,
      progress: 18,
      updatedAt: now,
    },
  ],
  milestones: [
    {
      id: "milestone-foundation",
      projectId: "project-apm",
      title: "桌面底座与计划工程师纵向切片",
      dueDate: nextWeek,
      progress: 35,
    },
  ],
  confirmationItems: [
    {
      id: "confirmation-scope",
      projectId: "project-apm",
      milestoneId: "milestone-foundation",
      title: "确认首个纵向切片的验收范围",
      dueDate: today,
      priority: "high",
      status: "pending",
      notes: "覆盖项目、确认事项和今日驾驶舱。",
      createdAt: now,
      updatedAt: now,
    },
    {
      id: "confirmation-rust",
      projectId: "project-apm",
      title: "安装 Rust 工具链以启用 Tauri 原生构建",
      dueDate: yesterday,
      priority: "medium",
      status: "confirmed",
      conclusion: "Rust/Cargo 1.97.0 stable（MSVC toolchain）已安装并通过原生构建验证。",
      createdAt: now,
      updatedAt: now,
    },
  ],
  meetings: [],
}

export function loadWorkspace(): WorkspaceData {
  try {
    const saved = localStorage.getItem(STORAGE_KEY)
    const workspace = saved ? (JSON.parse(saved) as WorkspaceData) : initialWorkspace
    return {
      ...workspace,
      confirmationItems: workspace.confirmationItems.map((item) => (
        item.id === "confirmation-rust" && item.status === "pending"
          ? {
              ...item,
              status: "confirmed",
              conclusion: "Rust/Cargo 1.97.0 stable（MSVC toolchain）已安装并通过原生构建验证。",
              updatedAt: new Date().toISOString(),
            }
          : item
      )),
    }
  } catch {
    return initialWorkspace
  }
}

export function saveWorkspace(data: WorkspaceData) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(data))
}

export function createProject(input: Pick<Project, "name" | "goal" | "startDate" | "endDate">): Project {
  return {
    ...input,
    id: crypto.randomUUID(),
    status: "active",
    progress: 0,
    updatedAt: new Date().toISOString(),
  }
}

export function createConfirmation(
  input: Pick<ConfirmationItem, "title" | "projectId" | "dueDate" | "priority">,
): ConfirmationItem {
  const timestamp = new Date().toISOString()
  return {
    ...input,
    id: crypto.randomUUID(),
    status: "pending",
    createdAt: timestamp,
    updatedAt: timestamp,
  }
}

export function createMilestone(
  input: Pick<Milestone, "projectId" | "title" | "dueDate" | "progress">,
): Milestone {
  return {
    ...input,
    id: crypto.randomUUID(),
  }
}
