import { DatabaseSync } from "node:sqlite";
import { existsSync } from "node:fs";

const databaseFlag = process.argv.indexOf("--database");
const path =
  databaseFlag >= 0 ? process.argv[databaseFlag + 1] : process.argv[2];
if (!path)
  throw new Error(
    "usage: node scripts/verify-project-context-live.mjs [--database] <assistant-product-manager.db>",
  );
if (!existsSync(path)) throw new Error(`database does not exist: ${path}`);

const database = new DatabaseSync(path, { readOnly: true });
database.exec("PRAGMA query_only = ON");

const requiredTables = [
  "projects",
  "requirement_cards",
  "requirement_versions",
  "product_documents",
  "product_document_versions",
  "knowledge_items",
  "project_risks",
  "product_decisions",
  "product_decision_versions",
  "releases",
];
const existingTables = new Set(
  database
    .prepare("SELECT name FROM sqlite_master WHERE type = 'table'")
    .all()
    .map((row) => row.name),
);
const missingTables = requiredTables.filter(
  (table) => !existingTables.has(table),
);
if (missingTables.length)
  throw new Error(
    `live desktop database is behind the context contract: ${missingTables.join(", ")}`,
  );

const projects = database
  .prepare(
    "SELECT id, archived_at FROM projects ORDER BY updated_at DESC LIMIT 100",
  )
  .all();
const count = (sql, projectId) =>
  Number(database.prepare(sql).get(projectId).count);
const contexts = projects.map((project) => ({
  archived: Boolean(project.archived_at),
  requirements: count(
    "SELECT COUNT(*) AS count FROM requirement_cards c JOIN requirement_versions v ON v.id = c.current_version_id WHERE c.project_id = ? AND c.status = 'confirmed' AND v.is_confirmed = 1",
    project.id,
  ),
  prds: count(
    "SELECT COUNT(*) AS count FROM product_documents WHERE project_id = ? AND document_type = 'prd' AND status = 'confirmed'",
    project.id,
  ),
  technicalCandidates: count(
    "SELECT COUNT(*) AS count FROM knowledge_items WHERE domain = 'project' AND project_id = ? AND item_type = 'technical_discussion' AND status = 'confirmed'",
    project.id,
  ),
  risks: count(
    "SELECT COUNT(*) AS count FROM project_risks WHERE project_id = ?",
    project.id,
  ),
  decisions: count(
    "SELECT COUNT(*) AS count FROM product_decisions WHERE project_id = ? AND status IN ('confirmed', 'revisit')",
    project.id,
  ),
  releaseCandidates: count(
    "SELECT COUNT(*) AS count FROM releases WHERE project_id = ? AND status IN ('released', 'reviewed')",
    project.id,
  ),
}));
const projectsWith = (field) =>
  contexts.filter((item) => item[field] > 0).length;
const foreignKeyErrors = database
  .prepare("PRAGMA foreign_key_check")
  .all().length;
if (foreignKeyErrors)
  throw new Error(
    `live desktop database has ${foreignKeyErrors} foreign key errors`,
  );

console.log(
  JSON.stringify(
    {
      status: "passed",
      mode: "read_only_live_database",
      projects: contexts.length,
      archivedProjects: contexts.filter((item) => item.archived).length,
      projectsWith: {
        requirements: projectsWith("requirements"),
        prds: projectsWith("prds"),
        technicalCandidates: projectsWith("technicalCandidates"),
        risks: projectsWith("risks"),
        decisions: projectsWith("decisions"),
        releaseCandidates: projectsWith("releaseCandidates"),
      },
      totalRecords: {
        requirements: contexts.reduce(
          (sum, item) => sum + item.requirements,
          0,
        ),
        prds: contexts.reduce((sum, item) => sum + item.prds, 0),
        technicalCandidates: contexts.reduce(
          (sum, item) => sum + item.technicalCandidates,
          0,
        ),
        risks: contexts.reduce((sum, item) => sum + item.risks, 0),
        decisions: contexts.reduce((sum, item) => sum + item.decisions, 0),
        releaseCandidates: contexts.reduce(
          (sum, item) => sum + item.releaseCandidates,
          0,
        ),
      },
      foreignKeyErrors,
    },
    null,
    2,
  ),
);

database.close();
