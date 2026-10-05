INSERT INTO agent_definitions
  (id, definition_key, version, name, description, input_schema_version, output_schema_version, permissions_json, created_at)
VALUES
  ('competitor-review:v1', 'competitor-review', 1, '竞品档案审阅 Agent',
   '只读取当前活动项目已保存且带来源的竞品档案，生成字段级精确引用的比较和研究缺口预览，不联网补写事实、不修改档案或创建需求。', '1.0.0', '1.0.0',
   '{"dataScope":"current_project_competitor_profiles","allowedTools":["read_competitor_profiles"],"businessWriteAccess":false,"requiresCitations":true,"proposalOnly":true,"externalSearchAccess":false}',
   '2026-07-16T00:00:00.000Z');
