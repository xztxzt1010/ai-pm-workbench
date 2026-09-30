CREATE TABLE knowledge_items (
  id TEXT PRIMARY KEY NOT NULL,
  item_type TEXT NOT NULL CHECK (item_type IN (
    'meeting_record',
    'technical_discussion',
    'product_idea',
    'ai_learning',
    'project_decision'
  )),
  status TEXT NOT NULL CHECK (status IN ('draft', 'confirmed', 'archived')),
  domain TEXT NOT NULL CHECK (domain IN ('project', 'personal', 'company', 'team')),
  project_id TEXT REFERENCES projects(id) ON DELETE CASCADE,
  scope_id TEXT,
  title TEXT NOT NULL CHECK (length(trim(title)) BETWEEN 1 AND 200),
  content_markdown TEXT NOT NULL DEFAULT '',
  target_kind TEXT CHECK (target_kind IS NULL OR target_kind IN ('meeting', 'product_decision')),
  target_id TEXT,
  target_version TEXT,
  content_version INTEGER NOT NULL DEFAULT 1 CHECK (content_version > 0),
  created_by TEXT NOT NULL CHECK (created_by IN ('user', 'agent', 'system')),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  confirmed_at TEXT,
  archived_at TEXT,
  archived_from_status TEXT CHECK (archived_from_status IS NULL OR archived_from_status IN ('draft', 'confirmed')),
  CHECK (
    (domain = 'project' AND project_id IS NOT NULL AND scope_id IS NULL) OR
    (domain = 'personal' AND project_id IS NULL AND scope_id IS NULL) OR
    (domain IN ('company', 'team') AND project_id IS NULL AND scope_id IS NOT NULL)
  ),
  CHECK (
    (item_type = 'meeting_record' AND target_kind = 'meeting' AND target_id IS NOT NULL AND target_version IS NOT NULL AND length(trim(content_markdown)) = 0) OR
    (item_type = 'project_decision' AND target_kind = 'product_decision' AND target_id IS NOT NULL AND target_version IS NOT NULL AND length(trim(content_markdown)) = 0) OR
    (item_type IN ('technical_discussion', 'product_idea', 'ai_learning') AND target_kind IS NULL AND target_id IS NULL AND target_version IS NULL AND length(trim(content_markdown)) > 0)
  ),
  CHECK (created_by <> 'agent' OR status = 'draft'),
  CHECK (status <> 'confirmed' OR confirmed_at IS NOT NULL),
  CHECK (status <> 'draft' OR confirmed_at IS NULL),
  CHECK (
    (status = 'archived' AND archived_at IS NOT NULL AND archived_from_status IS NOT NULL) OR
    (status <> 'archived' AND archived_at IS NULL AND archived_from_status IS NULL)
  )
);

CREATE UNIQUE INDEX idx_knowledge_items_target
  ON knowledge_items(target_kind, target_id)
  WHERE target_kind IS NOT NULL;
CREATE INDEX idx_knowledge_items_project_status
  ON knowledge_items(project_id, status, updated_at DESC)
  WHERE domain = 'project';
CREATE INDEX idx_knowledge_items_personal_status
  ON knowledge_items(status, updated_at DESC)
  WHERE domain = 'personal';
CREATE INDEX idx_knowledge_items_type_status
  ON knowledge_items(item_type, status, updated_at DESC);

CREATE TABLE knowledge_sources (
  id TEXT PRIMARY KEY NOT NULL,
  item_id TEXT NOT NULL REFERENCES knowledge_items(id) ON DELETE CASCADE,
  source_kind TEXT NOT NULL CHECK (source_kind IN (
    'manual',
    'markdown',
    'meeting',
    'product_document',
    'product_decision',
    'research_entry',
    'project_memory',
    'external_url'
  )),
  source_ref TEXT NOT NULL CHECK (length(trim(source_ref)) BETWEEN 1 AND 1000),
  source_version TEXT NOT NULL CHECK (length(trim(source_version)) BETWEEN 1 AND 200),
  content_hash TEXT NOT NULL CHECK (length(content_hash) = 64 AND content_hash = lower(content_hash)),
  title TEXT NOT NULL CHECK (length(trim(title)) BETWEEN 1 AND 200),
  locator_json TEXT NOT NULL DEFAULT '{}' CHECK (json_valid(locator_json) AND json_type(locator_json) = 'object'),
  captured_at TEXT NOT NULL,
  created_at TEXT NOT NULL,
  UNIQUE (item_id, source_kind, source_ref, source_version)
);

CREATE INDEX idx_knowledge_sources_item
  ON knowledge_sources(item_id, created_at, id);
CREATE INDEX idx_knowledge_sources_ref_version
  ON knowledge_sources(source_kind, source_ref, source_version);

