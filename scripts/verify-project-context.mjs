import { DatabaseSync } from "node:sqlite";
import { readFileSync, readdirSync } from "node:fs";

const migrations = readdirSync("src-tauri/migrations")
  .filter((file) => file.endsWith(".sql"))
  .sort();
const database = new DatabaseSync(":memory:");
database.exec("PRAGMA foreign_keys = ON");
for (const migration of migrations)
  database.exec(readFileSync(`src-tauri/migrations/${migration}`, "utf8"));

const now = "2026-07-18T08:00:00.000Z";
const insertProject = database.prepare(
  "INSERT INTO projects (id, name, goal, status, progress, created_at, updated_at) VALUES (?, ?, ?, 'active', 30, ?, ?)",
);
insertProject.run("context-p1", "上下文项目", "验证桌面 SQLite 聚合", now, now);
insertProject.run("context-p2", "隔离项目", "不得进入项目一", now, now);

const insertMeeting = database.prepare(
  "INSERT INTO meetings (id, project_id, title, meeting_date, participants_json, status, created_at, updated_at) VALUES (?, ?, ?, '2026-07-18', '[]', 'completed', ?, ?)",
);
insertMeeting.run("meeting-p1", "context-p1", "项目一会议", now, now);
insertMeeting.run("meeting-p2", "context-p2", "项目二会议", now, now);

function insertRequirement(id, projectId, meetingId, status, confirmed) {
  const versionId = `${id}-v1`;
  database
    .prepare(
      "INSERT INTO requirement_cards (id, meeting_id, project_id, current_version_id, title, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
    )
    .run(id, meetingId, projectId, versionId, id, status, now, now);
  database
    .prepare(
      "INSERT INTO requirement_versions (id, requirement_card_id, version_number, title, content_json, evidence_json, source, is_confirmed, created_at) VALUES (?, ?, 1, ?, ?, '[]', 'user', ?, ?)",
    )
    .run(
      versionId,
      id,
      id,
      JSON.stringify({
        description: id,
        targetUsers: "PM",
        scenario: "上下文",
        painPoint: "分散",
        acceptanceCriteria: [],
      }),
      confirmed ? 1 : 0,
      now,
    );
}
insertRequirement(
  "req-confirmed",
  "context-p1",
  "meeting-p1",
  "confirmed",
  true,
);
insertRequirement("req-draft", "context-p1", "meeting-p1", "draft", false);
insertRequirement("req-cross", "context-p2", "meeting-p2", "confirmed", true);

function insertDocument(id, projectId, type, status) {
  database
    .prepare(
      "INSERT INTO product_documents (id, project_id, title, document_type, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
    )
    .run(id, projectId, id, type, status, now, now);
  database
    .prepare(
      "INSERT INTO product_document_versions (id, document_id, version_number, content_markdown, source_json, change_summary, created_by, created_at) VALUES (?, ?, 1, ?, '[]', 'fixture', 'user', ?)",
    )
    .run(`${id}-v1`, id, `# ${id}`, now);
}
insertDocument("prd-confirmed", "context-p1", "prd", "confirmed");
insertDocument("prd-draft", "context-p1", "prd", "draft");
insertDocument("design-confirmed", "context-p1", "design_brief", "confirmed");
insertDocument("prd-cross", "context-p2", "prd", "confirmed");

function insertKnowledge(id, projectId, status) {
  database
    .prepare(
      "INSERT INTO knowledge_items (id, item_type, status, domain, project_id, title, content_markdown, content_version, created_by, created_at, updated_at, confirmed_at) VALUES (?, 'technical_discussion', ?, 'project', ?, ?, ?, 1, 'user', ?, ?, ?)",
    )
    .run(
      id,
      status,
      projectId,
      id,
      `# ${id}`,
      now,
      now,
      status === "confirmed" ? now : null,
    );
}
insertKnowledge("technical-confirmed", "context-p1", "confirmed");
insertKnowledge("technical-draft", "context-p1", "draft");
insertKnowledge("technical-cross", "context-p2", "confirmed");

const insertRisk = database.prepare(
  "INSERT INTO project_risks (id, project_id, title, description, severity, probability, status, owner, due_date, mitigation, created_at, updated_at) VALUES (?, ?, ?, '风险', 'medium', 'possible', 'open', 'PM', '2026-08-01', '跟进', ?, ?)",
);
for (let index = 0; index < 105; index += 1)
  insertRisk.run(
    `risk-${String(index).padStart(3, "0")}`,
    "context-p1",
    `风险 ${index}`,
    now,
    now,
  );
insertRisk.run("risk-cross", "context-p2", "跨项目风险", now, now);

