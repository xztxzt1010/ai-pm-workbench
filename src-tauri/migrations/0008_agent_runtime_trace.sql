CREATE TABLE agent_definitions (
  id TEXT PRIMARY KEY NOT NULL,
  definition_key TEXT NOT NULL,
  version INTEGER NOT NULL CHECK (version > 0),
  name TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  input_schema_version TEXT NOT NULL,
  output_schema_version TEXT NOT NULL,
  permissions_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL,
  UNIQUE (definition_key, version)
);

ALTER TABLE agent_runs ADD COLUMN agent_definition_id TEXT REFERENCES agent_definitions(id);
ALTER TABLE agent_runs ADD COLUMN project_id TEXT REFERENCES projects(id) ON DELETE CASCADE;
ALTER TABLE agent_runs ADD COLUMN trace_version INTEGER NOT NULL DEFAULT 1 CHECK (trace_version > 0);
ALTER TABLE agent_runs ADD COLUMN idempotency_key TEXT;
ALTER TABLE agent_runs ADD COLUMN metadata_json TEXT NOT NULL DEFAULT '{}';

CREATE TABLE agent_run_steps (
  id TEXT PRIMARY KEY NOT NULL,
  agent_run_id TEXT NOT NULL REFERENCES agent_runs(id) ON DELETE CASCADE,
  ordinal INTEGER NOT NULL CHECK (ordinal > 0),
  step_type TEXT NOT NULL CHECK (step_type IN ('model_request', 'model_response', 'tool_call', 'tool_result', 'validation')),
  status TEXT NOT NULL CHECK (status IN ('queued', 'running', 'succeeded', 'failed', 'cancelled')),
  duration_ms INTEGER,
  input_tokens INTEGER,
  output_tokens INTEGER,
  detail_json TEXT NOT NULL DEFAULT '{}',
  error_code TEXT,
  error_summary TEXT,
  created_at TEXT NOT NULL,
  completed_at TEXT,
  UNIQUE (agent_run_id, ordinal)
);

CREATE TABLE agent_run_messages (
  id TEXT PRIMARY KEY NOT NULL,
  agent_run_id TEXT NOT NULL REFERENCES agent_runs(id) ON DELETE CASCADE,
  ordinal INTEGER NOT NULL CHECK (ordinal > 0),
  role TEXT NOT NULL CHECK (role IN ('system', 'user', 'assistant', 'tool')),
  content_summary TEXT NOT NULL DEFAULT '',
  content_hash TEXT NOT NULL,
  token_count INTEGER,
  created_at TEXT NOT NULL,
  UNIQUE (agent_run_id, ordinal)
);

CREATE INDEX idx_agent_runs_idempotency ON agent_runs(idempotency_key, created_at DESC);
CREATE INDEX idx_agent_runs_project_created ON agent_runs(project_id, created_at DESC);
CREATE INDEX idx_agent_run_steps_run ON agent_run_steps(agent_run_id, ordinal);
CREATE INDEX idx_agent_run_messages_run ON agent_run_messages(agent_run_id, ordinal);

INSERT INTO agent_definitions
  (id, definition_key, version, name, description, input_schema_version, output_schema_version, permissions_json, created_at)
VALUES
  ('meeting-requirement-analyst:v1', 'meeting-requirement-analyst', 1, '会议需求分析师',
   '只读当前项目会议段落，输出结构化分析草稿，不写正式业务数据。', '1.0.0', '1.0.0',
   '{"dataScope":"current_project_meeting","allowedTools":["read_current_meeting_paragraphs"],"businessWriteAccess":false}',
   '2026-07-15T00:00:00.000Z');