CREATE TABLE knowledge_relations (
  id TEXT PRIMARY KEY NOT NULL,
  from_item_id TEXT NOT NULL REFERENCES knowledge_items(id) ON DELETE CASCADE,
  to_item_id TEXT NOT NULL REFERENCES knowledge_items(id) ON DELETE CASCADE,
  relation_type TEXT NOT NULL CHECK (relation_type IN (
    'derived_from',
    'supports',
    'contradicts',
    'relates_to',
    'supersedes'
  )),
  status TEXT NOT NULL CHECK (status IN ('draft', 'confirmed', 'rejected')),
  evidence_json TEXT NOT NULL DEFAULT '[]' CHECK (json_valid(evidence_json) AND json_type(evidence_json) = 'array'),
  created_by TEXT NOT NULL CHECK (created_by IN ('user', 'agent', 'system')),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  confirmed_at TEXT,
  CHECK (from_item_id <> to_item_id),
  CHECK (created_by <> 'agent' OR status = 'draft'),
  CHECK ((status = 'confirmed') = (confirmed_at IS NOT NULL)),
  UNIQUE (from_item_id, to_item_id, relation_type)
);

CREATE INDEX idx_knowledge_relations_from
  ON knowledge_relations(from_item_id, status, relation_type);
CREATE INDEX idx_knowledge_relations_to
  ON knowledge_relations(to_item_id, status, relation_type);

CREATE TRIGGER knowledge_items_validate_adapter_before_insert
BEFORE INSERT ON knowledge_items
WHEN new.item_type IN ('meeting_record', 'project_decision')
BEGIN
  SELECT CASE
    WHEN new.item_type = 'meeting_record' AND NOT EXISTS (
      SELECT 1 FROM meetings meeting
      JOIN meeting_sources source ON source.meeting_id = meeting.id
      WHERE meeting.id = new.target_id AND source.content_hash = new.target_version
        AND ((new.domain = 'personal' AND meeting.project_id IS NULL)
          OR (new.domain = 'project' AND meeting.project_id = new.project_id))
    ) THEN RAISE(ABORT, 'knowledge meeting target mismatch')
    WHEN new.item_type = 'project_decision' AND NOT EXISTS (
      SELECT 1 FROM product_decisions decision
      WHERE decision.id = new.target_id AND decision.project_id = new.project_id
        AND new.domain = 'project'
        AND CAST(decision.current_version_number AS TEXT) = new.target_version
    ) THEN RAISE(ABORT, 'knowledge decision target mismatch')
  END;
END;

CREATE TRIGGER knowledge_items_validate_adapter_before_update
BEFORE UPDATE OF item_type, domain, project_id, target_kind, target_id, target_version ON knowledge_items
WHEN new.item_type IN ('meeting_record', 'project_decision')
BEGIN
  SELECT CASE
    WHEN new.item_type = 'meeting_record' AND NOT EXISTS (
      SELECT 1 FROM meetings meeting
      JOIN meeting_sources source ON source.meeting_id = meeting.id
      WHERE meeting.id = new.target_id AND source.content_hash = new.target_version
        AND ((new.domain = 'personal' AND meeting.project_id IS NULL)
          OR (new.domain = 'project' AND meeting.project_id = new.project_id))
    ) THEN RAISE(ABORT, 'knowledge meeting target mismatch')
    WHEN new.item_type = 'project_decision' AND NOT EXISTS (
      SELECT 1 FROM product_decisions decision
      WHERE decision.id = new.target_id AND decision.project_id = new.project_id
        AND new.domain = 'project'
        AND CAST(decision.current_version_number AS TEXT) = new.target_version
    ) THEN RAISE(ABORT, 'knowledge decision target mismatch')
  END;
END;

CREATE TRIGGER knowledge_relations_validate_scope_before_insert
BEFORE INSERT ON knowledge_relations
WHEN NOT EXISTS (
  SELECT 1 FROM knowledge_items from_item
  JOIN knowledge_items to_item ON to_item.id = new.to_item_id
  WHERE from_item.id = new.from_item_id
    AND from_item.domain = to_item.domain
    AND from_item.project_id IS to_item.project_id
    AND from_item.scope_id IS to_item.scope_id
)
BEGIN
  SELECT RAISE(ABORT, 'knowledge relation scope mismatch');
END;

CREATE TRIGGER knowledge_relations_validate_scope_before_update
BEFORE UPDATE OF from_item_id, to_item_id ON knowledge_relations
WHEN NOT EXISTS (
  SELECT 1 FROM knowledge_items from_item
  JOIN knowledge_items to_item ON to_item.id = new.to_item_id
  WHERE from_item.id = new.from_item_id
    AND from_item.domain = to_item.domain
    AND from_item.project_id IS to_item.project_id
    AND from_item.scope_id IS to_item.scope_id
)
BEGIN
  SELECT RAISE(ABORT, 'knowledge relation scope mismatch');
END;

CREATE TRIGGER meetings_delete_knowledge_adapter
AFTER DELETE ON meetings
BEGIN
  DELETE FROM knowledge_items WHERE target_kind = 'meeting' AND target_id = old.id;
END;

CREATE TRIGGER meeting_sources_delete_knowledge_adapter_version
AFTER DELETE ON meeting_sources
BEGIN
  DELETE FROM knowledge_items
   WHERE target_kind = 'meeting' AND target_id = old.meeting_id
     AND target_version = old.content_hash;
END;

