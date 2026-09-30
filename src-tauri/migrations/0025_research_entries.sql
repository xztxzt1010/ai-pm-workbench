CREATE TABLE IF NOT EXISTS research_entries (
  id TEXT PRIMARY KEY NOT NULL,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  research_type TEXT NOT NULL CHECK (research_type IN ('interview', 'survey', 'desk', 'observation')),
  title TEXT NOT NULL,
  source_ref TEXT NOT NULL,
  accessed_at TEXT NOT NULL,
  insight TEXT NOT NULL,
  persona_suggestion TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_research_entries_project_updated ON research_entries(project_id, updated_at DESC);
