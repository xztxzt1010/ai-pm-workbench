import { existsSync, readFileSync, readdirSync } from "node:fs"
import { join } from "node:path"

const failures = []
const gitignore = readFileSync(".gitignore", "utf8")
for (const pattern of ["*.db", "*.sqlite", "*.sqlite3", ".env"]) if (!gitignore.split(/\r?\n/).includes(pattern)) failures.push(`.gitignore missing ${pattern}`)

const tauri = JSON.parse(readFileSync("src-tauri/tauri.conf.json", "utf8"))
if (!tauri.bundle?.externalBin?.length) failures.push("Tauri externalBin is not configured")
const launcher = readFileSync("scripts/start-workbench.ps1", "utf8")
if (!launcher.includes("127.0.0.1") || launcher.includes("--host 0.0.0.0")) failures.push("workbench launcher is not loopback-only")
const rust = readFileSync("src-tauri/src/lib.rs", "utf8")
const cargo = readFileSync("src-tauri/Cargo.toml", "utf8")
const settingsPage = readFileSync("src/components/settings-page.tsx", "utf8")
const credentialStatus = readFileSync("src/domain/provider-credential-status.ts", "utf8")
const sidecarServer = readFileSync("sidecar/src/server.mjs", "utf8")
const sidecarProcessTests = readFileSync("sidecar/test/process.test.mjs", "utf8")
const sidecarServerTests = readFileSync("sidecar/test/server.test.mjs", "utf8")
const researchSearchAdapter = readFileSync("src/domain/research-search-adapter.ts", "utf8")
const researchSearchService = readFileSync("src/services/research-search-service.ts", "utf8")
const researchSearchSettings = readFileSync("src/domain/research-search-settings.ts", "utf8")
const researchSearchSettingsCard = readFileSync("src/components/research-search-settings-card.tsx", "utf8")
const projectResearchSearchPanel = readFileSync("src/components/project-research-search-panel.tsx", "utf8")
const agentToolAuthorization = readFileSync("src/domain/agent-tool-authorization.ts", "utf8")
const agentOrchestration = readFileSync("src/domain/agent-orchestration.ts", "utf8")
const agentDefinitionPanel = readFileSync("src/components/agent-definition-panel.tsx", "utf8")
const projectAgentOrchestrationPanel = readFileSync("src/components/project-agent-orchestration-panel.tsx", "utf8")
const projectQaDomain = readFileSync("src/domain/project-qa.ts", "utf8")
const projectQaPanel = readFileSync("src/components/project-qa-panel.tsx", "utf8")
const structuredGenerationService = readFileSync("src/services/structured-generation-service.ts", "utf8")
const projectQaV2Migration = readFileSync("src-tauri/migrations/0041_project_qa_v2.sql", "utf8")
const agentToolProposalService = readFileSync("src/services/agent-tool-proposal-service.ts", "utf8")
const researchPlanPanel = readFileSync("src/components/project-research-plan-panel.tsx", "utf8")
const proposalMigration = readFileSync("src-tauri/migrations/0040_agent_tool_proposals.sql", "utf8")
const riskProposalMigration = readFileSync("src-tauri/migrations/0042_risk_update_proposals.sql", "utf8")
const riskRemediationDomain = readFileSync("src/domain/risk-remediation-agent.ts", "utf8")
const projectRiskPanel = readFileSync("src/components/project-risk-panel.tsx", "utf8")
const dependencyProposalMigration = readFileSync("src-tauri/migrations/0043_dependency_update_proposals.sql", "utf8")
const dependencyRemediationDomain = readFileSync("src/domain/dependency-remediation-agent.ts", "utf8")
const projectDependencyPanel = readFileSync("src/components/project-dependency-panel.tsx", "utf8")
const releaseProposalMigration=readFileSync("src-tauri/migrations/0044_release_preparation_proposals.sql","utf8")
const releasePreparationDomain=readFileSync("src/domain/release-preparation-agent.ts","utf8")
const projectReleasePanel=readFileSync("src/components/project-release-panel.tsx","utf8")
const backupContracts = [
  "async fn replace_database_from_backup(",
  "validate_database_file(source).await?",
  "create_consistent_snapshot(database, &rollback)",
  '"snapshot-{}-{}.tmp"',
  "备份目标文件已存在，拒绝覆盖",
  "restore_rejects_corrupt_source_before_touching_current_database",
  "restore_aborts_before_mutation_when_rollback_directory_is_unusable",
  "snapshot_never_overwrites_an_existing_destination",
  "recover_interrupted_database_restore(&database)",
  "interrupted_restore_keeps_valid_current_and_cleans_stale_files",
  "interrupted_restore_prefers_previous_when_switch_was_not_completed",
  "interrupted_restore_aborts_when_every_candidate_is_corrupt",
]
for (const contract of backupContracts) if (!rust.includes(contract)) failures.push(`backup safety contract missing: ${contract}`)
const interruptedRestoreWiring = rust.indexOf("block_on(recover_interrupted_database_restore(&database))")
const migrationBackupWiring = rust.indexOf("create_pre_migration_backup(app", interruptedRestoreWiring)
if (interruptedRestoreWiring < 0 || migrationBackupWiring < interruptedRestoreWiring) failures.push("interrupted restore recovery must run before migration backup and SQLite migrations")
const notificationActivationService = readFileSync("src/services/notification-activation-service.ts", "utf8")
for (const contract of [
  "NotificationActivationState::default()",
  "take_pending_notification_open",
  "notification_activation_queue_is_bounded_and_ordered",
]) if (!rust.includes(contract)) failures.push(`notification activation contract missing: ${contract}`)
for (const contract of [
  'listen("notification-open-item"',
  'invoke<string | null>("take_pending_notification_open")',
  "await drainPending()",
]) if (!notificationActivationService.includes(contract)) failures.push(`notification activation bridge missing: ${contract}`)
for (const contract of [
  "Win32_Storage_FileSystem",
  "GetDiskFreeSpaceExW",
  "DISK_WRITE_RESERVE_BYTES",
  "disk_write_budget_rejects_one_byte_short_with_clear_error",
]) if (!(cargo.includes(contract) || rust.includes(contract))) failures.push(`disk space contract missing: ${contract}`)
if ((rust.match(/ensure_disk_space\(/g) ?? []).length < 5) failures.push("disk space checks must protect meeting attachments, snapshots, restore copies, and backup exports")
for (const contract of [
  "fn provider_credential_account(",
  "fn validate_provider_api_key_value(",
  "fn read_provider_api_key(",
  "fn get_provider_credential_status(",
  "StoredProviderApiKey::Invalid",
  "credential_accounts_are_limited_to_key_bearing_providers",
  "credential_values_require_bounded_visible_ascii",
  "credential_status_distinguishes_missing_invalid_and_valid_values",
]) if (!rust.includes(contract)) failures.push(`credential boundary contract missing: ${contract}`)
if ((rust.match(/\.get_password\(\)/g) ?? []).length !== 1) failures.push("Credential Manager reads must use the centralized validated helper")
if (!rust.includes("set_provider_api_key,\n            get_provider_credential_status,\n            has_provider_api_key,")) failures.push("credential status command is not registered in the Tauri handler")
for (const contract of [
  'invoke<ProviderCredentialStatus>("get_provider_credential_status"',
  "credentialUi.hasStoredCredential",
  "credentialUi.invalid",
]) if (!settingsPage.includes(contract)) failures.push(`credential recovery UI missing: ${contract}`)
for (const contract of ['state === "invalid"', "hasStoredCredential: true", 'state === "unavailable"']) {
  if (!credentialStatus.includes(contract)) failures.push(`credential status presentation missing: ${contract}`)
}
for (const contract of [
  'request.url === "/v1/research/search"',
  "MAX_SEARCH_RESPONSE_BYTES",
  "validResearchSearchEndpoint",
  "search_response_too_large",
  'WIKIPEDIA_ZH_ENDPOINT = "https://zh.wikipedia.org/w/api.php"',
  "WIKIMEDIA_USER_AGENT",
  "RESEARCH_SEARCH_CACHE_TTL_MS",
  "normalizeWikipediaSearchResults",
]) if (!sidecarServer.includes(contract)) failures.push(`research search sidecar boundary missing: ${contract}`)
for (const contract of [
  "fn validated_research_search_endpoint(",
  "fn call_sidecar_research_search(",
  "validate_research_search_result",
  "search_research_sources,",
  "research_search_endpoint_rejects_insecure_or_credentialed_routes",
  "fn validated_research_search_provider(",
  "research_search_provider_is_forwarded_and_bounded",
]) if (!rust.includes(contract)) failures.push(`research search Tauri boundary missing: ${contract}`)
for (const contract of [
  'invoke<ResearchSearchTransportResult[]>("search_research_sources"',
  "validateResearchSearchRequest(request)",
  "normalizeResearchSearchResults(values)",
]) if (!researchSearchService.includes(contract)) failures.push(`research search desktop bridge missing: ${contract}`)
if (/\bfetch\s*\(/.test(researchSearchAdapter) || /\bfetch\s*\(/.test(researchSearchService)) failures.push("research search must not fetch remote endpoints from the WebView")
if (!sidecarProcessTests.includes('/v1/research/search') || !sidecarProcessTests.includes('search-private')) failures.push("research search cross-process smoke test missing")
for (const contract of [
  'provider: "wikipedia_zh"',
  'WIKIPEDIA_ZH_SEARCH_ENDPOINT = "https://zh.wikipedia.org/w/api.php"',
]) if (!researchSearchSettings.includes(contract)) failures.push(`built-in research provider setting missing: ${contract}`)
for (const contract of ['value="wikipedia_zh"', "中文维基百科（内置、免密钥）"]) if (!researchSearchSettingsCard.includes(contract)) failures.push(`built-in research provider UI missing: ${contract}`)
for (const contract of ["来源：中文维基百科", "CC BY-SA 4.0", "licenses/by-sa/4.0"]) if (!projectResearchSearchPanel.includes(contract)) failures.push(`Wikipedia attribution UI missing: ${contract}`)
if (!sidecarProcessTests.includes('provider: "generic_json"')) failures.push("generic research adapter cross-process compatibility missing")
if (!sidecarServerTests.includes("built-in Chinese Wikipedia search uses the official GET contract and a bounded cache")) failures.push("built-in Wikipedia contract test missing")
if (!sidecarServerTests.includes("built-in Wikipedia cache evicts the oldest query after fifty entries")) failures.push("built-in Wikipedia cache bound test missing")
for (const contract of [
  'scopeMode?: "runtime" | "preview"',
  'request.scopeMode === "preview"',
]) if (!agentToolAuthorization.includes(contract)) failures.push(`Agent tool scope contract missing: ${contract}`)
for (const contract of [
  "context: OrchestrationContext",
  'scopeMode: context.previewOnly ? "preview" : "runtime"',
  "activeProjectId: string",
  "buildAgentOrchestration(definitions, { activeProjectId })",
]) if (!agentOrchestration.includes(contract)) failures.push(`Agent orchestration authorization contract missing: ${contract}`)
if (!agentDefinitionPanel.includes("buildAgentOrchestration(definitions, { previewOnly: true })")) failures.push("Agent definition preview must explicitly defer runtime project matching")
for (const contract of [
  "listAgentDefinitions(true)",
  "buildAgentOrchestrationTasks(",
  "definitions,",
  "projectId,",
  "权限阻断",
]) if (!projectAgentOrchestrationPanel.includes(contract)) failures.push(`project Agent execution authorization missing: ${contract}`)
for (const contract of [
  "save_research_plan_update_proposals",
  "validate_research_plan_proposal_citations",
  "r.agent_definition_id = 'plan-engineer:v2'",
  "r.status = 'succeeded'",
  "user_confirmed: bool",
  "if !user_confirmed",
  "AND updated_at = ? AND status != 'cancelled'",
  "SET status = 'stale'",
  "SET status = 'executed'",
]) if (!rust.includes(contract)) failures.push(`persisted Agent proposal boundary missing: ${contract}`)
for (const contract of [
  "CHECK (json_valid(payload_json) AND json_type(payload_json) = 'object')",
  "CHECK (json_valid(evidence_json) AND json_type(evidence_json) = 'array')",
  "pending_confirmation",
  "userConfirmationRequired",
]) if (!proposalMigration.includes(contract)) failures.push(`Agent proposal migration contract missing: ${contract}`)
for (const contract of [
  "target_type IN ('research_plan', 'project_risk')",
  "agent_definition_id = 'risk-review:v2'",
  "tool_key = 'update_project_risk'",
  "delete_project_risk_tool_proposals",
  "userConfirmationRequired",
]) if (!riskProposalMigration.includes(contract)) failures.push(`risk proposal migration contract missing: ${contract}`)
for (const contract of [
  "save_project_risk_update_proposals",
  "validate_project_risk_proposal_citations",
  "r.agent_definition_id = 'risk-review:v2'",
  "risk.0 != proposal.4 || risk.1 == \"closed\"",
  "AND updated_at = ? AND status != 'closed'",
]) if (!rust.includes(contract)) failures.push(`risk remediation executor boundary missing: ${contract}`)
for (const contract of [
  'agentDefinitionId: "risk-review:v2"',
  "validateRiskRemediationOutput",
  "expectedUpdatedAt",
]) if (!(structuredGenerationService.includes(contract) || riskRemediationDomain.includes(contract))) failures.push(`risk remediation generation boundary missing: ${contract}`)
for (const contract of [
  "saveRiskUpdateProposals",
  'targetType === "project_risk"',
  "确认执行风险缓解更新？",
  "风险状态不在授权范围内",
]) if (!(agentToolProposalService.includes(contract) || projectRiskPanel.includes(contract))) failures.push(`risk remediation confirmation UI missing: ${contract}`)
for (const contract of [
  "target_type IN ('research_plan', 'project_risk', 'project_dependency')",
  "agent_definition_id = 'dependency-remediation:v1'",
  "tool_key = 'update_project_dependency'",
  "DROP TRIGGER delete_research_plan_tool_proposals",
  "delete_project_dependency_tool_proposals",
  "userConfirmationRequired",
]) if (!dependencyProposalMigration.includes(contract)) failures.push(`dependency proposal migration contract missing: ${contract}`)
for (const contract of [
  "save_project_dependency_update_proposals",
  "validate_project_dependency_proposal_citations",
  "r.agent_definition_id = 'dependency-remediation:v1'",
  "dependency.0 != proposal.4 || dependency.1 == \"resolved\"",
  "AND updated_at = ? AND status != 'resolved'",
]) if (!rust.includes(contract)) failures.push(`dependency remediation executor boundary missing: ${contract}`)
for (const contract of [
  'agentDefinitionId: "dependency-remediation:v1"',
  "validateDependencyRemediationOutput",
  "expectedUpdatedAt",
]) if (!(structuredGenerationService.includes(contract) || dependencyRemediationDomain.includes(contract))) failures.push(`dependency remediation generation boundary missing: ${contract}`)
for (const contract of [
  "saveDependencyUpdateProposals",
  'targetType === "project_dependency"',
  "确认执行依赖处置更新？",
  "依赖状态不在授权范围",
]) if (!(agentToolProposalService.includes(contract) || projectDependencyPanel.includes(contract))) failures.push(`dependency remediation confirmation UI missing: ${contract}`)
for(const contract of ["release-preparation:v1","update_release_preparation","delete_release_tool_proposals","userConfirmationRequired"])if(!releaseProposalMigration.includes(contract))failures.push(`release proposal migration missing: ${contract}`)
for(const contract of ["save_release_preparation_proposals","validate_release_preparation_citations","status IN ('planned','ready')","AND updated_at=? AND status IN ('planned','ready')"])if(!rust.includes(contract))failures.push(`release proposal executor missing: ${contract}`)
for(const contract of ['agentDefinitionId: "release-preparation:v1"',"validateReleasePreparationOutput"])if(!(structuredGenerationService.includes(contract)||releasePreparationDomain.includes(contract)))failures.push(`release proposal generation missing: ${contract}`)
const compactProjectReleasePanel = projectReleasePanel.replace(/\s+/g, "")
for(const contract of ["saveReleasePreparationProposals",'targetType==="release"',"确认执行发布准备更新？","发布状态不在授权范围"])if(!(agentToolProposalService.includes(contract)||projectReleasePanel.includes(contract)||compactProjectReleasePanel.includes(contract)))failures.push(`release proposal UI missing: ${contract}`)
for (const contract of [
  '"confirm_agent_tool_proposal"',
  "userConfirmed: true",
  "saveResearchPlanUpdateProposals",
]) if (!agentToolProposalService.includes(contract)) failures.push(`Agent proposal desktop bridge missing: ${contract}`)
for (const contract of [
  "高风险工具提案收件箱",
  "确认并应用",
  "计划快照已变化，将拒绝覆盖",
]) if (!researchPlanPanel.includes(contract)) failures.push(`Agent proposal confirmation UI missing: ${contract}`)
const createMeetingStart = rust.indexOf("async fn create_meeting_document(")
const inspectMeetingStart = rust.indexOf("fn inspect_text_meeting_file(", createMeetingStart)
const createMeetingSource = rust.slice(createMeetingStart, inspectMeetingStart)
if (createMeetingSource.includes("request.run_type") || createMeetingSource.includes("项目问答")) failures.push("project Q&A validation must not be wired into meeting creation")
for (const contract of [
  "async fn validate_project_qa_prompt(",
  'if request.run_type == "project_qa"',
  "validate_project_qa_prompt(&mut connection, &request).await?",
  "m.status = 'confirmed'",
  "项目问答证据必须与当前项目数据库快照完全一致",
  "project_qa_v2_rechecks_complete_evidence_and_project_scope",
]) if (!rust.includes(contract)) failures.push(`project Q&A v2 Rust boundary missing: ${contract}`)
if (rust.includes('"milestone" | "confirmation" => Ok(1_i64)')) failures.push("project Q&A milestone and confirmation evidence must be checked against the database")
for (const contract of [
  "project-qa:v2",
  '"read_project_risks"',
  '"read_project_dependencies"',
  '"read_project_releases"',
  '"read_research_entries"',
]) if (!projectQaV2Migration.includes(contract)) failures.push(`project Q&A v2 definition missing: ${contract}`)
for (const contract of [
  "selectProjectQaEvidence",
  "contentCharacters + item.content.length > 240_000",
  "evidenceCaps",
]) if (!projectQaDomain.includes(contract)) failures.push(`project Q&A evidence bound missing: ${contract}`)
for (const contract of [
  'searchProjectMemories(true, projectId, normalizedQuestion, "confirmed", 8)',
  "listProjectRisks(true, projectId)",
  "listProjectDependencies(true, projectId)",
  "listReleases(true, projectId)",
  "listResearchEntries(true, projectId)",
  'agentDefinitionId: "project-qa:v2"',
]) if (!structuredGenerationService.includes(contract)) failures.push(`project Q&A multi-source bridge missing: ${contract}`)
for (const contract of [
  "多源项目问答",
  "引用来源（可展开）",
  "归档项目只读",
]) if (!projectQaPanel.includes(contract)) failures.push(`project Q&A evidence UI missing: ${contract}`)
const csp = String(tauri.app?.security?.csp ?? "")
const connectSources = csp.match(/(?:^|;)\s*connect-src\s+([^;]+)/i)?.[1]?.trim().split(/\s+/) ?? []
if (!connectSources.length || connectSources.some((source) => !["ipc:", "http://ipc.localhost"].includes(source))) failures.push("WebView CSP must not be widened for external research search")

const ignored = new Set(["node_modules", "dist", "target", ".git", ".vite", "bin", ".sea", "test"])
const suspicious = [/sk-[A-Za-z0-9]{20,}/, /x-api-key\s*[:=]/i, /api[_-]?key\s*[:=]\s*["'][^"']{16,}["']/i]
function scan(directory) {
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    if (ignored.has(entry.name)) continue
    const path = join(directory, entry.name)
    if (entry.isDirectory()) scan(path)
    else if (/\.(ts|tsx|rs|js|mjs|json|ps1|toml|sql|md)$/.test(entry.name)) {
      const text = readFileSync(path, "utf8")
      if (suspicious.some((pattern) => pattern.test(text))) failures.push(`possible credential literal in ${path}`)
    }
  }
}
scan(".")
if (failures.length) throw new Error(failures.join("\n"))
console.log(JSON.stringify({ status: "passed", checks: ["database_ignore_rules", "loopback_launcher", "sidecar_config", "credential_literal_scan", "backup_restore_contract", "notification_activation_contract", "disk_space_contract", "credential_boundary_contract", "credential_recovery_ui", "research_search_sidecar_boundary", "agent_orchestration_authorization", "persisted_agent_proposal_confirmation", "project_qa_v2_complete_evidence_scope"] }, null, 2))
