INSERT INTO agent_definitions
  (id, definition_key, version, name, description, input_schema_version, output_schema_version, permissions_json, created_at)
VALUES
  ('plan-engineer:v1', 'plan-engineer', 1, '研究计划工程师 Agent',
   '只读检查当前项目研究计划及其关联结果，提出范围、问题、排期和覆盖缺口建议，不修改计划或创建研究记录。', '1.0.0', '1.0.0',
   '{"dataScope":"current_project_research_plans","allowedTools":["read_research_plans","read_linked_research_entries"],"businessWriteAccess":false,"requiresCitations":true,"proposalOnly":true}',
   '2026-07-16T00:00:00.000Z');
