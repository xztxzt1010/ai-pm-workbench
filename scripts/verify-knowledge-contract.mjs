import { DatabaseSync } from "node:sqlite"
import { readFileSync, readdirSync } from "node:fs"

const migrations = readdirSync("src-tauri/migrations").filter((file) => file.endsWith(".sql")).sort()
const database = new DatabaseSync(":memory:")
database.exec("PRAGMA foreign_keys = ON")
for (const migration of migrations) database.exec(readFileSync(`src-tauri/migrations/${migration}`, "utf8"))

function expectRejected(label, action) {
  try {
    action()
  } catch {
    return
  }
  throw new Error(`${label} should have been rejected`)
}

function insertOwned({ id, type, domain, projectId = null, title = id, content = "# Content", actor = "user", status = "draft", confirmedAt = null }) {
  database.prepare(
    `INSERT INTO knowledge_items
     (id, item_type, status, domain, project_id, title, content_markdown,
      content_version, created_by, created_at, updated_at, confirmed_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, 1, ?, '2026-07-17T12:00:00.000Z',
             '2026-07-17T12:00:00.000Z', ?)`,
  ).run(id, type, status, domain, projectId, title, content, actor, confirmedAt)
}

const emptyCounts = Object.fromEntries(
  ["knowledge_items", "knowledge_sources", "knowledge_relations", "knowledge_index_events", "knowledge_import_receipts"].map((table) => [
    table,
    database.prepare(`SELECT COUNT(*) AS count FROM ${table}`).get().count,
  ]),
)
if (Object.values(emptyCounts).some((count) => count !== 0)) throw new Error("migration 45 must not copy or mutate legacy user rows")

database.prepare("INSERT INTO projects (id, name, goal, status, created_at, updated_at) VALUES (?, ?, '', 'active', ?, ?)")
  .run("project-1", "Project 1", "2026-07-17T12:00:00.000Z", "2026-07-17T12:00:00.000Z")
database.prepare("INSERT INTO projects (id, name, goal, status, created_at, updated_at) VALUES (?, ?, '', 'active', ?, ?)")
  .run("project-2", "Project 2", "2026-07-17T12:00:00.000Z", "2026-07-17T12:00:00.000Z")
database.prepare("INSERT INTO meetings (id, project_id, title, meeting_date, participants_json, status, created_at, updated_at) VALUES (?, ?, ?, ?, '[]', 'completed', ?, ?)")
  .run("meeting-1", "project-1", "Planning", "2026-07-17", "2026-07-17T12:00:00.000Z", "2026-07-17T12:00:00.000Z")
database.prepare(
  `INSERT INTO meeting_sources
   (id, meeting_id, source_type, content_hash, parsed_text, byte_size, created_at,
    mime_type, parse_status, updated_at)
   VALUES (?, ?, 'md', ?, '# Meeting', 9, ?, 'text/markdown', 'parsed', ?)`,
).run("meeting-source-1", "meeting-1", "a".repeat(64), "2026-07-17T12:00:00.000Z", "2026-07-17T12:00:00.000Z")
database.prepare("INSERT INTO product_decisions (id, project_id, status, current_version_number, created_at, updated_at) VALUES (?, ?, 'confirmed', 1, ?, ?)")
  .run("decision-1", "project-1", "2026-07-17T12:00:00.000Z", "2026-07-17T12:00:00.000Z")
database.prepare(
  `INSERT INTO product_decision_versions
   (id, decision_id, version_number, title, context, decision_text, alternatives_json,
    evidence_json, objections_json, impact, review_date, created_by, created_at)
   VALUES ('decision-version-1', 'decision-1', 1, 'Direction', 'Context', 'Decision',
           '[]', '[]', '[]', 'Impact', '', 'user', '2026-07-17T12:00:00.000Z')`,
).run()

insertOwned({ id: "idea-1", type: "product_idea", domain: "project", projectId: "project-1" })
insertOwned({ id: "technical-1", type: "technical_discussion", domain: "project", projectId: "project-1" })
insertOwned({ id: "learning-1", type: "ai_learning", domain: "personal" })
insertOwned({ id: "idea-project-2", type: "product_idea", domain: "project", projectId: "project-2" })

database.prepare(
  `INSERT INTO knowledge_items
   (id, item_type, status, domain, project_id, title, content_markdown, target_kind,
    target_id, target_version, content_version, created_by, created_at, updated_at)
   VALUES ('meeting-knowledge-1', 'meeting_record', 'draft', 'project', 'project-1',
           'Planning', '', 'meeting', 'meeting-1', ?, 1, 'user', ?, ?)`,
).run("a".repeat(64), "2026-07-17T12:00:00.000Z", "2026-07-17T12:00:00.000Z")
database.prepare(
  `INSERT INTO knowledge_items
   (id, item_type, status, domain, project_id, title, content_markdown, target_kind,
    target_id, target_version, content_version, created_by, created_at, updated_at)
   VALUES ('decision-knowledge-1', 'project_decision', 'draft', 'project', 'project-1',
           'Direction', '', 'product_decision', 'decision-1', '1', 1, 'user', ?, ?)`,
).run("2026-07-17T12:00:00.000Z", "2026-07-17T12:00:00.000Z")

