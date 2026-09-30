import { useEffect, useState } from "react";
import { Link2 } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { dependencyDueState, validateProjectDependencyDraft, type DependencyStatus, type DependencyType } from "@/domain/project-dependency";
import { createProjectDependency, listProjectDependencies, updateProjectDependencyStatus, type ProjectDependencyRecord } from "@/services/project-dependency-service";
import { loadProviderConfig } from "@/data/provider-settings";
import { generateDependencyRemediationProposals } from "@/services/structured-generation-service";
import { confirmAgentToolProposal, listAgentToolProposals, rejectAgentToolProposal, saveDependencyUpdateProposals, type AgentToolProposal } from "@/services/agent-tool-proposal-service";

const empty = { title: "", description: "", dependencyType: "internal" as DependencyType, owner: "", dueDate: "", resolution: "" };
const labels: Record<string, string> = { internal: "内部", external: "外部", technical: "技术", approval: "审批", pending: "待处理", blocked: "阻塞", ready: "已就绪", resolved: "已解决" };
const proposalLabels: Record<AgentToolProposal["status"], string> = { pending_confirmation: "待确认", executed: "已执行", rejected: "已拒绝", stale: "已过期" };
const changeLabels: Record<string, string> = { owner: "负责人", dueDate: "截止日期", resolution: "解决条件" };
const proposalChangeText = (proposal: AgentToolProposal) => Object.entries(proposal.changes).map(([key, value]) => `${changeLabels[key] ?? key}：${String(value)}`);

