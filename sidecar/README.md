# Assistant Product Manager Sidecar

本目录是独立于 React 前端的 Node Sidecar 运行时。当前安全协议版本为 1：

- 只监听 IPv4 回环地址 `127.0.0.1`，端口由操作系统动态分配。
- 启动时必须通过 `APM_SIDECAR_TOKEN` 提供 32–512 字符的会话令牌。
- 所有 HTTP 路由都要求 `Authorization: Bearer <token>`。
- 标准输出只发布不含令牌的 `ready` JSON；错误响应和日志不回显令牌。
- 当前提供 `GET /health`、`POST /shutdown`、Provider 探测、结构化生成和外部研究搜索代理；不写正式业务数据。

本地验证：

```powershell
npm install --prefix sidecar
npm run sidecar:test
```

手动启动需要显式设置临时令牌：

```powershell
$env:APM_SIDECAR_TOKEN = "replace-with-a-random-token-at-least-32-characters"
npm run sidecar:dev
```

当前已接入开发/发布态 Tauri 生命周期、自包含 SEA 构建、一次崩溃重启、Provider 探测、结构化生成、中文维基百科和通用无凭据研究搜索代理；NSIS 安装、代码签名、真实 Provider/搜索服务桌面验收和干净机器验证仍未完成，不得把本目录存在当作阶段完成证据。

Node 合约测试覆盖 OpenAI/Anthropic/CC Switch/OpenAI-compatible 的请求路径、临时凭据头、结构化响应、上游错误和正文脱敏，以及研究搜索的端点约束、响应上限、结果规范化和跨进程回环请求；这些测试不执行真实计费请求或公网搜索。

发布构建后可执行 `npm run verify`，检查当前目标架构、PE 文件头、二进制体积、SHA-256 和 Tauri `externalBin` 契约。
