INSERT INTO agent_definitions
  (id, definition_key, version, name, description, input_schema_version, output_schema_version, permissions_json, created_at)
VALUES
  ('project-qa:v1', 'project-qa', 1, '首席产品经理项目问答 Agent',
   '只基于当前项目已检索的记忆和来源回答问题，必须引用证据，不写入业务数据。', '1.0.0', '1.0.0',
   '{"dataScope":"current_project","allowedTools":["read_project_business_data","search_project_memories","read_project_memory_sources"],"businessWriteAccess":false,"requiresCitations":true}',
   '2026-07-15T00:00:00.000Z');
