import { useEffect, useState, type ChangeEvent, type FormEvent } from "react";
import {
  ArchiveIcon,
  DownloadIcon,
  FileTextIcon,
  FileTypeIcon,
  PlusIcon,
  SaveIcon,
} from "lucide-react";
import { toast } from "sonner";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { getRequirementRepository } from "@/data/requirement-repository";
import { loadProviderConfig } from "@/data/provider-settings";
import type { RequirementDocument } from "@/domain/models";
import {
  archiveProductDocument,
  createProductDocument,
  createProductDocumentVersion,
  exportProductDocument,
  listProductDocumentVersions,
  listProductDocuments,
  type ProductDocument,
  type ProductDocumentType,
  type ProductDocumentVersion,
} from "@/services/product-document-service";
import {
  generateDocumentDiffReview,
  generatePrdDraft,
  type DocumentDiffReviewGeneration,
  type PrdDraftGeneration,
} from "@/services/structured-generation-service";
import { buildDocumentDiff, type DocumentDiff } from "@/domain/document-diff";
import { projectContextRecordLocator } from "@/domain/project-context";

const documentTypeLabels: Record<ProductDocumentType, string> = {
  prd: "PRD",
  design_brief: "设计 Brief",
  markdown: "Markdown",
};

function errorMessage(error: unknown) {
  return error instanceof Error && error.message
    ? error.message
    : "产品文档操作失败";
}

