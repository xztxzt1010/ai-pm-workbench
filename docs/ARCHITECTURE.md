# 架构约定

## 总体分层

```text
React 页面与组件
        ↓
应用 Service / Hook（编排用例、事务边界、权限与错误映射）
        ↓
Repository 接口与平台适配器
        ↓
Tauri SQLite / Rust 原生命令 / 浏览器开发适配器
        ↓
领域模型与确定性规则（不依赖 UI 和平台）
```

依赖方向必须指向领域层。页面不得新增散落 SQL、文件路径处理、模型调用或关键状态机；这些逻辑分别归 Repository、Service、Rust 原生命令和领域规则所有。

## 目录职责

- `src/domain`：稳定业务类型、状态机、校验和确定性规则，不导入 React、Tauri 或数据库驱动。
- `src/data`：Repository 与持久化适配器，集中 SQL、行映射、localStorage 开发适配和备份命令。
- `src/hooks`：跨页面应用服务，例如提醒调度；负责组织 Repository 与系统能力，但不定义业务真值。
- `src/components`：页面和可复用 UI，只调用应用服务或 Repository 门面。
- `src-tauri/src`：Windows 生命周期、托盘、通知激活、文件系统安全边界、数据库备份和恢复。
- `src-tauri/migrations`：只追加的正式数据库演进历史。

现有 `App.tsx` 仍直接组合部分 `src/data` 函数，这是 P0 基线前已有的过渡门面。新纵向切片必须先定义 Repository/Service 契约；后续按切片逐步收敛旧入口，不做无业务收益的大爆炸重写。

## Repository / Service 规则

1. Repository 负责持久化、查询、事务和存储行到领域对象的映射。
2. Service 负责一个完整用例，例如“导入会议”“恢复备份”“调度提醒”。
3. 领域规则必须可以脱离 React、Tauri 和 SQLite 单元测试。
4. 正式桌面实现与浏览器开发适配器必须遵循相同输入、输出和状态语义；浏览器适配器不能作为安装包的验收证据。
5. 涉及删除、覆盖、发送或发布的 Service 必须显式表达确认步骤，不允许 UI 绕过。
6. AI 只生成草稿或提案；正式业务状态变更必须由确定性 Service 在用户确认后执行。

## 错误约定

跨层错误使用 `AppError`，至少包含稳定的 `code` 和面向用户的安全消息。底层异常可作为 `cause` 保留给开发调试，但不得把 SQL、绝对隐私路径、API Key、请求正文或模型原始敏感响应直接展示或写入普通日志。

错误码按领域稳定分类：

- `validation`：输入、文件类型、大小或状态转换不合法。
- `not_found`：目标业务对象不存在或已被删除。
- `conflict`：哈希重复、版本冲突或并发状态变化。
- `storage`：数据库或文件系统失败。
- `permission`：操作系统权限或用户授权不足。
- `external_service`：模型、Sidecar 或外部适配器失败。
- `unexpected`：未分类异常；只能返回脱敏摘要。

## 安全与数据边界

- 正式数据只以 SQLite 业务表和受管理的应用数据目录为真值来源。
- 附件放应用数据目录，SQLite 只保存元数据、哈希和受控路径。
- API Key 只能进入 Windows Credential Manager。
- 项目查询默认强制 `project_id` 隔离。
- Rust 文件命令必须校验规范化路径、允许的根目录、MIME/签名和大小。
- 所有 migration、备份、恢复、AI 运行和高风险提案必须可审计。

## AI 分析契约

- AI 输入与输出必须先通过版本化 Zod Schema，Provider 原始响应不能直接进入 Repository。
- Agent 工具按定义显式白名单；会议需求分析师只读当前项目会议段落，不具备业务写权限。
- 每条结论必须区分事实、推断和建议；事实证据的段落 ID、全局偏移和引用文本必须与稳定原文精确匹配。
- 项目 ID、会议 ID 或段落范围不匹配时整次结果拒绝，不允许通过提示词声明代替确定性校验。
- 模型建议只能生成待审核草稿，用户确认后由确定性 Service 执行正式状态变更。
- 长会议分析先按稳定段落分块；运行器可保留成功段并只重试失败段，聚合结果必须在完整会议输入上再次校验。运行状态持久化和 Sidecar Trace 由后续 P3/P4 切片负责。

