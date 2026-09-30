CREATE TABLE product_documents (
  id TEXT PRIMARY KEY NOT NULL,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  document_type TEXT NOT NULL CHECK (document_type IN ('prd', 'design_brief', 'markdown')),
  status TEXT NOT NULL CHECK (status IN ('draft', 'confirmed', 'archived')),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE product_document_versions (
  id TEXT PRIMARY KEY NOT NULL,
  document_id TEXT NOT NULL REFERENCES product_documents(id) ON DELETE CASCADE,
  version_number INTEGER NOT NULL CHECK (version_number > 0),
  content_markdown TEXT NOT NULL,
  source_json TEXT NOT NULL DEFAULT '[]',
  change_summary TEXT NOT NULL DEFAULT '',
  created_by TEXT NOT NULL CHECK (created_by IN ('user', 'agent')),
  created_at TEXT NOT NULL,
  UNIQUE (document_id, version_number)
);

CREATE INDEX idx_product_documents_project_status ON product_documents(project_id, status, updated_at DESC);
CREATE INDEX idx_product_document_versions_document ON product_document_versions(document_id, version_number DESC);
