INSERT INTO agent_definitions
  (id, definition_key, version, name, description, input_schema_version, output_schema_version, permissions_json, created_at)
VALUES
  ('analysis-explainer:v1', 'analysis-explainer', 1, '数据分析解释 Agent',
   '只读取当前项目已保存的分析运行，解释真实计算结果并逐条引用结果路径，不写入业务数据。', '1.0.0', '1.0.0',
   '{"dataScope":"current_project_analysis_run","allowedTools":["read_analysis_run"],"businessWriteAccess":false,"requiresCitations":true,"numbersMustMatchEvidence":true}',
   '2026-07-16T00:00:00.000Z');