## Provider 连接边界

- React 只管理非敏感 Provider 元数据和安全状态，不直接持有已保存的 API Key，也不直接向云端模型发送请求。
- CC Switch 连接探测由 Tauri Command 执行，只接受 `http://127.0.0.1` 或 `http://localhost`，禁止任意主机探测；工作台不读取 CC Switch 数据库和凭据。
- OpenAI、Anthropic 和其他兼容接口的真实请求必须经后续 Sidecar/Provider Adapter；Sidecar 未接入时 UI 必须显示不可用，不得把“配置已保存”当作“连接成功”。

## Sidecar 安全协议

- Mastra 运行时位于独立 `sidecar` 工作区，不进入 React/Vite 依赖图；Tauri 是唯一允许持有会话令牌并转发敏感请求的调用方。
- Sidecar 每次进程启动使用新的随机会话令牌和动态端口，只绑定 `127.0.0.1`；错误或缺失令牌统一返回 401。
- 健康响应只暴露状态、运行时名称和协议版本；标准输出的 ready 事件不得包含令牌、Provider 凭据或请求正文。
- 当前协议版本 1 实现健康检查、关闭、Provider 探测、结构化生成和外部研究搜索端点。开发态 Tauri 通过 Shell 启动 Node Sidecar；发布态通过 `externalBin` 启动由 Node SEA 生成的 `apm-sidecar-<target>.exe`。两种模式都使用 Rust 生成的临时令牌校验 ready/health，并允许一次崩溃重启；React 只能通过 Tauri Command 使用协议并读取脱敏状态。NSIS/干净机器验收和代码签名仍需单独完成，不能绕过这些边界让 React 直连 Sidecar。
- Provider 连接探测采用 `React → Tauri → Sidecar → Provider`：Tauri 从 Credential Manager 临时读取凭据，Sidecar 只在单次内存请求中使用，并只返回状态摘要。云端地址强制 HTTPS，本地 HTTP 只允许回环地址；响应正文和凭据不进入前端或 Trace。
- 结构化生成沿用同一安全链路：请求限制 512 KiB、输出 Token 上限 8192、Provider 响应限制 2 MiB，并由 Sidecar 使用 JSON Schema 校验后才返回。SQLite Trace 只保存运行/步骤状态、耗时、Token、内容长度摘要和 SHA-256，不保存提示词正文、模型原始响应或 API Key。
- 外部研究搜索同样使用 `React → Tauri → Sidecar → 搜索适配器`，WebView CSP 保持仅 IPC。端点不允许携带凭据，Sidecar 将请求限制为 16 KiB、上游响应限制为 256 KiB、结果限制为 10 条；预览结果不会自动成为研究证据。
- 内置 `wikipedia_zh` 提供商固定访问 `https://zh.wikipedia.org/w/api.php`，使用 MediaWiki 只读 GET 和描述性 User-Agent；相同查询在 Sidecar 内缓存 5 分钟、最多 50 项。历史和用户配置的 `generic_json` POST 契约继续兼容。
- `provider-diagnostic:v1` 是无业务写权限的诊断 Agent：数据范围为 `none`、工具列表为空，只发送固定合成 nonce。输出 Schema 使用常量约束验证结构化 JSON、指令遵循和 synthetic-only 声明；诊断运行写入脱敏 Trace，但不关联项目或会议。
- Provider 能力由统一元数据声明：Anthropic 使用 Messages，OpenAI/CC Switch/OpenAI-compatible 使用 Chat，结构化 JSON 和适配器输出上限为 8192 Token。Windows Credential Manager 只允许 `openai`、`anthropic`、`openai_compatible` 三个固定账户；API Key 限制为 1–512 字节可见 ASCII。保存、状态检查、连接测试和生成共用同一读取校验器；状态接口只暴露缺失、无效、有效三态，使异常凭据可恢复但不能进入 Sidecar、日志或协议。

## 项目记忆与检索

