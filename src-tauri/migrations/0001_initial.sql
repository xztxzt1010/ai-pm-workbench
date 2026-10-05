PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS projects (
  id TEXT PRIMARY KEY NOT NULL,
  name TEXT NOT NULL,
  goal TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL CHECK (status IN ('planning', 'active', 'paused', 'completed')),
  start_date TEXT,
  end_date TEXT,
  progress INTEGER NOT NULL DEFAULT 0 CHECK (progress BETWEEN 0 AND 100),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS milestones (
  id TEXT PRIMARY KEY NOT NULL,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  due_date TEXT NOT NULL,
  progress INTEGER NOT NULL DEFAULT 0 CHECK (progress BETWEEN 0 AND 100),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS confirmation_items (
  id TEXT PRIMARY KEY NOT NULL,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  milestone_id TEXT REFERENCES milestones(id) ON DELETE SET NULL,
  title TEXT NOT NULL,
  due_date TEXT NOT NULL,
  due_time TEXT,
  priority TEXT NOT NULL CHECK (priority IN ('high', 'medium', 'low')),
  status TEXT NOT NULL CHECK (status IN ('pending', 'confirmed', 'postponed', 'cancelled')),
  conclusion TEXT,
  notes TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS meetings (
  id TEXT PRIMARY KEY NOT NULL,
  project_id TEXT REFERENCES projects(id) ON DELETE SET NULL,
  title TEXT NOT NULL,
  meeting_date TEXT NOT NULL,
  participants_json TEXT NOT NULL DEFAULT '[]',
  status TEXT NOT NULL CHECK (status IN ('pending_import', 'parsed', 'pending_analysis', 'analyzing', 'pending_confirmation', 'completed', 'failed')),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS meeting_sources (
  id TEXT PRIMARY KEY NOT NULL,
  meeting_id TEXT NOT NULL REFERENCES meetings(id) ON DELETE CASCADE,
  source_type TEXT NOT NULL CHECK (source_type IN ('paste', 'txt', 'md', 'docx')),
  file_name TEXT,
  file_path TEXT,
  content_hash TEXT NOT NULL,
  parsed_text TEXT NOT NULL,
  byte_size INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS requirement_cards (
  id TEXT PRIMARY KEY NOT NULL,
  meeting_id TEXT NOT NULL REFERENCES meetings(id) ON DELETE CASCADE,
  project_id TEXT REFERENCES projects(id) ON DELETE SET NULL,
  current_version_id TEXT,
  title TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('draft', 'pending_confirmation', 'confirmed', 'archived')),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS requirement_versions (
  id TEXT PRIMARY KEY NOT NULL,
  requirement_card_id TEXT NOT NULL REFERENCES requirement_cards(id) ON DELETE CASCADE,
  version_number INTEGER NOT NULL,
  content_json TEXT NOT NULL,
  evidence_json TEXT NOT NULL DEFAULT '[]',
  source TEXT NOT NULL CHECK (source IN ('ai', 'user')),
  is_confirmed INTEGER NOT NULL DEFAULT 0 CHECK (is_confirmed IN (0, 1)),
  created_at TEXT NOT NULL,
  UNIQUE (requirement_card_id, version_number)
);

CREATE TABLE IF NOT EXISTS notifications (
  id TEXT PRIMARY KEY NOT NULL,
  confirmation_item_id TEXT REFERENCES confirmation_items(id) ON DELETE CASCADE,
  scheduled_at TEXT NOT NULL,
  delivered_at TEXT,
  status TEXT NOT NULL CHECK (status IN ('scheduled', 'delivered', 'skipped', 'failed')),
  deduplication_key TEXT NOT NULL UNIQUE,
  error_summary TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS agent_runs (
  id TEXT PRIMARY KEY NOT NULL,
  run_type TEXT NOT NULL,
  entity_id TEXT,
  provider_mode TEXT NOT NULL,
  model TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('queued', 'running', 'succeeded', 'failed', 'cancelled')),
  duration_ms INTEGER,
  input_tokens INTEGER,
  output_tokens INTEGER,
  error_code TEXT,
  error_summary TEXT,
  created_at TEXT NOT NULL,
  completed_at TEXT
);

CREATE TABLE IF NOT EXISTS app_settings (
  key TEXT PRIMARY KEY NOT NULL,
  value_json TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_milestones_project_due ON milestones(project_id, due_date);
CREATE INDEX IF NOT EXISTS idx_confirmation_due_status ON confirmation_items(due_date, status);
CREATE INDEX IF NOT EXISTS idx_confirmation_project ON confirmation_items(project_id);
CREATE INDEX IF NOT EXISTS idx_meetings_project_date ON meetings(project_id, meeting_date);
CREATE INDEX IF NOT EXISTS idx_requirement_cards_meeting ON requirement_cards(meeting_id);
CREATE INDEX IF NOT EXISTS idx_notifications_schedule ON notifications(status, scheduled_at);
