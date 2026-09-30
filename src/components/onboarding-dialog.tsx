import { useEffect, useState } from "react"
import { invoke } from "@tauri-apps/api/core"
import { ArrowLeftIcon, ArrowRightIcon, CheckIcon, SparklesIcon } from "lucide-react"
import { toast } from "sonner"

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Field, FieldDescription, FieldGroup, FieldLabel } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { Progress } from "@/components/ui/progress"
import { Select, SelectContent, SelectGroup, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { loadOnboardingCompleted, persistOnboardingCompleted } from "@/data/onboarding-state"
import { loadProviderConfig, persistProviderConfig } from "@/data/provider-settings"
import { providerDefaultEndpoint, providerDefaultModel, providerNeedsApiKey, type ProviderConfig, type ProviderKind } from "@/domain/provider-rules"

const emptyConfig: ProviderConfig = { kind: "none", endpoint: "", model: "", enabled: false, updatedAt: new Date(0).toISOString() }

export function OnboardingDialog({ desktopRuntime, reopenToken, onOpenSettings }: { desktopRuntime: boolean; reopenToken: number; onOpenSettings: () => void }) {
  const [open, setOpen] = useState(false)
  const [step, setStep] = useState<1 | 2>(1)
  const [providerConfig, setProviderConfig] = useState<ProviderConfig>(emptyConfig)
  const [apiKey, setApiKey] = useState("")
  const [error, setError] = useState("")
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    let cancelled = false
    void Promise.all([loadOnboardingCompleted(desktopRuntime), loadProviderConfig(desktopRuntime)])
      .then(([completed, provider]) => {
        if (cancelled) return
        setProviderConfig(provider)
        if (!completed && provider.kind === "none") setOpen(true)
      })
      .catch(() => undefined)
    return () => { cancelled = true }
  }, [desktopRuntime])

  useEffect(() => {
    if (reopenToken > 0) {
      setStep(1)
      setError("")
      setOpen(true)
    }
  }, [reopenToken])

  async function finish(config: ProviderConfig) {
    setSaving(true)
    setError("")
    try {
      await persistProviderConfig({ kind: config.kind, endpoint: config.endpoint.trim(), model: config.model.trim(), enabled: config.enabled }, desktopRuntime)
      if (desktopRuntime && providerNeedsApiKey(config.kind) && apiKey.trim()) {
        await invoke("set_provider_api_key", { provider: config.kind, apiKey })
      }
      await persistOnboardingCompleted(true, desktopRuntime)
      setApiKey("")
      setOpen(false)
      toast.success(config.kind === "none" ? "已完成工作台引导，AI 可稍后配置" : "已保存模型连接设置")
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "无法保存引导设置")
    } finally { setSaving(false) }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent className="sm:max-w-xl">
        <DialogHeader>
          <div className="flex items-center gap-2">
            <div className="flex size-8 items-center justify-center rounded-lg bg-primary text-primary-foreground"><SparklesIcon /></div>
            <div>
              <DialogTitle>欢迎使用产品经理工作台</DialogTitle>
              <DialogDescription>先完成两步设置，之后可以随时在“设置”中修改。</DialogDescription>
            </div>
          </div>
        </DialogHeader>
        <Progress value={step === 1 ? 50 : 100} aria-label={`引导进度：第 ${step} 步，共 2 步`} />

        {step === 1 ? (
          <Card size="sm">
            <CardHeader>
              <CardTitle>先从可靠的本地工作流开始</CardTitle>
              <CardDescription>项目、会议原文、需求版本、提醒和备份不依赖模型也能使用。</CardDescription>
            </CardHeader>
            <CardContent className="flex flex-col gap-3 text-sm text-muted-foreground">
              <p>AI 只会生成待确认草稿，不会静默修改已确认的业务数据。</p>
              <p>API Key 仅在桌面应用中写入 Windows 凭据存储；浏览器预览不会保存密钥。</p>
            </CardContent>
          </Card>
        ) : (
          <div className="flex flex-col gap-4">
            <FieldGroup>
              <Field>
                <FieldLabel>模型 Provider</FieldLabel>
                <Select value={providerConfig.kind} onValueChange={(value) => {
                  const kind = (value ?? "none") as ProviderKind
                  setProviderConfig((current) => ({ ...current, kind, enabled: kind !== "none", endpoint: providerDefaultEndpoint(kind) || (kind === "openai_compatible" ? current.endpoint : ""), model: providerDefaultModel(kind) || (kind === "openai_compatible" ? current.model : "") }))
                  setError("")
                }}>
                  <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
                  <SelectContent><SelectGroup>
                    <SelectItem value="none">暂不配置</SelectItem>
                    <SelectItem value="cc_switch">CC Switch 本地路由</SelectItem>
                    <SelectItem value="openai">OpenAI 直连</SelectItem>
                    <SelectItem value="anthropic">Anthropic 直连</SelectItem>
                    <SelectItem value="openai_compatible">其他 OpenAI 兼容接口</SelectItem>
                  </SelectGroup></SelectContent>
                </Select>
              </Field>
              <Field>
                <FieldLabel htmlFor="onboarding-endpoint">服务地址</FieldLabel>
                <Input id="onboarding-endpoint" value={providerConfig.endpoint} onChange={(event) => setProviderConfig((current) => ({ ...current, endpoint: event.target.value }))} placeholder="https://..." disabled={!providerConfig.enabled} />
              </Field>
              <Field>
                <FieldLabel htmlFor="onboarding-model">模型名称</FieldLabel>
                <Input id="onboarding-model" value={providerConfig.model} onChange={(event) => setProviderConfig((current) => ({ ...current, model: event.target.value }))} placeholder="模型 ID" disabled={!providerConfig.enabled} />
              </Field>
              <Field>
                <FieldLabel htmlFor="onboarding-api-key">API Key（可稍后填写）</FieldLabel>
                <Input id="onboarding-api-key" type="password" autoComplete="new-password" value={apiKey} onChange={(event) => setApiKey(event.target.value)} placeholder={providerConfig.kind === "cc_switch" ? "由 CC Switch 管理，无需在工作台保存" : desktopRuntime ? "仅写入 Windows 凭据存储" : "浏览器预览不保存密钥"} disabled={!desktopRuntime || !providerNeedsApiKey(providerConfig.kind)} />
                <FieldDescription>{providerConfig.kind === "cc_switch" ? "工作台不会读取或复制 CC Switch 的密钥。" : desktopRuntime ? "密钥不会写入 SQLite、localStorage 或日志。" : "请在 Tauri 桌面应用的设置页完成安全凭据配置。"}</FieldDescription>
              </Field>
            </FieldGroup>
            {error ? <Alert variant="destructive"><AlertTitle>保存失败</AlertTitle><AlertDescription>{error}</AlertDescription></Alert> : null}
          </div>
        )}

        <DialogFooter>
          {step === 1 ? (
            <>
              <Button variant="ghost" type="button" onClick={() => { void finish(emptyConfig) }} disabled={saving}>暂时跳过</Button>
              <Button type="button" onClick={() => setStep(2)}>下一步<ArrowRightIcon data-icon="inline-end" /></Button>
            </>
          ) : (
            <>
              <Button variant="outline" type="button" onClick={() => setStep(1)} disabled={saving}><ArrowLeftIcon data-icon="inline-start" />上一步</Button>
              <Button type="button" onClick={() => { void finish(providerConfig) }} disabled={saving}>{saving ? "保存中…" : "完成引导"}<CheckIcon data-icon="inline-end" /></Button>
              <Button variant="ghost" type="button" onClick={() => { setOpen(false); onOpenSettings() }} disabled={saving}>打开设置</Button>
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
