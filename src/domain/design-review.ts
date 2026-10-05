import type { DesignBrief } from "@/domain/design-brief"

export type DesignReviewSeverity = "info" | "warning" | "critical"
export type DesignReviewCategory = "structure" | "layout" | "flow" | "copy" | "state" | "accessibility"
export interface DesignReviewFinding { id: string; severity: DesignReviewSeverity; category: DesignReviewCategory; targetId?: string; message: string; recommendation: string }
export interface DesignReviewResult { passed: boolean; criticalCount: number; warningCount: number; findings: DesignReviewFinding[] }

const REQUIRED_STATES = [
  { key: "empty", labels: ["empty", "空"] },
  { key: "loading", labels: ["loading", "加载"] },
  { key: "error", labels: ["error", "错误", "失败"] },
  { key: "permission", labels: ["permission", "权限", "无权"] },
]

export function reviewDesignBrief(brief: DesignBrief): DesignReviewResult {
  const findings: DesignReviewFinding[] = []
  const add = (finding: DesignReviewFinding) => findings.push(finding)
  const nodeIds = new Set<string>()
  for (const node of brief.nodes) {
    if (nodeIds.has(node.id)) add({ id: `duplicate:${node.id}`, severity: "critical", category: "structure", targetId: node.id, message: `节点 ID “${node.id}” 重复`, recommendation: "为每个节点分配唯一 ID。" })
    nodeIds.add(node.id)
    if (node.x + node.width > brief.viewport.width || node.y + node.height > brief.viewport.height) add({ id: `overflow:${node.id}`, severity: "critical", category: "layout", targetId: node.id, message: `节点“${node.id}”超出画布`, recommendation: "缩小节点或调整坐标，使其完全处于 viewport 内。" })
    if (!node.label.trim()) add({ id: `copy:${node.id}`, severity: "warning", category: "copy", targetId: node.id, message: `节点“${node.id}”缺少可见文案`, recommendation: "补充清晰、面向用户的标签或占位提示。" })
    if (["button", "input", "nav"].includes(node.type) && (node.width < 44 || node.height < 44)) add({ id: `target:${node.id}`, severity: "warning", category: "accessibility", targetId: node.id, message: `交互节点“${node.id}”尺寸小于 44×44`, recommendation: "增大可点击区域以支持触控和行动不便用户。" })
  }
  const flowIds = new Set<string>()
  for (const flow of brief.flows) {
    if (flowIds.has(flow.id)) add({ id: `flow-duplicate:${flow.id}`, severity: "critical", category: "flow", targetId: flow.id, message: `流程 ID “${flow.id}”重复`, recommendation: "为每条流程分配唯一 ID。" })
    flowIds.add(flow.id)
    if (!nodeIds.has(flow.fromNodeId) || !nodeIds.has(flow.toNodeId)) add({ id: `flow-reference:${flow.id}`, severity: "critical", category: "flow", targetId: flow.id, message: `流程“${flow.id}”引用了不存在的节点`, recommendation: "修正 fromNodeId/toNodeId，确保两端节点均存在。" })
    if (!flow.trigger.trim()) add({ id: `flow-trigger:${flow.id}`, severity: "warning", category: "flow", targetId: flow.id, message: `流程“${flow.id}”缺少触发条件`, recommendation: "说明点击、提交、超时或系统事件等触发方式。" })
  }
  const stateText = brief.states.map((state) => `${state.id} ${state.name}`.toLowerCase()).join(" ")
  for (const state of REQUIRED_STATES) if (!state.labels.some((label) => stateText.includes(label))) add({ id: `state:${state.key}`, severity: "warning", category: "state", targetId: state.key, message: `缺少${state.labels.at(-1)}状态`, recommendation: `补充 ${state.key} 状态及用户可执行的恢复路径。` })
  if (!brief.accessibility.keyboard) add({ id: "a11y:keyboard", severity: "critical", category: "accessibility", message: "未声明键盘可访问", recommendation: "补充完整键盘操作顺序和快捷方式。" })
  if (!brief.accessibility.focusVisible) add({ id: "a11y:focus", severity: "critical", category: "accessibility", message: "未声明可见焦点", recommendation: "为所有交互控件提供清晰的焦点样式。" })
  if (!brief.accessibility.contrast) add({ id: "a11y:contrast", severity: "warning", category: "accessibility", message: "未声明对比度检查", recommendation: "按 WCAG 对文字和控件状态进行对比度检查。" })
  const criticalCount = findings.filter((finding) => finding.severity === "critical").length
  return { passed: criticalCount === 0, criticalCount, warningCount: findings.filter((finding) => finding.severity === "warning").length, findings }
}
