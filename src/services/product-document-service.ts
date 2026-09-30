import { invoke } from "@tauri-apps/api/core"

import { AppError } from "@/domain/app-error"

export type ProductDocumentType = "prd" | "design_brief" | "markdown"
export type ProductDocumentStatus = "draft" | "confirmed" | "archived"

export interface ProductDocument {
  id: string
  projectId: string
  title: string
  documentType: ProductDocumentType
  status: ProductDocumentStatus
  versionNumber: number
  contentMarkdown: string
  sourceJson: string
  changeSummary: string
  createdBy: "user" | "agent"
  createdAt: string
  updatedAt: string
}

export interface ProductDocumentVersion {
  id: string
  documentId: string
  versionNumber: number
  contentMarkdown: string
  changeSummary: string
  createdBy: "user" | "agent"
  createdAt: string
}

function requireDesktop(desktopRuntime: boolean) {
  if (!desktopRuntime) throw new AppError("permission", "产品文档仅在桌面应用中保存")
}

export async function listProductDocuments(desktopRuntime: boolean, projectId: string): Promise<ProductDocument[]> {
  if (!desktopRuntime) return []
  return invoke<ProductDocument[]>("list_product_documents", { projectId })
}

export async function createProductDocument(desktopRuntime: boolean, input: { id: string; projectId: string; title: string; documentType: ProductDocumentType; contentMarkdown: string; changeSummary?: string; sourceJson?: string }): Promise<ProductDocument> {
  requireDesktop(desktopRuntime)
  return invoke<ProductDocument>("create_product_document", { request: input })
}

export async function createProductDocumentVersion(desktopRuntime: boolean, input: { projectId: string; documentId: string; contentMarkdown: string; changeSummary: string; sourceJson?: string }): Promise<ProductDocument> {
  requireDesktop(desktopRuntime)
  return invoke<ProductDocument>("create_product_document_version", input)
}

export async function listProductDocumentVersions(desktopRuntime: boolean, projectId: string, documentId: string): Promise<ProductDocumentVersion[]> {
  if (!desktopRuntime) return []
  return invoke<ProductDocumentVersion[]>("list_product_document_versions", { projectId, documentId })
}

export async function archiveProductDocument(desktopRuntime: boolean, projectId: string, documentId: string): Promise<void> {
  requireDesktop(desktopRuntime)
  await invoke("archive_product_document", { projectId, documentId })
}

export async function exportProductDocument(desktopRuntime: boolean, input: { title: string; contentMarkdown: string; format: "docx" | "pdf" }): Promise<string | null> {
  requireDesktop(desktopRuntime)
  const { save } = await import("@tauri-apps/plugin-dialog")
  const target = await save({ defaultPath: `${input.title}.${input.format}`, filters: [{ name: input.format.toUpperCase(), extensions: [input.format] }] })
  if (!target) return null
  await invoke(input.format === "docx" ? "export_product_document_docx" : "export_product_document_pdf", { title: input.title, contentMarkdown: input.contentMarkdown, targetPath: target })
  return target
}

export interface AnalysisDatasetRecord { id: string; projectId: string; title: string; sourceType: "csv" | "json"; sourceFormat: "csv" | "json" | "xlsx"; schemaJson: string; rowsJson: string; contentHash: string; createdAt: string }

export async function createAnalysisDataset(desktopRuntime: boolean, input: { id: string; projectId: string; title: string; sourceType: "csv" | "json"; sourceFormat: "csv" | "json" | "xlsx"; schemaJson: string; rowsJson: string; contentHash: string }): Promise<AnalysisDatasetRecord> {
  requireDesktop(desktopRuntime)
  return invoke<AnalysisDatasetRecord>("create_analysis_dataset", { request: input })
}

export async function listAnalysisDatasets(desktopRuntime: boolean, projectId: string): Promise<AnalysisDatasetRecord[]> {
  if (!desktopRuntime) return []
  return invoke<AnalysisDatasetRecord[]>("list_analysis_datasets", { projectId })
}

