INSERT INTO agent_definitions
  (id, definition_key, version, name, description, input_schema_version, output_schema_version, permissions_json, created_at)
VALUES
  ('knowledge-review:v1', 'knowledge-review', 1, '知识管理审阅 Agent',
   '只读审阅当前项目记忆、来源与冲突关系，输出知识缺口和冲突复查建议，不修改业务数据。', '1.0.0', '1.0.0',
   '{"dataScope":"current_project","allowedTools":["read_project_memories","read_project_memory_sources","read_project_memory_conflicts"],"businessWriteAccess":false,"requiresCitations":true}',
   '2026-07-16T00:00:00.000Z');
