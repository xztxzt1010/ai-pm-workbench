CREATE TABLE IF NOT EXISTS experiments (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  version_number INTEGER NOT NULL CHECK (version_number > 0),
  name TEXT NOT NULL,
  hypothesis TEXT NOT NULL,
  primary_metric TEXT NOT NULL,
  sample_plan TEXT NOT NULL,
  start_date TEXT NOT NULL,
  end_date TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('draft', 'running', 'completed', 'cancelled')),
  conclusion TEXT NOT NULL DEFAULT '',
  decision TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL,
  UNIQUE(id, version_number)
);
CREATE TABLE IF NOT EXISTS experiment_results (
  id TEXT PRIMARY KEY,
  experiment_id TEXT NOT NULL REFERENCES experiments(id) ON DELETE CASCADE,
  result_json TEXT NOT NULL,
  analysis_json TEXT NOT NULL,
  imported_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_experiments_project ON experiments(project_id, created_at DESC);
