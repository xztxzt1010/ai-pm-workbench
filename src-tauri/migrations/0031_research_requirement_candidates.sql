CREATE TABLE IF NOT EXISTS research_requirement_candidates (
  id TEXT PRIMARY KEY NOT NULL,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  insight_id TEXT NOT NULL REFERENCES research_insights(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  description TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'accepted', 'rejected')),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(project_id, insight_id)
);
CREATE INDEX IF NOT EXISTS idx_research_requirement_candidates_project_updated ON research_requirement_candidates(project_id, updated_at DESC);
