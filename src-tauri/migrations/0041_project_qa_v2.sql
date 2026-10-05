INSERT INTO agent_definitions
  (id, definition_key, version, name, description, input_schema_version, output_schema_version, permissions_json, created_at)
VALUES
  ('project-qa:v2', 'project-qa', 2, '首席产品经理多源项目问答 Agent',
   '只读取当前活动项目的项目事实、记忆、里程碑、确认事项、风险、依赖、发布和研究记录；后端逐条复核完整证据快照，回答必须引用且不写业务数据。', '2.0.0', '1.0.0',
   '{"dataScope":"current_project","allowedTools":["read_project_business_data","search_project_memories","read_project_memory_sources","read_project_milestones","read_project_confirmations","read_project_risks","read_project_dependencies","read_project_releases","read_research_entries"],"businessWriteAccess":false,"requiresCitations":true}',
   '2026-07-17T00:00:00.000Z');
