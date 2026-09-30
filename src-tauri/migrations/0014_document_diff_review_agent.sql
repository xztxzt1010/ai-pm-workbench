INSERT INTO agent_definitions
  (id, definition_key, version, name, description, input_schema_version, output_schema_version, permissions_json, created_at)
VALUES
  ('document-diff-reviewer:v1', 'document-diff-reviewer', 1, '文档差异审阅 Agent',
   '只读取当前项目中由确定性算法计算的产品文档差异，返回带精确行索引引用的风险审阅预览，不修改文档。', '1.0.0', '1.0.0',
   '{"dataScope":"current_project_document_diff","allowedTools":[],"businessWriteAccess":false,"requiresCitations":true}',
   '2026-07-15T00:00:00.000Z');
