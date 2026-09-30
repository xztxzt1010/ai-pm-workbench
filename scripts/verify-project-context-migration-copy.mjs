import { backup, DatabaseSync } from "node:sqlite";
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
} from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

const databaseFlag = process.argv.indexOf("--database");
const sourcePath =
  databaseFlag >= 0 ? process.argv[databaseFlag + 1] : process.argv[2];
if (!sourcePath)
  throw new Error(
    "usage: node scripts/verify-project-context-migration-copy.mjs [--database] <assistant-product-manager.db>",
  );
if (!existsSync(sourcePath))
  throw new Error(`database does not exist: ${sourcePath}`);

const temporaryDirectory = mkdtempSync(
  join(tmpdir(), "apm-context-migration-"),
);
const clonePath = join(temporaryDirectory, "assistant-product-manager.db");
let source;
let clone;
try {
  source = new DatabaseSync(sourcePath, { readOnly: true });
  const before = {
    projects: Number(
      source.prepare("SELECT COUNT(*) AS count FROM projects").get().count,
    ),
    requirements: Number(
      source.prepare("SELECT COUNT(*) AS count FROM requirement_cards").get()
        .count,
    ),
    appliedMigrations: Number(
      source
        .prepare(
          "SELECT COALESCE(MAX(version), 0) AS version FROM _sqlx_migrations WHERE success = 1",
        )
        .get().version,
    ),
  };
  await backup(source, clonePath);
  source.close();
  source = undefined;

  clone = new DatabaseSync(clonePath);
  clone.exec("PRAGMA foreign_keys = ON");
  const migrationFiles = readdirSync("src-tauri/migrations")
    .filter((file) => file.endsWith(".sql"))
    .sort();
  const pending = migrationFiles.filter(
    (file) => Number(file.slice(0, 4)) > before.appliedMigrations,
  );
  for (const migration of pending) {
    clone.exec("BEGIN IMMEDIATE");
    try {
      clone.exec(readFileSync(`src-tauri/migrations/${migration}`, "utf8"));
      clone.exec("COMMIT");
    } catch (error) {
      clone.exec("ROLLBACK");
      throw new Error(
        `migration copy failed at ${migration}: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  const requiredTables = [
    "product_documents",
    "product_document_versions",
    "knowledge_items",
    "project_risks",
    "product_decisions",
    "product_decision_versions",
    "releases",
  ];
  const existingTables = new Set(
    clone
      .prepare("SELECT name FROM sqlite_master WHERE type = 'table'")
      .all()
      .map((row) => row.name),
  );
  const missingTables = requiredTables.filter(
    (table) => !existingTables.has(table),
  );
  if (missingTables.length)
    throw new Error(
      `migrated copy is missing context tables: ${missingTables.join(", ")}`,
    );

  const after = {
    projects: Number(
      clone.prepare("SELECT COUNT(*) AS count FROM projects").get().count,
    ),
    requirements: Number(
      clone.prepare("SELECT COUNT(*) AS count FROM requirement_cards").get()
        .count,
    ),
  };
  if (
    after.projects !== before.projects ||
    after.requirements !== before.requirements
  )
    throw new Error(
      "migrated copy changed legacy project or requirement counts",
    );

  const contexts = clone
    .prepare(
      `
    SELECT p.id,
      (SELECT COUNT(*) FROM requirement_cards c JOIN requirement_versions v ON v.id = c.current_version_id WHERE c.project_id = p.id AND c.status = 'confirmed' AND v.is_confirmed = 1) AS requirements,
      (SELECT COUNT(*) FROM product_documents d WHERE d.project_id = p.id AND d.document_type = 'prd' AND d.status = 'confirmed') AS prds,
      (SELECT COUNT(*) FROM project_risks r WHERE r.project_id = p.id) AS risks,
      (SELECT COUNT(*) FROM product_decisions d WHERE d.project_id = p.id AND d.status IN ('confirmed', 'revisit')) AS decisions
    FROM projects p ORDER BY p.updated_at DESC LIMIT 100
  `,
    )
    .all();
  const foreignKeyErrors = clone
    .prepare("PRAGMA foreign_key_check")
    .all().length;
  if (foreignKeyErrors)
    throw new Error(`migrated copy has ${foreignKeyErrors} foreign key errors`);

  console.log(
    JSON.stringify(
      {
        status: "passed",
        mode: "consistent_backup_migration_copy",
        sourceDatabaseModified: false,
        sourceAppliedMigrations: before.appliedMigrations,
        migrationsReplayedOnCopy: pending.length,
        finalSchemaMigrations: migrationFiles.length,
        preserved: after,
        contextProjectsQueried: contexts.length,
        foreignKeyErrors,
      },
      null,
      2,
    ),
  );
} finally {
  try {
    clone?.close();
  } catch {}
  try {
    source?.close();
  } catch {}
  rmSync(temporaryDirectory, { recursive: true, force: true });
}
