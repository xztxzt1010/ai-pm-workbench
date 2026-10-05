INSERT INTO agent_definitions
  (id, definition_key, version, name, description, input_schema_version, output_schema_version, permissions_json, created_at)
VALUES
  ('research-insight:v1', 'research-insight', 1, '用户研究洞察 Agent',
   '只读取当前项目提供的研究记录，生成带精确证据引用的洞察草稿，不接受洞察、不创建候选或正式需求。', '1.0.0', '1.0.0',
   '{"dataScope":"current_project_research_entries","allowedTools":["read_research_entries"],"businessWriteAccess":false,"requiresCitations":true,"proposalOnly":true}',
   '2026-07-16T00:00:00.000Z');
