import { useEffect, useState } from "react";
import { RefreshCwIcon, SearchIcon } from "lucide-react";
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
import {
  Field,
  FieldDescription,
  FieldGroup,
  FieldLabel,
} from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import {
  loadResearchSearchConfig,
  persistResearchSearchConfig,
} from "@/data/research-search-settings";
import {
  defaultResearchSearchConfig,
  validateResearchSearchConfig,
  WIKIPEDIA_ZH_SEARCH_ENDPOINT,
  type ResearchSearchProvider,
  type ResearchSearchConfig,
} from "@/domain/research-search-settings";
import { searchResearchSources } from "@/services/research-search-service";

type TestResult = { available: boolean; message: string };

export function ResearchSearchSettingsCard({
  desktopRuntime,
}: {
  desktopRuntime: boolean;
}) {
  const [config, setConfig] = useState<ResearchSearchConfig>(
    defaultResearchSearchConfig,
  );
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<TestResult>();

  useEffect(() => {
    void loadResearchSearchConfig(desktopRuntime)
      .then(setConfig)
      .catch(() => toast.error("无法读取外部搜索配置"));
  }, [desktopRuntime]);

  async function save() {
    setSaving(true);
    try {
      const saved = await persistResearchSearchConfig(
        {
          provider: config.provider,
          endpoint: config.endpoint,
          enabled: config.enabled,
          timeoutMs: config.timeoutMs,
        },
        desktopRuntime,
      );
      setConfig(saved);
      setTestResult(undefined);
      toast.success("外部搜索配置已保存");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "外部搜索配置无效");
    } finally {
      setSaving(false);
    }
  }

  async function testConnection() {
    setTesting(true);
    setTestResult(undefined);
    try {
      const results = await searchResearchSources({
        provider: config.provider,
        query: config.provider === "wikipedia_zh" ? "产品研究" : "product research",
        endpoint: config.endpoint,
        timeoutMs: config.timeoutMs,
      });
      setTestResult({
        available: true,
        message: `适配器契约有效，测试返回 ${results.length} 条预览结果。`,
      });
    } catch (error) {
      setTestResult({
        available: false,
        message: error instanceof Error ? error.message : "连接测试失败",
      });
    } finally {
      setTesting(false);
    }
  }

  const validation = validateResearchSearchConfig({
    provider: config.provider,
    endpoint: config.endpoint,
    enabled: config.enabled,
    timeoutMs: config.timeoutMs,
  });

  return (
    <Card>
      <CardHeader>
        <CardTitle>
          <SearchIcon className="mr-2 inline size-4" />
          外部研究搜索
        </CardTitle>
        <CardDescription>
          可直接使用免密钥的中文维基百科，或配置通用 JSON 适配器；这里只保存非敏感端点和超时。
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <FieldGroup>
          <Field orientation="horizontal">
            <div>
              <FieldLabel>启用外部搜索</FieldLabel>
              <FieldDescription>
                关闭后研究页面仍可手动录入来源。
              </FieldDescription>
            </div>
            <Switch
              checked={config.enabled}
              onCheckedChange={(enabled) => {
                setConfig((current) => ({ ...current, enabled }));
                setTestResult(undefined);
              }}
            />
          </Field>
          <Field>
            <FieldLabel htmlFor="research-search-provider">搜索提供商</FieldLabel>
            <select
              id="research-search-provider"
              className="h-9 rounded-md border bg-background px-3 text-sm"
              value={config.provider}
              onChange={(event) => {
                const provider = event.target.value as ResearchSearchProvider;
                setConfig((current) => ({
                  ...current,
                  provider,
                  endpoint:
                    provider === "wikipedia_zh"
                      ? WIKIPEDIA_ZH_SEARCH_ENDPOINT
                      : current.provider === "wikipedia_zh"
                        ? ""
                        : current.endpoint,
                }));
                setTestResult(undefined);
              }}
              disabled={!config.enabled}
            >
              <option value="wikipedia_zh">中文维基百科（内置、免密钥）</option>
              <option value="generic_json">通用 JSON 适配器</option>
            </select>
            <FieldDescription>
              内置来源适合查找公开背景资料，不等同于全网搜索或竞品实时情报。
            </FieldDescription>
          </Field>
          <Field>
            <FieldLabel htmlFor="research-search-endpoint">
              适配器地址
            </FieldLabel>
            <Input
              id="research-search-endpoint"
              value={config.endpoint}
              onChange={(event) => {
                setConfig((current) => ({
                  ...current,
                  endpoint: event.target.value,
                }));
                setTestResult(undefined);
              }}
              placeholder="https://search.example.com/api"
              disabled={!config.enabled || config.provider === "wikipedia_zh"}
            />
            <FieldDescription>
              {config.provider === "wikipedia_zh"
                ? "内置提供商固定使用中文维基百科官方 API，不允许修改。"
                : "仅允许 HTTPS；本机开发适配器可使用 localhost 或 127.0.0.1 HTTP。"}
              桌面请求经已认证 Sidecar 转发，不放宽 WebView 网络权限。
            </FieldDescription>
          </Field>
          <Field>
            <FieldLabel htmlFor="research-search-timeout">
              请求超时（毫秒）
            </FieldLabel>
            <Input
              id="research-search-timeout"
              type="number"
              min={1000}
              max={30000}
              step={500}
              value={config.timeoutMs}
              onChange={(event) => {
                setConfig((current) => ({
                  ...current,
                  timeoutMs: Number(event.target.value),
                }));
                setTestResult(undefined);
              }}
              disabled={!config.enabled}
            />
          </Field>
        </FieldGroup>
        {testResult ? (
          <Alert variant={testResult.available ? "default" : "destructive"}>
            <AlertTitle>
              {testResult.available ? "连接可用" : "连接失败"}
            </AlertTitle>
            <AlertDescription>{testResult.message}</AlertDescription>
          </Alert>
        ) : null}
        <div className="flex flex-wrap items-center justify-between gap-3">
          <Badge variant={testResult?.available ? "secondary" : "outline"}>
            {testResult?.available
              ? "契约已验证"
              : config.enabled
                ? "待验证"
                : "未启用"}
          </Badge>
          <div className="flex flex-wrap gap-2">
            <Button
              variant="outline"
              disabled={
                !desktopRuntime ||
                !config.enabled ||
                !validation.valid ||
                testing
              }
              onClick={() => void testConnection()}
            >
              <RefreshCwIcon data-icon="inline-start" />
              {testing ? "检测中…" : "测试连接"}
            </Button>
            <Button
              variant="outline"
              disabled={saving || !validation.valid}
              onClick={() => void save()}
            >
              {saving ? "保存中…" : "保存搜索配置"}
            </Button>
          </div>
        </div>
        {!desktopRuntime ? (
          <p className="text-xs text-muted-foreground">
            浏览器预览可以保存界面配置，但不会执行连接测试或项目搜索。
          </p>
        ) : null}
      </CardContent>
    </Card>
  );
}
