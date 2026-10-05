import { useEffect, useRef, useState } from "react";
import { ScaleIcon } from "lucide-react";
import { toast } from "sonner";

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
import {
  decisionReviewState,
  validateProductDecisionDraft,
} from "@/domain/product-decision";
import { projectContextRecordLocator } from "@/domain/project-context";
import {
  createProductDecision,
  createProductDecisionVersion,
  listProductDecisions,
  reviewProductDecision,
  type ProductDecisionRecord,
} from "@/services/product-decision-service";

const empty = {
  title: "",
  context: "",
  decision: "",
  alternatives: "",
  evidence: "",
  objections: "",
  impact: "",
  reviewDate: "",
};

export function ProjectDecisionPanel({
  projectId,
  desktopRuntime,
  readOnly,
}: {
  projectId: string;
  desktopRuntime: boolean;
  readOnly: boolean;
}) {
  const [form, setForm] = useState(empty);
  const [editingId, setEditingId] = useState("");
  const [decisions, setDecisions] = useState<ProductDecisionRecord[]>([]);
  const [pendingScrollId, setPendingScrollId] = useState("");
  const pendingScrollRaf = useRef<number | undefined>(undefined);
  useEffect(() => {
    if (!desktopRuntime) return;
    void listProductDecisions(true, projectId)
      .then(setDecisions)
      .catch((caught) =>
        toast.error(
          caught instanceof Error ? caught.message : "无法读取决策日志",
        ),
      );
  }, [desktopRuntime, projectId]);
  // 保存成功后等 React 提交 DOM 再滚动，让“待确认”Badge 与确认按钮立即可见。
  useEffect(() => {
    if (!pendingScrollId) return;
    const locator = projectContextRecordLocator("decision", pendingScrollId);
    setPendingScrollId("");
    const target = document.getElementById(locator);
    if (!target) return;
    if (pendingScrollRaf.current !== undefined) {
      window.cancelAnimationFrame(pendingScrollRaf.current);
    }
    pendingScrollRaf.current = window.requestAnimationFrame(() => {
      pendingScrollRaf.current = undefined;
      target.scrollIntoView({ behavior: "smooth", block: "center" });
    });
  }, [pendingScrollId]);
  useEffect(
    () => () => {
      if (pendingScrollRaf.current !== undefined) {
        window.cancelAnimationFrame(pendingScrollRaf.current);
      }
    },
    [],
  );
  function field(name: keyof typeof form, value: string) {
    setForm((current) => ({ ...current, [name]: value }));
  }
  function loadVersion(item: ProductDecisionRecord) {
    try {
      const parseList = (value: string) => {
        const parsed: unknown = JSON.parse(value);
        if (
          !Array.isArray(parsed) ||
          parsed.some((entry) => typeof entry !== "string")
        )
          throw new Error("决策历史列表格式无效");
        return parsed.join("\n");
      };
      setEditingId(item.id);
      setForm({
        title: item.title,
        context: item.context,
        decision: item.decision,
        alternatives: parseList(item.alternativesJson),
        evidence: parseList(item.evidenceJson),
        objections: parseList(item.objectionsJson),
        impact: item.impact,
        reviewDate: item.reviewDate,
      });
    } catch (caught) {
      toast.error(
        caught instanceof Error ? caught.message : "无法读取决策历史",
      );
    }
  }
  async function save() {
    try {
      const draft = validateProductDecisionDraft({
        ...form,
        alternatives: form.alternatives.split("\n"),
        evidence: form.evidence.split("\n"),
        objections: form.objections.split("\n"),
      });
      const payload = {
        title: draft.title,
        context: draft.context,
        decision: draft.decision,
        alternativesJson: JSON.stringify(draft.alternatives),
        evidenceJson: JSON.stringify(draft.evidence),
        objectionsJson: JSON.stringify(draft.objections),
        impact: draft.impact,
        reviewDate: draft.reviewDate,
        createdBy: "user" as const,
      };
      const saved = editingId
        ? await createProductDecisionVersion(true, {
            ...payload,
            versionId: crypto.randomUUID(),
            projectId,
            decisionId: editingId,
          })
        : await createProductDecision(true, {
            ...payload,
            id: crypto.randomUUID(),
            versionId: crypto.randomUUID(),
            projectId,
          });
      setDecisions((current) =>
        editingId
          ? [saved, ...current.filter((item) => item.id !== saved.id)]
          : [saved, ...current],
      );
      setForm(empty);
      setEditingId("");
      setPendingScrollId(saved.id);
      toast.success(
        editingId
          ? "决策新版本已保存"
          : "决策已保存为待确认提议；点击确认后进入正式决策",
      );
    } catch (caught) {
      toast.error(caught instanceof Error ? caught.message : "决策保存失败");
    }
  }
  async function review(
    item: ProductDecisionRecord,
    action: "confirm" | "revisit" | "archive",
  ) {
    try {
      await reviewProductDecision(true, projectId, item.id, action);
      const status =
        action === "confirm"
          ? "confirmed"
          : action === "revisit"
            ? "revisit"
            : "archived";
      setDecisions((current) =>
        current.map((candidate) =>
          candidate.id === item.id ? { ...candidate, status } : candidate,
        ),
      );
      toast.success("决策状态已更新");
    } catch (caught) {
      toast.error(
        caught instanceof Error ? caught.message : "决策状态更新失败",
      );
    }
  }
  return (
    <Card>
      <CardHeader>
        <CardTitle>
          <ScaleIcon className="mr-2 inline size-4" />
          决策日志
        </CardTitle>
        <CardDescription>
          记录背景、结论、备选、证据、异议、影响和复查日期；确认后只能创建新版本，不覆盖历史。
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        <div className="grid gap-2 sm:grid-cols-2">
          <Input
            value={form.title}
            onChange={(event) => field("title", event.target.value)}
            placeholder={
              editingId
                ? "新版本标题（必填，最多 200 字符）"
                : "决策标题（必填，最多 200 字符）"
            }
            aria-label="决策标题（必填）"
            maxLength={200}
            disabled={readOnly}
          />
          <Input
            type="date"
            value={form.reviewDate}
            onChange={(event) => field("reviewDate", event.target.value)}
            aria-label="复查日期"
            disabled={readOnly}
          />
        </div>
        <Textarea
          value={form.context}
          onChange={(event) => field("context", event.target.value)}
          placeholder="背景与问题（必填，最多 5,000 字符）"
          aria-label="背景与问题（必填）"
          maxLength={5_000}
          disabled={readOnly}
        />
        <Textarea
          value={form.decision}
          onChange={(event) => field("decision", event.target.value)}
          placeholder="决策结论（必填，最多 5,000 字符）"
          aria-label="决策结论（必填）"
          maxLength={5_000}
          disabled={readOnly}
        />
        <div className="grid gap-2 sm:grid-cols-2">
          <Textarea
            value={form.alternatives}
            onChange={(event) => field("alternatives", event.target.value)}
            placeholder="备选方案（每行一项）"
            disabled={readOnly}
          />
          <Textarea
            value={form.evidence}
            onChange={(event) => field("evidence", event.target.value)}
            placeholder="证据（每行一项）"
            disabled={readOnly}
          />
          <Textarea
            value={form.objections}
            onChange={(event) => field("objections", event.target.value)}
            placeholder="异议（每行一项）"
            disabled={readOnly}
          />
          <Textarea
            value={form.impact}
            onChange={(event) => field("impact", event.target.value)}
            placeholder="影响与后续（必填，最多 3,000 字符）"
            aria-label="影响与后续（必填）"
            maxLength={3_000}
            disabled={readOnly}
          />
        </div>
        <div className="flex justify-end gap-2">
          <Button
            variant="outline"
            onClick={() => {
              setForm(empty);
              setEditingId("");
            }}
            disabled={readOnly}
          >
            清空
          </Button>
          <Button
            onClick={() => void save()}
            disabled={readOnly || !desktopRuntime}
          >
            {editingId ? "保存新版本" : "保存决策"}
          </Button>
        </div>
        {decisions.length ? (
          <div className="flex flex-col gap-2">
            <p className="text-sm font-medium">当前决策</p>
            {decisions.map((item) => (
              <div
                id={projectContextRecordLocator("decision", item.id)}
                key={item.id}
                className="rounded-md border p-3 text-sm"
              >
                <div className="flex flex-wrap items-center gap-2">
                  <p className="flex-1 font-medium">{item.title}</p>
                  <Badge
                    variant={
                      item.status === "confirmed"
                        ? "secondary"
                        : item.status === "archived"
                          ? "destructive"
                          : "outline"
                    }
                  >
                    {item.status === "proposed"
                      ? "待确认"
                      : item.status === "confirmed"
                        ? "已确认"
                        : item.status === "revisit"
                          ? "待复查"
                          : "已归档"}
                  </Badge>
                  <Badge variant="outline">v{item.versionNumber}</Badge>
                  <Badge
                    variant={
                      decisionReviewState(
                        item.reviewDate,
                        new Date().toISOString().slice(0, 10),
                      ) === "overdue"
                        ? "destructive"
                        : "outline"
                    }
                  >
                    复查 {item.reviewDate}
                  </Badge>
                </div>
                <p className="mt-1 text-muted-foreground">
                  {item.decision} · 影响：{item.impact}
                </p>
                <div className="mt-2 flex flex-wrap justify-end gap-2">
                  {item.status !== "archived" ? (
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => loadVersion(item)}
                      disabled={readOnly}
                    >
                      新建版本
                    </Button>
                  ) : null}
                  {item.status === "proposed" || item.status === "revisit" ? (
                    <Button
                      size="sm"
                      onClick={() => void review(item, "confirm")}
                      disabled={readOnly}
                    >
                      确认
                    </Button>
                  ) : null}
                  {item.status === "confirmed" ? (
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => void review(item, "revisit")}
                      disabled={readOnly}
                    >
                      要求复查
                    </Button>
                  ) : null}
                  {item.status !== "archived" ? (
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => void review(item, "archive")}
                      disabled={readOnly}
                    >
                      归档
                    </Button>
                  ) : null}
                </div>
              </div>
            ))}
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}
