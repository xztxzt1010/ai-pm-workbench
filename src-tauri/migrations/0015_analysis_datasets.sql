CREATE TABLE IF NOT EXISTS analysis_datasets (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  source_type TEXT NOT NULL CHECK (source_type IN ('csv', 'json')),
  schema_json TEXT NOT NULL,
  rows_json TEXT NOT NULL,
  content_hash TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS analysis_runs (
  id TEXT PRIMARY KEY,
  dataset_id TEXT NOT NULL REFERENCES analysis_datasets(id) ON DELETE CASCADE,
  operator TEXT NOT NULL CHECK (operator IN ('summary', 'funnel', 'cohort', 'trend')),
  parameters_json TEXT NOT NULL,
  result_json TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_analysis_datasets_project ON analysis_datasets(project_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_analysis_runs_dataset ON analysis_runs(dataset_id, created_at DESC);
