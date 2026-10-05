CREATE TABLE IF NOT EXISTS analysis_insights (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  analysis_run_id TEXT NOT NULL REFERENCES analysis_runs(id) ON DELETE RESTRICT,
  title TEXT NOT NULL,
  content TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('draft', 'confirmed', 'archived')),
  created_by TEXT NOT NULL CHECK (created_by IN ('user', 'agent')),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS analysis_insight_links (
  id TEXT PRIMARY KEY,
  insight_id TEXT NOT NULL REFERENCES analysis_insights(id) ON DELETE CASCADE,
  target_kind TEXT NOT NULL CHECK (target_kind IN ('project', 'requirement', 'experiment')),
  target_id TEXT NOT NULL,
  target_version_id TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL,
  UNIQUE (insight_id, target_kind, target_id, target_version_id)
);

CREATE INDEX IF NOT EXISTS idx_analysis_insights_project
  ON analysis_insights(project_id, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_analysis_insights_run
  ON analysis_insights(analysis_run_id);
CREATE INDEX IF NOT EXISTS idx_analysis_insight_links_target
  ON analysis_insight_links(target_kind, target_id, target_version_id);
