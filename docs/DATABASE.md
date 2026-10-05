# 数据库与 Migration 约定

## 正式数据库

桌面端使用 SQLite 文件 `assistant-product-manager.db`。数据库由 Tauri SQL 插件加载，Rust `sqlx` 负责一致性备份、恢复校验和 migration 测试。浏览器 localStorage 仅用于开发预览。

## 基础 Schema（migration 1–8）

| 表 | 用途 |
| --- | --- |
| `projects` | 项目主数据 |
| `milestones` | 项目里程碑 |
| `confirmation_items` | 确认事项及人工结论 |
| `meetings` | 会议业务对象骨架 |
| `meeting_sources` | 会议来源骨架 |
| `meeting_paragraphs` | 可稳定定位和哈希校验的会议原文段落 |
| `requirement_cards` | 需求卡主记录骨架 |
| `requirement_versions` | 不可覆盖的需求版本骨架，标题随版本保存 |
| `notifications` | 去重后的提醒调度和发送记录 |
| `agent_definitions` | 版本化 Agent 定义、Schema 版本与最小权限策略 |
| `agent_runs` | Agent 运行状态、Provider、模型、耗时、Token 与脱敏错误摘要 |
| `agent_run_steps` | 模型请求、响应、工具与校验步骤 Trace |
| `agent_run_messages` | 仅保存角色、长度摘要、内容哈希和 Token 的脱敏消息 Trace |
| `app_settings` | 本地应用设置 |

## 当前扩展 Schema（migration 9–39）

当前迁移链共 39 个只追加 migration、43 张业务/索引表。在上述基础上继续增加：

- Provider 诊断、项目记忆/FTS5、项目问答和 Agent 定义；
- 产品文档、PRD、设计/文档审阅；
- 数据集、指标、实验、分析洞察和分析解释；
- VOC、决策、风险、依赖、研究、竞品、发布与复盘；
- 研究计划、研究洞察、研究需求候选及其正式需求关联；
- 风险、发布、竞品、研究计划、知识和计划工程师审阅 Agent。

表数量和迁移顺序以 `src-tauri/migrations` 与 `npm.cmd run verify:migrations` 的实际输出为准，不能继续沿用 migration 8 的历史快照判断当前结构。

## Migration 不变量

1. 已进入 Git 基线的 migration 永不修改，只能追加更高版本文件。
2. 文件名使用四位递增版本，例如 `0004_meeting_sources_v2.sql`。
3. migration 必须能在空库按顺序执行，也必须能从每个受支持旧版本升级。
4. 破坏性结构变更采用“新表 → 校验复制 → 切换 → 删除旧表”，不能直接丢弃用户数据。
5. 新状态值、约束、索引和外键必须有升级夹具覆盖。
6. migration 失败必须回滚当前版本，旧数据仍可读取。
7. 应用在 SQL migration 插件初始化之前创建旧库一致性快照；备份失败则中止启动和迁移。

## 备份与恢复

- 在线备份使用 SQLite `VACUUM INTO`，避免遗漏 WAL 中尚未 checkpoint 的数据。
- Windows 写入前使用 `GetDiskFreeSpaceExW` 获取当前用户实际可用空间；会议附件、一致性快照、恢复临时副本和备份导出都要求“待写入文件大小 + 64 MiB 安全余量”，不足时在复制或切换主库前失败。
- migration 前每个目标版本最多创建一个 `pre-migration-v{version}` 快照。真实 v3 → v4 验收中，v4 主库包含 `meeting_paragraphs`，v4 前快照不包含该表，两者完整性均为 `ok`。
- 恢复在触碰当前数据库前先对来源执行 `PRAGMA integrity_check`，并用 `VACUUM INTO` 保存当前库的 `pre-restore` 一致性快照，不能直接复制主文件。
- 快照目标禁止覆盖已有文件；创建或完整性校验失败时清理本次产生的不完整文件。
- 恢复通过已复检的临时文件切换；暂存或替换失败时清理临时文件，并尝试恢复上一文件。
- SQLite 插件打开主库前检查 `.previous`、`.restore.tmp` 和 `.restore.invalid`：有效主库优先保留并清理残留；主库缺失或损坏时优先回滚有效旧库，其次提升有效临时库；全部候选损坏则中止启动而不是继续迁移。
- 禁止用普通文件复制代替运行中数据库的一致性快照。

## 自动化验证

Rust migration 夹具覆盖底层迁移、备份和恢复边界；Node 历史回放门禁覆盖当前全部 migration：

- 空数据库顺序安装全部 migration。
- migration 1 的旧库升级到当前版本并保留业务数据。
- 人为失败的 migration 在事务中回滚，不留下半建表。
- migration 前一致性快照保持旧版本内容，源库升级后快照仍完整。
- 恢复成功后主库为所选备份内容，`pre-restore` 快照仍保留恢复前内容。
- 损坏备份、不可用的回滚目录和已存在的快照目标均在修改当前数据库前失败。
- 中断恢复夹具覆盖有效主库清理、切换前退出回滚旧库、损坏主库回滚、仅临时库可用和全部候选损坏五种状态。
- 容量预算夹具覆盖安全余量、整数溢出和仅差 1 字节时的明确拒绝；真实配额、文件锁和磁盘写满仍需安装态故障注入。
- 源库与快照均通过 `PRAGMA integrity_check`。
- migration 8 额外验证 Agent 定义种子、3 张 Trace 表和 `agent_runs` 的 5 个扩展字段。
- 从空库逐个回放 1–39 的每个迁移前缀，检查检查点、外键和阶段核心表。

执行：

```powershell
npm run test:rust
npm.cmd run verify:migrations
```

## 示例数据策略

- 新建桌面数据库不自动插入固定项目、里程碑或确认事项，避免演示数据成为正式事实。
- 浏览器开发适配器可使用显式的 `initialWorkspace` 展示 UI，不能用于桌面验收。
- 历史真实数据库中已存在的固定演示记录不由 P0 静默删除，以免误删用户后续编辑或关联的数据；后续通过显式“示例数据清理/归档”操作处理。
- 自动化测试数据只存在临时数据库，测试结束后删除。
