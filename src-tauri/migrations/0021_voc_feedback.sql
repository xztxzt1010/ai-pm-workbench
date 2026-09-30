CREATE TABLE IF NOT EXISTS voc_feedback (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  content TEXT NOT NULL,
  category TEXT NOT NULL,
  cluster_key TEXT NOT NULL,
  severity TEXT NOT NULL CHECK (severity IN ('low', 'medium', 'high', 'critical')),
  source_type TEXT NOT NULL CHECK (source_type IN ('manual', 'interview', 'survey', 'support', 'import')),
  source_ref TEXT NOT NULL DEFAULT '',
  evidence TEXT NOT NULL DEFAULT '',
  occurred_at TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS voc_requirement_candidates (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  description TEXT NOT NULL,
  feedback_ids_json TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('draft', 'accepted', 'rejected')),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_voc_feedback_project_time ON voc_feedback(project_id, occurred_at DESC);
CREATE INDEX IF NOT EXISTS idx_voc_feedback_cluster ON voc_feedback(project_id, cluster_key);
CREATE INDEX IF NOT EXISTS idx_voc_candidates_project ON voc_requirement_candidates(project_id, updated_at DESC);
