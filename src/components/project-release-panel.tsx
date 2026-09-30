import { useEffect, useState } from "react";
import { Rocket } from "lucide-react";
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
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { validateReleaseDraft, type ReleaseStatus } from "@/domain/release";
import {
  createRelease,
  listReleases,
  updateReleaseStatus,
  type ReleaseRecord,
} from "@/services/release-service";
import { loadProviderConfig } from "@/data/provider-settings";
import {
  generateReleasePreparationProposals,
  generateReleaseReview,
} from "@/services/structured-generation-service";
import {
  releaseRecordToReviewSource,
  type ReleaseReviewOutput,
} from "@/domain/release-review-agent";
import { releaseRecordToPreparationSource } from "@/domain/release-preparation-agent";
import { projectContextRecordLocator } from "@/domain/project-context";
import {
  confirmAgentToolProposal,
  listAgentToolProposals,
  rejectAgentToolProposal,
  saveReleasePreparationProposals,
  type AgentToolProposal,
} from "@/services/agent-tool-proposal-service";
const empty = {
  title: "",
  scope: "",
  checklist: "",
  rollbackPlan: "",
  result: "",
  retrospective: "",
  followUp: "",
  targetDate: "",
};
const labels: Record<string, string> = {
  planned: "计划中",
  ready: "待发布",
  released: "已发布",
  reviewed: "已复盘",
  cancelled: "已取消",
};
const proposalLabels: Record<AgentToolProposal["status"], string> = {
  pending_confirmation: "待确认",
  executed: "已执行",
  rejected: "已拒绝",
  stale: "已过期",
};
const changeLabels: Record<string, string> = {
  scope: "发布范围",
  checklist: "检查清单",
  rollbackPlan: "回滚方案",
  targetDate: "目标日期",
};
const proposalText = (proposal: AgentToolProposal) =>
  Object.entries(proposal.changes).map(
    ([key, value]) =>
      `${changeLabels[key] ?? key}：${Array.isArray(value) ? value.join("；") : String(value)}`,
  );
