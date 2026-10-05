import { useState, type FormEvent } from "react";
import {
  BotIcon,
  CircleHelpIcon,
  DatabaseIcon,
  LoaderCircleIcon,
  QuoteIcon,
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
import { Textarea } from "@/components/ui/textarea";
import { loadProviderConfig } from "@/data/provider-settings";
import type { ProjectQaEvidence } from "@/domain/project-qa";
import {
  generateProjectQuestion,
  type ProjectQuestionAnswer,
  type ProjectQaBusinessContext,
} from "@/services/structured-generation-service";

const sourceLabels: Record<ProjectQaEvidence["sourceType"], string> = {
  memory: "已确认记忆",
  project: "项目事实",
  milestone: "里程碑",
  confirmation: "确认事项",
  risk: "风险",
  dependency: "依赖",
  release: "发布复盘",
  research: "研究记录",
};

function errorMessage(error: unknown) {
  return error instanceof Error && error.message
    ? error.message
    : "项目问答运行失败";
}

function readableEvidence(content: string) {
  try {
    return JSON.stringify(JSON.parse(content), null, 2).slice(0, 2_000);
  } catch {
    return content.slice(0, 2_000);
  }
}

export function ProjectQaPanel({
  projectId,
  desktopRuntime,
  businessContext,
  readOnly = false,
}: {
  projectId: string;
  desktopRuntime: boolean;
  businessContext?: ProjectQaBusinessContext;
  readOnly?: boolean;
}) {
  const [question, setQuestion] = useState("");
  const [answer, setAnswer] = useState<ProjectQuestionAnswer>();
  const [loading, setLoading] = useState(false);
  const normalizedQuestion = question.trim();
  const questionBytes = new TextEncoder().encode(normalizedQuestion).length;
  const questionValid =
    Boolean(normalizedQuestion) &&
    questionBytes <= 500 &&
    /[\p{L}\p{N}]/u.test(normalizedQuestion);

  async function ask(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setLoading(true);
    setAnswer(undefined);
    try {
      const provider = await loadProviderConfig(desktopRuntime);
      setAnswer(
        await generateProjectQuestion(
          projectId,
          question,
          provider,
          desktopRuntime,
          businessContext,
        ),
      );
    } catch (error) {
      toast.error(errorMessage(error));
    } finally {
      setLoading(false);
    }
  }

  if (!desktopRuntime)
    return (
      <Card>
        <CardHeader>
          <CardTitle>项目问答</CardTitle>
          <CardDescription>只基于当前项目证据回答，并展示引用。</CardDescription>
        </CardHeader>
        <CardContent>
          <Alert>
            <BotIcon />
            <AlertTitle>桌面模式功能</AlertTitle>
            <AlertDescription>
              浏览器预览不会调用模型或读取本地项目证据。
            </AlertDescription>
          </Alert>
        </CardContent>
      </Card>
    );

  return (
    <Card>
      <CardHeader>
        <CardTitle>多源项目问答</CardTitle>
        <CardDescription>
          检索当前项目的已确认记忆、项目事实、里程碑、确认事项、风险、依赖、发布和研究记录；每条引用均由桌面后端复核完整快照。
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        {readOnly ? (
          <Alert>
            <DatabaseIcon />
            <AlertTitle>归档项目只读</AlertTitle>
            <AlertDescription>
              后端不会把归档项目数据发送给模型；恢复项目后才能提问。
            </AlertDescription>
          </Alert>
        ) : null}
        <form className="flex flex-col gap-2" onSubmit={ask}>
          <Textarea
            value={question}
            onChange={(event) => setQuestion(event.target.value)}
            maxLength={500}
            required
            disabled={readOnly || loading}
            placeholder="例如：当前发布范围、阻塞依赖和高风险是什么？"
            aria-label="项目问题"
          />
          <div className="flex items-center justify-between gap-3">
            <span className="text-xs text-muted-foreground">
              {questionBytes}/500 字节
            </span>
            <Button
              type="submit"
              disabled={readOnly || loading || !questionValid}
            >
              {loading ? (
                <>
                  <LoaderCircleIcon className="animate-spin" data-icon="inline-start" />
                  检索并回答…
                </>
              ) : (
                <>
                  <CircleHelpIcon data-icon="inline-start" />
                  提问
                </>
              )}
            </Button>
          </div>
        </form>
        {answer ? (
          <div className="flex flex-col gap-3 rounded-lg border bg-muted/20 p-3">
            <div className="flex flex-wrap items-center gap-2">
              <Badge variant="secondary">
                <BotIcon data-icon="inline-start" />只读回答
              </Badge>
              <Badge variant="outline">{answer.evidence.length} 条候选证据</Badge>
              <span className="text-xs text-muted-foreground">
                {answer.durationMs} ms
              </span>
            </div>
            <p className="whitespace-pre-wrap text-sm">{answer.output.answer}</p>
            <div className="rounded-md border p-2">
              <p className="mb-2 flex items-center gap-1 text-xs font-medium">
                <QuoteIcon className="size-3.5" />引用来源（可展开）
              </p>
              <div className="flex flex-col gap-2">
                {answer.output.citations.map((citation) => {
                  const evidence = answer.evidence.find(
                    (item) =>
                      item.sourceType === citation.sourceType &&
                      item.sourceId === citation.sourceId,
                  );
                  return (
                    <details
                      key={`${citation.sourceType}:${citation.sourceId}`}
                      className="rounded border bg-background p-2 text-xs"
                    >
                      <summary className="cursor-pointer font-medium">
                        {citation.title}
                        <span className="ml-2 font-normal text-muted-foreground">
                          {sourceLabels[citation.sourceType]} · {citation.sourceId}
                        </span>
                      </summary>
                      {evidence ? (
                        <>
                          <pre className="mt-2 max-h-56 overflow-auto whitespace-pre-wrap break-words rounded bg-muted/40 p-2 font-sans">
                            {readableEvidence(evidence.content)}
                          </pre>
                          {evidence.sourceKind ? (
                            <p className="mt-1 text-muted-foreground">
                              原始来源：{evidence.sourceKind} · {evidence.sourceIdDetail ?? "无来源 ID"}
                            </p>
                          ) : null}
                        </>
                      ) : (
                        <p className="mt-2 text-destructive">引用证据未加载。</p>
                      )}
                    </details>
                  );
                })}
              </div>
            </div>
            <p className="text-xs text-muted-foreground">
              不确定性：{answer.output.uncertainty}
            </p>
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}