function insertDecision(id, projectId, status) {
  database
    .prepare(
      "INSERT INTO product_decisions (id, project_id, status, current_version_number, created_at, updated_at) VALUES (?, ?, ?, 1, ?, ?)",
    )
    .run(id, projectId, status, now, now);
  database
    .prepare(
      "INSERT INTO product_decision_versions (id, decision_id, version_number, title, context, decision_text, alternatives_json, evidence_json, objections_json, impact, review_date, created_by, created_at) VALUES (?, ?, 1, ?, '背景', '结论', '[]', '[]', '[]', '影响', '2026-08-01', 'user', ?)",
    )
    .run(`${id}-v1`, id, id, now);
}
insertDecision("decision-confirmed", "context-p1", "confirmed");
insertDecision("decision-proposed", "context-p1", "proposed");
insertDecision("decision-cross", "context-p2", "confirmed");

function insertRelease(id, projectId, status) {
  database
    .prepare(
      "INSERT INTO releases (id, project_id, title, scope_json, checklist_json, rollback_plan, result, retrospective, follow_up_json, status, target_date, created_at, updated_at) VALUES (?, ?, ?, '[]', '[]', '回滚', '结果', '复盘', '[]', ?, '2026-08-01', ?, ?)",
    )
    .run(id, projectId, id, status, now, now);
}
insertRelease("release-reviewed", "context-p1", "reviewed");
insertRelease("release-ready", "context-p1", "ready");
insertRelease("release-cross", "context-p2", "reviewed");

const requirements = database
  .prepare(
    "SELECT c.id FROM requirement_cards c JOIN requirement_versions v ON v.id = c.current_version_id WHERE c.project_id = ? AND c.status = 'confirmed' AND v.is_confirmed = 1 ORDER BY c.updated_at DESC LIMIT 100",
  )
  .all("context-p1");
const prds = database
  .prepare(
    "SELECT d.id, MAX(v.version_number) AS version_number FROM product_documents d JOIN product_document_versions v ON v.document_id = d.id WHERE d.project_id = ? AND d.document_type = 'prd' AND d.status = 'confirmed' GROUP BY d.id ORDER BY d.updated_at DESC LIMIT 100",
  )
  .all("context-p1");
const technicalCandidates = database
  .prepare(
    "SELECT id FROM knowledge_items WHERE domain = 'project' AND project_id = ? AND item_type = 'technical_discussion' AND status = 'confirmed' ORDER BY updated_at DESC LIMIT 100",
  )
  .all("context-p1");
const risks = database
  .prepare(
    "SELECT id FROM project_risks WHERE project_id = ? ORDER BY updated_at DESC, id LIMIT 100",
  )
  .all("context-p1");
const decisions = database
  .prepare(
    "SELECT d.id, v.version_number FROM product_decisions d JOIN product_decision_versions v ON v.decision_id = d.id AND v.version_number = d.current_version_number WHERE d.project_id = ? AND d.status IN ('confirmed', 'revisit') ORDER BY d.updated_at DESC LIMIT 100",
  )
  .all("context-p1");
const releaseCandidates = database
  .prepare(
    "SELECT id FROM releases WHERE project_id = ? AND status IN ('released', 'reviewed') ORDER BY updated_at DESC LIMIT 100",
  )
  .all("context-p1");

function exactIds(label, rows, expected) {
  const actual = rows.map((row) => row.id).sort();
  if (JSON.stringify(actual) !== JSON.stringify([...expected].sort()))
    throw new Error(`${label} selection mismatch: ${JSON.stringify(actual)}`);
}
exactIds("confirmed requirements", requirements, ["req-confirmed"]);
exactIds("confirmed PRDs", prds, ["prd-confirmed"]);
exactIds("technical candidates", technicalCandidates, ["technical-confirmed"]);
exactIds("formal decisions", decisions, ["decision-confirmed"]);
exactIds("release candidates", releaseCandidates, ["release-reviewed"]);
if (risks.length !== 100 || risks.some((row) => row.id === "risk-cross"))
  throw new Error("risk budget or project isolation failed");
if (database.prepare("PRAGMA foreign_key_check").all().length)
  throw new Error("project context fixture produced foreign key errors");

const rustSource = readFileSync("src-tauri/src/lib.rs", "utf8");
for (const command of [
  "list_product_documents",
  "list_project_risks",
  "list_product_decisions",
  "list_releases",
  "list_knowledge_items",
]) {
  if (!rustSource.includes(`async fn ${command}`))
    throw new Error(`desktop context command missing: ${command}`);
}
const serviceSource = readFileSync(
  "src/services/project-context-service.ts",
  "utf8",
);
if (
  !serviceSource.includes("const CONTEXT_QUERY_LIMIT = 100") ||
  !serviceSource.includes(".slice(0, CONTEXT_QUERY_LIMIT)")
)
  throw new Error(
    "frontend context budget changed without updating acceptance",
  );

console.log(
  JSON.stringify(
    {
      status: "passed",
      migrations: migrations.length,
      project: "context-p1",
      formal: {
        requirements: requirements.length,
        prds: prds.length,
        risks: risks.length,
        decisions: decisions.length,
      },
      candidates: {
        technical: technicalCandidates.length,
        releases: releaseCandidates.length,
      },
      excludedCrossProject: true,
      excludedDrafts: true,
      retainedPerSourceLimit: 100,
      foreignKeyErrors: 0,
    },
    null,
    2,
  ),
);

database.close();