export function ProjectReleasePanel({
  projectId,
  desktopRuntime,
  readOnly,
}: {
  projectId: string;
  desktopRuntime: boolean;
  readOnly: boolean;
}) {
  const [form, setForm] = useState(empty);
  const [releases, setReleases] = useState<ReleaseRecord[]>([]);
  const [providerEnabled, setProviderEnabled] = useState(false);
  const [reviewBusy, setReviewBusy] = useState(false);
  const [review, setReview] = useState<ReleaseReviewOutput>();
  const [proposals, setProposals] = useState<AgentToolProposal[]>([]);
  const [confirming, setConfirming] = useState<AgentToolProposal>();
  const [proposalBusyId, setProposalBusyId] = useState<string>();
  useEffect(() => {
    if (desktopRuntime) {
      void Promise.all([
        listReleases(true, projectId),
        loadProviderConfig(true),
        listAgentToolProposals(true, projectId),
      ])
        .then(([savedReleases, provider, savedProposals]) => {
          setReleases(savedReleases);
          setProviderEnabled(provider.enabled);
          setProposals(
            savedProposals.filter((item) => item.targetType === "release"),
          );
        })
        .catch((error) =>
          toast.error(
            error instanceof Error ? error.message : "无法读取发布记录",
          ),
        );
    }
  }, [desktopRuntime, projectId]);
  async function save() {
    try {
      const draft = validateReleaseDraft({
        ...form,
        scope: form.scope.split("\n"),
        checklist: form.checklist.split("\n"),
        followUp: form.followUp.split("\n"),
      });
      const saved = await createRelease(true, {
        ...draft,
        id: crypto.randomUUID(),
        projectId,
        scopeJson: JSON.stringify(draft.scope),
        checklistJson: JSON.stringify(draft.checklist),
        followUpJson: JSON.stringify(draft.followUp),
      });
      setReleases((current) => [saved, ...current]);
      setForm(empty);
      toast.success("发布计划已保存");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "发布计划保存失败");
    }
  }
  async function change(item: ReleaseRecord, status: ReleaseStatus) {
    try {
      await updateReleaseStatus(true, projectId, item.id, status);
      setReleases((current) =>
        current.map((value) =>
          value.id === item.id ? { ...value, status } : value,
        ),
      );
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "发布状态更新失败");
    }
  }
  async function runReview() {
    try {
      setReviewBusy(true);
      const provider = await loadProviderConfig(true);
      const sources = releases.map(releaseRecordToReviewSource);
      const generated = await generateReleaseReview(
        projectId,
        sources,
        provider,
        desktopRuntime,
      );
      setReview(generated.output);
      toast.success("发布审阅 Agent 已生成只读预览");
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "发布审阅 Agent 运行失败",
      );
    } finally {
      setReviewBusy(false);
    }
  }
  async function runPreparation() {
    try {
      setReviewBusy(true);
      const generated = await generateReleasePreparationProposals(
        projectId,
        releases.map(releaseRecordToPreparationSource),
        await loadProviderConfig(true),
        desktopRuntime,
      );
      if (!generated.output.proposals.length) {
        toast.info("发布准备 Agent 未发现需要修改的字段");
        return;
      }
      await saveReleasePreparationProposals(
        true,
        projectId,
        generated.runId,
        generated.output.proposals,
      );
      setProposals(
        (await listAgentToolProposals(true, projectId)).filter(
          (item) => item.targetType === "release",
        ),
      );
      toast.success(
        `已保存 ${generated.output.proposals.length} 条待确认发布提案`,
      );
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "发布准备 Agent 运行失败",
      );
    } finally {
      setReviewBusy(false);
    }
  }
  async function confirmProposal(proposal: AgentToolProposal) {
    try {
      setProposalBusyId(proposal.id);
      const status = await confirmAgentToolProposal(
        true,
        projectId,
        proposal.id,
      );
      const [saved, savedProposals] = await Promise.all([
        listReleases(true, projectId),
        listAgentToolProposals(true, projectId),
      ]);
      setReleases(saved);
      setProposals(
        savedProposals.filter((item) => item.targetType === "release"),
      );
      setConfirming(undefined);
      status === "stale"
        ? toast.warning("发布记录已变化，提案已过期且未覆盖新数据")
        : toast.success("发布准备提案已应用");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "发布提案执行失败");
    } finally {
      setProposalBusyId(undefined);
    }
  }
  async function rejectProposal(proposal: AgentToolProposal) {
    try {
      setProposalBusyId(proposal.id);
      await rejectAgentToolProposal(true, projectId, proposal.id);
      setProposals(
        (await listAgentToolProposals(true, projectId)).filter(
          (item) => item.targetType === "release",
        ),
      );
      toast.success("发布提案已拒绝，正式数据未修改");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "发布提案拒绝失败");
    } finally {
      setProposalBusyId(undefined);
    }
  }
  return (
    <Card>
      <CardHeader>
        <CardTitle>
          <Rocket className="mr-2 inline size-4" />
          发布与复盘
        </CardTitle>
        <CardDescription>
          先保存计划和检查清单，再人工标记待发布、已发布和已复盘；发布状态不会由
          Agent 静默改变。
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        <div className="flex justify-end">
          <Button
            variant="outline"
            onClick={() => void runReview()}
            disabled={
              readOnly ||
              !desktopRuntime ||
              !providerEnabled ||
              !releases.some((release) => release.status !== "cancelled") ||
              reviewBusy
            }
          >
            {reviewBusy ? "审阅中…" : "生成发布审阅预览"}
          </Button>
          <Button
            variant="outline"
            onClick={() => void runPreparation()}
            disabled={
              readOnly ||
              !desktopRuntime ||
              !providerEnabled ||
              !releases.some(
                (item) => item.status === "planned" || item.status === "ready",
              ) ||
              reviewBusy
            }
          >
            {reviewBusy ? "生成中…" : "生成发布准备提案"}
          </Button>
        </div>
        {review ? (
          <div className="rounded-md border bg-muted/30 p-3">
            <div className="flex flex-wrap items-center gap-2">
              <p className="font-medium">Agent 只读预览</p>
              <Badge
                variant={
                  review.readiness === "blocked" ? "destructive" : "outline"
                }
              >
                {review.readiness === "ready"
                  ? "准备就绪"
                  : review.readiness === "blocked"
                    ? "存在阻断"
                    : "需要关注"}
              </Badge>
            </div>
            <p className="mt-1 text-xs text-muted-foreground">
              仅提供准备度和复盘建议，不修改发布状态，也不执行发布。
            </p>
            {review.findings.map((finding, index) => {
              const source = releases.find(
                (release) => release.id === finding.releaseId,
              );
              return (
                <div
                  key={`${finding.releaseId}-${finding.category}-${index}`}
                  className="mt-2 rounded border bg-background/70 p-2 text-sm"
                >
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="font-medium">
                      {source?.title ?? finding.releaseId}
                    </p>
                    <Badge
                      variant={
                        finding.severity === "blocker"
                          ? "destructive"
                          : "outline"
                      }
                    >
                      {finding.category} · {finding.severity}
                    </Badge>
                  </div>
                  <p className="mt-1">{finding.summary}</p>
                  <p className="mt-1 text-muted-foreground">
                    建议：{finding.recommendation}
                  </p>
                  <p className="mt-1 text-xs text-muted-foreground">
                    引用字段：
                    {finding.citations
                      .map((citation) => citation.field)
                      .join("、")}
                  </p>
                </div>
              );
            })}
            {review.limitations.length ? (
              <p className="mt-2 text-xs text-muted-foreground">
                限制：{review.limitations.join("；")}
              </p>
            ) : null}
          </div>
        ) : null}
        {proposals.length ? (
          <div className="rounded-md border bg-muted/20 p-3">
            <div className="flex items-center justify-between gap-2">
              <div>
                <p className="font-medium">发布准备提案收件箱</p>
                <p className="text-xs text-muted-foreground">
                  仅修改范围、清单、回滚方案和目标日期；发布状态不在授权范围。
                </p>
              </div>
              <Badge variant="outline">
                {
                  proposals.filter(
                    (item) => item.status === "pending_confirmation",
                  ).length
                }{" "}
                条待确认
              </Badge>
            </div>
            {proposals.map((proposal) => (
              <div
                key={proposal.id}
                className="mt-2 rounded border bg-background p-2 text-sm"
              >
                <div className="flex items-center gap-2">
                  <p className="flex-1 font-medium">
                    {releases.find((item) => item.id === proposal.targetId)
                      ?.title ?? proposal.targetId}
                  </p>
                  <Badge
                    variant={
                      proposal.status === "stale" ||
                      proposal.status === "rejected"
                        ? "destructive"
                        : "outline"
                    }
                  >
                    {proposalLabels[proposal.status]}
                  </Badge>
                </div>
                <p className="mt-1 text-muted-foreground">
                  {proposal.rationale}
                </p>
                <ul className="mt-1 list-disc pl-5">
                  {proposalText(proposal).map((text) => (
                    <li key={text}>{text}</li>
                  ))}
                </ul>
                {proposal.status === "pending_confirmation" ? (
                  <div className="mt-2 flex justify-end gap-2">
                    <Button
                      size="sm"
                      variant="ghost"
                      disabled={readOnly || proposalBusyId === proposal.id}
                      onClick={() => void rejectProposal(proposal)}
                    >
                      拒绝
                    </Button>
                    <Button
                      size="sm"
                      disabled={readOnly || proposalBusyId === proposal.id}
                      onClick={() => setConfirming(proposal)}
                    >
                      审核并确认
                    </Button>
                  </div>
                ) : null}
              </div>
            ))}
          </div>
        ) : null}
        <div className="grid gap-2 sm:grid-cols-2">
          <Input
            value={form.title}
            onChange={(e) => setForm({ ...form, title: e.target.value })}
            placeholder="发布标题"
            disabled={readOnly}
          />
          <Input
            type="date"
            value={form.targetDate}
            onChange={(e) => setForm({ ...form, targetDate: e.target.value })}
            aria-label="目标日期"
            disabled={readOnly}
          />
        </div>
        <Textarea
          value={form.scope}
          onChange={(e) => setForm({ ...form, scope: e.target.value })}
          placeholder="发布范围（每行一项）"
          disabled={readOnly}
        />
        <Textarea
          value={form.checklist}
          onChange={(e) => setForm({ ...form, checklist: e.target.value })}
          placeholder="发布检查清单（每行一项）"
          disabled={readOnly}
        />
        <Textarea
          value={form.rollbackPlan}
          onChange={(e) => setForm({ ...form, rollbackPlan: e.target.value })}
          placeholder="回滚方案"
          disabled={readOnly}
        />
        <Textarea
          value={form.result}
          onChange={(e) => setForm({ ...form, result: e.target.value })}
          placeholder="发布结果"
          disabled={readOnly}
        />
        <Textarea
          value={form.retrospective}
          onChange={(e) => setForm({ ...form, retrospective: e.target.value })}
          placeholder="复盘结论"
          disabled={readOnly}
        />
        <Textarea
          value={form.followUp}
          onChange={(e) => setForm({ ...form, followUp: e.target.value })}
          placeholder="后续行动（每行一项）"
          disabled={readOnly}
        />
        <div className="flex justify-end">
          <Button
            onClick={() => void save()}
            disabled={readOnly || !desktopRuntime}
          >
            保存发布计划
          </Button>
        </div>
        {releases.map((item) => (
          <div
            id={projectContextRecordLocator("release", item.id)}
            key={item.id}
            className="rounded-md border p-3 text-sm"
          >
            <div className="flex flex-wrap items-center gap-2">
              <p className="flex-1 font-medium">{item.title}</p>
              <Badge
                variant={
                  item.status === "cancelled" ? "destructive" : "outline"
                }
              >
                {labels[item.status]}
              </Badge>
              <Badge variant="outline">目标 {item.targetDate}</Badge>
            </div>
            <p className="mt-1">回滚：{item.rollbackPlan}</p>
            <p className="mt-1 text-muted-foreground">
              结果：{item.result || "尚未发布"}
            </p>
            <div className="mt-2 flex justify-end gap-2">
              {item.status === "planned" ? (
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => void change(item, "ready")}
                  disabled={readOnly}
                >
                  待发布
                </Button>
              ) : null}
              {item.status === "ready" ? (
                <Button
                  size="sm"
                  onClick={() => void change(item, "released")}
                  disabled={readOnly}
                >
                  标记已发布
                </Button>
              ) : null}
              {item.status === "released" ? (
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => void change(item, "reviewed")}
                  disabled={readOnly}
                >
                  完成复盘
                </Button>
              ) : null}
              {item.status !== "released" &&
              item.status !== "reviewed" &&
              item.status !== "cancelled" ? (
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => void change(item, "cancelled")}
                  disabled={readOnly}
                >
                  取消
                </Button>
              ) : null}
            </div>
          </div>
        ))}
      </CardContent>
      <Dialog
        open={Boolean(confirming)}
        onOpenChange={(open) => {
          if (!open && !proposalBusyId) setConfirming(undefined);
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>确认执行发布准备更新？</DialogTitle>
            <DialogDescription>
              这会修改正式发布准备数据，但不会改变发布状态、结果或复盘。快照变化时执行器会拒绝覆盖。
            </DialogDescription>
          </DialogHeader>
          {confirming ? (
            <ul className="list-disc space-y-1 pl-5">
              {proposalText(confirming).map((text) => (
                <li key={text}>{text}</li>
              ))}
            </ul>
          ) : null}
          <DialogFooter>
            <DialogClose
              render={
                <Button variant="outline" disabled={Boolean(proposalBusyId)} />
              }
            >
              取消
            </DialogClose>
            <Button
              disabled={!confirming || Boolean(proposalBusyId)}
              onClick={() => confirming && void confirmProposal(confirming)}
            >
              {proposalBusyId ? "执行中…" : "确认并应用"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  );
}
