import { useEffect, useMemo, useState } from "react";
import { Lightbulb } from "lucide-react";
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
import { validateResearchInsightDraft } from "@/domain/research-insight";
import {
  listResearchEntries,
  type ResearchEntryRecord,
} from "@/services/research-entry-service";
import {
  listResearchPlans,
  type ResearchPlanRecord,
} from "@/services/research-plan-service";
import {
  createResearchInsight,
  listResearchInsights,
  reviewResearchInsight,
  type ResearchInsightRecord,
} from "@/services/research-insight-service";
import {
  createResearchRequirementCandidate,
  listResearchRequirementCandidates,
  reviewResearchRequirementCandidate,
  type ResearchRequirementCandidateRecord,
} from "@/services/research-requirement-candidate-service";
import { loadProviderConfig } from "@/data/provider-settings";
import { generateResearchInsights } from "@/services/structured-generation-service";
import type { ResearchAgentOutput } from "@/domain/research-insight-agent";
import { getRequirementRepository } from "@/data/requirement-repository";
import { researchRequirementEvidence } from "@/domain/research-requirement-bridge";
import type { Meeting } from "@/domain/models";
const labels: Record<string, string> = {
  draft: "待审核",
  accepted: "已接受",
  rejected: "已拒绝",
};
export function ProjectResearchInsightPanel({
  projectId,
  meetings,
  desktopRuntime,
  readOnly,
}: {
  projectId: string;
  meetings: Meeting[];
  desktopRuntime: boolean;
  readOnly: boolean;
}) {
  const [entries, setEntries] = useState<ResearchEntryRecord[]>([]);
  const [plans, setPlans] = useState<ResearchPlanRecord[]>([]);
  const [insights, setInsights] = useState<ResearchInsightRecord[]>([]);
  const [candidates, setCandidates] = useState<
    ResearchRequirementCandidateRecord[]
  >([]);
  const [entryId, setEntryId] = useState("");
  const [planId, setPlanId] = useState("");
  const [meetingId, setMeetingId] = useState(meetings[0]?.id ?? "");
  const [title, setTitle] = useState("");
  const [statement, setStatement] = useState("");
  const [evidence, setEvidence] = useState("");
  const [providerEnabled, setProviderEnabled] = useState(false);
  const [agentBusy, setAgentBusy] = useState(false);
  const [agentOutput, setAgentOutput] = useState<
    ResearchAgentOutput | undefined
  >();
  const projectMeetings = useMemo(
    () => meetings.filter((meeting) => meeting.projectId === projectId),
    [meetings, projectId],
  );

  useEffect(() => {
    if (!projectMeetings.some((meeting) => meeting.id === meetingId)) {
      setMeetingId(projectMeetings[0]?.id ?? "");
    }
  }, [meetingId, projectMeetings]);

  useEffect(() => {
    if (!desktopRuntime) return;
    void Promise.all([
      listResearchEntries(true, projectId),
      listResearchPlans(true, projectId),
      listResearchInsights(true, projectId),
      listResearchRequirementCandidates(true, projectId),
      loadProviderConfig(true),
    ])
      .then(
        ([
          loadedEntries,
          loadedPlans,
          loadedInsights,
          loadedCandidates,
          provider,
        ]) => {
          setEntries(loadedEntries);
          setPlans(loadedPlans);
          setInsights(loadedInsights);
          setCandidates(loadedCandidates);
          setEntryId(loadedEntries[0]?.id ?? "");
          setProviderEnabled(provider.enabled);
        },
      )
      .catch((error) =>
        toast.error(
          error instanceof Error ? error.message : "无法读取研究洞察",
        ),
      );
  }, [desktopRuntime, projectId]);
  async function save() {
    try {
      if (!entryId) throw new Error("请先选择研究记录");
      const draft = validateResearchInsightDraft({
        title,
        statement,
        evidence: evidence.split("\n"),
      });
      const saved = await createResearchInsight(true, {
        ...draft,
        id: crypto.randomUUID(),
        projectId,
        entryId,
        planId: planId || undefined,
        evidenceJson: JSON.stringify(draft.evidence),
      });
      setInsights((current) => [saved, ...current]);
      setTitle("");
      setStatement("");
      setEvidence("");
      toast.success("研究洞察草稿已保存");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "研究洞察保存失败");
    }
  }
  async function review(
    item: ResearchInsightRecord,
    status: "accepted" | "rejected",
  ) {
    try {
      await reviewResearchInsight(true, projectId, item.id, status);
      setInsights((current) =>
        current.map((value) =>
          value.id === item.id ? { ...value, status } : value,
        ),
      );
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "研究洞察审核失败");
    }
  }
  async function createCandidate(item: ResearchInsightRecord) {
    try {
      const saved = await createResearchRequirementCandidate(true, {
        id: crypto.randomUUID(),
        projectId,
        insightId: item.id,
        title: item.title,
        description: item.statement,
      });
      setCandidates((current) => [saved, ...current]);
      toast.success("研究需求候选已创建");
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "研究需求候选创建失败",
      );
    }
  }
  async function reviewCandidate(
    item: ResearchRequirementCandidateRecord,
    status: "accepted" | "rejected",
  ) {
    try {
      await reviewResearchRequirementCandidate(
        true,
        projectId,
        item.id,
        status,
      );
      setCandidates((current) =>
        current.map((value) =>
          value.id === item.id ? { ...value, status } : value,
        ),
      );
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "研究需求候选审核失败",
      );
    }
  }
  async function convertCandidate(item: ResearchRequirementCandidateRecord) {
    try {
      if (!meetingId) throw new Error("请先选择项目会议上下文");
      const meeting = projectMeetings.find(
        (candidate) => candidate.id === meetingId,
      );
      if (!meeting) throw new Error("会议不存在或不属于当前项目");
      const insight = insights.find(
        (candidate) => candidate.id === item.insightId,
      );
      if (!insight) throw new Error("候选关联的研究洞察不存在");
      const requirement = await getRequirementRepository(
        desktopRuntime,
      ).createDraft({
        meetingId: meeting.id,
        projectId,
        title: item.title,
        content: {
          description: item.description,
          targetUsers: "",
          scenario: "",
          painPoint: "",
          acceptanceCriteria: [],
        },
        evidence: [
          researchRequirementEvidence(insight.entryId, item.description),
        ],
        source: "user",
        researchCandidateId: item.id,
      });
      setCandidates((current) =>
        current.map((candidate) =>
          candidate.id === item.id
            ? { ...candidate, requirementCardId: requirement.card.id }
            : candidate,
        ),
      );
      toast.success(
        `已创建需求草稿：${requirement.currentVersion.title}，请到会议与需求页面提交人工确认`,
      );
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "正式需求草稿创建失败",
      );
    }
  }
  async function runAgent() {
    try {
      setAgentBusy(true);
      const provider = await loadProviderConfig(true);
      const generated = await generateResearchInsights(
        projectId,
        entries.map((entry) => ({
          entryId: entry.id,
          title: entry.title,
          insight: entry.insight,
          sourceRef: entry.sourceRef,
        })),
        provider,
        desktopRuntime,
      );
      setAgentOutput(generated.output);
      toast.success("研究洞察 Agent 已生成预览");
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "研究洞察 Agent 运行失败",
      );
    } finally {
      setAgentBusy(false);
    }
  }
  return (
    <Card>
      <CardHeader>
        <CardTitle>
          <Lightbulb className="mr-2 inline size-4" />
          研究洞察卡
        </CardTitle>
        <CardDescription>
          洞察先作为草稿，必须人工接受或拒绝；接受后可创建独立需求候选，仍不会自动成为正式需求。
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        <div className="flex justify-end">
          <Button
            variant="outline"
            onClick={() => void runAgent()}
            disabled={
              readOnly ||
              !desktopRuntime ||
              !providerEnabled ||
              !entries.length ||
              agentBusy
            }
          >
            {agentBusy ? "生成中…" : "生成 Agent 预览"}
          </Button>
        </div>
        {agentOutput ? (
          <div className="rounded-md border bg-muted/30 p-3">
            <p className="text-sm font-medium">Agent 预览（未保存）</p>
            {agentOutput.findings.map((finding, index) => (
              <div
                key={`${finding.title}-${index}`}
                className="mt-2 rounded border p-2 text-sm"
              >
                <p className="font-medium">{finding.title}</p>
                <p>{finding.statement}</p>
                <p className="text-xs text-muted-foreground">
                  证据：
                  {finding.citations
                    .map((citation) => citation.quote)
                    .join("；")}
                </p>
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => {
                    setTitle(finding.title);
                    setStatement(finding.statement);
                    setEvidence(
                      finding.citations
                        .map(
                          (citation) =>
                            `${citation.quote}（${citation.sourceRef}）`,
                        )
                        .join("\n"),
                    );
                  }}
                >
                  填充草稿表单
                </Button>
              </div>
            ))}
          </div>
        ) : null}
        <div className="grid gap-2 sm:grid-cols-2">
          <select
            className="rounded-md border bg-background px-3 text-sm"
            aria-label="洞察来源研究记录"
            value={entryId}
            onChange={(e) => setEntryId(e.target.value)}
            disabled={readOnly}
          >
            <option value="">选择研究记录</option>
            {entries.map((entry) => (
              <option key={entry.id} value={entry.id}>
                {entry.title}
              </option>
            ))}
          </select>
          <select
            className="rounded-md border bg-background px-3 text-sm"
            aria-label="洞察关联研究计划"
            value={planId}
            onChange={(e) => setPlanId(e.target.value)}
            disabled={readOnly}
          >
            <option value="">不绑定计划</option>
            {plans
              .filter((plan) => plan.status !== "cancelled")
              .map((plan) => (
                <option key={plan.id} value={plan.id}>
                  {plan.title}
                </option>
              ))}
          </select>
          <Input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="洞察标题"
            disabled={readOnly}
          />
        </div>
        <Textarea
          value={statement}
          onChange={(e) => setStatement(e.target.value)}
          placeholder="洞察陈述"
          disabled={readOnly}
        />
        <Textarea
          value={evidence}
          onChange={(e) => setEvidence(e.target.value)}
          placeholder="证据引用（每行一项）"
          disabled={readOnly}
        />
        <div className="flex justify-end">
          <Button
            onClick={() => void save()}
            disabled={readOnly || !desktopRuntime}
          >
            保存洞察草稿
          </Button>
        </div>
        {insights.map((item) => (
          <div key={item.id} className="rounded-md border p-3 text-sm">
            <div className="flex items-center gap-2">
              <p className="flex-1 font-medium">{item.title}</p>
              <Badge
                variant={item.status === "rejected" ? "destructive" : "outline"}
              >
                {labels[item.status]}
              </Badge>
            </div>
            <p className="mt-1">{item.statement}</p>
            <p className="mt-1 text-muted-foreground">
              证据：{JSON.parse(item.evidenceJson).join("；")}
            </p>
            {item.status === "draft" ? (
              <div className="mt-2 flex justify-end gap-2">
                <Button
                  size="sm"
                  onClick={() => void review(item, "accepted")}
                  disabled={readOnly}
                >
                  接受
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => void review(item, "rejected")}
                  disabled={readOnly}
                >
                  拒绝
                </Button>
              </div>
            ) : item.status === "accepted" &&
              !candidates.some(
                (candidate) => candidate.insightId === item.id,
              ) ? (
              <div className="mt-2 flex justify-end">
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => void createCandidate(item)}
                  disabled={readOnly}
                >
                  创建需求候选
                </Button>
              </div>
            ) : null}
          </div>
        ))}
        {candidates.length ? (
          <div className="border-t pt-3">
            <p className="font-medium">研究需求候选</p>
            {candidates.some((item) => item.status === "accepted") ? (
              <div className="mt-2 rounded-md border bg-muted/30 p-3">
                <label
                  className="text-sm font-medium"
                  htmlFor={`research-requirement-meeting-${projectId}`}
                >
                  正式需求所属会议
                </label>
                <select
                  id={`research-requirement-meeting-${projectId}`}
                  className="mt-2 min-h-9 w-full rounded-md border bg-background px-3 text-sm"
                  value={meetingId}
                  onChange={(event) => setMeetingId(event.target.value)}
                  disabled={readOnly}
                >
                  <option value="">选择项目会议上下文</option>
                  {projectMeetings.map((meeting) => (
                    <option key={meeting.id} value={meeting.id}>
                      {meeting.title}
                    </option>
                  ))}
                </select>
                <p className="mt-2 text-xs text-muted-foreground">
                  转换只创建带研究来源证据的需求草稿，仍需在会议与需求页面提交并人工确认。
                </p>
              </div>
            ) : null}
            {candidates.map((item) => (
              <div key={item.id} className="mt-2 rounded-md border p-3 text-sm">
                <div className="flex items-center gap-2">
                  <p className="flex-1 font-medium">{item.title}</p>
                  <Badge
                    variant={
                      item.status === "rejected" ? "destructive" : "outline"
                    }
                  >
                    {item.status === "draft"
                      ? "待审核"
                      : item.status === "accepted"
                        ? "已接受"
                        : "已拒绝"}
                  </Badge>
                </div>
                <p className="mt-1">{item.description}</p>
                {item.status === "draft" ? (
                  <div className="mt-2 flex justify-end gap-2">
                    <Button
                      size="sm"
                      onClick={() => void reviewCandidate(item, "accepted")}
                      disabled={readOnly}
                    >
                      接受候选
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => void reviewCandidate(item, "rejected")}
                      disabled={readOnly}
                    >
                      拒绝候选
                    </Button>
                  </div>
                ) : item.status === "accepted" ? (
                  <div className="mt-2 flex justify-end">
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => void convertCandidate(item)}
                      disabled={
                        readOnly || !meetingId || Boolean(item.requirementCardId)
                      }
                    >
                      {item.requirementCardId
                        ? "已创建需求草稿"
                        : "创建正式需求草稿"}
                    </Button>
                  </div>
                ) : null}
              </div>
            ))}
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}
