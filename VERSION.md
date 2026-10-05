# 版本记录

## v0.2.0 · Source Preview（2026-09-30）

- 发布 allowlist 净化源码快照、测试、文档与验证命令
- 许可证：MIT（Copyright 2026 xztxzt1010）
- 版本元数据统一为 0.2.0；`private: true` 保留
- **assets = 0**：不附带 Windows 安装器，不声称正式桌面发布
- Sidecar ready 门禁按冷启动测量改为 20s 有界超时，并输出脱敏诊断
- 完整预检连续三次通过；Rust fmt/check/test 通过
- 虚构 Demo UI 证据：八类状态、来源下钻、Markdown 导出
- 公开快照清单见 `PUBLIC_SNAPSHOT_MANIFEST.md`

## v0.1.0 · 公开产品案例（2026-09-27）

- 发布产品案例文档与截图
- 说明问题、产品决策、实现能力与发布边界
- 当时只发布案例材料，不发布完整源码和安装包

## 下一版本门槛

### v1.0.0 · Windows 公开候选版

- NSIS、干净机、升级/卸载、凭据、Sidecar、缩放和键盘验收全部通过
- 发布物带版本、文件大小和 SHA-256
- README、Release Notes 与实际能力一致
