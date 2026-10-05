import { useEffect, useState } from "react";
import { ClipboardList } from "lucide-react";
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
  validateResearchPlanDraft,
  type ResearchPlanStatus,
} from "@/domain/research-plan";
import {
  createResearchPlan,
  listResearchPlans,
  updateResearchPlanStatus,
  type ResearchPlanRecord,
} from "@/services/research-plan-service";
import {
  listResearchEntries,
  type ResearchEntryRecord,
} from "@/services/research-entry-service";
import { loadProviderConfig } from "@/data/provider-settings";
import {
  generateResearchPlanReview,
  generatePlanEngineer,
} from "@/services/structured-generation-service";
import {
  buildResearchPlanReviewSources,
  type ResearchPlanReviewOutput,
} from "@/domain/research-plan-review-agent";
import {
  confirmAgentToolProposal,
  listAgentToolProposals,
  rejectAgentToolProposal,
  saveResearchPlanUpdateProposals,
  type AgentToolProposal,
} from "@/services/agent-tool-proposal-service";
const empty = {
  title: "",
  objective: "",
  targetPersona: "",
  questions: "",
  startDate: "",
  endDate: "",
};
const labels: Record<string, string> = {
  planned: "计划中",
  active: "进行中",
  completed: "已完成",
  cancelled: "已取消",
};
const proposalStatusLabels: Record<AgentToolProposal["status"], string> = {
  pending_confirmation: "待确认",
  executed: "已执行",
  rejected: "已拒绝",
  stale: "已过期",
};
const changeLabels: Record<string, string> = {
  objective: "研究目标",
  targetPersona: "目标画像",
  questions: "访谈提纲",
  startDate: "开始日期",
  endDate: "结束日期",
};

