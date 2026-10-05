import { AlertCircleIcon, BellIcon, CheckCircle2Icon, Clock3Icon, ExternalLinkIcon, PauseCircleIcon, RefreshCwIcon } from "lucide-react"
import { format, parseISO } from "date-fns"
import { zhCN } from "date-fns/locale"

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty"
import type { NotificationRecord } from "@/domain/models"

const statusLabels = {
  scheduled: "等待授权或发送",
  delivered: "已发送",
  skipped: "已跳过",
  failed: "发送失败",
} as const

export function NotificationsPage({ records, error, desktopRuntime, paused, onRefresh, onOpenItem }: {
  records: NotificationRecord[]
  error?: string
  desktopRuntime: boolean
  paused: boolean
  onRefresh: () => void
  onOpenItem: (confirmationItemId: string) => void
}) {
  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div><h1 className="text-2xl font-semibold tracking-tight">通知</h1><p className="mt-1 text-sm text-muted-foreground">查看提醒发送、跳过和补发记录。</p></div>
        <Button variant="outline" size="sm" disabled={!desktopRuntime} onClick={onRefresh}><RefreshCwIcon data-icon="inline-start" />立即检查</Button>
      </div>

      {error ? <Alert variant="destructive"><AlertCircleIcon /><AlertTitle>提醒调度异常</AlertTitle><AlertDescription>{error}</AlertDescription></Alert> : null}
      {!desktopRuntime ? <Alert><BellIcon /><AlertTitle>浏览器预览不发送系统通知</AlertTitle><AlertDescription>提醒记录和休眠补发只在 Tauri 桌面应用中运行。</AlertDescription></Alert> : null}
      {desktopRuntime && paused ? <Alert><PauseCircleIcon /><AlertTitle>提醒已暂停</AlertTitle><AlertDescription>到期记录仍会保留；恢复后只发送尚未处理的提醒。</AlertDescription></Alert> : null}

      <Card>
        <CardHeader><CardTitle>最近提醒</CardTitle><CardDescription>同一事项在相同日期和时间最多生成一条记录。</CardDescription></CardHeader>
        <CardContent className="flex flex-col gap-3">
          {records.length ? records.map((record) => (
            <div key={record.id} className="flex flex-col gap-2 rounded-lg border p-3 sm:flex-row sm:items-center">
              <div className="min-w-0 flex-1">
                <p className="font-medium">{record.itemTitle}</p>
                <p className="text-sm text-muted-foreground">计划 {format(parseISO(record.scheduledAt), "M 月 d 日 HH:mm", { locale: zhCN })}{record.deliveredAt ? ` · 发送 ${format(parseISO(record.deliveredAt), "M 月 d 日 HH:mm", { locale: zhCN })}` : ""}</p>
                {record.errorSummary ? <p className="text-sm text-muted-foreground">{record.errorSummary}</p> : null}
              </div>
              <div className="flex items-center gap-2">
                <Badge variant={record.status === "failed" ? "destructive" : record.status === "delivered" ? "secondary" : "outline"}>
                  {record.status === "delivered" ? <CheckCircle2Icon /> : <Clock3Icon />}
                  {statusLabels[record.status]}
                </Badge>
                {record.confirmationItemId ? <Button variant="ghost" size="sm" onClick={() => onOpenItem(record.confirmationItemId!)}><ExternalLinkIcon data-icon="inline-start" />打开事项</Button> : null}
              </div>
            </div>
          )) : (
            <Empty><EmptyHeader><EmptyMedia variant="icon"><BellIcon /></EmptyMedia><EmptyTitle>还没有提醒记录</EmptyTitle><EmptyDescription>到达确认日期和时间后，桌面应用会生成去重记录并尝试通知。</EmptyDescription></EmptyHeader></Empty>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