export async function createAnalysisRun(desktopRuntime: boolean, input: { id: string; projectId: string; datasetId: string; operator: "summary" | "funnel" | "cohort" | "trend"; parametersJson: string; resultJson: string }): Promise<void> {
  requireDesktop(desktopRuntime)
  await invoke("create_analysis_run", { request: input })
}

export type AnalysisInsightStatus = "draft" | "confirmed" | "archived"
export type AnalysisInsightTargetKind = "project" | "requirement" | "experiment"
export interface AnalysisInsightRecord {
  id: string
  projectId: string
  analysisRunId: string
  title: string
  content: string
  status: AnalysisInsightStatus
  createdBy: "user" | "agent"
  targetKind: AnalysisInsightTargetKind
  targetId: string
  targetVersionId: string
  createdAt: string
  updatedAt: string
}

export async function createAnalysisInsight(desktopRuntime: boolean, input: { id: string; linkId: string; projectId: string; analysisRunId: string; title: string; content: string; targetKind: AnalysisInsightTargetKind; targetId: string; targetVersionId: string; createdBy: "user" | "agent" }): Promise<AnalysisInsightRecord> {
  requireDesktop(desktopRuntime)
  return invoke<AnalysisInsightRecord>("create_analysis_insight", { request: input })
}

export async function listAnalysisInsights(desktopRuntime: boolean, projectId: string): Promise<AnalysisInsightRecord[]> {
  if (!desktopRuntime) return []
  return invoke<AnalysisInsightRecord[]>("list_analysis_insights", { projectId })
}

export async function reviewAnalysisInsight(desktopRuntime: boolean, projectId: string, insightId: string, action: "confirm" | "archive"): Promise<void> {
  requireDesktop(desktopRuntime)
  await invoke("review_analysis_insight", { projectId, insightId, action })
}

export async function createExperiment(desktopRuntime: boolean, input: { id: string; projectId: string; name: string; hypothesis: string; primaryMetric: string; samplePlan: string; startDate: string; endDate: string; status: "draft" | "running" | "completed" | "cancelled"; conclusion: string; decision: string }): Promise<unknown> {
  requireDesktop(desktopRuntime)
  return invoke("create_experiment", { request: input })
}

export async function createExperimentResult(desktopRuntime: boolean, input: { id: string; experimentId: string; resultJson: string; analysisJson: string }): Promise<void> {
  requireDesktop(desktopRuntime)
  await invoke("create_experiment_result", input)
}

export interface ExperimentRecord { id: string; projectId: string; versionNumber: number; name: string; hypothesis: string; primaryMetric: string; samplePlan: string; startDate: string; endDate: string; status: "draft" | "running" | "completed" | "cancelled"; conclusion: string; decision: string; createdAt: string }
export async function listExperiments(desktopRuntime: boolean, projectId: string): Promise<ExperimentRecord[]> {
  if (!desktopRuntime) return []
  return invoke<ExperimentRecord[]>("list_experiments", { projectId })
}

export interface MetricDefinitionRecord { id: string; projectId: string; versionNumber: number; name: string; description: string; unit: string; formulaJson: string; sourceDatasetId: string; createdAt: string }
export async function createMetricDefinition(desktopRuntime: boolean, input: { id: string; projectId: string; name: string; description: string; unit: string; formulaJson: string; sourceDatasetId: string }): Promise<MetricDefinitionRecord> {
  requireDesktop(desktopRuntime)
  return invoke<MetricDefinitionRecord>("create_metric_definition", { request: input })
}
export async function listMetricDefinitions(desktopRuntime: boolean, projectId: string): Promise<MetricDefinitionRecord[]> {
  if (!desktopRuntime) return []
  return invoke<MetricDefinitionRecord[]>("list_metric_definitions", { projectId })
}
