import { beforeEach, describe, expect, it, vi } from "vitest"

const { invokeMock } = vi.hoisted(() => ({ invokeMock: vi.fn() }))
vi.mock("@tauri-apps/api/core", () => ({ invoke: invokeMock }))
vi.mock("@tauri-apps/plugin-dialog", () => ({ save: vi.fn().mockResolvedValue("C:\\Exports\\product.docx") }))

import { archiveProductDocument, createAnalysisDataset, createAnalysisInsight, createAnalysisRun, createProductDocument, createProductDocumentVersion, exportProductDocument, listAnalysisInsights, listExperiments, listProductDocumentVersions, listProductDocuments, reviewAnalysisInsight } from "@/services/product-document-service"

describe("product document service", () => {
  beforeEach(() => invokeMock.mockReset())

  it("keeps browser preview free of document database calls", async () => {
    await expect(listProductDocuments(false, "p1")).resolves.toEqual([])
    await expect(createProductDocument(false, { id: "d1", projectId: "p1", title: "PRD", documentType: "prd", contentMarkdown: "# PRD" })).rejects.toMatchObject({ code: "permission" })
    await expect(createProductDocumentVersion(false, { projectId: "p1", documentId: "d1", contentMarkdown: "# v2", changeSummary: "更新" })).rejects.toMatchObject({ code: "permission" })
    await expect(listProductDocumentVersions(false, "p1", "d1")).resolves.toEqual([])
    await expect(archiveProductDocument(false, "p1", "d1")).rejects.toMatchObject({ code: "permission" })
    expect(invokeMock).not.toHaveBeenCalled()
  })

  it("uses explicit project-scoped version commands", async () => {
    invokeMock.mockResolvedValueOnce([]).mockResolvedValueOnce({ id: "d1", versionNumber: 1 }).mockResolvedValueOnce({ id: "d1", versionNumber: 2 }).mockResolvedValueOnce([{ versionNumber: 2 }]).mockResolvedValueOnce(undefined)
    await listProductDocuments(true, "p1")
    await createProductDocument(true, { id: "d1", projectId: "p1", title: "PRD", documentType: "prd", contentMarkdown: "# PRD" })
    await createProductDocumentVersion(true, { projectId: "p1", documentId: "d1", contentMarkdown: "# v2", changeSummary: "更新" })
    await listProductDocumentVersions(true, "p1", "d1")
    await archiveProductDocument(true, "p1", "d1")
    expect(invokeMock).toHaveBeenNthCalledWith(1, "list_product_documents", { projectId: "p1" })
    expect(invokeMock).toHaveBeenNthCalledWith(2, "create_product_document", { request: expect.objectContaining({ projectId: "p1" }) })
    expect(invokeMock).toHaveBeenNthCalledWith(3, "create_product_document_version", { projectId: "p1", documentId: "d1", contentMarkdown: "# v2", changeSummary: "更新" })
    expect(invokeMock).toHaveBeenNthCalledWith(4, "list_product_document_versions", { projectId: "p1", documentId: "d1" })
    expect(invokeMock).toHaveBeenNthCalledWith(5, "archive_product_document", { projectId: "p1", documentId: "d1" })
  })

  it("exports through the desktop command and refuses browser mode", async () => {
    invokeMock.mockResolvedValue(undefined)
    await expect(exportProductDocument(false, { title: "PRD", contentMarkdown: "# Draft", format: "docx" })).rejects.toMatchObject({ code: "permission" })
    await expect(exportProductDocument(true, { title: "PRD", contentMarkdown: "# Draft", format: "docx" })).resolves.toBe("C:\\Exports\\product.docx")
    expect(invokeMock).toHaveBeenCalledWith("export_product_document_docx", { title: "PRD", contentMarkdown: "# Draft", targetPath: "C:\\Exports\\product.docx" })
  })

  it("persists the selected deterministic analysis operator", async () => {
    invokeMock.mockResolvedValue(undefined)
    await createAnalysisRun(true, { id: "run-1", projectId: "p1", datasetId: "d1", operator: "funnel", parametersJson: '{"fields":["visit","signup"]}', resultJson: "[]" })
    expect(invokeMock).toHaveBeenCalledWith("create_analysis_run", { request: expect.objectContaining({ operator: "funnel", datasetId: "d1" }) })
  })

  it("preserves the original xlsx source format while saving normalized rows", async () => {
    invokeMock.mockResolvedValue({ id: "d1", sourceFormat: "xlsx" })
    await createAnalysisDataset(true, { id: "d1", projectId: "p1", title: "销售表", sourceType: "json", sourceFormat: "xlsx", schemaJson: "[]", rowsJson: "[]", contentHash: "a".repeat(64) })
    expect(invokeMock).toHaveBeenCalledWith("create_analysis_dataset", { request: expect.objectContaining({ sourceType: "json", sourceFormat: "xlsx" }) })
  })

  it("keeps analysis insights project-scoped and desktop-only", async () => {
    await expect(listAnalysisInsights(false, "p1")).resolves.toEqual([])
    await expect(listExperiments(false, "p1")).resolves.toEqual([])
    await expect(createAnalysisInsight(false, { id: "i1", linkId: "l1", projectId: "p1", analysisRunId: "r1", title: "转化下降", content: "注册转化下降", targetKind: "project", targetId: "p1", targetVersionId: "", createdBy: "user" })).rejects.toMatchObject({ code: "permission" })
    expect(invokeMock).not.toHaveBeenCalled()
  })

  it("uses explicit versioned insight targets and review commands", async () => {
    const input = { id: "i1", linkId: "l1", projectId: "p1", analysisRunId: "r1", title: "转化下降", content: "注册转化下降", targetKind: "requirement" as const, targetId: "req1", targetVersionId: "rv2", createdBy: "user" as const }
    invokeMock.mockResolvedValueOnce({ ...input, status: "draft" }).mockResolvedValueOnce([]).mockResolvedValueOnce(undefined)
    await createAnalysisInsight(true, input)
    await listAnalysisInsights(true, "p1")
    await reviewAnalysisInsight(true, "p1", "i1", "confirm")
    expect(invokeMock).toHaveBeenNthCalledWith(1, "create_analysis_insight", { request: input })
    expect(invokeMock).toHaveBeenNthCalledWith(2, "list_analysis_insights", { projectId: "p1" })
    expect(invokeMock).toHaveBeenNthCalledWith(3, "review_analysis_insight", { projectId: "p1", insightId: "i1", action: "confirm" })
  })
})
