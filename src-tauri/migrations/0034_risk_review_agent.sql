INSERT INTO agent_definitions
  (id, definition_key, version, name, description, input_schema_version, output_schema_version, permissions_json, created_at)
VALUES
  ('risk-review:v1', 'risk-review', 1, '项目风险审阅 Agent',
   '只读取当前活动项目已保存且未关闭的风险，生成带字段级精确引用的缓解建议预览，不修改风险状态或执行缓解措施。', '1.0.0', '1.0.0',
   '{"dataScope":"current_project_open_risks","allowedTools":["read_project_risks"],"businessWriteAccess":false,"requiresCitations":true,"proposalOnly":true}',
   '2026-07-16T00:00:00.000Z');
