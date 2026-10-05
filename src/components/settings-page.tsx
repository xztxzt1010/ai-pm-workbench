import { useEffect, useRef, useState, type ChangeEvent } from "react"
import { invoke } from "@tauri-apps/api/core"
import { BellIcon, ChevronDownIcon, ChevronUpIcon, DatabaseBackupIcon, DownloadIcon, MonitorCogIcon, RefreshCwIcon, RotateCcwIcon, ShieldCheckIcon, SparklesIcon } from "lucide-react"
import { disable, enable, isEnabled } from "@tauri-apps/plugin-autostart"
import { isPermissionGranted, requestPermission, sendNotification } from "@tauri-apps/plugin-notification"
import { toast } from "sonner"

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { AgentDefinitionPanel } from "@/components/agent-definition-panel"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Field, FieldContent, FieldDescription, FieldGroup, FieldLabel, FieldTitle } from "@/components/ui/field"
import { Switch } from "@/components/ui/switch"
import { Input } from "@/components/ui/input"
import { createBackup, exportBackup, listBackups, selectAndRestoreBackup, type BackupInfo } from "@/data/backup-service"
import { loadProviderConfig, persistProviderConfig } from "@/data/provider-settings"
import { providerCapabilities, providerDefaultEndpoint, providerDefaultModel, providerNeedsApiKey, validateProviderApiKey, type ProviderConfig, type ProviderKind } from "@/domain/provider-rules"
import { providerCredentialUiState, type ProviderCredentialState, type ProviderCredentialStatus } from "@/domain/provider-credential-status"
import { Select, SelectContent, SelectGroup, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { testProviderConnection, type ProviderConnectionResult } from "@/services/provider-connection-service"
import { loadAiRuntimeStatus, type AiRuntimeStatus } from "@/services/ai-runtime-service"
import { loadAgentRunSteps, loadRecentAgentRuns, type AgentRunStepSummary, type AgentRunSummary } from "@/services/agent-run-service"
import { runProviderDiagnostic, type ProviderDiagnosticResult } from "@/services/provider-diagnostic-service"
import { ResearchSearchSettingsCard } from "@/components/research-search-settings-card"
import { notificationActionLabel, notificationPermissionLabel, notificationPermissionState } from "@/domain/notification-permission"

function formatBytes(bytes: number) {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`
}

function formatTraceDate(value: string) {
  const timestamp = Number(value)
  return Number.isFinite(timestamp) ? new Date(timestamp).toLocaleString("zh-CN") : value
}

function traceStatusLabel(status: AgentRunSummary["status"]) {
  return status === "succeeded" ? "成功" : status === "failed" ? "失败" : status === "running" ? "运行中" : status === "queued" ? "排队" : "已取消"
}

function traceRunTypeLabel(runType: string) {
  return runType === "meeting_analysis" ? "会议分析" : runType === "provider_diagnostic" ? "模型诊断" : runType
}

function traceStepTypeLabel(stepType: AgentRunStepSummary["stepType"]) {
  return stepType === "model_request" ? "模型请求" : stepType === "model_response" ? "模型响应" : stepType === "validation" ? "结果校验" : stepType === "tool_call" ? "工具调用" : "工具结果"
}

function AgentRunRow({ run, expanded, loading, steps, onToggle }: { run: AgentRunSummary; expanded: boolean; loading: boolean; steps?: AgentRunStepSummary[]; onToggle: () => void }) {
  return (
    <div className="flex flex-col gap-3 rounded-lg border p-3">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div className="min-w-0"><div className="flex flex-wrap items-center gap-2"><Badge variant={run.status === "succeeded" ? "secondary" : run.status === "failed" ? "destructive" : "outline"}>{traceStatusLabel(run.status)}</Badge><span className="text-sm font-medium">{traceRunTypeLabel(run.runType)}</span><span className="text-xs text-muted-foreground">{run.model}</span></div><p className="mt-1 text-xs text-muted-foreground">{formatTraceDate(run.createdAt)}{run.errorSummary ? ` · ${run.errorSummary}` : ""}</p></div>
        <div className="flex items-center justify-between gap-3"><span className="text-xs text-muted-foreground">{run.durationMs != null ? `${run.durationMs} ms` : "—"}{run.inputTokens != null || run.outputTokens != null ? ` · ${run.inputTokens ?? "?"}/${run.outputTokens ?? "?"} tokens` : ""}</span><Button variant="ghost" size="sm" onClick={onToggle} disabled={loading}>{expanded ? <ChevronUpIcon data-icon="inline-start" /> : <ChevronDownIcon data-icon="inline-start" />}{loading ? "加载中" : expanded ? "收起步骤" : "查看步骤"}</Button></div>
      </div>
      {expanded ? <div className="flex flex-col gap-2 border-t pt-3">{steps?.length ? steps.map((step) => <div key={`${run.id}:${step.ordinal}`} className="flex flex-col gap-1 rounded-md bg-muted/40 px-3 py-2 sm:flex-row sm:items-center sm:justify-between"><div className="flex flex-wrap items-center gap-2"><Badge variant={step.status === "succeeded" ? "secondary" : step.status === "failed" ? "destructive" : "outline"}>{traceStatusLabel(step.status)}</Badge><span className="text-sm">步骤 {step.ordinal} · {traceStepTypeLabel(step.stepType)}</span>{step.errorCode ? <span className="text-xs text-muted-foreground">{step.errorCode}</span> : null}</div><div className="text-xs text-muted-foreground">{step.errorSummary ? `${step.errorSummary} · ` : ""}{step.durationMs != null ? `${step.durationMs} ms` : "—"}{step.inputTokens != null || step.outputTokens != null ? ` · ${step.inputTokens ?? "?"}/${step.outputTokens ?? "?"} tokens` : ""}</div></div>) : <p className="text-sm text-muted-foreground">该运行尚无步骤记录。</p>}</div> : null}
    </div>
  )
}

export function SettingsPage({ desktopRuntime, reminderPaused, reminderTime, onReminderPausedChange, onReminderTimeChange, onOpenOnboarding }: {
  desktopRuntime: boolean
  reminderPaused: boolean
  reminderTime: string
  onReminderPausedChange: (paused: boolean) => Promise<void>
  onReminderTimeChange: (time: string) => Promise<void>
  onOpenOnboarding: () => void
}) {
  const [autostartEnabled, setAutostartEnabled] = useState(false)
  const [notificationGranted, setNotificationGranted] = useState(false)
  const [loading, setLoading] = useState(desktopRuntime)
  const [backups, setBackups] = useState<BackupInfo[]>([])
  const [backupBusy, setBackupBusy] = useState(false)
  const [savingReminderTime, setSavingReminderTime] = useState(false)
  const [providerConfig, setProviderConfig] = useState<ProviderConfig>({ kind: "none", endpoint: "", model: "", enabled: false, updatedAt: new Date(0).toISOString() })
  const [savingProvider, setSavingProvider] = useState(false)
  const [apiKey, setApiKey] = useState("")
  const [credentialState, setCredentialState] = useState<ProviderCredentialState>(desktopRuntime ? "missing" : "not_applicable")
  const credentialStatusRequest = useRef(0)
  const [savingApiKey, setSavingApiKey] = useState(false)
  const [testingProvider, setTestingProvider] = useState(false)
  const [connectionResult, setConnectionResult] = useState<ProviderConnectionResult>()
  const [aiRuntimeStatus, setAiRuntimeStatus] = useState<AiRuntimeStatus>()
  const [agentRuns, setAgentRuns] = useState<AgentRunSummary[]>([])
  const [diagnosingProvider, setDiagnosingProvider] = useState(false)
  const [diagnosticResult, setDiagnosticResult] = useState<ProviderDiagnosticResult>()
  const [expandedRunId, setExpandedRunId] = useState<string>()
  const [runSteps, setRunSteps] = useState<Record<string, AgentRunStepSummary[]>>({})
  const [stepsLoadingRunId, setStepsLoadingRunId] = useState<string>()
  const providerCapabilitiesForConfig = providerCapabilities(providerConfig.kind)
  const credentialUi = providerCredentialUiState(credentialState)
  const notificationState = notificationPermissionState(desktopRuntime, notificationGranted)

  async function refreshProviderCredentialStatus(kind: ProviderKind) {
    const request = ++credentialStatusRequest.current
    if (!desktopRuntime || !providerNeedsApiKey(kind)) {
      setCredentialState("not_applicable")
      return
    }
    try {
      const status = await invoke<ProviderCredentialStatus>("get_provider_credential_status", { provider: kind })
      if (credentialStatusRequest.current === request) setCredentialState(status.state)
    } catch {
      if (credentialStatusRequest.current === request) setCredentialState("unavailable")
    }
  }

  useEffect(() => {
    void Promise.all([
      desktopRuntime ? isEnabled() : Promise.resolve(false),
      desktopRuntime ? isPermissionGranted() : Promise.resolve(false),
      desktopRuntime ? listBackups() : Promise.resolve([] as BackupInfo[]),
      loadProviderConfig(desktopRuntime),
      loadAiRuntimeStatus(desktopRuntime),
      loadRecentAgentRuns(desktopRuntime),
    ])
      .then(([autostart, notification, availableBackups, provider, runtime, runs]) => {
        setAutostartEnabled(autostart)
        setNotificationGranted(notification)
        setBackups(availableBackups)
        setProviderConfig(provider)
        setAiRuntimeStatus(runtime)
        setAgentRuns(runs)
        void refreshProviderCredentialStatus(provider.kind)
      })
      .catch(() => toast.error("无法读取桌面设置状态"))
      .finally(() => setLoading(false))
  }, [desktopRuntime])

  useEffect(() => {
    if (!desktopRuntime) return
    const interval = window.setInterval(() => {
      void loadAiRuntimeStatus(true).then(setAiRuntimeStatus).catch(() => undefined)
    }, 2_000)
    return () => window.clearInterval(interval)
  }, [desktopRuntime])

  async function saveProvider() {
    setSavingProvider(true)
    try {
      const saved = await persistProviderConfig({ kind: providerConfig.kind, endpoint: providerConfig.endpoint.trim(), model: providerConfig.model.trim(), enabled: providerConfig.enabled }, desktopRuntime)
      setProviderConfig(saved)
      toast.success(providerNeedsApiKey(saved.kind) ? "连接元数据已保存；密钥仍由 Windows 凭据存储管理" : "连接元数据已保存")
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "模型连接配置无效")
    } finally { setSavingProvider(false) }
  }

  async function saveApiKey() {
    if (!desktopRuntime || !providerNeedsApiKey(providerConfig.kind) || !validateProviderApiKey(apiKey)) {
      if (apiKey) toast.error("API Key 只能包含可见 ASCII 字符且不能超过 512 字节")
      return
    }
    setSavingApiKey(true)
    try {
      await invoke("set_provider_api_key", { provider: providerConfig.kind, apiKey })
      setApiKey("")
      credentialStatusRequest.current += 1
      setCredentialState("valid")
      toast.success("API Key 已保存到 Windows 凭据存储")
    } catch (error) { toast.error(error instanceof Error ? error.message : "无法保存 API Key") } finally { setSavingApiKey(false) }
  }

  async function deleteApiKey() {
    if (!desktopRuntime || !providerNeedsApiKey(providerConfig.kind)) return
    try {
      await invoke("delete_provider_api_key", { provider: providerConfig.kind })
      credentialStatusRequest.current += 1
      setCredentialState("missing")
      toast.success("API Key 已从 Windows 凭据存储删除")
    } catch (error) { toast.error(error instanceof Error ? error.message : "无法删除 API Key") }
  }

  function changeProviderKind(kind: ProviderKind) {
    setProviderConfig((current) => ({
      ...current,
      kind,
      enabled: kind !== "none",
      endpoint: providerDefaultEndpoint(kind) || (kind === "openai_compatible" ? current.endpoint : ""),
      model: providerDefaultModel(kind) || (kind === "openai_compatible" ? current.model : ""),
    }))
    setApiKey("")
    setCredentialState(desktopRuntime && providerNeedsApiKey(kind) ? "missing" : "not_applicable")
    setConnectionResult(undefined)
    setDiagnosticResult(undefined)
    void refreshProviderCredentialStatus(kind)
  }

  async function testConnection() {
    setTestingProvider(true)
    try {
      setConnectionResult(await testProviderConnection(providerConfig, desktopRuntime))
      setAiRuntimeStatus(await loadAiRuntimeStatus(desktopRuntime))
    }
    finally { setTestingProvider(false) }
  }

  async function runDiagnostic() {
    setDiagnosingProvider(true)
    setDiagnosticResult(undefined)
    try {
      const result = await runProviderDiagnostic(providerConfig, desktopRuntime)
      setDiagnosticResult(result)
      setAgentRuns(await loadRecentAgentRuns(desktopRuntime))
      toast.success("诊断 Agent 固定 Eval 已通过")
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "诊断 Agent 运行失败")
      try { setAgentRuns(await loadRecentAgentRuns(desktopRuntime)) } catch { /* trace refresh is best-effort */ }
    } finally {
      setDiagnosingProvider(false)
    }
  }

  async function toggleRunSteps(runId: string) {
    if (expandedRunId === runId) {
      setExpandedRunId(undefined)
      return
    }
    setExpandedRunId(runId)
    if (runSteps[runId]) return
    setStepsLoadingRunId(runId)
    try {
      const steps = await loadAgentRunSteps(desktopRuntime, runId)
      setRunSteps((current) => ({ ...current, [runId]: steps }))
    } catch {
      setExpandedRunId(undefined)
      toast.error("无法读取 Agent 步骤记录")
    } finally {
      setStepsLoadingRunId(undefined)
    }
  }

  async function changeAutostart(checked: boolean) {
    setAutostartEnabled(checked)
    try {
      if (checked) await enable()
      else await disable()
      toast.success(checked ? "已开启开机启动" : "已关闭开机启动")
    } catch {
      setAutostartEnabled(!checked)
      toast.error("无法修改开机启动设置")
    }
  }

  async function authorizeAndTestNotification() {
    try {
      let granted = await isPermissionGranted()
      if (!granted) granted = await requestPermission() === "granted"
      setNotificationGranted(granted)
      if (!granted) {
        toast.error("未获得系统通知权限")
        return
      }
      sendNotification({
        title: "产品经理工作台",
        body: "测试通知已发送。后续到期确认事项会通过这里提醒你。",
      })
      toast.success("测试通知已发送")
    } catch {
      toast.error("测试通知发送失败")
    }
  }

  async function changeReminderPaused(checked: boolean) {
    try {
      await onReminderPausedChange(checked)
      toast.success(checked ? "所有提醒已暂停" : "提醒已恢复并立即检查")
    } catch {
      toast.error("无法修改提醒暂停状态")
    }
  }

  async function changeReminderTime(event: ChangeEvent<HTMLInputElement>) {
    setSavingReminderTime(true)
    try {
      await onReminderTimeChange(event.target.value)
      toast.success(`默认提醒时间已设为 ${event.target.value}`)
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "无法修改默认提醒时间")
    } finally {
      setSavingReminderTime(false)
    }
  }

  async function makeBackup() {
    setBackupBusy(true)
    try {
      const backup = await createBackup()
      setBackups((current) => [backup, ...current.filter((item) => item.path !== backup.path)])
      toast.success("一致性备份已创建")
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "创建备份失败")
    } finally {
      setBackupBusy(false)
    }
  }

  async function exportLatestBackup() {
    const latest = backups[0]
    if (!latest) return
    setBackupBusy(true)
    try {
      if (await exportBackup(latest)) toast.success("备份已导出")
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "导出备份失败")
    } finally {
      setBackupBusy(false)
    }
  }

  async function restoreBackup() {
    setBackupBusy(true)
    try {
      await selectAndRestoreBackup()
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "恢复备份失败，当前数据未替换")
    } finally {
      setBackupBusy(false)
    }
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div><h1 className="text-2xl font-semibold tracking-tight">设置</h1><p className="mt-1 text-sm text-muted-foreground">配置桌面行为、数据和模型连接。</p></div>
        <Button variant="outline" size="sm" onClick={onOpenOnboarding}><SparklesIcon data-icon="inline-start" />重新打开首次引导</Button>
      </div>

      {!desktopRuntime ? (
        <Alert><MonitorCogIcon /><AlertTitle>当前是浏览器预览模式</AlertTitle><AlertDescription>开机启动和系统通知只能在 Tauri 桌面应用中配置，浏览器模式不会模拟系统状态。</AlertDescription></Alert>
      ) : null}

      {aiRuntimeStatus ? (
        <Card>
          <CardHeader><CardTitle>AI Runtime</CardTitle><CardDescription>Sidecar 运行状态；令牌和 Provider 密钥不会显示在界面。</CardDescription></CardHeader>
          <CardContent className="flex flex-col gap-3">
            <div className="flex flex-wrap items-center justify-between gap-3"><Badge variant={aiRuntimeStatus.state === "available" ? "secondary" : aiRuntimeStatus.state === "degraded" ? "destructive" : "outline"}>{aiRuntimeStatus.state === "available" ? "可用" : aiRuntimeStatus.state === "preview" ? "浏览器预览" : aiRuntimeStatus.state === "restarting" ? "重启中" : aiRuntimeStatus.state === "starting" ? "启动中" : aiRuntimeStatus.state === "stopped" ? "已停止" : "已降级"}</Badge><span className="text-xs text-muted-foreground">{aiRuntimeStatus.host && aiRuntimeStatus.port ? `${aiRuntimeStatus.host}:${aiRuntimeStatus.port} · 协议 v${aiRuntimeStatus.protocolVersion ?? "?"}` : "未绑定端口"}</span></div>
            <Alert variant={aiRuntimeStatus.state === "degraded" ? "destructive" : "default"}><AlertTitle>当前状态</AlertTitle><AlertDescription>{aiRuntimeStatus.message}{aiRuntimeStatus.restartCount ? `（已自动重启 ${aiRuntimeStatus.restartCount} 次）` : ""}</AlertDescription></Alert>
          </CardContent>
        </Card>
      ) : null}

      <AgentDefinitionPanel desktopRuntime={desktopRuntime} />

      <ResearchSearchSettingsCard desktopRuntime={desktopRuntime} />

      <Card>
        <CardHeader className="flex flex-row items-start justify-between gap-3"><div><CardTitle>最近的 Agent 运行</CardTitle><CardDescription>只显示脱敏状态、模型、耗时和 Token；提示词与模型原始响应不会显示。</CardDescription></div><Button variant="outline" size="sm" disabled={!desktopRuntime} onClick={() => { void loadRecentAgentRuns(desktopRuntime).then(setAgentRuns).catch(() => toast.error("无法刷新 Agent 运行记录")) }}><RefreshCwIcon data-icon="inline-start" />刷新</Button></CardHeader>
        <CardContent>
          {agentRuns.length ? <div className="flex flex-col gap-2">{agentRuns.map((run) => <AgentRunRow key={run.id} run={run} expanded={expandedRunId === run.id} loading={stepsLoadingRunId === run.id} steps={runSteps[run.id]} onToggle={() => { void toggleRunSteps(run.id) }} />)}</div> : <p className="text-sm text-muted-foreground">{desktopRuntime ? "还没有 Agent 运行记录。连接测试不会写入 Agent Trace。" : "浏览器预览不读取桌面 Agent Trace。"}</p>}
        </CardContent>
      </Card>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader><CardTitle>桌面行为</CardTitle><CardDescription>控制应用随 Windows 启动及后台驻留方式。</CardDescription></CardHeader>
          <CardContent>
            <FieldGroup>
              <Field orientation="horizontal" data-disabled={!desktopRuntime || loading}>
                <FieldContent>
                  <FieldTitle>开机时启动工作台</FieldTitle>
                  <FieldDescription>以隐藏窗口方式启动并驻留系统托盘，不打断当前工作。</FieldDescription>
                </FieldContent>
                <Switch
                  aria-label="开机时启动工作台"
                  checked={autostartEnabled}
                  disabled={!desktopRuntime || loading}
                  onCheckedChange={changeAutostart}
                />
              </Field>
              <Field orientation="horizontal" data-disabled={!desktopRuntime || loading || savingReminderTime}>
                <FieldContent>
                  <FieldTitle>默认提醒时间</FieldTitle>
                  <FieldDescription>未单独设置时间的确认事项使用此时间；修改后会重新计算未发送提醒。</FieldDescription>
                </FieldContent>
                <Input
                  aria-label="默认提醒时间"
                  className="h-9 w-28 rounded-md border bg-background px-3 text-sm"
                  type="time"
                  value={reminderTime}
                  disabled={!desktopRuntime || loading || savingReminderTime}
                  onChange={(event) => { void changeReminderTime(event) }}
                />
              </Field>
              <Field orientation="horizontal" data-disabled={!desktopRuntime || loading}>
                <FieldContent>
                  <FieldTitle>暂停所有提醒</FieldTitle>
                  <FieldDescription>暂停期间保留到期记录；恢复时只补发尚未发送的去重记录。</FieldDescription>
                </FieldContent>
                <Switch
                  aria-label="暂停所有提醒"
                  checked={reminderPaused}
                  disabled={!desktopRuntime || loading}
                  onCheckedChange={changeReminderPaused}
                />
              </Field>
            </FieldGroup>
          </CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle>系统通知</CardTitle><CardDescription>{desktopRuntime ? "确认 Windows 通知权限并发送一条本机测试消息。" : "浏览器工作台不能注册为 Windows 通知发送者；请安装并启动桌面版。"}</CardDescription></CardHeader>
          <CardContent className="flex flex-col gap-4">
            <div className="flex items-center justify-between gap-3">
              <div className="flex items-center gap-2"><BellIcon className="size-4 text-muted-foreground" /><span className="text-sm font-medium">通知权限</span></div>
              <Badge variant={notificationState === "desktop_granted" ? "secondary" : "outline"}>{notificationPermissionLabel(notificationState)}</Badge>
            </div>
            <Button variant="outline" disabled={!desktopRuntime || loading} onClick={authorizeAndTestNotification}>
              <BellIcon data-icon="inline-start" />
              {notificationActionLabel(notificationState)}
            </Button>
          </CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle>模型连接</CardTitle><CardDescription>保存 Provider 元数据并验证可用性；API Key 不进入 SQLite、localStorage 或日志。</CardDescription></CardHeader>
          <CardContent className="flex flex-col gap-4">
            <FieldGroup>
              <Field>
                <FieldLabel>Provider</FieldLabel>
                <Select value={providerConfig.kind} onValueChange={(value) => changeProviderKind((value ?? "none") as ProviderKind)}>
                  <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
                  <SelectContent><SelectGroup><SelectItem value="none">未配置</SelectItem><SelectItem value="cc_switch">CC Switch 本地路由</SelectItem><SelectItem value="openai">OpenAI 直连</SelectItem><SelectItem value="anthropic">Anthropic 直连</SelectItem><SelectItem value="openai_compatible">其他 OpenAI 兼容接口</SelectItem></SelectGroup></SelectContent>
                </Select>
              </Field>
              <Field><FieldLabel htmlFor="provider-endpoint">服务地址</FieldLabel><Input id="provider-endpoint" value={providerConfig.endpoint} onChange={(event) => { setProviderConfig((current) => ({ ...current, endpoint: event.target.value })); setConnectionResult(undefined) }} placeholder="https://..." disabled={!providerConfig.enabled} /></Field>
              <Field><FieldLabel htmlFor="provider-model">模型名称</FieldLabel><Input id="provider-model" value={providerConfig.model} onChange={(event) => { setProviderConfig((current) => ({ ...current, model: event.target.value })); setConnectionResult(undefined) }} placeholder="模型 ID" disabled={!providerConfig.enabled} /><p className="text-xs text-muted-foreground">能力：{providerCapabilitiesForConfig.structuredJson ? "结构化 JSON" : "未启用"}{providerCapabilitiesForConfig.structuredJson ? ` · ${providerCapabilitiesForConfig.protocol === "anthropic_messages" ? "Anthropic Messages" : "OpenAI Chat"} · 最大 ${providerCapabilitiesForConfig.maxOutputTokens} Token` : ""}</p></Field>
              <Field data-disabled={!desktopRuntime || !providerNeedsApiKey(providerConfig.kind)}><FieldLabel htmlFor="provider-api-key">API Key</FieldLabel><Input id="provider-api-key" type="password" autoComplete="new-password" value={apiKey} onChange={(event) => setApiKey(event.target.value)} placeholder={providerConfig.kind === "cc_switch" ? "由 CC Switch 管理，无需在工作台保存" : credentialUi.placeholder} disabled={!desktopRuntime || !providerNeedsApiKey(providerConfig.kind)} />{credentialUi.invalid ? <p role="alert" className="text-xs text-destructive">已保存的 API Key 格式无效，请替换或删除。</p> : null}<div className="flex flex-wrap gap-2"><Button type="button" size="sm" variant="outline" disabled={!desktopRuntime || !providerNeedsApiKey(providerConfig.kind) || !validateProviderApiKey(apiKey) || savingApiKey} onClick={() => { void saveApiKey() }}>{savingApiKey ? "保存中…" : "保存 API Key"}</Button>{credentialUi.hasStoredCredential ? <Button type="button" size="sm" variant="ghost" onClick={() => { void deleteApiKey() }}>删除已保存 Key</Button> : null}</div></Field>
            </FieldGroup>
            {connectionResult ? <Alert variant={["invalid", "unavailable", "credential_missing"].includes(connectionResult.state) ? "destructive" : "default"}><AlertTitle>{connectionResult.state === "available" ? "Provider 连接可用" : "连接状态"}</AlertTitle><AlertDescription>{connectionResult.message}</AlertDescription></Alert> : null}
            {diagnosticResult ? <Alert><ShieldCheckIcon /><AlertTitle>诊断 Agent 通过</AlertTitle><AlertDescription>{diagnosticResult.message} · {diagnosticResult.durationMs} ms{diagnosticResult.inputTokens != null || diagnosticResult.outputTokens != null ? ` · ${diagnosticResult.inputTokens ?? "?"}/${diagnosticResult.outputTokens ?? "?"} tokens` : ""}</AlertDescription></Alert> : null}
            <div className="flex flex-wrap items-center justify-between gap-3"><Badge variant={connectionResult?.state === "available" ? "secondary" : "outline"}>{connectionResult?.state === "available" ? "连接可用" : providerConfig.enabled ? "待验证" : "未启用"}</Badge><div className="flex flex-wrap gap-2"><Button variant="outline" disabled={!providerConfig.enabled || testingProvider} onClick={() => { void testConnection() }}><RefreshCwIcon data-icon="inline-start" />{testingProvider ? "检测中…" : "测试连接"}</Button><Button variant="outline" disabled={savingProvider} onClick={() => { void saveProvider() }}>{savingProvider ? "保存中…" : "保存连接元数据"}</Button></div></div>
            <div className="flex flex-col gap-2 rounded-lg border p-3"><div><p className="text-sm font-medium">只读诊断 Agent</p><p className="text-xs text-muted-foreground">仅发送固定合成样本，检查结构化 JSON、指令遵循和无业务写权限；不会读取项目或会议数据。</p></div><Button variant="outline" disabled={!desktopRuntime || !providerConfig.enabled || diagnosingProvider || aiRuntimeStatus?.state !== "available"} onClick={() => { void runDiagnostic() }}><SparklesIcon data-icon="inline-start" />{diagnosingProvider ? "诊断中…" : "运行固定 Eval"}</Button></div>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader><CardTitle>本地数据备份</CardTitle><CardDescription>使用 SQLite 一致性快照；恢复前会校验文件并额外保存当前数据库。</CardDescription></CardHeader>
        <CardContent className="flex flex-col gap-4">
          <div className="flex flex-col gap-2 rounded-lg border p-3 sm:flex-row sm:items-center">
            <DatabaseBackupIcon className="size-4 text-muted-foreground" />
            <div className="min-w-0 flex-1">
              <p className="font-medium">{backups[0] ? "最近备份" : "尚无本地备份"}</p>
              <p className="text-sm text-muted-foreground">
                {backups[0] ? `${new Date(backups[0].createdAtEpochMs).toLocaleString("zh-CN")} · ${formatBytes(backups[0].size)} · 共 ${backups.length} 份` : "创建后保存在应用数据目录，可另行导出到指定位置。"}
              </p>
            </div>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" disabled={!desktopRuntime || backupBusy} onClick={makeBackup}><DatabaseBackupIcon data-icon="inline-start" />{backupBusy ? "处理中" : "创建备份"}</Button>
            <Button variant="outline" disabled={!desktopRuntime || backupBusy || !backups.length} onClick={exportLatestBackup}><DownloadIcon data-icon="inline-start" />导出最近备份</Button>
            <Button variant="outline" disabled={!desktopRuntime || backupBusy} onClick={restoreBackup}><RotateCcwIcon data-icon="inline-start" />恢复备份</Button>
          </div>
        </CardContent>
      </Card>

      <Alert><ShieldCheckIcon /><AlertTitle>本地优先</AlertTitle><AlertDescription>桌面设置由操作系统和本地数据库管理；API Key 不会写入普通业务表或日志。</AlertDescription></Alert>
    </div>
  )
}
