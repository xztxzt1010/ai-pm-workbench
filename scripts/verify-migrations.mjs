import { DatabaseSync } from "node:sqlite"
import { readdirSync, readFileSync } from "node:fs"

const migrations = readdirSync("src-tauri/migrations").filter((file) => file.endsWith(".sql")).sort()
const checkpoints = []
for (let prefix = 1; prefix <= migrations.length; prefix += 1) {
  const db = new DatabaseSync(":memory:")
  db.exec("PRAGMA foreign_keys = ON")
  try {
    for (const migration of migrations.slice(0, prefix)) db.exec(readFileSync(`src-tauri/migrations/${migration}`, "utf8"))
    const foreignKeys = db.prepare("PRAGMA foreign_key_check").all()
    if (foreignKeys.length) throw new Error(`foreign key errors: ${JSON.stringify(foreignKeys)}`)
    const tables = new Set(db.prepare("SELECT name FROM sqlite_master WHERE type IN ('table','view')").all().map((row) => row.name))
    if (!tables.has("projects")) throw new Error("projects table missing")
    if (prefix >= 8 && !tables.has("agent_definitions")) throw new Error("agent_definitions table missing")
    if (prefix >= 10 && !tables.has("project_memories")) throw new Error("project_memories table missing")
    checkpoints.push({ prefix, migration: migrations[prefix - 1], tables: tables.size })
  } finally {
    db.close()
  }
}
console.log(JSON.stringify({ migrations: migrations.length, checkpoints: checkpoints.length, first: checkpoints[0], last: checkpoints.at(-1) }, null, 2))
