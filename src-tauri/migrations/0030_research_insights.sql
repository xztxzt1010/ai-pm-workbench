CREATE TABLE IF NOT EXISTS research_insights (
  id TEXT PRIMARY KEY NOT NULL,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  plan_id TEXT REFERENCES research_plans(id) ON DELETE SET NULL,
  entry_id TEXT NOT NULL REFERENCES research_entries(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  statement TEXT NOT NULL,
  evidence_json TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'accepted', 'rejected')),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_research_insights_project_updated ON research_insights(project_id, updated_at DESC);
