INSERT INTO agent_definitions
  (id, definition_key, version, name, description, input_schema_version, output_schema_version, permissions_json, created_at)
VALUES
  ('provider-diagnostic:v1', 'provider-diagnostic', 1, '模型连接诊断 Agent',
   '仅使用固定合成样本验证结构化输出能力，不读取或写入任何业务数据。', '1.0.0', '1.0.0',
   '{"dataScope":"none","allowedTools":[],"businessWriteAccess":false,"syntheticInputOnly":true}',
   '2026-07-15T00:00:00.000Z');
