INSERT INTO agent_definitions
  (id, definition_key, version, name, description, input_schema_version, output_schema_version, permissions_json, created_at)
VALUES
  ('prd-agent:v1', 'prd-agent', 1, 'PRD 草稿 Agent',
   '只使用当前项目已确认需求生成 Markdown 草稿预览，不写入或确认产品文档。', '1.0.0', '1.0.0',
   '{"dataScope":"current_project_confirmed_requirements","allowedTools":["read_confirmed_requirements"],"businessWriteAccess":false,"requiresCitations":true}',
   '2026-07-15T00:00:00.000Z');