export function ProjectDocumentPanel({
  projectId,
  desktopRuntime,
  readOnly,
}: {
  projectId: string;
  desktopRuntime: boolean;
  readOnly?: boolean;
}) {
  const [documents, setDocuments] = useState<ProductDocument[]>([]);
  const [selectedId, setSelectedId] = useState<string>();
  const [editing, setEditing] = useState("");
  const [newContent, setNewContent] = useState("");
  const [changeSummary, setChangeSummary] = useState("");
  const [versions, setVersions] = useState<ProductDocumentVersion[]>([]);
  const [compareVersion, setCompareVersion] =
    useState<ProductDocumentVersion>();
  const [requirements, setRequirements] = useState<RequirementDocument[]>([]);
  const [sourceRequirementIds, setSourceRequirementIds] = useState<string[]>(
    [],
  );
  const [busy, setBusy] = useState(false);
  const [prdBusy, setPrdBusy] = useState(false);
  const [prdDraft, setPrdDraft] = useState<PrdDraftGeneration>();
  const [documentDiff, setDocumentDiff] = useState<DocumentDiff>();
  const [diffReview, setDiffReview] = useState<DocumentDiffReviewGeneration>();
  const [diffReviewBusy, setDiffReviewBusy] = useState(false);

  async function refresh(preferredId?: string) {
    if (!desktopRuntime) return;
    try {
      const next = await listProductDocuments(true, projectId);
      setDocuments(next);
      const nextId =
        preferredId && next.some((document) => document.id === preferredId)
          ? preferredId
          : selectedId && next.some((document) => document.id === selectedId)
            ? selectedId
            : next[0]?.id;
      setSelectedId(nextId);
      const selected = next.find((document) => document.id === nextId);
      if (selected) {
        setEditing(selected.contentMarkdown);
        try {
          const sources = JSON.parse(selected.sourceJson) as Array<{
            kind?: string;
            id?: string;
          }>;
          setSourceRequirementIds(
            sources
              .filter((source) => source.kind === "requirement" && source.id)
              .map((source) => source.id as string),
          );
        } catch {
          setSourceRequirementIds([]);
        }
      }
    } catch (error) {
      toast.error(errorMessage(error));
    }
  }

  useEffect(() => {
    setDocuments([]);
    setSelectedId(undefined);
    setEditing("");
    setNewContent("");
    setVersions([]);
    setCompareVersion(undefined);
    setDocumentDiff(undefined);
    setDiffReview(undefined);
    setSourceRequirementIds([]);
    setPrdDraft(undefined);
    if (!desktopRuntime) return;
    void getRequirementRepository(true)
      .listByProject(projectId)
      .then((next) =>
        setRequirements(
          next.filter(
            (item) =>
              item.card.status === "confirmed" &&
              item.currentVersion.isConfirmed,
          ),
        ),
      )
      .catch((error) => toast.error(errorMessage(error)));
    void refresh(); /* projectId scopes the local document list */
  }, [desktopRuntime, projectId]);

  useEffect(() => {
    if (!desktopRuntime || !selectedId) return;
    void listProductDocumentVersions(true, projectId, selectedId)
      .then((next) => {
        setVersions(next);
        setCompareVersion(undefined);
      })
      .catch((error) => toast.error(errorMessage(error)));
  }, [desktopRuntime, projectId, selectedId]);

  useEffect(() => {
    setDiffReview(undefined);
  }, [selectedId, compareVersion?.versionNumber]);

  const selected = documents.find((document) => document.id === selectedId);

  async function create(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const values = new FormData(form);
    setBusy(true);
    try {
      const sourceJson = JSON.stringify(
        requirements
          .filter((item) => sourceRequirementIds.includes(item.card.id))
          .map((item) => ({
            kind: "requirement",
            id: item.card.id,
            versionId: item.currentVersion.id,
            title: item.currentVersion.title,
          })),
      );
      const document = await createProductDocument(desktopRuntime, {
        id: crypto.randomUUID(),
        projectId,
        title: String(values.get("title") ?? "").trim(),
        documentType: String(
          values.get("documentType") ?? "prd",
        ) as ProductDocumentType,
        contentMarkdown: newContent,
        changeSummary: "初始版本",
        sourceJson,
      });
      form.reset();
      setNewContent("");
      setSourceRequirementIds([]);
      await refresh(document.id);
      toast.success("产品文档已创建");
    } catch (error) {
      toast.error(errorMessage(error));
    } finally {
      setBusy(false);
    }
  }

  async function importMarkdown(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) return;
    if (
      !file.name.toLowerCase().endsWith(".md") &&
      file.type !== "text/markdown"
    ) {
      toast.error("只允许导入 Markdown 文件");
      event.target.value = "";
      return;
    }
    try {
      const content = await file.text();
      if (content.length > 200_000)
        throw new Error("Markdown 内容不能超过 200 KB");
      setNewContent(content);
      toast.success("Markdown 已载入草稿表单");
    } catch (error) {
      toast.error(errorMessage(error));
    }
    event.target.value = "";
  }

  async function generatePrdPreview() {
    setPrdBusy(true);
    try {
      const provider = await loadProviderConfig(desktopRuntime);
      const confirmed = requirements.map((item) => ({
        requirementId: item.card.id,
        versionId: item.currentVersion.id,
        title: item.currentVersion.title,
        description: item.currentVersion.content.description,
        targetUsers: item.currentVersion.content.targetUsers,
        scenario: item.currentVersion.content.scenario,
        painPoint: item.currentVersion.content.painPoint,
        acceptanceCriteria: item.currentVersion.content.acceptanceCriteria,
      }));
      setPrdDraft(
        await generatePrdDraft(projectId, confirmed, provider, desktopRuntime),
      );
      toast.success("PRD 草稿预览已生成，尚未写入文档");
    } catch (error) {
      toast.error(errorMessage(error));
    } finally {
      setPrdBusy(false);
    }
  }

  async function savePrdDraft() {
    if (!prdDraft) return;
    setBusy(true);
    try {
      const sourceJson = JSON.stringify(
        prdDraft.output.citations.map((citation) => ({
          kind: "requirement",
          id: citation.requirementId,
          versionId: citation.versionId,
          title: citation.title,
        })),
      );
      const created = await createProductDocument(desktopRuntime, {
        id: crypto.randomUUID(),
        projectId,
        title: prdDraft.output.title,
        documentType: "prd",
        contentMarkdown: prdDraft.output.contentMarkdown,
        changeSummary: "PRD Agent 草稿（人工保存）",
        sourceJson,
      });
      setPrdDraft(undefined);
      await refresh(created.id);
      toast.success("PRD 草稿已保存为新文档");
    } catch (error) {
      toast.error(errorMessage(error));
    } finally {
      setBusy(false);
    }
  }

  async function saveVersion(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!selected || selected.status === "archived") return;
    setBusy(true);
    try {
      const document = await createProductDocumentVersion(desktopRuntime, {
        projectId,
        documentId: selected.id,
        contentMarkdown: editing,
        changeSummary: changeSummary.trim() || "人工编辑",
        sourceJson: selected.sourceJson,
      });
      setChangeSummary("");
      await refresh(document.id);
      toast.success(`已保存 v${document.versionNumber}`);
    } catch (error) {
      toast.error(errorMessage(error));
    } finally {
      setBusy(false);
    }
  }

  async function archive() {
    if (!selected) return;
    setBusy(true);
    try {
      await archiveProductDocument(desktopRuntime, projectId, selected.id);
      await refresh();
      toast.success("产品文档已归档");
    } catch (error) {
      toast.error(errorMessage(error));
    } finally {
      setBusy(false);
    }
  }

  function exportMarkdown() {
    if (!selected) return;
    const link = document.createElement("a");
    link.href = URL.createObjectURL(
      new Blob([selected.contentMarkdown], {
        type: "text/markdown;charset=utf-8",
      }),
    );
    link.download = `${selected.title}-v${selected.versionNumber}.md`;
    link.click();
    URL.revokeObjectURL(link.href);
  }

  async function exportOffice(format: "docx" | "pdf") {
    if (!selected) return;
    try {
      const target = await exportProductDocument(desktopRuntime, {
        title: selected.title,
        contentMarkdown: selected.contentMarkdown,
        format,
      });
      if (target) toast.success(`${format.toUpperCase()} 已导出`);
    } catch (error) {
      toast.error(errorMessage(error));
    }
  }

  async function runDiffReview() {
    if (!selected || !compareVersion || !documentDiff) return;
    setDiffReviewBusy(true);
    try {
      const provider = await loadProviderConfig(desktopRuntime);
      setDiffReview(
        await generateDocumentDiffReview(
          projectId,
          selected.id,
          compareVersion.versionNumber,
          selected.versionNumber,
          documentDiff,
          provider,
          desktopRuntime,
        ),
      );
      toast.success("AI 差异审阅预览已生成");
    } catch (error) {
      toast.error(errorMessage(error));
    } finally {
      setDiffReviewBusy(false);
    }
  }

  if (!desktopRuntime)
    return (
      <Card>
        <CardHeader>
          <CardTitle>产品文档</CardTitle>
          <CardDescription>Markdown 文档和版本管理。</CardDescription>
        </CardHeader>
        <CardContent>
          <Alert>
            <FileTextIcon />
            <AlertTitle>桌面模式功能</AlertTitle>
            <AlertDescription>浏览器预览不读取本地产品文档。</AlertDescription>
          </Alert>
        </CardContent>
      </Card>
    );

  return (
    <Card>
      <CardHeader>
        <CardTitle>产品文档</CardTitle>
        <CardDescription>
          每次保存都会创建新版本，不覆盖历史内容；当前切片支持 Markdown 导出。
        </CardDescription>
        {!readOnly && requirements.length ? (
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={prdBusy}
            onClick={() => void generatePrdPreview()}
          >
            {prdBusy ? "生成中…" : "生成 PRD 草稿预览"}
          </Button>
        ) : null}
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        {!readOnly ? (
          <form className="rounded-lg border p-3" onSubmit={create}>
            <div className="grid gap-2 sm:grid-cols-[1fr_10rem_auto]">
              <Input
                name="title"
                required
                maxLength={200}
                placeholder="文档标题"
              />
              <select
                name="documentType"
                defaultValue="prd"
                className="h-9 rounded-md border bg-background px-2 text-sm"
                aria-label="文档类型"
              >
                <option value="prd">PRD</option>
                <option value="design_brief">设计 Brief</option>
                <option value="markdown">Markdown</option>
              </select>
              <Button
                type="submit"
                size="sm"
                disabled={busy || !newContent.trim()}
              >
                <PlusIcon data-icon="inline-start" />
                新建
              </Button>
            </div>
            <div className="mt-2 flex items-center gap-2">
              <Input
                type="file"
                accept=".md,text/markdown"
                onChange={(event) => void importMarkdown(event)}
                aria-label="导入 Markdown 文件"
              />
              <span className="text-xs text-muted-foreground">
                仅读取文本，不执行脚本
              </span>
            </div>
            {requirements.length ? (
              <div className="mt-2 rounded-md bg-muted/30 p-2">
                <p className="mb-2 text-xs font-medium">
                  关联已确认需求（可选）
                </p>
                <div className="flex flex-col gap-1">
                  {requirements.map((requirement) => (
                    <label
                      key={requirement.card.id}
                      className="flex items-center gap-2 text-xs"
                    >
                      <input
                        type="checkbox"
                        checked={sourceRequirementIds.includes(
                          requirement.card.id,
                        )}
                        onChange={(event) =>
                          setSourceRequirementIds((current) =>
                            event.target.checked
                              ? [...current, requirement.card.id]
                              : current.filter(
                                  (id) => id !== requirement.card.id,
                                ),
                          )
                        }
                      />
                      {requirement.currentVersion.title}
                    </label>
                  ))}
                </div>
              </div>
            ) : null}
            <Textarea
              className="mt-2"
              name="contentMarkdown"
              value={newContent}
              onChange={(event) => setNewContent(event.target.value)}
              required
              placeholder="# 文档正文（Markdown）"
            />
          </form>
        ) : null}
        {requirements.length ? (
          <div className="flex flex-col gap-2">
            <p className="text-sm font-medium">已确认需求来源</p>
            {requirements.map((requirement) => (
              <div
                id={projectContextRecordLocator(
                  "requirement",
                  requirement.card.id,
                )}
                key={requirement.card.id}
                className="rounded-md border p-2 text-sm"
              >
                <div className="flex flex-wrap items-center gap-2">
                  <p className="flex-1 font-medium">
                    {requirement.currentVersion.title}
                  </p>
                  <Badge variant="outline">
                    v{requirement.currentVersion.versionNumber}
                  </Badge>
                </div>
                <p className="mt-1 text-muted-foreground">
                  {requirement.currentVersion.content.description}
                </p>
              </div>
            ))}
          </div>
        ) : null}
        {documents.length ? (
          <div className="flex flex-wrap gap-2">
            {documents.map((document) => (
              <Button
                id={projectContextRecordLocator(
                  "product_document",
                  document.id,
                )}
                key={document.id}
                type="button"
                size="sm"
                variant={selectedId === document.id ? "secondary" : "outline"}
                onClick={() => {
                  setSelectedId(document.id);
                  setDocumentDiff(undefined);
                  setDiffReview(undefined);
                  setEditing(document.contentMarkdown);
                }}
              >
                {document.title}
                <Badge className="ml-1" variant="outline">
                  {documentTypeLabels[document.documentType]} v
                  {document.versionNumber}
                </Badge>
              </Button>
            ))}
          </div>
        ) : (
          <p className="rounded-lg border border-dashed p-4 text-center text-sm text-muted-foreground">
            当前项目暂无产品文档。
          </p>
        )}
        {prdDraft ? (
          <div className="flex flex-col gap-3 rounded-lg border border-sky-500/30 bg-sky-500/5 p-3">
            <div className="flex items-center justify-between gap-2">
              <div>
                <p className="font-medium">{prdDraft.output.title}</p>
                <p className="text-xs text-muted-foreground">
                  只读 Agent 预览 · {prdDraft.output.citations.length}{" "}
                  条已确认需求引用
                </p>
              </div>
              <Button
                type="button"
                size="sm"
                disabled={busy}
                onClick={() => void savePrdDraft()}
              >
                保存为 PRD 草稿
              </Button>
            </div>
            <pre className="max-h-80 overflow-auto whitespace-pre-wrap rounded-md bg-background/70 p-3 text-sm">
              {prdDraft.output.contentMarkdown}
            </pre>
            <div className="flex flex-wrap gap-2">
              {prdDraft.output.citations.map((citation) => (
                <Badge
                  key={`${citation.requirementId}:${citation.versionId}`}
                  variant="outline"
                >
                  {citation.title}
                </Badge>
              ))}
            </div>
            <p className="text-xs text-muted-foreground">
              Agent 只读已确认需求；保存动作由你明确触发。
            </p>
          </div>
        ) : null}
        {selected ? (
          <div className="flex flex-col gap-3 rounded-lg border p-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <p className="font-medium">{selected.title}</p>
                <p className="text-xs text-muted-foreground">
                  {documentTypeLabels[selected.documentType]} · v
                  {selected.versionNumber} ·{" "}
                  {selected.status === "archived" ? "已归档" : "草稿"}
                </p>
              </div>
              <div className="flex gap-2">
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  onClick={exportMarkdown}
                >
                  <DownloadIcon data-icon="inline-start" />
                  导出 Markdown
                </Button>
                {!readOnly && selected.status !== "archived" ? (
                  <Button
                    type="button"
                    size="sm"
                    variant="ghost"
                    disabled={busy}
                    onClick={() => void archive()}
                  >
                    <ArchiveIcon data-icon="inline-start" />
                    归档
                  </Button>
                ) : null}
              </div>
            </div>
            {!readOnly && selected.status !== "archived" ? (
              <form onSubmit={saveVersion}>
                <Textarea
                  value={editing}
                  onChange={(event) => setEditing(event.target.value)}
                  maxLength={200000}
                  className="min-h-52 font-mono text-sm"
                  aria-label="Markdown 正文"
                />
                <div className="mt-2 flex gap-2">
                  <Input
                    value={changeSummary}
                    onChange={(event) => setChangeSummary(event.target.value)}
                    maxLength={500}
                    placeholder="本次修改说明"
                  />
                  <Button type="submit" disabled={busy}>
                    <SaveIcon data-icon="inline-start" />
                    保存新版本
                  </Button>
                </div>
              </form>
            ) : (
              <pre className="max-h-80 overflow-auto whitespace-pre-wrap rounded-md bg-muted/30 p-3 text-sm">
                {selected.contentMarkdown}
              </pre>
            )}
            <div className="border-t pt-3">
              <p className="mb-2 text-sm font-medium">版本历史</p>
              <div className="flex flex-col gap-2">
                {versions.map((version) => (
                  <div
                    key={version.id}
                    className="flex flex-wrap items-center gap-2 text-xs"
                  >
                    <Badge
                      variant={
                        version.versionNumber === selected.versionNumber
                          ? "secondary"
                          : "outline"
                      }
                    >
                      v{version.versionNumber}
                    </Badge>
                    <span className="min-w-0 flex-1 text-muted-foreground">
                      {version.changeSummary || "无修改说明"}
                    </span>
                    <Button
                      type="button"
                      size="sm"
                      variant="ghost"
                      onClick={() => {
                        setCompareVersion(version);
                        setDocumentDiff(undefined);
                        setEditing(version.contentMarkdown);
                        setChangeSummary(
                          `从 v${version.versionNumber} 回退为新版本`,
                        );
                      }}
                    >
                      {version.versionNumber === selected.versionNumber
                        ? "当前"
                        : "比较/载入"}
                    </Button>
                  </div>
                ))}
              </div>
              {compareVersion &&
              compareVersion.versionNumber !== selected.versionNumber ? (
                <div className="mt-3 flex flex-col gap-3">
                  <div className="grid gap-2 md:grid-cols-2">
                    <div>
                      <p className="mb-1 text-xs font-medium">
                        当前 v{selected.versionNumber}
                      </p>
                      <pre className="max-h-48 overflow-auto whitespace-pre-wrap rounded-md bg-muted/30 p-2 text-xs">
                        {selected.contentMarkdown}
                      </pre>
                    </div>
                    <div>
                      <p className="mb-1 text-xs font-medium">
                        历史 v{compareVersion.versionNumber}
                      </p>
                      <pre className="max-h-48 overflow-auto whitespace-pre-wrap rounded-md bg-muted/30 p-2 text-xs">
                        {compareVersion.contentMarkdown}
                      </pre>
                    </div>
                  </div>
                  <div className="flex items-center justify-between gap-2">
                    <p className="text-sm font-medium">确定性差异审阅</p>
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      onClick={() => {
                        try {
                          setDocumentDiff(
                            buildDocumentDiff(
                              compareVersion.contentMarkdown,
                              selected.contentMarkdown,
                            ),
                          );
                        } catch (error) {
                          toast.error(errorMessage(error));
                        }
                      }}
                    >
                      生成差异
                    </Button>
                  </div>
                  {documentDiff ? (
                    <div className="flex flex-col gap-2">
                      <div className="flex flex-wrap gap-2 text-xs">
                        <Badge variant="secondary">
                          新增 {documentDiff.added}
                        </Badge>
                        <Badge variant="outline">
                          删除 {documentDiff.removed}
                        </Badge>
                        <Badge variant="outline">
                          未变更 {documentDiff.unchanged}
                        </Badge>
                        {documentDiff.truncated ? (
                          <Badge variant="destructive">结果已截断</Badge>
                        ) : null}
                      </div>
                      <pre className="max-h-72 overflow-auto whitespace-pre-wrap rounded-md bg-muted/30 p-2 text-xs">
                        {documentDiff.lines.map((line, index) => (
                          <span
                            key={`${index}-${line.kind}`}
                            className={
                              line.kind === "added"
                                ? "text-emerald-600"
                                : line.kind === "removed"
                                  ? "text-destructive"
                                  : "text-muted-foreground"
                            }
                          >
                            {line.kind === "added"
                              ? "+ "
                              : line.kind === "removed"
                                ? "- "
                                : "  "}
                            {line.text}
                            {"\n"}
                          </span>
                        ))}
                      </pre>
                    </div>
                  ) : null}
                </div>
              ) : null}
            </div>
          </div>
        ) : null}
        {selected && compareVersion && documentDiff ? (
          <div className="flex flex-col gap-3 rounded-lg border border-violet-500/30 bg-violet-500/5 p-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <p className="font-medium">AI 差异审阅</p>
                <p className="text-xs text-muted-foreground">
                  只读预览；仅引用上方确定性差异，不会修改文档。
                </p>
              </div>
              <Button
                type="button"
                size="sm"
                variant="outline"
                disabled={
                  diffReviewBusy ||
                  documentDiff.truncated ||
                  !documentDiff.changed
                }
                onClick={() => void runDiffReview()}
              >
                {diffReviewBusy ? "审阅中…" : "生成审阅预览"}
              </Button>
            </div>
            {documentDiff.truncated ? (
              <p className="text-xs text-destructive">
                差异已截断，为避免不完整审阅，AI 审阅已禁用。
              </p>
            ) : null}
            {diffReview ? (
              <div className="flex flex-col gap-2">
                <div className="flex flex-wrap gap-2">
                  <Badge
                    variant={
                      diffReview.output.verdict === "high_risk"
                        ? "destructive"
                        : "secondary"
                    }
                  >
                    {diffReview.output.verdict}
                  </Badge>
                  <span className="text-sm">{diffReview.output.summary}</span>
                </div>
                {diffReview.output.findings.length ? (
                  diffReview.output.findings.map((finding, index) => (
                    <div
                      key={`${index}-${finding.summary}`}
                      className="rounded-md bg-background/70 p-2 text-sm"
                    >
                      <div className="mb-1 flex gap-2">
                        <Badge
                          variant={
                            finding.severity === "critical"
                              ? "destructive"
                              : "outline"
                          }
                        >
                          {finding.severity}
                        </Badge>
                        <Badge variant="outline">{finding.category}</Badge>
                      </div>
                      <p className="font-medium">{finding.summary}</p>
                      <p className="text-muted-foreground">
                        {finding.recommendation}
                      </p>
                      <p className="mt-1 text-xs text-muted-foreground">
                        引用差异行：
                        {finding.evidenceLineIndexes
                          .map((lineIndex) => `#${lineIndex}`)
                          .join("、")}
                      </p>
                    </div>
                  ))
                ) : (
                  <p className="text-sm text-muted-foreground">
                    未发现需要额外审阅的问题。
                  </p>
                )}
              </div>
            ) : null}
          </div>
        ) : null}
        {selected ? (
          <div className="flex flex-wrap justify-end gap-2">
            <Button
              type="button"
              size="sm"
              variant="outline"
              onClick={() => void exportOffice("docx")}
            >
              <FileTypeIcon data-icon="inline-start" />
              导出 DOCX
            </Button>
            <Button
              type="button"
              size="sm"
              variant="outline"
              onClick={() => void exportOffice("pdf")}
            >
              <FileTypeIcon data-icon="inline-start" />
              导出 PDF
            </Button>
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}
