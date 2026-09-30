CREATE TABLE IF NOT EXISTS project_risks (
  id TEXT PRIMARY KEY NOT NULL,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  description TEXT NOT NULL,
  severity TEXT NOT NULL CHECK (severity IN ('low', 'medium', 'high', 'critical')),
  probability TEXT NOT NULL CHECK (probability IN ('unlikely', 'possible', 'likely')),
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'mitigated', 'accepted', 'closed')),
  owner TEXT NOT NULL,
  due_date TEXT NOT NULL,
  mitigation TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_project_risks_project_updated ON project_risks(project_id, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_project_risks_due_date ON project_risks(project_id, due_date);
