INSERT INTO agent_definitions
  (id, definition_key, version, name, description, input_schema_version, output_schema_version, permissions_json, created_at)
VALUES
  ('research-plan-review:v1', 'research-plan-review', 1, '研究计划审阅 Agent',
   '只读取当前活动项目未取消研究计划及其已关联研究结果，生成目标、画像、提纲、排期和覆盖缺口建议，不修改计划或创建研究记录。', '1.0.0', '1.0.0',
   '{"dataScope":"current_project_research_plans","allowedTools":["read_research_plans","read_linked_research_entries"],"businessWriteAccess":false,"requiresCitations":true,"proposalOnly":true}',
   '2026-07-16T00:00:00.000Z');