- `project_memories` 按 `project_id` 强制隔离，类型区分正式事实、已确认记忆、待确认候选、推断和临时上下文；状态独立表示待确认、已确认、拒绝、过期和归档。
- `project_memory_sources` 保存可展开来源与定位，`project_memory_conflicts` 保存冲突/替代关系；业务表仍是正式事实来源，记忆不能静默覆盖业务数据。
- `project_memory_fts` 使用 SQLite FTS5 外部内容表和增删改触发器同步；检索 SQL 同时约束 `project_id` 和可选状态。索引可由正式记忆表显式重建，Embedding 不是可用性的前置条件。
- 候选与首条来源在一个事务中写入，初始状态固定为 `pending`。Agent 创建者仅能选择 `pending_candidate` 或 `inference`；人工确认才会转为 `confirmed_memory/confirmed`。
- 审核采用数据库条件更新避免覆盖并发变化：`pending -> confirmed/rejected`、`confirmed -> expired`，未归档记录可进入 `archived`；归档为终态。浏览器预览不调用这些桌面写命令。
- 来源在用户展开记忆卡片时按需读取；查询通过 `project_memories` 连接同时约束 `project_id` 与 `memory_id`，不允许仅凭记忆 ID 跨项目读取定位或引用文本。
- 冲突关系在写入前要求两端属于同一项目且未归档；`conflicts` 以排序后的 ID 存储并去重，`supersedes` 保留方向。关系只表达人工判断，不自动修改任一记忆的正文或状态；解除关系同样要求项目边界。

## Agent 定义中心

- `agent_definitions` 作为只读目录来源；设置页展示版本化职责、输入/输出 Schema、数据范围、允许工具、业务写权限和 Eval/合成输入标记。权限 JSON 在前端解析失败时降级为空对象，不阻断设置页。
- 目录查询只在桌面运行时执行，当前切片不提供修改 Agent 定义、授权工具或直接写入业务数据的 UI；后续 Agent 编排必须继续复用定义中的权限边界。
- 编排预览与执行共享同一确定性授权器：全局定义预览显式使用 `previewOnly`，只延后具体项目 ID 比对；项目执行必须传 `activeProjectId`。实际任务由已授权定义和显式执行器求交集生成，点击运行时重新读取定义，缺失工具、非只读权限或项目范围不匹配均不会进入运行器。
- `project-qa:v1` 是只读当前项目问答 Agent：前端先使用项目 ID 检索记忆，再加入当前项目、里程碑和确认事项的正式上下文，最后把受限证据集交给结构化生成；输出契约要求 `sourceType + sourceId + title` 精确匹配证据，引用越权、重复或缺失时不显示答案。回答同时展示对应来源类型/来源 ID和不确定性说明。
- Rust Trace allowlist 对项目问答只允许 `project_id`、拒绝 `entity_id`，避免通用生成入口扩大到任意会议、文件或跨项目对象；问答不会写业务表或记忆表。

## 产品文档与版本

- `product_documents` 保存项目范围内的文档元数据，`product_document_versions` 以 `(document_id, version_number)` 唯一约束保存完整 Markdown 正文；编辑只追加新版本，不更新历史正文。
- 创建文档和首个版本在同一事务中完成；归档文档拒绝新版本。历史版本只追加，回退通过复制旧正文创建新版本。来源 JSON 在 Rust 侧规范化，并要求需求卡属于当前项目且当前版本已确认。导入/导出只处理 Markdown 纯文本，不解析或执行其中的 HTML/JavaScript；AI 修订尚未开放。
- `prd-agent:v1` 只读取当前项目已确认需求，输出 Markdown 草稿和精确需求卡/版本引用；生成命令只返回预览，只有用户显式保存时才调用文档写入命令。该 Agent 没有业务写权限。
- 桌面启动后会原子恢复上次进程遗留的 `queued/running` Agent 运行与步骤：统一标记 `process_interrupted`，保留已完成历史且不自动重放模型请求。恢复操作幂等，避免崩溃后重复计费或 Trace 永久卡在运行中。
- Agent Trace 将生成拆成“模型请求”和“结果校验”步骤。Provider/网络失败会使请求步骤失败并取消校验；JSON/Schema 失败会保留请求成功并把校验步骤标记为 `output_validation_failed`。设置页只查询步骤摘要，不返回提示词、输出正文或消息哈希。
- Sidecar 运行期请求若明确返回“Sidecar 不可访问/响应无效/超时”，Rust 会把 Runtime 标记为降级、清理会话并终止当前子进程，让统一生命周期策略执行一次重启；第二次退出或应用正在停止时直接保持降级/停止。Provider 自身的 HTTP 错误不会被误判为 Sidecar 故障。
