CREATE TABLE IF NOT EXISTS product_decisions (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  status TEXT NOT NULL CHECK (status IN ('proposed', 'confirmed', 'revisit', 'archived')),
  current_version_number INTEGER NOT NULL CHECK (current_version_number > 0),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS product_decision_versions (
  id TEXT PRIMARY KEY,
  decision_id TEXT NOT NULL REFERENCES product_decisions(id) ON DELETE CASCADE,
  version_number INTEGER NOT NULL CHECK (version_number > 0),
  title TEXT NOT NULL,
  context TEXT NOT NULL,
  decision_text TEXT NOT NULL,
  alternatives_json TEXT NOT NULL,
  evidence_json TEXT NOT NULL,
  objections_json TEXT NOT NULL,
  impact TEXT NOT NULL,
  review_date TEXT NOT NULL,
  created_by TEXT NOT NULL CHECK (created_by IN ('user', 'agent')),
  created_at TEXT NOT NULL,
  UNIQUE (decision_id, version_number)
);

CREATE INDEX IF NOT EXISTS idx_product_decisions_project ON product_decisions(project_id, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_product_decision_review ON product_decision_versions(review_date);
