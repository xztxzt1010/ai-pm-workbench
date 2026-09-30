import type { RequirementContent, RequirementVersion } from "@/domain/models"

export function requirementContentChanges(current: RequirementContent, previous?: RequirementContent) {
  if (!previous) return ["初始版本"]
  const changes: string[] = []
  if (current.description !== previous.description) changes.push("需求描述")
  if (current.targetUsers !== previous.targetUsers) changes.push("目标用户")
  if (current.scenario !== previous.scenario) changes.push("使用场景")
  if (current.painPoint !== previous.painPoint) changes.push("痛点")
  if (current.acceptanceCriteria.join("\n") !== previous.acceptanceCriteria.join("\n")) changes.push("验收标准")
  return changes
}

export function requirementVersionSummary(version: RequirementVersion, previous?: RequirementVersion) {
  const changes = requirementContentChanges(version.content, previous?.content)
  return {
    versionNumber: version.versionNumber,
    changes,
    evidenceCount: version.evidence.length,
    confirmed: version.isConfirmed,
  }
}
