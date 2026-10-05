import { useEffect, useState } from "react";
import { ShieldAlert } from "lucide-react";
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
import {
  riskReviewState,
  validateProjectRiskDraft,
  type RiskProbability,
  type RiskSeverity,
  type RiskStatus,
} from "@/domain/project-risk";
import {
  createProjectRisk,
  listProjectRisks,
  updateProjectRiskStatus,
  type ProjectRiskRecord,
} from "@/services/project-risk-service";
import { loadProviderConfig } from "@/data/provider-settings";
import {
  generateRiskRemediationProposals,
  generateRiskReview,
} from "@/services/structured-generation-service";
import type { RiskReviewOutput } from "@/domain/risk-review-agent";
import { projectContextRecordLocator } from "@/domain/project-context";
import {
  confirmAgentToolProposal,
  listAgentToolProposals,
  rejectAgentToolProposal,
  saveRiskUpdateProposals,
  type AgentToolProposal,
} from "@/services/agent-tool-proposal-service";

const empty = {
  title: "",
  description: "",
  severity: "medium" as RiskSeverity,
  probability: "possible" as RiskProbability,
  owner: "",
  dueDate: "",
  mitigation: "",
};
const labels: Record<string, string> = {
  low: "低",
  medium: "中",
  high: "高",
  critical: "严重",
  unlikely: "不太可能",
  possible: "可能",
  likely: "很可能",
  open: "开放",
  mitigated: "已缓解",
  accepted: "已接受",
  closed: "已关闭",
};
const proposalStatusLabels: Record<AgentToolProposal["status"], string> = {
  pending_confirmation: "待确认",
  executed: "已执行",
  rejected: "已拒绝",
  stale: "已过期",
};
const riskChangeLabels: Record<string, string> = {
  mitigation: "缓解措施",
  owner: "负责人",
  dueDate: "截止日期",
  severity: "影响程度",
  probability: "发生概率",
};
function proposalChangeText(proposal: AgentToolProposal) {
  return Object.entries(proposal.changes).map(
    ([key, value]) => `${riskChangeLabels[key] ?? key}：${String(value)}`,
  );
}