export function ProjectDependencyPanel({ projectId, desktopRuntime, readOnly }: { projectId: string; desktopRuntime: boolean; readOnly: boolean }) {
  const [form, setForm] = useState(empty);
  const [items, setItems] = useState<ProjectDependencyRecord[]>([]);
  const [providerEnabled, setProviderEnabled] = useState(false);
  const [proposals, setProposals] = useState<AgentToolProposal[]>([]);
  const [confirmingProposal, setConfirmingProposal] = useState<AgentToolProposal>();
  const [busy, setBusy] = useState(false);
  const [proposalBusyId, setProposalBusyId] = useState<string>();

  const reload = () => {
    if (!desktopRuntime) return;
    void Promise.all([listProjectDependencies(true, projectId), loadProviderConfig(true), listAgentToolProposals(true, projectId)])
      .then(([dependencies, provider, savedProposals]) => {
        setItems(dependencies);
        setProviderEnabled(provider.enabled);
        setProposals(savedProposals.filter((item) => item.targetType === "project_dependency"));
      })
      .catch((error) => toast.error(error instanceof Error ? error.message : "无法读取依赖"));
  };
  useEffect(reload, [desktopRuntime, projectId]);

  async function save() {
    try {
      const draft = validateProjectDependencyDraft(form);
      const saved = await createProjectDependency(true, { ...draft, id: crypto.randomUUID(), projectId });
      setItems((current) => [saved, ...current]);
      setForm(empty);
      toast.success("依赖已保存");
    } catch (error) { toast.error(error instanceof Error ? error.message : "依赖保存失败"); }
  }
  async function change(item: ProjectDependencyRecord, status: DependencyStatus) {
    try {
      await updateProjectDependencyStatus(true, projectId, item.id, status);
      setItems((current) => current.map((value) => value.id === item.id ? { ...value, status } : value));
    } catch (error) { toast.error(error instanceof Error ? error.message : "依赖状态更新失败"); }
  }
  async function generateProposals() {
    try {
      setBusy(true);
      const generated = await generateDependencyRemediationProposals(projectId, items, await loadProviderConfig(true), desktopRuntime);
      if (!generated.output.proposals.length) { toast.info("依赖处置 Agent 未发现需要修改的字段"); return; }
      await saveDependencyUpdateProposals(true, projectId, generated.runId, generated.output.proposals);
      setProposals((await listAgentToolProposals(true, projectId)).filter((item) => item.targetType === "project_dependency"));
      toast.success(`已保存 ${generated.output.proposals.length} 条待确认依赖提案`);
    } catch (error) { toast.error(error instanceof Error ? error.message : "依赖处置 Agent 运行失败"); }
    finally { setBusy(false); }
  }
  async function confirmProposal(proposal: AgentToolProposal) {
    try {
      setProposalBusyId(proposal.id);
      const status = await confirmAgentToolProposal(true, projectId, proposal.id);
      const [dependencies, savedProposals] = await Promise.all([listProjectDependencies(true, projectId), listAgentToolProposals(true, projectId)]);
      setItems(dependencies);
      setProposals(savedProposals.filter((item) => item.targetType === "project_dependency"));
      setConfirmingProposal(undefined);
      if (status === "stale") toast.warning("依赖已变化或解决，提案已过期且没有覆盖新数据");
      else toast.success("依赖处置提案已确认并应用");
    } catch (error) { toast.error(error instanceof Error ? error.message : "依赖提案执行失败"); }
    finally { setProposalBusyId(undefined); }
  }
  async function rejectProposal(proposal: AgentToolProposal) {
    try {
      setProposalBusyId(proposal.id);
      await rejectAgentToolProposal(true, projectId, proposal.id);
      setProposals((await listAgentToolProposals(true, projectId)).filter((item) => item.targetType === "project_dependency"));
      toast.success("依赖提案已拒绝，正式数据未修改");
    } catch (error) { toast.error(error instanceof Error ? error.message : "依赖提案拒绝失败"); }
    finally { setProposalBusyId(undefined); }
  }

  return <Card>
    <CardHeader><CardTitle><Link2 className="mr-2 inline size-4" />依赖管理</CardTitle><CardDescription>记录内部、外部、技术和审批依赖；负责人、截止日期和解决条件可回流今日驾驶舱。</CardDescription></CardHeader>
    <CardContent className="flex flex-col gap-3">
      <div className="flex justify-end"><Button variant="outline" onClick={() => void generateProposals()} disabled={readOnly || !desktopRuntime || !providerEnabled || !items.some((item) => item.status !== "resolved") || busy}>{busy ? "生成中…" : "生成依赖处置提案"}</Button></div>
      {proposals.length ? <div className="rounded-md border bg-muted/20 p-3">
        <div className="flex items-center justify-between gap-2"><div><p className="font-medium">依赖处置提案收件箱</p><p className="text-xs text-muted-foreground">Agent 只能建议负责人、截止日期和解决条件；依赖状态不在授权范围。</p></div><Badge variant="outline">{proposals.filter((item) => item.status === "pending_confirmation").length} 条待确认</Badge></div>
        {proposals.map((proposal) => <div key={proposal.id} className="mt-2 rounded border bg-background p-2 text-sm">
          <div className="flex items-center gap-2"><p className="flex-1 font-medium">{items.find((item) => item.id === proposal.targetId)?.title ?? proposal.targetId}</p><Badge variant={proposal.status === "stale" || proposal.status === "rejected" ? "destructive" : "outline"}>{proposalLabels[proposal.status]}</Badge></div>
          <p className="mt-1 text-muted-foreground">{proposal.rationale}</p><ul className="mt-1 list-disc pl-5">{proposalChangeText(proposal).map((text) => <li key={text}>{text}</li>)}</ul>
          <p className="mt-1 text-xs text-muted-foreground">证据 {proposal.citations.length} 条 · 目标快照 {proposal.expectedTargetUpdatedAt}</p>
          {proposal.status === "pending_confirmation" ? <div className="mt-2 flex justify-end gap-2"><Button size="sm" variant="ghost" disabled={readOnly || proposalBusyId === proposal.id} onClick={() => void rejectProposal(proposal)}>拒绝</Button><Button size="sm" disabled={readOnly || proposalBusyId === proposal.id} onClick={() => setConfirmingProposal(proposal)}>审核并确认</Button></div> : null}
        </div>)}
      </div> : null}
      <div className="grid gap-2 sm:grid-cols-2"><Input value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} placeholder="依赖标题" disabled={readOnly} /><Input type="date" value={form.dueDate} onChange={(e) => setForm({ ...form, dueDate: e.target.value })} aria-label="依赖截止日期" disabled={readOnly} /><Input value={form.owner} onChange={(e) => setForm({ ...form, owner: e.target.value })} placeholder="负责人" disabled={readOnly} /><select className="rounded-md border bg-background px-3 text-sm" value={form.dependencyType} onChange={(e) => setForm({ ...form, dependencyType: e.target.value as DependencyType })} aria-label="依赖类型" disabled={readOnly}><option value="internal">内部依赖</option><option value="external">外部依赖</option><option value="technical">技术依赖</option><option value="approval">审批依赖</option></select></div>
      <Textarea value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} placeholder="依赖内容与影响" disabled={readOnly} /><Textarea value={form.resolution} onChange={(e) => setForm({ ...form, resolution: e.target.value })} placeholder="解决条件或替代方案" disabled={readOnly} /><div className="flex justify-end"><Button onClick={() => void save()} disabled={readOnly || !desktopRuntime}>保存依赖</Button></div>
      {items.map((item) => { const due = dependencyDueState(item.dueDate, new Date().toISOString().slice(0, 10)); return <div key={item.id} className="rounded-md border p-3 text-sm"><div className="flex flex-wrap items-center gap-2"><p className="flex-1 font-medium">{item.title}</p><Badge variant="outline">{labels[item.dependencyType]}</Badge><Badge variant={item.status === "blocked" ? "destructive" : "outline"}>{labels[item.status]}</Badge><Badge variant={due === "overdue" && item.status !== "resolved" ? "destructive" : "outline"}>截止 {item.dueDate}</Badge></div><p className="mt-1 text-muted-foreground">{item.description} · 负责人：{item.owner}</p><p className="mt-1">解决条件：{item.resolution}</p><div className="mt-2 flex justify-end gap-2">{item.status !== "blocked" && item.status !== "resolved" ? <Button size="sm" variant="outline" onClick={() => void change(item, "blocked")} disabled={readOnly}>标记阻塞</Button> : null}{item.status !== "ready" && item.status !== "resolved" ? <Button size="sm" variant="outline" onClick={() => void change(item, "ready")} disabled={readOnly}>标记就绪</Button> : null}{item.status !== "resolved" ? <Button size="sm" onClick={() => void change(item, "resolved")} disabled={readOnly}>解决</Button> : null}</div></div>; })}
    </CardContent>
    <Dialog open={Boolean(confirmingProposal)} onOpenChange={(open) => { if (!open && !proposalBusyId) setConfirmingProposal(undefined); }}><DialogContent><DialogHeader><DialogTitle>确认执行依赖处置更新？</DialogTitle><DialogDescription>这会修改正式依赖数据，但不会修改依赖状态。若依赖快照已变化或已解决，执行器会拒绝覆盖。</DialogDescription></DialogHeader>{confirmingProposal ? <ul className="list-disc space-y-1 pl-5">{proposalChangeText(confirmingProposal).map((text) => <li key={text}>{text}</li>)}</ul> : null}<DialogFooter><DialogClose render={<Button variant="outline" disabled={Boolean(proposalBusyId)} />}>取消</DialogClose><Button disabled={!confirmingProposal || Boolean(proposalBusyId)} onClick={() => confirmingProposal && void confirmProposal(confirmingProposal)}>{proposalBusyId ? "执行中…" : "确认并应用"}</Button></DialogFooter></DialogContent></Dialog>
  </Card>;
}
