import { useEffect, useState } from "react";
import { ScanSearch } from "lucide-react";
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
import { validateCompetitorProfileDraft } from "@/domain/competitor-profile";
import {
  createCompetitorProfile,
  listCompetitorProfiles,
  type CompetitorProfileRecord,
} from "@/services/competitor-profile-service";
import { loadProviderConfig } from "@/data/provider-settings";
import { generateCompetitorReview } from "@/services/structured-generation-service";
import type { CompetitorReviewOutput } from "@/domain/competitor-review-agent";
const empty = {
  name: "",
  sourceRef: "",
  accessedAt: "",
  strengths: "",
  weaknesses: "",
  positioning: "",
};
export function ProjectCompetitorPanel({
  projectId,
  desktopRuntime,
  readOnly,
}: {
  projectId: string;
  desktopRuntime: boolean;
  readOnly: boolean;
}) {
  const [form, setForm] = useState(empty);
  const [profiles, setProfiles] = useState<CompetitorProfileRecord[]>([]);
  const [providerEnabled, setProviderEnabled] = useState(false);
  const [reviewBusy, setReviewBusy] = useState(false);
  const [review, setReview] = useState<CompetitorReviewOutput>();
  useEffect(() => {
    if (desktopRuntime) {
      void Promise.all([
        listCompetitorProfiles(true, projectId),
        loadProviderConfig(true),
      ])
        .then(([savedProfiles, provider]) => {
          setProfiles(savedProfiles);
          setProviderEnabled(provider.enabled);
        })
        .catch((error) =>
          toast.error(
            error instanceof Error ? error.message : "无法读取竞品档案",
          ),
        );
    }
  }, [desktopRuntime, projectId]);
  async function save() {
    try {
      const draft = validateCompetitorProfileDraft(form);
      const saved = await createCompetitorProfile(true, {
        ...draft,
        id: crypto.randomUUID(),
        projectId,
      });
      setProfiles((current) => [saved, ...current]);
      setForm(empty);
      toast.success("竞品档案已保存");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "竞品档案保存失败");
    }
  }
  async function runReview() {
    try {
      setReviewBusy(true);
      const provider = await loadProviderConfig(true);
      const generated = await generateCompetitorReview(
        projectId,
        profiles,
        provider,
        desktopRuntime,
      );
      setReview(generated.output);
      toast.success("竞品审阅 Agent 已生成只读预览");
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "竞品审阅 Agent 运行失败",
      );
    } finally {
      setReviewBusy(false);
    }
  }
  return (
    <Card>
      <CardHeader>
        <CardTitle>
          <ScanSearch className="mr-2 inline size-4" />
          竞品档案
        </CardTitle>
        <CardDescription>
          手动记录竞品和来源，保留访问日期、优势、短板与定位；没有搜索服务时仍可完成比较基线。
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
              !profiles.length ||
              reviewBusy
            }
          >
            {reviewBusy ? "审阅中…" : "生成竞品审阅预览"}
          </Button>
        </div>
        {review ? (
          <div className="rounded-md border bg-muted/30 p-3">
            <p className="font-medium">Agent 只读预览</p>
            <p className="mt-1 text-xs text-muted-foreground">
              仅比较已保存档案，不联网补写事实，也不修改档案或创建需求。
            </p>
            {review.findings.map((finding, index) => (
              <div
                key={`${finding.category}-${index}`}
                className="mt-2 rounded border bg-background/70 p-2 text-sm"
              >
                <div className="flex flex-wrap items-center gap-2">
                  <Badge variant="outline">{finding.category}</Badge>
                  <span className="text-xs text-muted-foreground">
                    {finding.profileIds
                      .map(
                        (id) =>
                          profiles.find((profile) => profile.id === id)?.name ??
                          id,
                      )
                      .join(" / ")}
                  </span>
                </div>
                <p className="mt-1 font-medium">{finding.summary}</p>
                <p className="mt-1 text-muted-foreground">
                  启示：{finding.implication}
                </p>
                <p className="mt-1 text-xs text-muted-foreground">
                  引用：
                  {finding.citations
                    .map(
                      (citation) => `${citation.profileId}.${citation.field}`,
                    )
                    .join("、")}
                </p>
              </div>
            ))}
            {review.limitations.length ? (
              <p className="mt-2 text-xs text-muted-foreground">
                限制：{review.limitations.join("；")}
              </p>
            ) : null}
          </div>
        ) : null}
        <div className="grid gap-2 sm:grid-cols-2">
          <Input
            value={form.name}
            onChange={(e) => setForm({ ...form, name: e.target.value })}
            placeholder="竞品名称"
            disabled={readOnly}
          />
          <Input
            value={form.sourceRef}
            onChange={(e) => setForm({ ...form, sourceRef: e.target.value })}
            placeholder="来源链接或文件引用"
            disabled={readOnly}
          />
          <Input
            type="date"
            value={form.accessedAt}
            onChange={(e) => setForm({ ...form, accessedAt: e.target.value })}
            aria-label="访问日期"
            disabled={readOnly}
          />
        </div>
        <Textarea
          value={form.strengths}
          onChange={(e) => setForm({ ...form, strengths: e.target.value })}
          placeholder="优势"
          disabled={readOnly}
        />
        <Textarea
          value={form.weaknesses}
          onChange={(e) => setForm({ ...form, weaknesses: e.target.value })}
          placeholder="短板"
          disabled={readOnly}
        />
        <Textarea
          value={form.positioning}
          onChange={(e) => setForm({ ...form, positioning: e.target.value })}
          placeholder="市场定位与差异"
          disabled={readOnly}
        />
        <div className="flex justify-end">
          <Button
            onClick={() => void save()}
            disabled={readOnly || !desktopRuntime}
          >
            保存竞品档案
          </Button>
        </div>
        {profiles.map((item) => (
          <div key={item.id} className="rounded-md border p-3 text-sm">
            <div className="flex flex-wrap items-center gap-2">
              <p className="flex-1 font-medium">{item.name}</p>
              <Badge variant="outline">访问 {item.accessedAt}</Badge>
            </div>
            <p className="mt-1 text-muted-foreground">来源：{item.sourceRef}</p>
            <p className="mt-1">优势：{item.strengths}</p>
            <p className="mt-1">短板：{item.weaknesses}</p>
            <p className="mt-1">定位：{item.positioning}</p>
          </div>
        ))}
      </CardContent>
    </Card>
  );
}
