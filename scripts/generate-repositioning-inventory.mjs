import { DatabaseSync } from "node:sqlite"
import { mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs"
import { dirname, join, relative } from "node:path"

const root = process.cwd()
const migrationDirectory = join(root, "src-tauri", "migrations")
const outputPath = join(root, "docs", "project-management", "reports", "repositioning", "STEP1_ASSET_INVENTORY.generated.md")

const migrationFiles = readdirSync(migrationDirectory)
  .filter((file) => file.endsWith(".sql"))
  .sort()

const database = new DatabaseSync(":memory:")
database.exec("PRAGMA foreign_keys = ON")

const firstSeen = new Map()
const migrationIntroductions = []

for (const migrationFile of migrationFiles) {
  database.exec(readFileSync(join(migrationDirectory, migrationFile), "utf8"))
  const introduced = []
  const tables = database
    .prepare("PRAGMA table_list")
    .all()
    .filter((table) => table.schema === "main" && !table.name.startsWith("sqlite_"))
  for (const table of tables) {
    if (firstSeen.has(table.name)) continue
    firstSeen.set(table.name, migrationFile)
    introduced.push(table.name)
  }
  migrationIntroductions.push({ migrationFile, introduced: introduced.sort() })
}

const tableList = database
  .prepare("PRAGMA table_list")
  .all()
  .filter((table) => table.schema === "main" && !table.name.startsWith("sqlite_"))
  .sort((left, right) => left.name.localeCompare(right.name))

const shadowTables = tableList.filter((table) => table.type === "shadow")
const logicalTables = tableList.filter((table) => table.type !== "shadow")
const schemaObjects = database
  .prepare(
    "SELECT type, name, tbl_name FROM sqlite_master WHERE name NOT LIKE 'sqlite_%' ORDER BY type, name",
  )
  .all()
const indexes = schemaObjects.filter((object) => object.type === "index")
const triggers = schemaObjects.filter((object) => object.type === "trigger")
const views = schemaObjects.filter((object) => object.type === "view")

const agentDefinitions = database
  .prepare(
    `SELECT definition_key, version, name, input_schema_version, output_schema_version,
            permissions_json
       FROM agent_definitions
      ORDER BY definition_key, version`,
  )
  .all()

function listFiles(directory, predicate, prefix) {
  return readdirSync(join(root, directory), { withFileTypes: true })
    .filter((entry) => entry.isFile() && predicate(entry.name))
    .map((entry) => `${prefix}/${entry.name}`)
    .sort()
}

const pageComponents = listFiles(
  "src/components",
  (name) => name.endsWith(".tsx") && !name.endsWith(".test.tsx"),
  "src/components",
)
const services = listFiles(
  "src/services",
  (name) => name.endsWith(".ts") && !name.endsWith(".test.ts"),
  "src/services",
)
const agentDomainModules = listFiles(
  "src/domain",
  (name) =>
    name.endsWith(".ts") &&
    !name.endsWith(".test.ts") &&
    /(agent|analysis|prd|risk|release|research|knowledge|project-qa|dependency|competitor)/.test(name),
  "src/domain",
)
const documents = listFiles("docs", (name) => name.endsWith(".md"), "docs")

function escapeCell(value) {
  return String(value).replaceAll("|", "\\|").replaceAll("\n", " ")
}

function formatList(items) {
  return items.length ? items.map((item) => `- \`${item}\``).join("\n") : "- 无"
}

const lines = []
lines.push("# 第 1 步：资产盘点（自动生成证据）")
lines.push("")
lines.push("> 本文件由 `scripts/generate-repositioning-inventory.mjs` 从当前 migration 和源码目录生成。请勿手工修改。")
lines.push("")
lines.push("## 数据库摘要")
lines.push("")
lines.push("| 项目 | 数量 |")
lines.push("| --- | ---: |")
lines.push(`| Migration | ${migrationFiles.length} |`)
lines.push(`| SQLite 物理表（含 FTS 影子表） | ${logicalTables.length + shadowTables.length} |`)
lines.push(`| 逻辑表（普通表 + FTS 虚拟表） | ${logicalTables.length} |`)
lines.push(`| FTS 影子表 | ${shadowTables.length} |`)
lines.push(`| 显式索引 | ${indexes.length} |`)
lines.push(`| 触发器 | ${triggers.length} |`)
lines.push(`| 视图 | ${views.length} |`)
lines.push(`| Agent 定义版本记录 | ${agentDefinitions.length} |`)
lines.push("")
lines.push(`FTS 影子表：${shadowTables.map((table) => `\`${table.name}\``).join("、")}。这些表由 SQLite FTS5 管理，不作为独立业务模型迁移。`)
lines.push("")
lines.push("## Migration 演进")
lines.push("")
lines.push("| Migration | 首次出现的数据库对象 |")
lines.push("| --- | --- |")
for (const entry of migrationIntroductions) {
  lines.push(`| \`${entry.migrationFile}\` | ${entry.introduced.length ? entry.introduced.map((name) => `\`${name}\``).join("、") : "—"} |`)
}
lines.push("")
lines.push("## 逻辑表结构")
lines.push("")
lines.push("| 表 | 类型 | 首次出现 | 列数 | 外键目标 |")
lines.push("| --- | --- | --- | ---: | --- |")
for (const table of logicalTables) {
  const columns = database.prepare(`PRAGMA table_info(${JSON.stringify(table.name)})`).all()
  const foreignKeys = database.prepare(`PRAGMA foreign_key_list(${JSON.stringify(table.name)})`).all()
  const targets = [...new Set(foreignKeys.map((foreignKey) => foreignKey.table))].sort()
  lines.push(
    `| \`${table.name}\` | ${table.type === "virtual" ? "FTS 虚拟表" : "普通表"} | \`${firstSeen.get(table.name)}\` | ${columns.length} | ${targets.length ? targets.map((target) => `\`${target}\``).join("、") : "—"} |`,
  )
}
lines.push("")
lines.push("## Agent 定义资产")
lines.push("")
lines.push("| Definition | 版本 | 名称 | 数据范围 | 写权限 | 引用要求 |")
lines.push("| --- | ---: | --- | --- | --- | --- |")
for (const definition of agentDefinitions) {
  const permissions = JSON.parse(definition.permissions_json)
  lines.push(
    `| \`${definition.definition_key}\` | ${definition.version} | ${escapeCell(definition.name)} | \`${permissions.dataScope ?? "未声明"}\` | ${permissions.businessWriteAccess ? "受控提案" : "只读"} | ${permissions.requiresCitations ? "是" : "否"} |`,
  )
}
lines.push("")
lines.push("## 应用资产入口")
lines.push("")
lines.push(`### 页面与业务面板（${pageComponents.length}）`)
lines.push("")
lines.push(formatList(pageComponents))
lines.push("")
lines.push(`### Service（${services.length}）`)
lines.push("")
lines.push(formatList(services))
lines.push("")
lines.push(`### Agent 相关领域模块（${agentDomainModules.length}）`)
lines.push("")
lines.push(formatList(agentDomainModules))
lines.push("")
lines.push(`### 既有产品/技术文档（${documents.length}）`)
lines.push("")
lines.push(formatList(documents))
lines.push("")
lines.push("## 生成边界")
lines.push("")
lines.push("- 本清单证明资产存在和 Schema 关系，不判断资产是否应该继续暴露给用户。")
lines.push("- Agent 的专家归类、五类记录兼容策略、术语冻结和迁移样例记录在配套人工评审文档中。")
lines.push("- `首次出现` 表示对象第一次进入逐 migration 回放后的 Schema；后续重建或字段演进仍以 SQL migration 为准。")
lines.push("")

database.close()

const rendered = `${lines.join("\n")}\n`
const mode = process.argv[2]

if (mode === "--write") {
  mkdirSync(dirname(outputPath), { recursive: true })
  writeFileSync(outputPath, rendered, "utf8")
  console.log(`updated ${relative(root, outputPath)}`)
} else if (mode === "--check") {
  const existing = readFileSync(outputPath, "utf8")
  if (existing !== rendered) {
    throw new Error(
      `${relative(root, outputPath)} is stale; run npm run inventory:repositioning`,
    )
  }
  console.log(`verified ${relative(root, outputPath)}`)
} else {
  process.stdout.write(rendered)
}
