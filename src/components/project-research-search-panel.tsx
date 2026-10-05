import { useEffect, useState } from "react";
import { Search } from "lucide-react";
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
import { loadResearchSearchConfig } from "@/data/research-search-settings";
import {
  defaultResearchSearchConfig,
  type ResearchSearchConfig,
} from "@/domain/research-search-settings";
import type { ResearchSearchResult } from "@/domain/research-search-adapter";
import { searchResearchSources } from "@/services/research-search-service";

export function ProjectResearchSearchPanel({
  desktopRuntime,
  readOnly,
}: {
  desktopRuntime: boolean;
  readOnly: boolean;
}) {
  const [query, setQuery] = useState("");
  const [config, setConfig] = useState<ResearchSearchConfig>(
    defaultResearchSearchConfig,
  );
  const [results, setResults] = useState<ResearchSearchResult[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    void loadResearchSearchConfig(desktopRuntime)
      .then(setConfig)
      .catch(() => toast.error("无法读取外部搜索配置"));
  }, [desktopRuntime]);

  async function search() {
    setLoading(true);
    try {
      setResults(
        await searchResearchSources({
          provider: config.provider,
          query,
          endpoint: config.endpoint,
          timeoutMs: config.timeoutMs,
        }),
      );
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "搜索失败");
      setResults([]);
    } finally {
      setLoading(false);
    }
  }

  const available =
    desktopRuntime && config.enabled && Boolean(config.endpoint);

  return (
    <Card>
      <CardHeader>
        <CardTitle>
          <Search className="mr-2 inline size-4" />
          外部资料搜索预览
        </CardTitle>
        <CardDescription>
          搜索结果仅供核验，不会自动写入研究记录；确认后请使用上方的手动研究记录表保存来源。
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        <div className="grid gap-2 sm:grid-cols-[1fr_auto]">
          <Input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="输入研究问题或关键词"
            disabled={readOnly || !available}
            aria-label="搜索关键词"
          />
          <Button
            onClick={() => void search()}
            disabled={readOnly || !available || loading || !query.trim()}
          >
            {loading ? "搜索中…" : "搜索"}
          </Button>
        </div>
        <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
          <Badge variant={available ? "secondary" : "outline"}>
            {available ? "搜索已配置" : "搜索未配置"}
          </Badge>
          {available ? (
            <span>
              {config.provider === "wikipedia_zh" ? "中文维基百科" : "通用 JSON 适配器"}
              {" · "}超时 {config.timeoutMs} ms
            </span>
          ) : (
            <span>请先在“设置 → 外部研究搜索”中保存并启用适配器。</span>
          )}
        </div>
        {!desktopRuntime ? (
          <p className="text-sm text-muted-foreground">
            当前为浏览器预览模式，桌面运行时才允许访问外部搜索适配器。
          </p>
        ) : null}
        {results.map((result) => (
          <article key={result.id} className="rounded-md border p-3 text-sm">
            <div className="flex flex-wrap items-center gap-2">
              <a
                className="font-medium underline"
                href={result.url}
                target="_blank"
                rel="noreferrer"
              >
                {result.title}
              </a>
              <Badge variant="outline">预览</Badge>
            </div>
            <p className="mt-1 text-muted-foreground">{result.snippet}</p>
            <p className="mt-1 break-all text-xs text-muted-foreground">
              {result.url}
            </p>
          </article>
        ))}
        {config.provider === "wikipedia_zh" && results.length > 0 ? (
          <p className="text-xs text-muted-foreground">
            来源：中文维基百科。摘要仅用于研究预览；页面文本通常采用{" "}
            <a
              className="underline"
              href="https://creativecommons.org/licenses/by-sa/4.0/"
              target="_blank"
              rel="noreferrer"
            >
              CC BY-SA 4.0
            </a>
            ，引用或再发布前请核对原页面的作者与许可说明。
          </p>
        ) : null}
        {available && results.length === 0 && !loading ? (
          <p className="text-sm text-muted-foreground">
            {config.provider === "wikipedia_zh"
              ? "暂无维基百科预览结果，可调整关键词或继续手动录入来源。"
              : <>暂无预览结果。适配器应返回 <code>{"{ results: [{ title, url, snippet }] }"}</code>。</>}
          </p>
        ) : null}
      </CardContent>
    </Card>
  );
}