expectRejected("project scope without project", () => insertOwned({ id: "bad-1", type: "product_idea", domain: "project" }))
expectRejected("personal scope with project", () => insertOwned({ id: "bad-2", type: "ai_learning", domain: "personal", projectId: "project-1" }))
expectRejected("owned record without content", () => insertOwned({ id: "bad-3", type: "ai_learning", domain: "personal", content: "" }))
expectRejected("agent confirmed knowledge", () => insertOwned({ id: "bad-4", type: "ai_learning", domain: "personal", actor: "agent", status: "confirmed", confirmedAt: "2026-07-17T12:00:00.000Z" }))
expectRejected("meeting target in another project", () => database.prepare(
  `INSERT INTO knowledge_items
   (id, item_type, status, domain, project_id, title, content_markdown, target_kind,
    target_id, target_version, content_version, created_by, created_at, updated_at)
   VALUES ('bad-5', 'meeting_record', 'draft', 'project', 'project-2', 'Wrong', '',
           'meeting', 'meeting-1', ?, 1, 'user', ?, ?)`,
).run("a".repeat(64), "2026-07-17T12:00:00.000Z", "2026-07-17T12:00:00.000Z"))

database.prepare(
  `INSERT INTO knowledge_sources
   (id, item_id, source_kind, source_ref, source_version, content_hash, title,
    locator_json, captured_at, created_at)
   VALUES ('source-1', 'idea-1', 'markdown', 'notes/idea.md', '1', ?, 'Idea',
           '{"heading":"scope"}', ?, ?)`,
).run("b".repeat(64), "2026-07-17T12:00:00.000Z", "2026-07-17T12:00:00.000Z")
expectRejected("duplicate source version", () => database.prepare(
  `INSERT INTO knowledge_sources
   (id, item_id, source_kind, source_ref, source_version, content_hash, title,
    locator_json, captured_at, created_at)
   SELECT 'source-duplicate', item_id, source_kind, source_ref, source_version,
          content_hash, title, locator_json, captured_at, created_at
     FROM knowledge_sources WHERE id = 'source-1'`,
).run())

database.prepare(
  `INSERT INTO knowledge_relations
   (id, from_item_id, to_item_id, relation_type, status, evidence_json, created_by,
    created_at, updated_at, confirmed_at)
   VALUES ('relation-1', 'idea-1', 'technical-1', 'supports', 'confirmed', '[]',
           'user', ?, ?, ?)`,
).run("2026-07-17T12:00:00.000Z", "2026-07-17T12:00:00.000Z", "2026-07-17T12:00:00.000Z")
expectRejected("cross-project relation", () => database.prepare(
  `INSERT INTO knowledge_relations
   (id, from_item_id, to_item_id, relation_type, status, evidence_json, created_by,
    created_at, updated_at, confirmed_at)
   VALUES ('relation-cross', 'idea-1', 'idea-project-2', 'relates_to', 'confirmed', '[]',
           'user', ?, ?, ?)`,
).run("2026-07-17T12:00:00.000Z", "2026-07-17T12:00:00.000Z", "2026-07-17T12:00:00.000Z"))

database.prepare(
  `INSERT INTO knowledge_import_receipts (item_id, package_hash, imported_at)
   VALUES ('idea-1', ?, '2026-07-17T12:30:00.000Z')`,
).run("c".repeat(64))
database.prepare("UPDATE knowledge_items SET content_markdown = '# v2', content_version = 2, updated_at = ? WHERE id = 'idea-1'")
  .run("2026-07-17T13:00:00.000Z")
if (database.prepare("SELECT COUNT(*) AS count FROM knowledge_import_receipts WHERE item_id = 'idea-1'").get().count !== 0) {
  throw new Error("editing imported knowledge must invalidate its idempotency receipt")
}
database.prepare("UPDATE knowledge_items SET status = 'archived', archived_at = ?, archived_from_status = 'draft', updated_at = ? WHERE id = 'technical-1'")
  .run("2026-07-17T13:00:00.000Z", "2026-07-17T13:00:00.000Z")
database.prepare("DELETE FROM knowledge_items WHERE id = 'learning-1'").run()

const eventTypes = Object.fromEntries(
  database.prepare("SELECT event_type, COUNT(*) AS count FROM knowledge_index_events GROUP BY event_type ORDER BY event_type").all()
    .map((row) => [row.event_type, row.count]),
)
for (const required of ["upsert", "archive", "delete", "source_version_changed", "relation_changed"]) {
  if (!eventTypes[required]) throw new Error(`missing index invalidation event: ${required}`)
}

database.prepare("DELETE FROM meeting_sources WHERE id = 'meeting-source-1'").run()
if (database.prepare("SELECT COUNT(*) AS count FROM knowledge_items WHERE id = 'meeting-knowledge-1'").get().count !== 0) {
  throw new Error("meeting adapter must be removed when its exact source version is deleted")
}
if (database.prepare("PRAGMA foreign_key_check").all().length) throw new Error("knowledge contract produced foreign key errors")

const rustSource = readFileSync("src-tauri/src/lib.rs", "utf8")
for (const contract of [
  "validate_enabled_knowledge_scope",
  "create_knowledge_item",
  "update_knowledge_item",
  "list_knowledge_items",
  "review_knowledge_item",
  "add_knowledge_source",
  "create_knowledge_relation",
  "review_knowledge_relation",
  "import_knowledge_markdown_package",
  "list_knowledge_adapter_candidates",
  "外部来源只允许不含凭据的 HTTPS 地址",
  "知识关系两端必须属于同一知识域和项目且未归档",
]) {
  if (!rustSource.includes(contract)) throw new Error(`Rust knowledge boundary is missing: ${contract}`)
}

console.log(JSON.stringify({
  status: "passed",
  migrations: migrations.length,
  legacyRowsCopied: false,
  itemTypesCovered: 5,
  enabledDomains: ["project", "personal"],
  eventTypes,
  importReceiptInvalidation: true,
  foreignKeyErrors: 0,
}, null, 2))

database.close()
