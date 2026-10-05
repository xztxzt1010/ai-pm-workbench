import { z } from "zod"

import { AppError } from "@/domain/app-error"

export const DESIGN_BRIEF_SCHEMA_VERSION = "1.0.0"

const nodeSchema = z.object({
  id: z.string().min(1).max(100),
  type: z.enum(["frame", "text", "button", "input", "list", "nav", "badge"]),
  label: z.string().max(200),
  x: z.number().int().min(0).max(2000),
  y: z.number().int().min(0).max(2000),
  width: z.number().int().min(1).max(2000),
  height: z.number().int().min(1).max(2000),
  variant: z.enum(["default", "primary", "muted", "danger"]).optional(),
}).strict()

export const designBriefSchema = z.object({
  schemaVersion: z.literal(DESIGN_BRIEF_SCHEMA_VERSION),
  title: z.string().min(1).max(200),
  viewport: z.object({ width: z.number().int().min(320).max(1920), height: z.number().int().min(240).max(1200) }).strict(),
  nodes: z.array(nodeSchema).max(100),
  flows: z.array(z.object({ id: z.string().min(1).max(100), fromNodeId: z.string().min(1).max(100), toNodeId: z.string().min(1).max(100), trigger: z.string().max(200) }).strict()).max(50),
  states: z.array(z.object({ id: z.string().min(1).max(100), name: z.string().min(1).max(100), description: z.string().max(500) }).strict()).max(30),
  accessibility: z.object({ keyboard: z.boolean(), contrast: z.boolean(), focusVisible: z.boolean(), notes: z.string().max(1000) }).strict(),
}).strict()

export type DesignBrief = z.infer<typeof designBriefSchema>

export function validateDesignBrief(value: unknown): DesignBrief {
  const result = designBriefSchema.safeParse(value)
  if (!result.success) throw new AppError("validation", `Design Brief Schema 无效：${result.error.issues[0]?.message ?? "未知错误"}`)
  return result.data
}

export const DEFAULT_DESIGN_BRIEF: DesignBrief = {
  schemaVersion: DESIGN_BRIEF_SCHEMA_VERSION,
  title: "项目首页低保真稿",
  viewport: { width: 960, height: 640 },
  nodes: [
    { id: "nav", type: "nav", label: "产品名称    首页  项目  设置", x: 24, y: 24, width: 912, height: 48, variant: "muted" },
    { id: "title", type: "text", label: "欢迎回来", x: 48, y: 112, width: 360, height: 44 },
    { id: "search", type: "input", label: "搜索项目", x: 48, y: 184, width: 360, height: 44 },
    { id: "action", type: "button", label: "创建项目", x: 432, y: 184, width: 140, height: 44, variant: "primary" },
    { id: "list", type: "list", label: "项目卡片\n项目 A    进行中\n项目 B    已暂停", x: 48, y: 272, width: 864, height: 240, variant: "muted" },
  ],
  flows: [],
  states: [{ id: "default", name: "默认", description: "页面首次加载状态" }],
  accessibility: { keyboard: true, contrast: true, focusVisible: true, notes: "所有操作控件需要可键盘访问" },
}
