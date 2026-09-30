# GATE-02 UI 证据 · 虚构 Demo 数据

## 范围与诚实边界

- 应用：浏览器 Vite 预览（`desktopRuntime=false`），**未读取真实用户数据库**。
- 数据：系统注入的虚构 Demo（项目 `demo-audit-project` / 需求 / 技术讨论候选）。
- 截图不含用户名、绝对路径、API Key、真实会议、通知或私人背景。
- **部分通过说明**：浏览器模式下产品文档、风险、决策、发布仅桌面 SQLite 可读，UI 上对应卡片显示“缺失”是真实产品行为，不是伪造。完整正式对象矩阵由 `verify:project-context`、domain/service/UI 单测（19 项）覆盖。

## 文件

| 文件 | 对应状态 |
|---|---|
| `gate02-eight-context-categories.png` | 打开项目后的八类上下文总览 |
| `gate02-context-card.png` | 上下文卡片特写 |
| `gate02-source-drilldown.png` | 点击“前往模块”后的定位 |
| `gate02-exported-context.md` | 界面导出的 Markdown 快照 |
| `gate02-context-text.txt` | 卡片文本摘录 |

## 八类状态（浏览器 UI）

| 八类 | 状态 | 说明 |
|---|---|---|
| 项目目标 | 已有 | 虚构项目 goal |
| 用户需求 | 已有 | 已确认需求 Demo |
| PRD | 缺失 | 浏览器无正式 PRD 对象 |
| 技术方案 | 缺失 | 仅有技术讨论候选，不冒充正式方案 |
| 开发状态 | 已有 | 项目状态/进度 |
| 测试状态 | 缺失 | 无正式测试报告 |
| 风险列表 | 缺失 | 浏览器无正式风险对象 |
| 决策历史 | 缺失 | 浏览器无正式决策对象 |

合计：已有 3 · 过期 0 · 缺失 5。

## 与 fixture / Markdown 一致性

- 导出 Markdown 含 `apm-project-context:v1`、`个人知识：未加入`、`缺口及候选材料不是项目事实`。
- 技术讨论出现在“候选材料（非正式事实）”，技术方案保持“缺失”。
- 来源身份含类型与版本（`project` / `requirement` / `knowledge_item`）。
- 与 `src/domain/project-context.test.ts` 中“技术讨论不等于技术方案”“导出状态一致”断言一致。

## 命令摘要

```text
npm run dev   # Vite 127.0.0.1:1420
# Playwright + Edge：注入虚构 localStorage → 打开 #/projects/demo-audit-project
# → 截图八类 → 点击“前往模块” → 导出 Markdown
```