function proposalChangeText(proposal: AgentToolProposal) {
  return Object.entries(proposal.changes).map(([key, value]) =>
    `${changeLabels[key] ?? key}：${Array.isArray(value) ? value.join("；") : value}`,
  );
}
export function ProjectResearchPlanPanel({
  projectId,
  desktopRuntime,
  readOnly,
}: {
  projectId: string;
  desktopRuntime: boolean;
  readOnly: boolean;
}) {
  const [form, setForm] = useState(empty);
  const [plans, setPlans] = useState<ResearchPlanRecord[]>([]);
  const [entries, setEntries] = useState<ResearchEntryRecord[]>([]);
  const [providerEnabled, setProviderEnabled] = useState(false);
  const [reviewBusy, setReviewBusy] = useState(false);
  const [review, setReview] = useState<ResearchPlanReviewOutput>();
  const [proposals, setProposals] = useState<AgentToolProposal[]>([]);
  const [confirmingProposal, setConfirmingProposal] =
    useState<AgentToolProposal>();
  const [proposalBusyId, setProposalBusyId] = useState<string>();
  useEffect(() => {
    if (desktopRuntime)
      void Promise.all([
        listResearchPlans(true, projectId),
        listResearchEntries(true, projectId),
        loadProviderConfig(true),
        listAgentToolProposals(true, projectId),
      ])
        .then(([savedPlans, savedEntries, provider, savedProposals]) => {
          setPlans(savedPlans);
          setEntries(savedEntries);
          setProviderEnabled(provider.enabled);
          setProposals(
            savedProposals.filter((item) => item.targetType === "research_plan"),
          );
        })
        .catch((error) =>
          toast.error(
            error instanceof Error ? error.message : "无法读取研究计划",
          ),
        );
  }, [desktopRuntime, projectId]);
  async function save() {
    try {
      const draft = validateResearchPlanDraft({
        ...form,
        questions: form.questions.split("\n"),
      });
      const saved = await createResearchPlan(true, {
        ...draft,
        id: crypto.randomUUID(),
        projectId,
        questionsJson: JSON.stringify(draft.questions),
      });
      setPlans((current) => [saved, ...current]);
      setForm(empty);
      toast.success("研究计划已保存");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "研究计划保存失败");
    }
  }
  async function change(item: ResearchPlanRecord, status: ResearchPlanStatus) {
    try {
      await updateResearchPlanStatus(true, projectId, item.id, status);
      setPlans((current) =>
        current.map((value) =>
          value.id === item.id ? { ...value, status } : value,
        ),
      );
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "研究计划状态更新失败",
      );
    }
  }
  async function runReview() {
    try {
      setReviewBusy(true);
      const provider = await loadProviderConfig(true);
      const generated = await generateResearchPlanReview(
        projectId,
        buildResearchPlanReviewSources(plans, entries),
        provider,
        desktopRuntime,
      );
      setReview(generated.output);
      toast.success("研究计划审阅 Agent 已生成只读预览");
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "研究计划审阅 Agent 运行失败",
      );
    } finally {
      setReviewBusy(false);
    }
  }
  async function runPlanEngineer() {
    try {
      setReviewBusy(true);
      const generated = await generatePlanEngineer(
        projectId,
        buildResearchPlanReviewSources(plans, entries),
        await loadProviderConfig(true),
        desktopRuntime,
      );
      if (!generated.output.proposals.length) {
        toast.info("计划工程师未发现需要修改的计划字段");
        return;
      }
      await saveResearchPlanUpdateProposals(
        true,
        projectId,
        generated.runId,
        generated.output.proposals,
      );
      setProposals(
        (await listAgentToolProposals(true, projectId)).filter(
          (item) => item.targetType === "research_plan",
        ),
      );
      toast.success(
        `计划工程师已保存 ${generated.output.proposals.length} 条待确认提案`,
      );
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "计划工程师 Agent 运行失败",
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
      const [savedPlans, savedProposals] = await Promise.all([
        listResearchPlans(true, projectId),
        listAgentToolProposals(true, projectId),
      ]);
      setPlans(savedPlans);
      setProposals(
        savedProposals.filter((item) => item.targetType === "research_plan"),
      );
      setConfirmingProposal(undefined);
      if (status === "stale")
        toast.warning("计划已发生变化，提案已标记过期且没有覆盖新数据");
      else toast.success("提案已确认并应用到研究计划");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "提案执行失败");
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
          (item) => item.targetType === "research_plan",
        ),
      );
      toast.success("提案已拒绝，研究计划未修改");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "提案拒绝失败");
    } finally {
      setProposalBusyId(undefined);
    }
  }
  return (
    <Card>
      <CardHeader>
        <CardTitle>
          <ClipboardList className="mr-2 inline size-4" />
          研究计划与访谈提纲
        </CardTitle>
        <CardDescription>
          先定义目标、画像和问题，再录入研究结果；计划状态由人工推进。
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
              !plans.some((plan) => plan.status !== "cancelled") ||
              reviewBusy
            }
          >
            {reviewBusy ? "审阅中…" : "生成计划审阅预览"}
          </Button>
          <Button
            variant="outline"
            onClick={() => void runPlanEngineer()}
            disabled={
              readOnly ||
              !desktopRuntime ||
              !providerEnabled ||
              !plans.some((plan) => plan.status !== "cancelled") ||
              reviewBusy
            }
          >
            {reviewBusy ? "生成中…" : "生成计划工程师提案"}
          </Button>
        </div>
        {review ? (
          <div className="rounded-md border bg-muted/30 p-3">
            <p className="font-medium">Agent 只读预览</p>
            <p className="mt-1 text-xs text-muted-foreground">
              仅检查已保存计划及其关联研究结果，不修改计划、不创建研究记录。
            </p>
            {review.findings.map((finding, index) => {
              const plan = plans.find((item) => item.id === finding.planId);
              return (
                <div
                  key={`${finding.planId}-${finding.category}-${index}`}
                  className="mt-2 rounded border bg-background/70 p-2 text-sm"
                >
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="font-medium">
                      {plan?.title ?? finding.planId}
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
                    引用：
                    {finding.citations
                      .map(
                        (citation) =>
                          `${citation.sourceType}.${citation.sourceId}.${citation.field}`,
                      )
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
                <p className="font-medium">高风险工具提案收件箱</p>
                <p className="text-xs text-muted-foreground">
                  Agent 只能保存提案；确认后才由确定性执行器修改允许字段。
                </p>
              </div>
              <Badge variant="outline">
                {proposals.filter((item) => item.status === "pending_confirmation").length}
                条待确认
              </Badge>
            </div>
            {proposals.map((proposal) => {
              const plan = plans.find((item) => item.id === proposal.targetId);
              return (
                <div key={proposal.id} className="mt-2 rounded border bg-background p-2 text-sm">
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="flex-1 font-medium">
                      {plan?.title ?? proposal.targetId}
                    </p>
                    <Badge
                      variant={
                        proposal.status === "stale" || proposal.status === "rejected"
                          ? "destructive"
                          : "outline"
                      }
                    >
                      {proposalStatusLabels[proposal.status]}
                    </Badge>
                  </div>
                  <p className="mt-1 text-muted-foreground">{proposal.rationale}</p>
                  <ul className="mt-1 list-disc pl-5">
                    {proposalChangeText(proposal).map((text) => (
                      <li key={text}>{text}</li>
                    ))}
                  </ul>
                  <p className="mt-1 text-xs text-muted-foreground">
                    证据 {proposal.citations.length} 条 · 目标快照 {proposal.expectedTargetUpdatedAt}
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
            onChange={(e) => setForm({ ...form, title: e.target.value })}
            placeholder="计划标题"
            disabled={readOnly}
          />
          <Input
            value={form.targetPersona}
            onChange={(e) =>
              setForm({ ...form, targetPersona: e.target.value })
            }
            placeholder="目标用户画像"
            disabled={readOnly}
          />
          <Input
            type="date"
            value={form.startDate}
            onChange={(e) => setForm({ ...form, startDate: e.target.value })}
            aria-label="开始日期"
            disabled={readOnly}
          />
          <Input
            type="date"
            value={form.endDate}
            onChange={(e) => setForm({ ...form, endDate: e.target.value })}
            aria-label="结束日期"
            disabled={readOnly}
          />
        </div>
        <Textarea
          value={form.objective}
          onChange={(e) => setForm({ ...form, objective: e.target.value })}
          placeholder="研究目标"
          disabled={readOnly}
        />
        <Textarea
          value={form.questions}
          onChange={(e) => setForm({ ...form, questions: e.target.value })}
          placeholder="访谈提纲问题（每行一项）"
          disabled={readOnly}
        />
        <div className="flex justify-end">
          <Button
            onClick={() => void save()}
            disabled={readOnly || !desktopRuntime}
          >
            保存研究计划
          </Button>
        </div>
        {plans.map((item) => (
          <div key={item.id} className="rounded-md border p-3 text-sm">
            <div className="flex flex-wrap items-center gap-2">
              <p className="flex-1 font-medium">{item.title}</p>
              <Badge
                variant={
                  item.status === "cancelled" ? "destructive" : "outline"
                }
              >
                {labels[item.status]}
              </Badge>
              <Badge variant="outline">
                {item.startDate} 至 {item.endDate}
              </Badge>
            </div>
            <p className="mt-1">
              目标：{item.objective} · 画像：{item.targetPersona || "未填写"}
            </p>
            <p className="mt-1 text-muted-foreground">
              提纲：{JSON.parse(item.questionsJson).join("；")}
            </p>
            <div className="mt-2 flex justify-end gap-2">
              {item.status === "planned" ? (
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => void change(item, "active")}
                  disabled={readOnly}
                >
                  开始研究
                </Button>
              ) : null}
              {item.status === "active" ? (
                <Button
                  size="sm"
                  onClick={() => void change(item, "completed")}
                  disabled={readOnly}
                >
                  标记完成
                </Button>
              ) : null}
              {item.status !== "completed" && item.status !== "cancelled" ? (
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
        open={Boolean(confirmingProposal)}
        onOpenChange={(open) => {
          if (!open && !proposalBusyId) setConfirmingProposal(undefined);
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>确认执行计划更新？</DialogTitle>
            <DialogDescription>
              这会修改研究计划的正式业务数据。执行器只应用下列白名单字段；若计划快照已变化，将拒绝覆盖。
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
            <DialogClose render={<Button variant="outline" disabled={Boolean(proposalBusyId)} />}>
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
