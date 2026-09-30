# P9 发布前验收清单

这份清单把自动化证据和必须人工完成的 Windows 验收分开。预检通过不等于安装包已经发布。

## 自动化预检

在项目根目录运行：

```powershell
npm run verify:preflight
```

该命令覆盖前端测试、Sidecar 合约测试、P8 示例流程、39 个迁移前缀回放、安全预检、备份恢复安全契约、安装配置检查、发布清单/验收记录契约和生产构建。

备份恢复自动证据包括：前端取消/确认/关闭数据库/错误传播顺序，以及 Rust 恢复核心中的来源完整性前置校验、`pre-restore` 一致性快照、禁止覆盖、失败前不修改当前库和 SQLite 打开前的中断状态收敛。主机 Windows Application Control 仍阻止 proc-macro 编译；2026-08-04 已准备 `APM-Windows-Build` 隔离虚拟机，Rust 夹具将在该环境重新执行。静态安全门禁和“环境已就绪”都不能替代实际结果。

磁盘容量契约要求会议附件、一致性快照、恢复临时副本和备份导出在写入前读取 Windows 当前用户可用空间，并预留待写入大小之外的 64 MiB。最终安装态仍需用受控低空间卷或用户配额验证错误提示、当前数据库不变和残留临时文件清理。

正式交付文档与示例数据可单独检查：

```powershell
npm.cmd run verify:release-docs
```

该检查要求用户手册、隐私与数据说明、当前版本说明、示例项目指南和三份可导入示例素材存在，并确保版本号、关键安全边界、已知安装限制、CSV 结构和 README 入口没有漂移。

重负载与构建体积预算可单独检查：

```powershell
npm.cmd run verify:performance
npm.cmd run build
npm.cmd run verify:bundle-budget
```

性能门禁在单工作进程中实际解析/分析 100,000 行 CSV、规范化并逐段哈希约 8 MB 中文会议、生成分析分段，以及比较接近 20,000 行的文档。构建门禁要求入口 JavaScript 不超过 525 KiB、全部 JavaScript 不超过 1,100 KiB、CSS 不超过 100 KiB，并保留会议、设置和项目详情的懒加载分包。

这些预算用于发现明显回归，是启动和长数据风险的自动化代理；它们不等于低配置电脑启动耗时、Windows 缩放、键盘操作或真实 SQLite 大数据交互已经验收。

安装包前置配置可单独检查：

```powershell
npm run verify:installer-config
```

该检查同时确认 npm/Tauri 版本同步、应用标识、NSIS 目标、Sidecar 构建钩子、Windows 图标、窗口最小尺寸、SQLite 预载和本地 IPC CSP；通过仍不代表安装包已经生成。

发布清单契约可单独检查：

```powershell
npm run verify:release-manifest
```

真实打包时脚本会在生成 `installer-manifest.json` 后复核安装器和 Sidecar 的大小、SHA-256 与安全相对路径；任何不一致都会终止打包。

人工验收记录契约可单独检查：

```powershell
npm.cmd run verify:release-acceptance
```

该命令只测试验收记录规则，不代表真实验收通过。真实打包完成后会在 NSIS 目录生成 `release-acceptance.draft.json`，其中所有检查默认为 `pending`，不能被校验器当成通过记录。

## Rust/安装包

```powershell
npm run build:installer
```

成功标准：

- 生成 `src-tauri/target/release/bundle/nsis/*.exe`；
- 同目录生成 `installer-manifest.json`；
- 同目录生成 `release-acceptance.draft.json`，且仍为待人工填写状态；
- 清单包含安装包和 Sidecar 的文件名、大小、SHA-256、版本号；
- 安装脚本以非零退出码停止时，不得把失败误报为安装包生成成功。

当前已知环境限制：主机 Rust proc-macro 编译曾在 `thiserror_impl` 阶段报 `E0463`，该次没有 NSIS 产物。隔离虚拟机已具备构建工具链，但尚未复制项目、运行 Rust/Tauri 或生成 NSIS；详细门禁见 [`VM_BUILD_ENVIRONMENT_ACCEPTANCE_2026-08-04.md`](./VM_BUILD_ENVIRONMENT_ACCEPTANCE_2026-08-04.md)。

## 干净 Windows 人工验收

- [ ] 在不含 Node.js/Python/数据库工具的 Windows 环境安装；
- [ ] 首次启动、首次引导、无 Provider 配置时的非 AI 功能；
- [ ] 配置 Provider，Credential Manager 写入/读取 API Key；
- [ ] 确认 `none`、CC Switch 和任意 Provider 名称不能创建工作台凭据，删除后状态立即更新；
- [ ] 导入一次会议并完成首次分析；
- [ ] 关闭并重新打开应用，确认项目数据和设置仍在；
- [ ] 升级安装，确认数据库和附件不丢失；
- [ ] 卸载后按数据保留策略验证 SQLite 与备份；
- [ ] 临时关闭/挂起 Sidecar，确认 UI 降级与恢复提示；
- [ ] 验证常用缩放比例、键盘操作、运行中/冷启动通知跳转和控制台无明显错误；
- [ ] 记录 Windows 版本、安装包文件名、版本、SHA-256、验收时间和结果。

完成全部项目后，把草稿中的环境、测试者、完成时间、10 项证据和总结果据实填写，再运行：

```powershell
npm.cmd run verify:release-acceptance -- --record "<验收记录绝对路径>" --project-root .
```

正式通过要求：记录绑定的 manifest、安装器和 Sidecar 文件仍存在且大小/哈希一致；环境明确没有 Node.js、Python 或数据库工具；10 项检查全部为 `passed` 并带有可审计证据。不得在证据或备注中粘贴 API Key、Bearer Token 等凭据。验证失败时保持 P9 未完成。

## 数据与隐私

- 正式 SQLite 位于应用数据目录，备份位于 `backups` 子目录；
- API Key 不应进入 SQLite、日志、Trace、备份或崩溃信息；
- 浏览器预览不读取桌面数据库，也不保存 API Key；
- 外部研究来源只保存来源引用和访问时间，不自动把网页内容当作证据。

## 正式交付材料

- [用户手册](../../USER_GUIDE.md)
- [隐私与数据说明](../../PRIVACY_AND_DATA.md)
- [0.1.0 版本说明](../../RELEASE_NOTES.md)
- [“新用户激活改进”示例项目](../../../examples/README.md)
- [浏览器布局与可访问性验收记录](./P9_BROWSER_UI_ACCEPTANCE.md)

示例素材不会自动写入正式数据库；只能由用户在测试工作区显式导入。文档门禁证明文件与关键边界齐备，不替代内容的安装态操作验证。
