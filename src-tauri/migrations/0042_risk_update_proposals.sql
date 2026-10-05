CREATE TABLE agent_tool_proposals_v2 (
  id TEXT PRIMARY KEY NOT NULL,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  target_type TEXT NOT NULL CHECK (target_type IN ('research_plan', 'project_risk')),
  target_id TEXT NOT NULL,
  agent_run_id TEXT NOT NULL REFERENCES agent_runs(id) ON DELETE CASCADE,
  agent_definition_id TEXT NOT NULL REFERENCES agent_definitions(id),
  tool_key TEXT NOT NULL,
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
  CHECK (
    (target_type = 'research_plan' AND agent_definition_id = 'plan-engineer:v2'
      AND tool_key = 'update_research_plan') OR
    (target_type = 'project_risk' AND agent_definition_id = 'risk-review:v2'
      AND tool_key = 'update_project_risk')
  ),
  UNIQUE (agent_run_id, target_type, target_id, payload_json)
);

INSERT INTO agent_tool_proposals_v2
SELECT id, project_id, target_type, target_id, agent_run_id, agent_definition_id,
       tool_key, expected_target_updated_at, payload_json, evidence_json, rationale,
       status, created_at, updated_at, reviewed_at, executed_at
FROM agent_tool_proposals;

DROP TABLE agent_tool_proposals;
ALTER TABLE agent_tool_proposals_v2 RENAME TO agent_tool_proposals;

CREATE INDEX idx_agent_tool_proposals_project_status
  ON agent_tool_proposals(project_id, status, created_at DESC);

CREATE TRIGGER delete_research_plan_tool_proposals
AFTER DELETE ON research_plans BEGIN
  DELETE FROM agent_tool_proposals
  WHERE target_type = 'research_plan' AND target_id = OLD.id;
END;

CREATE TRIGGER delete_project_risk_tool_proposals
AFTER DELETE ON project_risks BEGIN
  DELETE FROM agent_tool_proposals
  WHERE target_type = 'project_risk' AND target_id = OLD.id;
END;

INSERT INTO agent_definitions
  (id, definition_key, version, name, description, input_schema_version, output_schema_version, permissions_json, created_at)
VALUES
  ('risk-review:v2', 'risk-review', 2, '项目风险缓解提案 Agent v2',
   '只读取当前活动项目未关闭风险，生成结构化缓解字段提案；提案持久化后仅由用户确认的确定性执行器修改允许字段，不改变标题或风险状态。', '2.0.0', '2.0.0',
   '{"dataScope":"current_project_open_risks","allowedTools":["read_project_risks","update_project_risk"],"businessWriteAccess":true,"requiresCitations":true,"proposalOnly":true,"userConfirmationRequired":true}',
   '2026-07-17T00:00:00.000Z');
