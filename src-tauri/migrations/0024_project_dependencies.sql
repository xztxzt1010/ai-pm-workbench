CREATE TABLE IF NOT EXISTS project_dependencies (
  id TEXT PRIMARY KEY NOT NULL,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  description TEXT NOT NULL,
  dependency_type TEXT NOT NULL CHECK (dependency_type IN ('internal', 'external', 'technical', 'approval')),
  owner TEXT NOT NULL,
  due_date TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'blocked', 'ready', 'resolved')),
  resolution TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_project_dependencies_project_updated ON project_dependencies(project_id, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_project_dependencies_due_date ON project_dependencies(project_id, due_date);
