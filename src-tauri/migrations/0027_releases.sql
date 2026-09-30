CREATE TABLE IF NOT EXISTS releases (
  id TEXT PRIMARY KEY NOT NULL,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  scope_json TEXT NOT NULL,
  checklist_json TEXT NOT NULL,
  rollback_plan TEXT NOT NULL,
  result TEXT NOT NULL,
  retrospective TEXT NOT NULL,
  follow_up_json TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'planned' CHECK (status IN ('planned', 'ready', 'released', 'reviewed', 'cancelled')),
  target_date TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_releases_project_updated ON releases(project_id, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_releases_target_date ON releases(project_id, target_date);
