INSERT INTO agent_definitions
  (id, definition_key, version, name, description, input_schema_version, output_schema_version, permissions_json, created_at)
VALUES
  ('release-review:v1', 'release-review', 1, '发布与复盘审阅 Agent',
   '只读取当前活动项目未取消的发布记录，生成带字段级精确引用的准备度与复盘缺口预览，不修改发布状态或执行发布。', '1.0.0', '1.0.0',
   '{"dataScope":"current_project_releases","allowedTools":["read_project_releases"],"businessWriteAccess":false,"requiresCitations":true,"proposalOnly":true}',
   '2026-07-16T00:00:00.000Z');
