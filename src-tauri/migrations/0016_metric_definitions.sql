CREATE TABLE IF NOT EXISTS metric_definitions (
  id TEXT NOT NULL,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  version_number INTEGER NOT NULL CHECK (version_number > 0),
  name TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  unit TEXT NOT NULL DEFAULT '',
  formula_json TEXT NOT NULL,
  source_dataset_id TEXT NOT NULL REFERENCES analysis_datasets(id) ON DELETE RESTRICT,
  created_at TEXT NOT NULL,
  PRIMARY KEY (id, version_number)
);
CREATE INDEX IF NOT EXISTS idx_metric_definitions_project ON metric_definitions(project_id, id, version_number DESC);