export function ProjectRiskPanel({
  projectId,
  desktopRuntime,
  readOnly,
}: {
  projectId: string;
  desktopRuntime: boolean;
  readOnly: boolean;
}) {
  const [form, setForm] = useState(empty);
  const [risks, setRisks] = useState<ProjectRiskRecord[]>([]);
  const [providerEnabled, setProviderEnabled] = useState(false);
  const [reviewBusy, setReviewBusy] = useState(false);
  const [review, setReview] = useState<RiskReviewOutput>();
  const [proposals, setProposals] = useState<AgentToolProposal[]>([]);
  const [confirmingProposal, setConfirmingProposal] =
    useState<AgentToolProposal>();
  const [proposalBusyId, setProposalBusyId] = useState<string>();
  const reload = () => {
    if (desktopRuntime) {
      void Promise.all([
        listProjectRisks(true, projectId),
        loadProviderConfig(true),
        listAgentToolProposals(true, projectId),
      ])
        .then(([savedRisks, provider, savedProposals]) => {
          setRisks(savedRisks);
          setProviderEnabled(provider.enabled);
          setProposals(
            savedProposals.filter((item) => item.targetType === "project_risk"),
          );
        })
        .catch((error) =>
          toast.error(error instanceof Error ? error.message : "无法读取风险"),
        );
    }
  };
  useEffect(reload, [desktopRuntime, projectId]);
  async function save() {
    try {
      const draft = validateProjectRiskDraft(form);
      const saved = await createProjectRisk(true, {
        ...draft,
        id: crypto.randomUUID(),
        projectId,
      });
      setRisks((current) => [saved, ...current]);
      setForm(empty);
      toast.success("风险已保存");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "风险保存失败");
    }
  }
  async function changeStatus(item: ProjectRiskRecord, status: RiskStatus) {
    try {
      await updateProjectRiskStatus(true, projectId, item.id, status);
      setRisks((current) =>
        current.map((risk) =>
          risk.id === item.id ? { ...risk, status } : risk,
        ),
      );
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "风险状态更新失败");
    }
  }
  async function runReview() {
    try {
      setReviewBusy(true);
      const provider = await loadProviderConfig(true);
      const generated = await generateRiskReview(
        projectId,
        risks,
        provider,
        desktopRuntime,
      );
      setReview(generated.output);
      toast.success("风险审阅 Agent 已生成只读预览");
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "风险审阅 Agent 运行失败",
      );
    } finally {
      setReviewBusy(false);
    }
  }
  async function runRemediation() {
    try {
      setReviewBusy(true);
      const generated = await generateRiskRemediationProposals(
        projectId,
        risks,
        await loadProviderConfig(true),
        desktopRuntime,
      );
      if (!generated.output.proposals.length) {
        toast.info("风险缓解 Agent 未发现需要修改的风险字段");
        return;
      }
      await saveRiskUpdateProposals(
        true,
        projectId,
        generated.runId,
        generated.output.proposals,
      );
      setProposals(
        (await listAgentToolProposals(true, projectId)).filter(
          (item) => item.targetType === "project_risk",
        ),
      );
      toast.success(
        `已保存 ${generated.output.proposals.length} 条待确认风险提案`,
      );
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "风险缓解 Agent 运行失败",
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
      const [savedRisks, savedProposals] = await Promise.all([
        listProjectRisks(true, projectId),
        listAgentToolProposals(true, projectId),
      ]);
      setRisks(savedRisks);
      setProposals(
        savedProposals.filter((item) => item.targetType === "project_risk"),
      );
      setConfirmingProposal(undefined);
      if (status === "stale")
        toast.warning("风险已变化或关闭，提案已标记过期且没有覆盖新数据");
      else toast.success("风险缓解提案已确认并应用");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "风险提案执行失败");
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
          (item) => item.targetType === "project_risk",
        ),
      );
      toast.success("风险提案已拒绝，正式风险数据未修改");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "风险提案拒绝失败");
    } finally {
      setProposalBusyId(undefined);
    }
  }
  return (
    <Card>
      <CardHeader>
        <CardTitle>
          <ShieldAlert className="mr-2 inline size-4" />
          风险登记
        </CardTitle>
        <CardDescription>
          记录影响、概率、负责人、截止日期和缓解措施；状态变化会保留在项目工作区，后续可接入今日驾驶舱。
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
              !risks.some((risk) => risk.status !== "closed") ||
              reviewBusy
            }
          >
            {reviewBusy ? "审阅中…" : "生成风险审阅预览"}
          </Button>
          <Button
            variant="outline"
            onClick={() => void runRemediation()}
            disabled={
              readOnly ||
              !desktopRuntime ||
              !providerEnabled ||
              !risks.some((risk) => risk.status !== "closed") ||
              reviewBusy
            }
          >
            {reviewBusy ? "生成中…" : "生成风险缓解提案"}
          </Button>
        </div>
        {review ? (
          <div className="rounded-md border bg-muted/30 p-3">
            <div className="flex flex-wrap items-center gap-2">
              <p className="font-medium">Agent 只读预览</p>
              <Badge
                variant={
                  review.overallAssessment === "critical"
                    ? "destructive"
                    : "outline"
                }
              >
                {review.overallAssessment === "critical"
                  ? "严重关注"
                  : review.overallAssessment === "watch"
                    ? "持续观察"
                    : "整体稳定"}
              </Badge>
            </div>
            <p className="mt-1 text-xs text-muted-foreground">
              仅提供建议，不修改风险状态、负责人或缓解措施。
            </p>
            {review.findings.map((finding) => {
              const source = risks.find((risk) => risk.id === finding.riskId);
              return (
                <div
                  key={finding.riskId}
                  className="mt-2 rounded border bg-background/70 p-2 text-sm"
                >
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="font-medium">
                      {source?.title ?? finding.riskId}
                    </p>
                    <Badge variant="outline">{finding.priority}</Badge>
                  </div>
                  <p className="mt-1">{finding.rationale}</p>
                  <p className="mt-1 text-muted-foreground">
                    建议：{finding.suggestedMitigation}
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
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <p className="font-medium">风险缓解提案收件箱</p>
                <p className="text-xs text-muted-foreground">
                  Agent
                  只能保存建议；确认后确定性执行器才会修改白名单字段，风险状态不在授权范围内。
                </p>
              </div>
              <Badge variant="outline">
                {
                  proposals.filter(
                    (item) => item.status === "pending_confirmation",
                  ).length
                }
                条待确认
              </Badge>
            </div>
            {proposals.map((proposal) => {
              const risk = risks.find((item) => item.id === proposal.targetId);
              return (
                <div
                  key={proposal.id}
                  className="mt-2 rounded border bg-background p-2 text-sm"
                >
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="flex-1 font-medium">
                      {risk?.title ?? proposal.targetId}
                    </p>
                    <Badge
                      variant={
                        proposal.status === "stale" ||
                        proposal.status === "rejected"
                          ? "destructive"
                          : "outline"
                      }
                    >
                      {proposalStatusLabels[proposal.status]}
                    </Badge>
                  </div>
                  <p className="mt-1 text-muted-foreground">
                    {proposal.rationale}
                  </p>
                  <ul className="mt-1 list-disc pl-5">
                    {proposalChangeText(proposal).map((text) => (
                      <li key={text}>{text}</li>
                    ))}
                  </ul>
                  <p className="mt-1 text-xs text-muted-foreground">
                    证据 {proposal.citations.length} 条 · 目标快照{" "}
                    {proposal.expectedTargetUpdatedAt}
                  </p>
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
                        onClick={() => setConfirmingProposal(proposal)}
                      >
                        审核并确认
                      </Button>
                    </div>
                  ) : null}
                </div>
              );
            })}
          </div>
        ) : null}
        <div className="grid gap-2 sm:grid-cols-2">
          <Input
            value={form.title}
            onChange={(event) =>
              setForm({ ...form, title: event.target.value })
            }
            placeholder="风险标题"
            disabled={readOnly}
          />
          <Input
            type="date"
            value={form.dueDate}
            onChange={(event) =>
              setForm({ ...form, dueDate: event.target.value })
            }
            aria-label="截止日期"
            disabled={readOnly}
          />
          <Input
            value={form.owner}
            onChange={(event) =>
              setForm({ ...form, owner: event.target.value })
            }
            placeholder="负责人"
            disabled={readOnly}
          />
          <select
            className="rounded-md border bg-background px-3 text-sm"
            aria-label="风险影响程度"
            value={form.severity}
            onChange={(event) =>
              setForm({ ...form, severity: event.target.value as RiskSeverity })
            }
            disabled={readOnly}
          >
            <option value="low">低影响</option>
            <option value="medium">中影响</option>
            <option value="high">高影响</option>
            <option value="critical">严重影响</option>
          </select>
          <select
            className="rounded-md border bg-background px-3 text-sm"
            aria-label="风险发生概率"
            value={form.probability}
            onChange={(event) =>
              setForm({
                ...form,
                probability: event.target.value as RiskProbability,
              })
            }
            disabled={readOnly}
          >
            <option value="unlikely">不太可能</option>
            <option value="possible">可能</option>
            <option value="likely">很可能</option>
          </select>
        </div>
        <Textarea
          value={form.description}
          onChange={(event) =>
            setForm({ ...form, description: event.target.value })
          }
          placeholder="风险描述与触发条件"
          disabled={readOnly}
        />
        <Textarea
          value={form.mitigation}
          onChange={(event) =>
            setForm({ ...form, mitigation: event.target.value })
          }
          placeholder="缓解措施与应急方案"
          disabled={readOnly}
        />
        <div className="flex justify-end">
          <Button
            onClick={() => void save()}
            disabled={readOnly || !desktopRuntime}
          >
            保存风险
          </Button>
        </div>
        {risks.length ? (
          <div className="flex flex-col gap-2">
            {risks.map((item) => {
              const due = riskReviewState(
                item.dueDate,
                new Date().toISOString().slice(0, 10),
              );
              return (
                <div
                  id={projectContextRecordLocator("risk", item.id)}
                  key={item.id}
                  className="rounded-md border p-3 text-sm"
                >
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="flex-1 font-medium">{item.title}</p>
                    <Badge
                      variant={
                        item.severity === "critical" || item.severity === "high"
                          ? "destructive"
                          : "outline"
                      }
                    >
                      {labels[item.severity]}影响 / {labels[item.probability]}
                    </Badge>
                    <Badge
                      variant={
                        item.status === "closed" ? "secondary" : "outline"
                      }
                    >
                      {labels[item.status]}
                    </Badge>
                    <Badge
                      variant={due === "overdue" ? "destructive" : "outline"}
                    >
                      截止 {item.dueDate}
                    </Badge>
                  </div>
                  <p className="mt-1 text-muted-foreground">
                    {item.description} · 负责人：{item.owner}
                  </p>
                  <p className="mt-1">缓解：{item.mitigation}</p>
                  <div className="mt-2 flex flex-wrap justify-end gap-2">
                    {item.status === "open" ? (
                      <>
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => void changeStatus(item, "mitigated")}
                          disabled={readOnly}
                        >
                          标记已缓解
                        </Button>
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => void changeStatus(item, "accepted")}
                          disabled={readOnly}
                        >
                          接受风险
                        </Button>
                      </>
                    ) : null}
                    {item.status !== "closed" ? (
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => void changeStatus(item, "closed")}
                        disabled={readOnly}
                      >
                        关闭
                      </Button>
                    ) : null}
                  </div>
                </div>
              );
            })}
          </div>
        ) : null}
      </CardContent>
      <Dialog
        open={Boolean(confirmingProposal)}
        onOpenChange={(open) => {
          if (!open && !proposalBusyId) setConfirmingProposal(undefined);
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>确认执行风险缓解更新？</DialogTitle>
            <DialogDescription>
              这会修改正式风险数据，但不会修改风险状态。若风险快照已经变化或风险已关闭，执行器会拒绝覆盖并将提案标记为过期。
            </DialogDescription>
          </DialogHeader>
          {confirmingProposal ? (
            <ul className="list-disc space-y-1 pl-5">
              {proposalChangeText(confirmingProposal).map((text) => (
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
              disabled={!confirmingProposal || Boolean(proposalBusyId)}
              onClick={() =>
                confirmingProposal && void confirmProposal(confirmingProposal)
              }
            >
              {proposalBusyId ? "执行中…" : "确认并应用"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  );
}