CREATE TRIGGER product_decisions_delete_knowledge_adapter
AFTER DELETE ON product_decisions
BEGIN
  DELETE FROM knowledge_items WHERE target_kind = 'product_decision' AND target_id = old.id;
END;

CREATE TABLE knowledge_index_events (
  sequence INTEGER PRIMARY KEY AUTOINCREMENT,
  item_id TEXT NOT NULL,
  source_id TEXT,
  domain TEXT NOT NULL CHECK (domain IN ('project', 'personal', 'company', 'team')),
  project_id TEXT,
  event_type TEXT NOT NULL CHECK (event_type IN (
    'upsert',
    'delete',
    'archive',
    'source_version_changed',
    'relation_changed'
  )),
  content_version INTEGER NOT NULL CHECK (content_version > 0),
  created_at TEXT NOT NULL,
  processed_at TEXT
);

CREATE INDEX idx_knowledge_index_events_pending
  ON knowledge_index_events(processed_at, sequence);
CREATE INDEX idx_knowledge_index_events_item
  ON knowledge_index_events(item_id, sequence DESC);

CREATE TRIGGER knowledge_items_index_after_insert
AFTER INSERT ON knowledge_items
BEGIN
  INSERT INTO knowledge_index_events
    (item_id, domain, project_id, event_type, content_version, created_at)
  VALUES
    (new.id, new.domain, new.project_id,
     CASE WHEN new.status = 'archived' THEN 'archive' ELSE 'upsert' END,
     new.content_version, strftime('%Y-%m-%dT%H:%M:%fZ', 'now'));
END;

CREATE TRIGGER knowledge_items_index_after_update
AFTER UPDATE OF title, content_markdown, status, domain, project_id, target_version, content_version ON knowledge_items
BEGIN
  INSERT INTO knowledge_index_events
    (item_id, domain, project_id, event_type, content_version, created_at)
  VALUES
    (new.id, new.domain, new.project_id,
     CASE WHEN new.status = 'archived' THEN 'archive' ELSE 'upsert' END,
     new.content_version, strftime('%Y-%m-%dT%H:%M:%fZ', 'now'));
END;

CREATE TRIGGER knowledge_items_index_before_delete
BEFORE DELETE ON knowledge_items
BEGIN
  INSERT INTO knowledge_index_events
    (item_id, domain, project_id, event_type, content_version, created_at)
  VALUES
    (old.id, old.domain, old.project_id, 'delete', old.content_version,
     strftime('%Y-%m-%dT%H:%M:%fZ', 'now'));
END;

CREATE TRIGGER knowledge_sources_index_after_insert
AFTER INSERT ON knowledge_sources
BEGIN
  INSERT INTO knowledge_index_events
    (item_id, source_id, domain, project_id, event_type, content_version, created_at)
  SELECT item.id, new.id, item.domain, item.project_id, 'source_version_changed',
         item.content_version, strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
    FROM knowledge_items item WHERE item.id = new.item_id;
END;

CREATE TRIGGER knowledge_sources_index_after_update
AFTER UPDATE OF source_version, content_hash, locator_json ON knowledge_sources
BEGIN
  INSERT INTO knowledge_index_events
    (item_id, source_id, domain, project_id, event_type, content_version, created_at)
  SELECT item.id, new.id, item.domain, item.project_id, 'source_version_changed',
         item.content_version, strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
    FROM knowledge_items item WHERE item.id = new.item_id;
END;

CREATE TRIGGER knowledge_sources_index_before_delete
BEFORE DELETE ON knowledge_sources
BEGIN
  INSERT INTO knowledge_index_events
    (item_id, source_id, domain, project_id, event_type, content_version, created_at)
  SELECT item.id, old.id, item.domain, item.project_id, 'source_version_changed',
         item.content_version, strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
    FROM knowledge_items item WHERE item.id = old.item_id;
END;

CREATE TRIGGER knowledge_relations_index_after_insert
AFTER INSERT ON knowledge_relations
BEGIN
  INSERT INTO knowledge_index_events
    (item_id, domain, project_id, event_type, content_version, created_at)
  SELECT item.id, item.domain, item.project_id, 'relation_changed', item.content_version,
         strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
    FROM knowledge_items item
   WHERE item.id IN (new.from_item_id, new.to_item_id);
END;

CREATE TRIGGER knowledge_relations_index_after_update
AFTER UPDATE OF status, relation_type, evidence_json ON knowledge_relations
BEGIN
  INSERT INTO knowledge_index_events
    (item_id, domain, project_id, event_type, content_version, created_at)
  SELECT item.id, item.domain, item.project_id, 'relation_changed', item.content_version,
         strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
    FROM knowledge_items item
   WHERE item.id IN (new.from_item_id, new.to_item_id);
END;

CREATE TRIGGER knowledge_relations_index_before_delete
BEFORE DELETE ON knowledge_relations
BEGIN
  INSERT INTO knowledge_index_events
    (item_id, domain, project_id, event_type, content_version, created_at)
  SELECT item.id, item.domain, item.project_id, 'relation_changed', item.content_version,
         strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
    FROM knowledge_items item
   WHERE item.id IN (old.from_item_id, old.to_item_id);
END;
