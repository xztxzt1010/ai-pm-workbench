import { existsSync, readFileSync, statSync } from "node:fs"

function requireCondition(condition, message) {
  if (!condition) throw new Error(message)
}

function read(path) {
  requireCondition(existsSync(path) && statSync(path).isFile(), `missing release document: ${path}`)
  return readFileSync(path, "utf8").replace(/^﻿/, "")
}

function requireSections(path, sections) {
  const content = read(path)
  for (const section of sections) requireCondition(content.includes(section), `${path} is missing required section: ${section}`)
  requireCondition(!/(?:\bTODO\b|\bTBD\b|<待填写>)/i.test(content), `${path} contains an unresolved placeholder`)
  return content
}

const packageConfig = JSON.parse(read("package.json"))
const userGuide = requireSections("docs/USER_GUIDE.md", [
  "## 1. 安装与首次启动",
  "## 3. 建立项目闭环",
  "## 4. 会议到需求",
  "## 6. Provider 与 Agent",
  "## 8. 备份与恢复",
  "## 9. 常见问题",
])
const privacy = requireSections("docs/PRIVACY_AND_DATA.md", [
  "## 2. 保存的数据",
  "## 3. API Key 与凭据",
  "## 4. 外部传输",
  "## 6. 备份、导出与保留",
  "## 7. 卸载与删除",
])
const releaseNotes = requireSections("docs/RELEASE_NOTES.md", [
  `## ${packageConfig.version}（Source Preview）`,
  "### 核心能力",
  "### 安全与数据边界",
  "### 已知限制",
  "### 升级与回退",
])
const sampleGuide = requireSections("examples/README.md", [
  "## 1. 创建项目",
  "## 2. 导入会议并形成需求",
  "## 4. 导入数据并运行确定性分析",
  "## 5. 指标、实验与发布",
  "## 6. 完成判定",
])
const browserAcceptance = requireSections("docs/acceptance/BROWSER_UI_ACCEPTANCE.md", [
  "## 1. 覆盖范围",
  "## 2. 发现与修复",
  "## 3. 当前自动与人工证据",
  "## 4. 完成边界",
])
const svgAcceptance = requireSections("docs/acceptance/SVG_VISUAL_ACCEPTANCE.md", [
  "## 1. 修复前风险",
  "## 2. 实现调整",
  "## 3. 自动化证据",
  "## 4. 浏览器视觉证据",
  "## 5. 未完成边界",
])

requireCondition(userGuide.includes("浏览器预览") && userGuide.includes("Windows Credential Manager"), "user guide must distinguish preview and credential behavior")
requireCondition(privacy.includes("com.assistant-product-manager.desktop") && privacy.includes("127.0.0.1"), "privacy notice must identify local storage and loopback boundaries")
requireCondition(releaseNotes.includes("尚未生成并验收最终 NSIS"), "release notes must preserve the unverified installer limitation")
requireCondition(releaseNotes.includes("不附带安装器"), "release notes must state source preview ships without an installer")
requireCondition(sampleGuide.includes("不会自动写入正式数据库"), "sample guide must not imply automatic production seeding")
requireCondition(browserAcceptance.includes("真实 Tauri 键盘操作尚未验收"), "browser acceptance must preserve the desktop keyboard verification gap")
requireCondition(svgAcceptance.includes("Windows 图片查看器") && svgAcceptance.includes("保持“进行中”"), "SVG acceptance must preserve the Windows viewer gap")
read("visual/analysis-chart-preview.html")
read("visual/analysis-chart-preview.ts")

const meeting = read("examples/activation-review-meeting.md")
const research = read("examples/research-notes.md")
const csv = read("examples/activation-funnel.csv").trim().split(/\r?\n/)
requireCondition(meeting.length >= 500 && meeting.includes("first_value_action"), "sample meeting is incomplete")
requireCondition(research.includes("限制：") && research.length >= 250, "sample research must include limitations")
requireCondition(csv[0] === "user_id,registered,workspace_created,member_invited,first_value_action,variant", "sample funnel CSV header changed unexpectedly")
requireCondition(csv.length === 11 && csv.slice(1).every((row) => row.split(",").length === 6), "sample funnel CSV must contain 10 valid rows")

const readme = read("README.md")
for (const link of [
  "docs/USER_GUIDE.md",
  "docs/PRIVACY_AND_DATA.md",
  "docs/RELEASE_NOTES.md",
  "examples/README.md",
  "docs/acceptance/BROWSER_UI_ACCEPTANCE.md",
  "docs/acceptance/SVG_VISUAL_ACCEPTANCE.md",
  "PUBLIC_SNAPSHOT_MANIFEST.md",
]) requireCondition(readme.includes(link), `README is missing release link: ${link}`)
requireCondition(readme.includes("不附带 Windows 安装包") || readme.includes("不附带安装包"), "README must state there is no supported installer")
requireCondition(packageConfig.private === true, "package must stay private to avoid accidental npm publish")
requireCondition(packageConfig.license === "MIT", "package license must be MIT")

console.log(JSON.stringify({
  status: "passed",
  version: packageConfig.version,
  documents: 6,
  sampleFiles: 3,
  visualFixtures: 2,
  sampleRows: csv.length - 1,
}, null, 2))
