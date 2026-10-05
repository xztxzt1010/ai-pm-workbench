import { getRequirementRepository } from "@/data/requirement-repository"
import type { ConfirmationItem, Milestone, Project } from "@/domain/models"
import { buildProjectContext } from "@/domain/project-context"
import { listKnowledgeItems } from "@/services/knowledge-service"
import { listProductDecisions } from "@/services/product-decision-service"
import { listProductDocuments } from "@/services/product-document-service"
import { listProjectRisks } from "@/services/project-risk-service"
import { listReleases } from "@/services/release-service"

const CONTEXT_QUERY_LIMIT = 100

export async function loadProjectContext(input: {
  project: Project
  milestones: Milestone[]
  confirmations: ConfirmationItem[]
  desktopRuntime: boolean
  generatedAt?: string
}) {
  const projectId = input.project.id
  const [requirements, documents, knowledgeItems, risks, decisions, releases] = await Promise.all([
    getRequirementRepository(input.desktopRuntime).listByProject(projectId, CONTEXT_QUERY_LIMIT),
    listProductDocuments(input.desktopRuntime, projectId),
    listKnowledgeItems(input.desktopRuntime, { domain: "project", projectId, limit: CONTEXT_QUERY_LIMIT }),
    listProjectRisks(input.desktopRuntime, projectId),
    listProductDecisions(input.desktopRuntime, projectId),
    listReleases(input.desktopRuntime, projectId),
  ])
  return buildProjectContext({
    project: input.project,
    milestones: input.milestones,
    confirmations: input.confirmations,
    requirements: requirements.slice(0, CONTEXT_QUERY_LIMIT),
    documents: documents.slice(0, CONTEXT_QUERY_LIMIT),
    knowledgeItems: knowledgeItems.slice(0, CONTEXT_QUERY_LIMIT),
    risks: risks.slice(0, CONTEXT_QUERY_LIMIT),
    decisions: decisions.slice(0, CONTEXT_QUERY_LIMIT),
    releases: releases.slice(0, CONTEXT_QUERY_LIMIT),
    generatedAt: input.generatedAt ?? new Date().toISOString(),
  })
}
