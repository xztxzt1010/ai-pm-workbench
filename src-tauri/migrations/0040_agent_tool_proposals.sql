CREATE TABLE agent_tool_proposals (
  id TEXT PRIMARY KEY NOT NULL,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  target_type TEXT NOT NULL CHECK (target_type = 'research_plan'),
  target_id TEXT NOT NULL REFERENCES research_plans(id) ON DELETE CASCADE,
  agent_run_id TEXT NOT NULL REFERENCES agent_runs(id) ON DELETE CASCADE,
  agent_definition_id TEXT NOT NULL REFERENCES agent_definitions(id),
  tool_key TEXT NOT NULL CHECK (tool_key = 'update_research_plan'),
  expected_target_updated_at TEXT NOT NULL,
  payload_json TEXT NOT NULL CHECK (json_valid(payload_json) AND json_type(payload_json) = 'object'),
  evidence_json TEXT NOT NULL CHECK (json_valid(evidence_json) AND json_type(evidence_json) = 'array'),
  rationale TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending_confirmation'
    CHECK (status IN ('pending_confirmation', 'executed', 'rejected', 'stale')),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  reviewed_at TEXT,
  executed_at TEXT,
  UNIQUE (agent_run_id, target_id, payload_json)
);

CREATE INDEX idx_agent_tool_proposals_project_status
  ON agent_tool_proposals(project_id, status, created_at DESC);

INSERT INTO agent_definitions
  (id, definition_key, version, name, description, input_schema_version, output_schema_version, permissions_json, created_at)
VALUES
  ('plan-engineer:v2', 'plan-engineer', 2, '研究计划工程师 Agent v2',
   '基于当前项目研究计划快照生成结构化字段变更提案；提案先持久化，只有用户确认后确定性执行器才能修改目标、画像、提纲或日期。', '2.0.0', '2.0.0',
   '{"dataScope":"current_project_research_plans","allowedTools":["read_research_plans","read_linked_research_entries","update_research_plan"],"businessWriteAccess":true,"requiresCitations":true,"proposalOnly":true,"userConfirmationRequired":true}',
   '2026-07-17T00:00:00.000Z');
