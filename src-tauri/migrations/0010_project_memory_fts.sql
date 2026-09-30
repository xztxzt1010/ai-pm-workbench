CREATE TABLE project_memories (
  id TEXT PRIMARY KEY NOT NULL,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  memory_type TEXT NOT NULL CHECK (memory_type IN ('formal_fact', 'confirmed_memory', 'pending_candidate', 'inference', 'temporary_context')),
  status TEXT NOT NULL CHECK (status IN ('pending', 'confirmed', 'rejected', 'expired', 'archived')),
  title TEXT NOT NULL,
  content TEXT NOT NULL,
  source_kind TEXT NOT NULL CHECK (source_kind IN ('project', 'meeting', 'requirement', 'manual', 'agent')),
  source_id TEXT,
  source_locator_json TEXT NOT NULL DEFAULT '{}',
  valid_from TEXT,
  valid_until TEXT,
  conflict_group TEXT,
  confidence REAL CHECK (confidence IS NULL OR (confidence >= 0 AND confidence <= 1)),
  created_by TEXT NOT NULL CHECK (created_by IN ('user', 'agent', 'system')),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE project_memory_sources (
  id TEXT PRIMARY KEY NOT NULL,
  memory_id TEXT NOT NULL REFERENCES project_memories(id) ON DELETE CASCADE,
  source_kind TEXT NOT NULL CHECK (source_kind IN ('project', 'meeting', 'requirement', 'manual', 'agent')),
  source_id TEXT,
  locator_json TEXT NOT NULL DEFAULT '{}',
  quote TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE project_memory_conflicts (
  memory_id TEXT NOT NULL REFERENCES project_memories(id) ON DELETE CASCADE,
  conflicts_with_memory_id TEXT NOT NULL REFERENCES project_memories(id) ON DELETE CASCADE,
  relation_type TEXT NOT NULL CHECK (relation_type IN ('conflicts', 'supersedes')),
  created_at TEXT NOT NULL,
  PRIMARY KEY (memory_id, conflicts_with_memory_id),
  CHECK (memory_id <> conflicts_with_memory_id)
);

CREATE INDEX idx_project_memories_project_status ON project_memories(project_id, status, updated_at DESC);
CREATE INDEX idx_project_memories_project_type ON project_memories(project_id, memory_type, updated_at DESC);
CREATE INDEX idx_project_memory_sources_memory ON project_memory_sources(memory_id, created_at);
CREATE INDEX idx_project_memory_conflicts_target ON project_memory_conflicts(conflicts_with_memory_id);

CREATE VIRTUAL TABLE project_memory_fts USING fts5(
  id UNINDEXED,
  project_id UNINDEXED,
  title,
  content,
  content='project_memories',
  content_rowid='rowid',
  tokenize='unicode61'
);

CREATE TRIGGER project_memories_ai AFTER INSERT ON project_memories BEGIN
  INSERT INTO project_memory_fts(rowid, id, project_id, title, content)
  VALUES (new.rowid, new.id, new.project_id, new.title, new.content);
END;

CREATE TRIGGER project_memories_ad AFTER DELETE ON project_memories BEGIN
  INSERT INTO project_memory_fts(project_memory_fts, rowid, id, project_id, title, content)
  VALUES ('delete', old.rowid, old.id, old.project_id, old.title, old.content);
END;

CREATE TRIGGER project_memories_au AFTER UPDATE ON project_memories BEGIN
  INSERT INTO project_memory_fts(project_memory_fts, rowid, id, project_id, title, content)
  VALUES ('delete', old.rowid, old.id, old.project_id, old.title, old.content);
  INSERT INTO project_memory_fts(rowid, id, project_id, title, content)
  VALUES (new.rowid, new.id, new.project_id, new.title, new.content);
END;
