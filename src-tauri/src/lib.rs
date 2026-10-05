use notify_rust::{Notification, NotificationResponse};
use quick_xml::{events::Event, Reader};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use sqlx::{sqlite::SqliteConnectOptions, Connection, Row, SqliteConnection};
use std::{
    collections::VecDeque,
    fs,
    io::{self, Read, Write},
    net::{SocketAddr, TcpStream, ToSocketAddrs},
    path::{Path, PathBuf},
    sync::{Arc, Mutex},
    time::{Duration, Instant, SystemTime, UNIX_EPOCH},
};
use tauri::{
    menu::{Menu, MenuItem},
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
    AppHandle, Emitter, Listener, Manager, RunEvent, State, WindowEvent,
};
use tauri_plugin_shell::{
    process::{CommandChild, CommandEvent},
    ShellExt,
};
use tauri_plugin_sql::{Migration, MigrationKind};

const DATABASE_URL: &str = "sqlite:assistant-product-manager.db";
const DATABASE_FILE: &str = "assistant-product-manager.db";
const MAX_MEETING_FILE_BYTES: u64 = 10 * 1024 * 1024;
const MAX_DOCX_ENTRIES: usize = 2_048;
const MAX_DOCX_UNCOMPRESSED_BYTES: u64 = 50 * 1024 * 1024;
const MAX_DOCX_XML_BYTES: u64 = 20 * 1024 * 1024;
const MAX_PENDING_NOTIFICATION_ACTIVATIONS: usize = 32;
const DISK_WRITE_RESERVE_BYTES: u64 = 64 * 1024 * 1024;

#[derive(Default)]
struct NotificationActivationState {
    pending_item_ids: Mutex<VecDeque<String>>,
}

struct MigrationSpec {
    version: i64,
    description: &'static str,
    sql: &'static str,
}

const MIGRATION_SPECS: &[MigrationSpec] = &[
    MigrationSpec {
        version: 1,
        description: "create_initial_business_tables",
        sql: include_str!("../migrations/0001_initial.sql"),
    },
    MigrationSpec {
        version: 2,
        description: "complete_seeded_rust_setup_item",
        sql: include_str!("../migrations/0002_complete_rust_setup.sql"),
    },
    MigrationSpec {
        version: 3,
        description: "fill_seeded_rust_setup_conclusion",
        sql: include_str!("../migrations/0003_fill_rust_setup_conclusion.sql"),
    },
    MigrationSpec {
        version: 4,
        description: "add_meeting_source_paragraphs",
        sql: include_str!("../migrations/0004_meeting_source_paragraphs.sql"),
    },
    MigrationSpec {
        version: 5,
        description: "add_project_archive_state",
        sql: include_str!("../migrations/0005_project_archive.sql"),
    },
    MigrationSpec {
        version: 6,
        description: "add_project_workspace_metadata",
        sql: include_str!("../migrations/0006_project_workspace_metadata.sql"),
    },
    MigrationSpec {
        version: 7,
        description: "add_requirement_version_titles",
        sql: include_str!("../migrations/0007_requirement_version_titles.sql"),
    },
    MigrationSpec {
        version: 8,
        description: "add_agent_runtime_trace",
        sql: include_str!("../migrations/0008_agent_runtime_trace.sql"),
    },
    MigrationSpec {
        version: 9,
        description: "add_provider_diagnostic_agent",
        sql: include_str!("../migrations/0009_provider_diagnostic_agent.sql"),
    },
    MigrationSpec {
        version: 10,
        description: "add_project_memory_fts",
        sql: include_str!("../migrations/0010_project_memory_fts.sql"),
    },
    MigrationSpec {
        version: 11,
        description: "add_project_qa_agent",
        sql: include_str!("../migrations/0011_project_qa_agent.sql"),
    },
    MigrationSpec {
        version: 12,
        description: "add_product_documents",
        sql: include_str!("../migrations/0012_product_documents.sql"),
    },
    MigrationSpec {
        version: 13,
        description: "add_prd_agent",
        sql: include_str!("../migrations/0013_prd_agent.sql"),
    },
    MigrationSpec {
        version: 14,
        description: "add_document_diff_review_agent",
        sql: include_str!("../migrations/0014_document_diff_review_agent.sql"),
    },
    MigrationSpec {
        version: 15,
        description: "add_analysis_datasets",
        sql: include_str!("../migrations/0015_analysis_datasets.sql"),
    },
    MigrationSpec {
        version: 16,
        description: "add_metric_definitions",
        sql: include_str!("../migrations/0016_metric_definitions.sql"),
    },
    MigrationSpec {
        version: 17,
        description: "add_experiments",
        sql: include_str!("../migrations/0017_experiments.sql"),
    },
    MigrationSpec {
        version: 18,
        description: "add_analysis_insights",
        sql: include_str!("../migrations/0018_analysis_insights.sql"),
    },
    MigrationSpec {
        version: 19,
        description: "add_analysis_dataset_source_format",
        sql: include_str!("../migrations/0019_analysis_dataset_source_format.sql"),
    },
    MigrationSpec {
        version: 20,
        description: "add_analysis_explainer_agent",
        sql: include_str!("../migrations/0020_analysis_explainer_agent.sql"),
    },
    MigrationSpec {
        version: 21,
        description: "add_voc_feedback",
        sql: include_str!("../migrations/0021_voc_feedback.sql"),
    },
    MigrationSpec {
        version: 22,
        description: "add_product_decisions",
        sql: include_str!("../migrations/0022_product_decisions.sql"),
    },
    MigrationSpec {
        version: 23,
        description: "add_project_risks",
        sql: include_str!("../migrations/0023_project_risks.sql"),
    },
    MigrationSpec {
        version: 24,
        description: "add_project_dependencies",
        sql: include_str!("../migrations/0024_project_dependencies.sql"),
    },
    MigrationSpec {
        version: 25,
        description: "add_research_entries",
        sql: include_str!("../migrations/0025_research_entries.sql"),
    },
    MigrationSpec {
        version: 26,
        description: "add_competitor_profiles",
        sql: include_str!("../migrations/0026_competitor_profiles.sql"),
    },
    MigrationSpec {
        version: 27,
        description: "add_releases",
        sql: include_str!("../migrations/0027_releases.sql"),
    },
    MigrationSpec {
        version: 28,
        description: "add_research_plans",
        sql: include_str!("../migrations/0028_research_plans.sql"),
    },
    MigrationSpec {
        version: 29,
        description: "link_research_entries_to_plans",
        sql: include_str!("../migrations/0029_research_entry_plan_link.sql"),
    },
    MigrationSpec {
        version: 30,
        description: "add_research_insights",
        sql: include_str!("../migrations/0030_research_insights.sql"),
    },
    MigrationSpec {
        version: 31,
        description: "add_research_requirement_candidates",
        sql: include_str!("../migrations/0031_research_requirement_candidates.sql"),
    },
    MigrationSpec {
        version: 32,
        description: "add_research_insight_agent",
        sql: include_str!("../migrations/0032_research_insight_agent.sql"),
    },
    MigrationSpec {
        version: 33,
        description: "link_research_candidates_to_requirements",
        sql: include_str!("../migrations/0033_link_research_candidates_to_requirements.sql"),
    },
    MigrationSpec {
        version: 34,
        description: "add_risk_review_agent",
        sql: include_str!("../migrations/0034_risk_review_agent.sql"),
    },
    MigrationSpec {
        version: 35,
        description: "add_release_review_agent",
        sql: include_str!("../migrations/0035_release_review_agent.sql"),
    },
    MigrationSpec {
        version: 36,
        description: "add_competitor_review_agent",
        sql: include_str!("../migrations/0036_competitor_review_agent.sql"),
    },
    MigrationSpec {
        version: 37,
        description: "add_research_plan_review_agent",
        sql: include_str!("../migrations/0037_research_plan_review_agent.sql"),
    },
    MigrationSpec {
        version: 38,
        description: "add_knowledge_review_agent",
        sql: include_str!("../migrations/0038_knowledge_review_agent.sql"),
    },
    MigrationSpec {
        version: 39,
        description: "add_plan_engineer_agent",
        sql: include_str!("../migrations/0039_plan_engineer_agent.sql"),
    },
    MigrationSpec {
        version: 40,
        description: "add_agent_tool_proposals",
        sql: include_str!("../migrations/0040_agent_tool_proposals.sql"),
    },
    MigrationSpec {
        version: 41,
        description: "add_project_qa_v2",
        sql: include_str!("../migrations/0041_project_qa_v2.sql"),
    },
    MigrationSpec {
        version: 42,
        description: "add_risk_update_proposals",
        sql: include_str!("../migrations/0042_risk_update_proposals.sql"),
    },
    MigrationSpec {
        version: 43,
        description: "add_dependency_update_proposals",
        sql: include_str!("../migrations/0043_dependency_update_proposals.sql"),
    },
    MigrationSpec {
        version: 44,
        description: "add_release_preparation_proposals",
        sql: include_str!("../migrations/0044_release_preparation_proposals.sql"),
    },
    MigrationSpec {
        version: 45,
        description: "add_unified_knowledge_contract",
        sql: include_str!("../migrations/0045_unified_knowledge_contract.sql"),
    },
    MigrationSpec {
        version: 46,
        description: "add_knowledge_import_receipts",
        sql: include_str!("../migrations/0046_knowledge_import_receipts.sql"),
    },
];

fn migrations() -> Vec<Migration> {
    MIGRATION_SPECS
        .iter()
        .map(|migration| Migration {
            version: migration.version,
            description: migration.description,
            sql: migration.sql,
            kind: MigrationKind::Up,
        })
        .collect()
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct BackupInfo {
    path: String,
    file_name: String,
    size: u64,
    created_at_epoch_ms: u128,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct TextFileInspection {
    file_name: String,
    source_type: String,
    mime_type: String,
    byte_size: u64,
    content_hash: String,
    text: String,
    parse_error: Option<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct MeetingDeletionResult {
    deleted: bool,
    attachments_removed: u64,
    cleanup_warnings: Vec<String>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct MeetingDocumentWrite {
    meeting: MeetingWrite,
    source: MeetingSourceWrite,
    paragraphs: Vec<MeetingParagraphWrite>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct MeetingWrite {
    id: String,
    project_id: String,
    title: String,
    meeting_date: String,
    status: String,
    created_at: String,
    updated_at: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct MeetingSourceWrite {
    id: String,
    meeting_id: String,
    source_type: String,
    file_name: Option<String>,
    file_path: Option<String>,
    content_hash: String,
    parsed_text: String,
    mime_type: String,
    byte_size: i64,
    parse_status: String,
    parse_error: Option<String>,
    created_at: String,
    updated_at: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct MeetingParagraphWrite {
    id: String,
    meeting_id: String,
    source_id: String,
    ordinal: i64,
    text: String,
    start_offset: i64,
    end_offset: i64,
    content_hash: String,
    created_at: String,
}

fn epoch_millis() -> u128 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_millis())
        .unwrap_or_default()
}

fn has_known_binary_signature(bytes: &[u8]) -> bool {
    bytes.starts_with(b"%PDF-")
        || bytes.starts_with(b"PK\x03\x04")
        || bytes.starts_with(b"\x89PNG\r\n\x1a\n")
        || bytes.starts_with(b"\xff\xd8\xff")
        || bytes.starts_with(b"\xd0\xcf\x11\xe0\xa1\xb1\x1a\xe1")
        || bytes.starts_with(b"MZ")
}

fn inspect_text_file(path: &Path) -> Result<TextFileInspection, String> {
    let source = fs::canonicalize(path).map_err(|error| format!("会议文件不存在：{error}"))?;
    let metadata =
        fs::metadata(&source).map_err(|error| format!("无法读取会议文件信息：{error}"))?;
    if !metadata.is_file() {
        return Err("选择的路径不是文件".into());
    }
    if metadata.len() == 0 {
        return Err("会议文件不能为空".into());
    }
    if metadata.len() > MAX_MEETING_FILE_BYTES {
        return Err("会议文件不能超过 10 MB".into());
    }

    let extension = source
        .extension()
        .and_then(|value| value.to_str())
        .map(str::to_ascii_lowercase)
        .ok_or_else(|| "会议文件缺少有效扩展名".to_string())?;
    let (source_type, mime_type) = match extension.as_str() {
        "txt" => ("txt", "text/plain; charset=utf-8"),
        "md" => ("md", "text/markdown; charset=utf-8"),
        _ => return Err("当前只支持 .txt 和 .md 文件".into()),
    };

    let bytes = fs::read(&source).map_err(|error| format!("无法读取会议文件：{error}"))?;
    if has_known_binary_signature(&bytes) {
        return Err("文件内容与文本扩展名不匹配".into());
    }
    let text = String::from_utf8(bytes.clone())
        .map_err(|_| "会议文件不是有效的 UTF-8 编码".to_string())?;
    if text
        .chars()
        .any(|character| character.is_control() && !matches!(character, '\n' | '\r' | '\t'))
    {
        return Err("会议文件包含不支持的二进制控制字符".into());
    }
    if text.trim_start_matches('\u{feff}').trim().is_empty() {
        return Err("会议文件不能只包含空白内容".into());
    }

    let file_name = source
        .file_name()
        .map(|value| value.to_string_lossy().to_string())
        .ok_or_else(|| "无法读取会议文件名".to_string())?;
    Ok(TextFileInspection {
        file_name,
        source_type: source_type.into(),
        mime_type: mime_type.into(),
        byte_size: metadata.len(),
        content_hash: format!("{:x}", Sha256::digest(&bytes)),
        text,
        parse_error: None,
    })
}

fn parse_docx_text(path: &Path) -> Result<String, String> {
    let file = fs::File::open(path).map_err(|error| format!("无法打开 docx：{error}"))?;
    let mut archive =
        zip::ZipArchive::new(file).map_err(|_| "文件不是有效的 docx ZIP 容器".to_string())?;
    if archive.len() > MAX_DOCX_ENTRIES {
        return Err("docx 包含过多内部条目".into());
    }
    let mut total_size = 0_u64;
    for index in 0..archive.len() {
        let entry = archive
            .by_index(index)
            .map_err(|_| "无法读取 docx 内部条目".to_string())?;
        total_size = total_size.saturating_add(entry.size());
        if total_size > MAX_DOCX_UNCOMPRESSED_BYTES {
            return Err("docx 解压后内容超过 50 MB 安全上限".into());
        }
    }
    {
        let content_types = archive
            .by_name("[Content_Types].xml")
            .map_err(|_| "docx 缺少 [Content_Types].xml 类型声明".to_string())?;
        if content_types.size() > 1024 * 1024 {
            return Err("docx 类型声明超过 1 MB 安全上限".into());
        }
        let mut content = String::new();
        content_types
            .take(1024 * 1024 + 1)
            .read_to_string(&mut content)
            .map_err(|_| "docx 类型声明不是有效的 UTF-8".to_string())?;
        if !content.contains(
            "application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml",
        ) {
            return Err("ZIP 内容类型不是标准 docx 文档".into());
        }
    }
    let document = archive
        .by_name("word/document.xml")
        .map_err(|_| "docx 缺少 word/document.xml 正文".to_string())?;
    if document.size() > MAX_DOCX_XML_BYTES {
        return Err("docx 正文 XML 超过 20 MB 安全上限".into());
    }
    let mut xml = String::new();
    document
        .take(MAX_DOCX_XML_BYTES + 1)
        .read_to_string(&mut xml)
        .map_err(|_| "docx 正文 XML 不是有效的 UTF-8".to_string())?;
    if xml.len() as u64 > MAX_DOCX_XML_BYTES {
        return Err("docx 正文 XML 超过 20 MB 安全上限".into());
    }

    let mut reader = Reader::from_str(&xml);
    reader.config_mut().trim_text(false);
    let mut output = String::new();
    let mut in_text = false;
    loop {
        match reader.read_event() {
            Ok(Event::Start(event)) => match event.local_name().as_ref() {
                b"t" => in_text = true,
                b"tab" => output.push('\t'),
                b"br" | b"cr" => output.push('\n'),
                _ => {}
            },
            Ok(Event::Empty(event)) => match event.local_name().as_ref() {
                b"tab" => output.push('\t'),
                b"br" | b"cr" => output.push('\n'),
                _ => {}
            },
            Ok(Event::Text(event)) if in_text => {
                let decoded = event
                    .decode()
                    .map_err(|_| "docx 正文包含无效 XML 文本".to_string())?;
                let unescaped = quick_xml::escape::unescape(&decoded)
                    .map_err(|_| "docx 正文包含无效 XML 实体".to_string())?;
                output.push_str(&unescaped);
            }
            Ok(Event::End(event)) => match event.local_name().as_ref() {
                b"t" => in_text = false,
                b"p" => output.push_str("\n\n"),
                _ => {}
            },
            Ok(Event::Eof) => break,
            Err(_) => return Err("docx 正文 XML 格式无效".into()),
            _ => {}
        }
    }
    let text = output
        .replace("\r\n", "\n")
        .replace('\r', "\n")
        .split("\n\n")
        .map(str::trim)
        .filter(|paragraph| !paragraph.is_empty())
        .collect::<Vec<_>>()
        .join("\n\n");
    if text.is_empty() {
        return Err("docx 正文不包含可导入文本".into());
    }
    Ok(text)
}

fn inspect_docx_file(path: &Path) -> Result<TextFileInspection, String> {
    let source = fs::canonicalize(path).map_err(|error| format!("会议文件不存在：{error}"))?;
    let metadata =
        fs::metadata(&source).map_err(|error| format!("无法读取会议文件信息：{error}"))?;
    if !metadata.is_file() {
        return Err("选择的路径不是文件".into());
    }
    if metadata.len() == 0 {
        return Err("会议文件不能为空".into());
    }
    if metadata.len() > MAX_MEETING_FILE_BYTES {
        return Err("会议文件不能超过 10 MB".into());
    }
    if !source
        .extension()
        .and_then(|value| value.to_str())
        .is_some_and(|value| value.eq_ignore_ascii_case("docx"))
    {
        return Err("当前命令只支持 .docx 文件".into());
    }
    let bytes = fs::read(&source).map_err(|error| format!("无法读取会议文件：{error}"))?;
    let parse_result = parse_docx_text(&source);
    Ok(TextFileInspection {
        file_name: source
            .file_name()
            .map(|value| value.to_string_lossy().to_string())
            .ok_or_else(|| "无法读取会议文件名".to_string())?,
        source_type: "docx".into(),
        mime_type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document".into(),
        byte_size: metadata.len(),
        content_hash: format!("{:x}", Sha256::digest(&bytes)),
        text: parse_result.as_ref().cloned().unwrap_or_default(),
        parse_error: parse_result.err(),
    })
}

fn meeting_attachments_directory(app: &AppHandle) -> Result<PathBuf, String> {
    let directory = app
        .path()
        .app_data_dir()
        .map_err(|error| format!("无法定位会议附件目录：{error}"))?
        .join("attachments")
        .join("meetings");
    fs::create_dir_all(&directory).map_err(|error| format!("无法创建会议附件目录：{error}"))?;
    Ok(directory)
}

fn database_path(app: &AppHandle) -> Result<PathBuf, String> {
    app.path()
        .app_config_dir()
        .map(|directory| directory.join(DATABASE_FILE))
        .map_err(|error| format!("无法定位本地数据库目录：{error}"))
}

fn backup_directory(app: &AppHandle) -> Result<PathBuf, String> {
    let directory = app
        .path()
        .app_data_dir()
        .map_err(|error| format!("无法定位备份目录：{error}"))?
        .join("backups");
    fs::create_dir_all(&directory).map_err(|error| format!("无法创建备份目录：{error}"))?;
    Ok(directory)
}

fn required_disk_space(content_bytes: u64) -> u64 {
    content_bytes.saturating_add(DISK_WRITE_RESERVE_BYTES)
}

fn validate_disk_space(available_bytes: u64, required_bytes: u64) -> Result<(), String> {
    if available_bytes >= required_bytes {
        return Ok(());
    }
    Err(format!(
        "磁盘空间不足：至少需要 {:.1} MiB，当前用户仅可用 {:.1} MiB",
        required_bytes as f64 / 1024.0 / 1024.0,
        available_bytes as f64 / 1024.0 / 1024.0
    ))
}

#[cfg(windows)]
fn available_disk_space(directory: &Path) -> Result<u64, String> {
    use std::os::windows::ffi::OsStrExt;
    use windows::{core::PCWSTR, Win32::Storage::FileSystem::GetDiskFreeSpaceExW};

    let wide_path: Vec<u16> = directory
        .as_os_str()
        .encode_wide()
        .chain(std::iter::once(0))
        .collect();
    let mut available_bytes = 0_u64;
    unsafe {
        GetDiskFreeSpaceExW(
            PCWSTR(wide_path.as_ptr()),
            Some(&mut available_bytes),
            None,
            None,
        )
    }
    .map_err(|error| format!("无法读取磁盘可用空间：{error}"))?;
    Ok(available_bytes)
}

#[cfg(not(windows))]
fn available_disk_space(_directory: &Path) -> Result<u64, String> {
    Ok(u64::MAX)
}

fn ensure_disk_space(directory: &Path, content_bytes: u64) -> Result<(), String> {
    validate_disk_space(
        available_disk_space(directory)?,
        required_disk_space(content_bytes),
    )
}

fn parent_directory(path: &Path) -> &Path {
    path.parent()
        .filter(|parent| !parent.as_os_str().is_empty())
        .unwrap_or(Path::new("."))
}

async fn sqlite_connection(path: &Path, read_only: bool) -> Result<SqliteConnection, String> {
    let options = SqliteConnectOptions::new()
        .filename(path)
        .create_if_missing(false)
        .read_only(read_only);
    SqliteConnection::connect_with(&options)
        .await
        .map_err(|error| format!("无法打开 SQLite 文件：{error}"))
}

async fn validate_database_file(path: &Path) -> Result<(), String> {
    let mut connection = sqlite_connection(path, true).await?;
    let result: String = sqlx::query_scalar("PRAGMA integrity_check")
        .fetch_one(&mut connection)
        .await
        .map_err(|error| format!("无法检查备份完整性：{error}"))?;
    connection.close().await.ok();
    if result == "ok" {
        Ok(())
    } else {
        Err(format!("备份完整性检查失败：{result}"))
    }
}

async fn create_consistent_snapshot(source: &Path, destination: &Path) -> Result<(), String> {
    if destination.exists() {
        return Err("备份目标文件已存在，拒绝覆盖".into());
    }
    let source_size = fs::metadata(source)
        .map_err(|error| format!("无法读取待备份数据库大小：{error}"))?
        .len();
    ensure_disk_space(parent_directory(destination), source_size)?;
    let temporary = destination.with_extension(format!(
        "snapshot-{}-{}.tmp",
        std::process::id(),
        epoch_millis()
    ));
    if temporary.exists() {
        return Err("备份临时文件已存在，请稍后重试".into());
    }
    let mut connection = sqlite_connection(source, false).await?;
    let snapshot_result = sqlx::query("VACUUM INTO ?")
        .bind(temporary.to_string_lossy().to_string())
        .execute(&mut connection)
        .await;
    connection.close().await.ok();
    if let Err(error) = snapshot_result {
        let _ = fs::remove_file(&temporary);
        return Err(format!("无法创建一致性备份：{error}"));
    }
    if let Err(error) = validate_database_file(&temporary).await {
        let _ = fs::remove_file(&temporary);
        return Err(error);
    }
    if destination.exists() {
        let _ = fs::remove_file(&temporary);
        return Err("备份目标文件已存在，拒绝覆盖".into());
    }
    if let Err(error) = fs::rename(&temporary, destination) {
        let _ = fs::remove_file(&temporary);
        return Err(format!("无法完成一致性备份：{error}"));
    }
    Ok(())
}

async fn create_backup_file(app: &AppHandle, prefix: &str) -> Result<BackupInfo, String> {
    let source = database_path(app)?;
    if !source.exists() {
        return Err("本地数据库尚未创建".into());
    }
    let directory = backup_directory(app)?;
    let file_name = format!("{prefix}-{}.db", epoch_millis());
    let destination = directory.join(&file_name);
    create_consistent_snapshot(&source, &destination).await?;
    let metadata =
        fs::metadata(&destination).map_err(|error| format!("无法读取备份信息：{error}"))?;
    Ok(BackupInfo {
        path: destination.to_string_lossy().to_string(),
        file_name,
        size: metadata.len(),
        created_at_epoch_ms: metadata
            .modified()
            .ok()
            .and_then(|time| time.duration_since(UNIX_EPOCH).ok())
            .map(|duration| duration.as_millis())
            .unwrap_or_default(),
    })
}

fn backup_info(path: PathBuf) -> Option<BackupInfo> {
    let metadata = fs::metadata(&path).ok()?;
    let file_name = path.file_name()?.to_string_lossy().to_string();
    Some(BackupInfo {
        path: path.to_string_lossy().to_string(),
        file_name,
        size: metadata.len(),
        created_at_epoch_ms: metadata
            .modified()
            .ok()
            .and_then(|time| time.duration_since(UNIX_EPOCH).ok())
            .map(|duration| duration.as_millis())
            .unwrap_or_default(),
    })
}

#[tauri::command]
async fn create_backup(app: AppHandle) -> Result<BackupInfo, String> {
    create_backup_file(&app, "manual").await
}

async fn insert_meeting_document(
    connection: &mut SqliteConnection,
    document: MeetingDocumentWrite,
) -> Result<(), sqlx::Error> {
    let mut transaction = connection.begin().await?;
    sqlx::query(
        "INSERT INTO meetings
         (id, project_id, title, meeting_date, participants_json, status, created_at, updated_at)
         VALUES (?, ?, ?, ?, '[]', ?, ?, ?)",
    )
    .bind(&document.meeting.id)
    .bind(&document.meeting.project_id)
    .bind(&document.meeting.title)
    .bind(&document.meeting.meeting_date)
    .bind(&document.meeting.status)
    .bind(&document.meeting.created_at)
    .bind(&document.meeting.updated_at)
    .execute(&mut *transaction)
    .await?;

    sqlx::query(
        "INSERT INTO meeting_sources
         (id, meeting_id, source_type, file_name, file_path, content_hash, parsed_text,
          byte_size, created_at, mime_type, parse_status, parse_error, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
    )
    .bind(&document.source.id)
    .bind(&document.source.meeting_id)
    .bind(&document.source.source_type)
    .bind(&document.source.file_name)
    .bind(&document.source.file_path)
    .bind(&document.source.content_hash)
    .bind(&document.source.parsed_text)
    .bind(document.source.byte_size)
    .bind(&document.source.created_at)
    .bind(&document.source.mime_type)
    .bind(&document.source.parse_status)
    .bind(&document.source.parse_error)
    .bind(&document.source.updated_at)
    .execute(&mut *transaction)
    .await?;

    for paragraph in document.paragraphs {
        sqlx::query(
            "INSERT INTO meeting_paragraphs
             (id, meeting_id, source_id, ordinal, paragraph_text, start_offset,
              end_offset, content_hash, created_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
        )
        .bind(paragraph.id)
        .bind(paragraph.meeting_id)
        .bind(paragraph.source_id)
        .bind(paragraph.ordinal)
        .bind(paragraph.text)
        .bind(paragraph.start_offset)
        .bind(paragraph.end_offset)
        .bind(paragraph.content_hash)
        .bind(paragraph.created_at)
        .execute(&mut *transaction)
        .await?;
    }

    transaction.commit().await
}

#[tauri::command]
async fn create_meeting_document(
    app: AppHandle,
    document: MeetingDocumentWrite,
) -> Result<(), String> {
    let path = database_path(&app)?;
    let mut connection = sqlite_connection(&path, false).await?;
    let result = insert_meeting_document(&mut connection, document)
        .await
        .map_err(|error| format!("无法保存会议原文：{error}"));
    connection.close().await.ok();
    result
}

#[tauri::command]
fn inspect_text_meeting_file(source_path: String) -> Result<TextFileInspection, String> {
    let path = Path::new(&source_path);
    if path
        .extension()
        .and_then(|value| value.to_str())
        .is_some_and(|value| value.eq_ignore_ascii_case("docx"))
    {
        inspect_docx_file(path)
    } else {
        inspect_text_file(path)
    }
}

fn cleanup_attachment(file: &Path, meeting_directory: &Path) {
    let _ = fs::remove_file(file);
    let _ = fs::remove_dir(meeting_directory);
}

async fn copy_and_insert_file_meeting(
    connection: &mut SqliteConnection,
    source_path: &Path,
    attachments_root: &Path,
    mut document: MeetingDocumentWrite,
) -> Result<PathBuf, String> {
    let source =
        fs::canonicalize(source_path).map_err(|error| format!("会议源文件不存在：{error}"))?;
    let inspected = if document.source.source_type == "docx" {
        inspect_docx_file(&source)?
    } else {
        inspect_text_file(&source)?
    };
    if document.source.content_hash != inspected.content_hash
        || document.source.byte_size != inspected.byte_size as i64
        || document.source.source_type != inspected.source_type
    {
        return Err("会议文件在确认导入前已发生变化，请重新选择".into());
    }

    ensure_disk_space(attachments_root, inspected.byte_size as u64)?;
    let meeting_directory = attachments_root.join(&document.meeting.id);
    fs::create_dir_all(&meeting_directory)
        .map_err(|error| format!("无法创建会议附件目录：{error}"))?;
    let destination = meeting_directory.join(&inspected.file_name);
    let copy_result = (|| -> Result<(), String> {
        let mut input =
            fs::File::open(&source).map_err(|error| format!("无法打开会议源文件：{error}"))?;
        let mut output = fs::OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(&destination)
            .map_err(|error| format!("无法创建受管会议附件：{error}"))?;
        io::copy(&mut input, &mut output).map_err(|error| format!("无法复制会议附件：{error}"))?;
        output
            .sync_all()
            .map_err(|error| format!("无法写入会议附件：{error}"))?;
        Ok(())
    })();
    if let Err(error) = copy_result {
        cleanup_attachment(&destination, &meeting_directory);
        return Err(error);
    }

    let copied = match if inspected.source_type == "docx" {
        inspect_docx_file(&destination)
    } else {
        inspect_text_file(&destination)
    } {
        Ok(value) => value,
        Err(error) => {
            cleanup_attachment(&destination, &meeting_directory);
            return Err(format!("复制后的会议附件校验失败：{error}"));
        }
    };
    if copied.content_hash != inspected.content_hash {
        cleanup_attachment(&destination, &meeting_directory);
        return Err("复制后的会议附件哈希不一致".into());
    }

    document.source.file_name = Some(copied.file_name);
    document.source.file_path = Some(destination.to_string_lossy().to_string());
    document.source.mime_type = copied.mime_type;
    document.source.byte_size = copied.byte_size as i64;
    document.source.parse_error = copied.parse_error.clone();
    if copied.parse_error.is_some() {
        if !document.paragraphs.is_empty() {
            cleanup_attachment(&destination, &meeting_directory);
            return Err("解析失败的 docx 不能包含正式段落".into());
        }
        document.meeting.status = "failed".into();
        document.source.parse_status = "failed".into();
        document.source.parsed_text.clear();
    } else {
        document.meeting.status = "pending_analysis".into();
        document.source.parse_status = "parsed".into();
    }
    if let Err(error) = insert_meeting_document(connection, document).await {
        cleanup_attachment(&destination, &meeting_directory);
        return Err(format!("无法保存会议文件记录：{error}"));
    }
    Ok(destination)
}

#[tauri::command]
async fn create_file_meeting_document(
    app: AppHandle,
    source_path: String,
    document: MeetingDocumentWrite,
) -> Result<String, String> {
    let database = database_path(&app)?;
    let attachments_root = meeting_attachments_directory(&app)?;
    let mut connection = sqlite_connection(&database, false).await?;
    let result = copy_and_insert_file_meeting(
        &mut connection,
        Path::new(&source_path),
        &attachments_root,
        document,
    )
    .await
    .map(|path| path.to_string_lossy().to_string());
    connection.close().await.ok();
    result
}

async fn retry_docx_in_connection(
    connection: &mut SqliteConnection,
    meeting_id: &str,
    updated_at: &str,
) -> Result<(), String> {
    let source = sqlx::query_as::<_, (String, String)>(
        "SELECT id, file_path FROM meeting_sources
         WHERE meeting_id = ? AND source_type = 'docx' ORDER BY created_at DESC LIMIT 1",
    )
    .bind(meeting_id)
    .fetch_optional(&mut *connection)
    .await
    .map_err(|error| format!("无法读取 docx 来源：{error}"))?
    .ok_or_else(|| "会议没有可重试的 docx 受管原文件".to_string())?;
    let inspection = inspect_docx_file(Path::new(&source.1))?;
    if let Some(error) = inspection.parse_error {
        sqlx::query(
            "UPDATE meeting_sources SET parse_status = 'failed', parse_error = ?, updated_at = ? WHERE id = ?",
        )
        .bind(&error)
        .bind(updated_at)
        .bind(&source.0)
        .execute(&mut *connection)
        .await
        .map_err(|storage_error| format!("无法更新解析错误：{storage_error}"))?;
        return Err(error);
    }

    let mut transaction = connection
        .begin()
        .await
        .map_err(|error| error.to_string())?;
    sqlx::query("DELETE FROM meeting_paragraphs WHERE source_id = ?")
        .bind(&source.0)
        .execute(&mut *transaction)
        .await
        .map_err(|error| error.to_string())?;
    let mut offset = 0_i64;
    for (index, paragraph) in inspection.text.split("\n\n").enumerate() {
        let length = paragraph.encode_utf16().count() as i64;
        sqlx::query(
            "INSERT INTO meeting_paragraphs
             (id, meeting_id, source_id, ordinal, paragraph_text, start_offset, end_offset, content_hash, created_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
        )
        .bind(format!("{}:p{:04}", source.0, index + 1))
        .bind(meeting_id)
        .bind(&source.0)
        .bind((index + 1) as i64)
        .bind(paragraph)
        .bind(offset)
        .bind(offset + length)
        .bind(format!("{:x}", Sha256::digest(paragraph.as_bytes())))
        .bind(updated_at)
        .execute(&mut *transaction)
        .await
        .map_err(|error| error.to_string())?;
        offset += length + 2;
    }
    sqlx::query(
        "UPDATE meeting_sources SET parsed_text = ?, parse_status = 'parsed', parse_error = NULL, updated_at = ? WHERE id = ?",
    )
    .bind(&inspection.text)
    .bind(updated_at)
    .bind(&source.0)
    .execute(&mut *transaction)
    .await
    .map_err(|error| error.to_string())?;
    sqlx::query("UPDATE meetings SET status = 'pending_analysis', updated_at = ? WHERE id = ?")
        .bind(updated_at)
        .bind(meeting_id)
        .execute(&mut *transaction)
        .await
        .map_err(|error| error.to_string())?;
    transaction
        .commit()
        .await
        .map_err(|error| error.to_string())?;
    Ok(())
}

#[tauri::command]
async fn retry_docx_meeting(
    app: AppHandle,
    meeting_id: String,
    updated_at: String,
) -> Result<(), String> {
    let database = database_path(&app)?;
    let mut connection = sqlite_connection(&database, false).await?;
    let result = retry_docx_in_connection(&mut connection, &meeting_id, &updated_at).await;
    connection.close().await.ok();
    result
}

async fn delete_meeting_and_cleanup(
    connection: &mut SqliteConnection,
    meeting_id: &str,
    attachments_root: &Path,
) -> Result<MeetingDeletionResult, String> {
    let file_paths = sqlx::query_scalar::<_, Option<String>>(
        "SELECT file_path FROM meeting_sources WHERE meeting_id = ? AND file_path IS NOT NULL",
    )
    .bind(meeting_id)
    .fetch_all(&mut *connection)
    .await
    .map_err(|error| format!("无法读取会议附件：{error}"))?
    .into_iter()
    .flatten()
    .collect::<Vec<_>>();

    let deleted = sqlx::query("DELETE FROM meetings WHERE id = ?")
        .bind(meeting_id)
        .execute(&mut *connection)
        .await
        .map_err(|error| format!("无法删除会议记录：{error}"))?
        .rows_affected()
        > 0;
    if !deleted {
        return Ok(MeetingDeletionResult {
            deleted: false,
            attachments_removed: 0,
            cleanup_warnings: Vec::new(),
        });
    }

    let managed_root = fs::canonicalize(attachments_root)
        .map_err(|error| format!("无法校验会议附件目录：{error}"))?;
    let mut attachments_removed = 0;
    let mut cleanup_warnings = Vec::new();
    for stored_path in file_paths {
        let candidate = PathBuf::from(&stored_path);
        if !candidate.exists() {
            continue;
        }
        let canonical = match fs::canonicalize(&candidate) {
            Ok(path) => path,
            Err(error) => {
                cleanup_warnings.push(format!("无法校验附件路径 {stored_path}：{error}"));
                continue;
            }
        };
        if !canonical.starts_with(&managed_root) {
            cleanup_warnings.push(format!("已跳过非受管附件路径：{stored_path}"));
            continue;
        }
        match fs::remove_file(&canonical) {
            Ok(()) => {
                attachments_removed += 1;
                if let Some(parent) = canonical.parent() {
                    let _ = fs::remove_dir(parent);
                }
            }
            Err(error) => cleanup_warnings.push(format!("无法清理附件 {stored_path}：{error}")),
        }
    }
    Ok(MeetingDeletionResult {
        deleted: true,
        attachments_removed,
        cleanup_warnings,
    })
}

#[tauri::command]
async fn delete_meeting_document(
    app: AppHandle,
    meeting_id: String,
) -> Result<MeetingDeletionResult, String> {
    let database = database_path(&app)?;
    let attachments_root = meeting_attachments_directory(&app)?;
    let mut connection = sqlite_connection(&database, false).await?;
    let result = delete_meeting_and_cleanup(&mut connection, &meeting_id, &attachments_root).await;
    connection.close().await.ok();
    result
}

#[tauri::command]
fn list_backups(app: AppHandle) -> Result<Vec<BackupInfo>, String> {
    let directory = backup_directory(&app)?;
    let mut backups = fs::read_dir(directory)
        .map_err(|error| format!("无法读取备份目录：{error}"))?
        .filter_map(Result::ok)
        .map(|entry| entry.path())
        .filter(|path| path.extension().is_some_and(|extension| extension == "db"))
        .filter_map(backup_info)
        .collect::<Vec<_>>();
    backups.sort_by(|a, b| b.created_at_epoch_ms.cmp(&a.created_at_epoch_ms));
    Ok(backups)
}

#[tauri::command]
async fn export_backup(
    app: AppHandle,
    source_path: String,
    target_path: String,
) -> Result<(), String> {
    let backup_root = fs::canonicalize(backup_directory(&app)?)
        .map_err(|error| format!("无法验证备份目录：{error}"))?;
    let source =
        fs::canonicalize(&source_path).map_err(|error| format!("备份文件不存在：{error}"))?;
    if !source.starts_with(backup_root) {
        return Err("只能导出工作台管理的备份文件".into());
    }
    validate_database_file(&source).await?;
    let source_size = fs::metadata(&source)
        .map_err(|error| format!("无法读取备份文件大小：{error}"))?
        .len();
    let target = Path::new(&target_path);
    ensure_disk_space(parent_directory(target), source_size)?;
    fs::copy(&source, &target_path).map_err(|error| format!("无法导出备份：{error}"))?;
    Ok(())
}

fn validate_product_export(
    title: &str,
    content: &str,
    target_path: &str,
    extension: &str,
) -> Result<(), String> {
    if title.trim().is_empty() || title.chars().count() > 200 {
        return Err("文档标题不能为空且不能超过 200 个字符".into());
    }
    if content.len() > 200_000 {
        return Err("文档正文不能超过 200 KB".into());
    }
    let target = Path::new(target_path);
    if target
        .extension()
        .and_then(|value| value.to_str())
        .is_none_or(|value| !value.eq_ignore_ascii_case(extension))
    {
        return Err(format!("导出目标必须是 .{extension} 文件"));
    }
    if target_path.len() > 1_024 {
        return Err("导出路径过长".into());
    }
    Ok(())
}

fn xml_escape(value: &str) -> String {
    value
        .replace('&', "&amp;")
        .replace('<', "&lt;")
        .replace('>', "&gt;")
        .replace('"', "&quot;")
        .replace('\'', "&apos;")
}

fn markdown_plain_lines(content: &str) -> Vec<String> {
    content
        .replace("\r\n", "\n")
        .replace('\r', "\n")
        .lines()
        .map(|line| {
            let trimmed = line.trim_start_matches('#').trim_start();
            trimmed
                .strip_prefix("- ")
                .or_else(|| trimmed.strip_prefix("* "))
                .unwrap_or(trimmed)
                .replace("**", "")
                .replace('`', "")
        })
        .collect()
}

#[tauri::command]
fn export_product_document_docx(
    title: String,
    content_markdown: String,
    target_path: String,
) -> Result<(), String> {
    validate_product_export(&title, &content_markdown, &target_path, "docx")?;
    let file = fs::File::create(&target_path).map_err(|error| format!("无法创建 DOCX：{error}"))?;
    let mut archive = zip::ZipWriter::new(file);
    let options = zip::write::SimpleFileOptions::default()
        .compression_method(zip::CompressionMethod::Deflated);
    archive
        .start_file("[Content_Types].xml", options)
        .map_err(|error| format!("无法写入 DOCX：{error}"))?;
    archive.write_all(br#"<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>"#).map_err(|error| format!("无法写入 DOCX：{error}"))?;
    archive
        .start_file("_rels/.rels", options)
        .map_err(|error| format!("无法写入 DOCX：{error}"))?;
    archive.write_all(br#"<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>"#).map_err(|error| format!("无法写入 DOCX：{error}"))?;
    archive
        .start_file("word/document.xml", options)
        .map_err(|error| format!("无法写入 DOCX：{error}"))?;
    let mut body = format!(
        r#"<w:p><w:r><w:rPr><w:b/></w:rPr><w:t>{}</w:t></w:r></w:p>"#,
        xml_escape(&title)
    );
    for line in markdown_plain_lines(&content_markdown) {
        body.push_str(&format!(
            r#"<w:p><w:r><w:t xml:space="preserve">{}</w:t></w:r></w:p>"#,
            xml_escape(&line)
        ));
    }
    let document = format!(
        r#"<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>{}<w:sectPr/></w:body></w:document>"#,
        body
    );
    archive
        .write_all(document.as_bytes())
        .map_err(|error| format!("无法写入 DOCX：{error}"))?;
    archive
        .finish()
        .map_err(|error| format!("无法完成 DOCX：{error}"))?;
    Ok(())
}

fn pdf_escape(value: &str) -> String {
    value
        .chars()
        .map(|character| if character.is_ascii() { character } else { '?' })
        .collect::<String>()
        .replace('\\', "\\\\")
        .replace('(', "\\(")
        .replace(')', "\\)")
}

#[tauri::command]
fn export_product_document_pdf(
    title: String,
    content_markdown: String,
    target_path: String,
) -> Result<(), String> {
    validate_product_export(&title, &content_markdown, &target_path, "pdf")?;
    let mut lines = vec![title];
    lines.extend(markdown_plain_lines(&content_markdown));
    let mut stream = String::from("BT\n/F1 11 Tf\n50 790 Td\n");
    for (index, line) in lines.iter().take(55).enumerate() {
        if index > 0 {
            stream.push_str("0 -14 Td\n");
        }
        stream.push_str(&format!("({}) Tj\n", pdf_escape(line)));
    }
    stream.push_str("ET\n");
    let objects = vec!["<< /Type /Catalog /Pages 2 0 R >>".to_string(), "<< /Type /Pages /Kids [3 0 R] /Count 1 >>".to_string(), "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 842] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>".to_string(), "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>".to_string(), format!("<< /Length {} >>\nstream\n{}endstream", stream.len(), stream)];
    let mut pdf = b"%PDF-1.4\n".to_vec();
    let mut offsets = Vec::new();
    for (index, object) in objects.iter().enumerate() {
        offsets.push(pdf.len());
        pdf.extend_from_slice(format!("{} 0 obj\n{}\nendobj\n", index + 1, object).as_bytes());
    }
    let xref = pdf.len();
    pdf.extend_from_slice(
        format!("xref\n0 {}\n0000000000 65535 f \n", objects.len() + 1).as_bytes(),
    );
    for offset in offsets {
        pdf.extend_from_slice(format!("{offset:010} 00000 n \n").as_bytes());
    }
    pdf.extend_from_slice(
        format!(
            "trailer\n<< /Size {} /Root 1 0 R >>\nstartxref\n{}\n%%EOF",
            objects.len() + 1,
            xref
        )
        .as_bytes(),
    );
    fs::write(&target_path, pdf).map_err(|error| format!("无法写入 PDF：{error}"))
}

#[tauri::command]
async fn restore_backup(app: AppHandle, source_path: String) -> Result<(), String> {
    let source = PathBuf::from(source_path);
    let database = database_path(&app)?;
    let directory = backup_directory(&app)?;
    replace_database_from_backup(&source, &database, &directory).await?;
    app.restart();
}

async fn replace_database_from_backup(
    source: &Path,
    database: &Path,
    backup_directory: &Path,
) -> Result<Option<PathBuf>, String> {
    validate_database_file(source).await?;
    fs::create_dir_all(backup_directory)
        .map_err(|error| format!("无法准备恢复前备份目录：{error}"))?;
    let rollback = backup_directory.join(format!("pre-restore-{}.db", epoch_millis()));
    let had_database = database.exists();
    if had_database {
        create_consistent_snapshot(database, &rollback)
            .await
            .map_err(|error| format!("无法创建恢复前一致性备份：{error}"))?;
    }

    let temporary = database.with_extension("restore.tmp");
    let previous = database.with_extension("previous");
    if temporary.exists() {
        fs::remove_file(&temporary)
            .map_err(|error| format!("无法清理上次恢复临时文件：{error}"))?;
    }
    let source_size = fs::metadata(source)
        .map_err(|error| format!("无法读取恢复文件大小：{error}"))?
        .len();
    ensure_disk_space(parent_directory(database), source_size)?;
    fs::copy(source, &temporary).map_err(|error| format!("无法准备恢复文件：{error}"))?;
    if let Err(error) = validate_database_file(&temporary).await {
        let _ = fs::remove_file(&temporary);
        return Err(error);
    }
    if previous.exists() {
        if let Err(error) = fs::remove_file(&previous) {
            let _ = fs::remove_file(&temporary);
            return Err(format!("无法清理旧恢复文件：{error}"));
        }
    }
    if database.exists() {
        if let Err(error) = fs::rename(database, &previous) {
            let _ = fs::remove_file(&temporary);
            return Err(format!("无法暂存当前数据库：{error}"));
        }
    }
    if let Err(error) = fs::rename(&temporary, &database) {
        if previous.exists() {
            let _ = fs::rename(&previous, &database);
        }
        return Err(format!("无法替换当前数据库，已尝试回滚：{error}"));
    }
    if previous.exists() {
        fs::remove_file(previous).ok();
    }
    Ok(had_database.then_some(rollback))
}

#[derive(Debug, PartialEq, Eq)]
enum RestoreRecoveryOutcome {
    NoInterruptedRestore,
    KeptValidCurrent,
    RestoredPrevious,
    PromotedTemporary,
}

async fn promote_restore_candidate(candidate: &Path, database: &Path) -> Result<(), String> {
    let rejected = database.with_extension("restore.invalid");
    if rejected.exists() {
        fs::remove_file(&rejected)
            .map_err(|error| format!("无法清理上次恢复的损坏数据库：{error}"))?;
    }
    let had_database = database.exists();
    if had_database {
        fs::rename(database, &rejected)
            .map_err(|error| format!("无法隔离损坏的当前数据库：{error}"))?;
    }
    if let Err(error) = fs::rename(candidate, database) {
        if had_database {
            let _ = fs::rename(&rejected, database);
        }
        return Err(format!("无法恢复中断的数据库切换：{error}"));
    }
    if let Err(error) = validate_database_file(database).await {
        let _ = fs::rename(database, candidate);
        if had_database {
            let _ = fs::rename(&rejected, database);
        }
        return Err(format!("恢复候选文件复检失败：{error}"));
    }
    if rejected.exists() {
        fs::remove_file(rejected).ok();
    }
    Ok(())
}

async fn recover_interrupted_database_restore(
    database: &Path,
) -> Result<RestoreRecoveryOutcome, String> {
    let temporary = database.with_extension("restore.tmp");
    let previous = database.with_extension("previous");
    let rejected = database.with_extension("restore.invalid");
    if !temporary.exists() && !previous.exists() && !rejected.exists() {
        return Ok(RestoreRecoveryOutcome::NoInterruptedRestore);
    }

    let current_is_valid = database.exists() && validate_database_file(database).await.is_ok();
    if current_is_valid {
        if temporary.exists() {
            fs::remove_file(&temporary)
                .map_err(|error| format!("无法清理中断恢复临时文件：{error}"))?;
        }
        if previous.exists() {
            fs::remove_file(&previous)
                .map_err(|error| format!("无法清理已完成恢复的旧数据库：{error}"))?;
        }
        if rejected.exists() {
            fs::remove_file(&rejected)
                .map_err(|error| format!("无法清理已恢复的损坏数据库：{error}"))?;
        }
        return Ok(RestoreRecoveryOutcome::KeptValidCurrent);
    }

    let previous_is_valid = previous.exists() && validate_database_file(&previous).await.is_ok();
    if previous_is_valid {
        promote_restore_candidate(&previous, database).await?;
        if temporary.exists() {
            fs::remove_file(&temporary)
                .map_err(|error| format!("无法清理已回滚恢复的临时文件：{error}"))?;
        }
        return Ok(RestoreRecoveryOutcome::RestoredPrevious);
    }

    let temporary_is_valid = temporary.exists() && validate_database_file(&temporary).await.is_ok();
    if temporary_is_valid {
        promote_restore_candidate(&temporary, database).await?;
        if previous.exists() {
            fs::remove_file(&previous)
                .map_err(|error| format!("无法清理损坏的旧数据库：{error}"))?;
        }
        return Ok(RestoreRecoveryOutcome::PromotedTemporary);
    }

    Err("检测到中断的数据库恢复，但当前库、旧库和临时恢复文件均无法安全使用".into())
}

fn create_pre_migration_backup(app: &AppHandle, migration_version: i64) -> Result<(), String> {
    let database = database_path(app)?;
    if !database.exists() {
        return Ok(());
    }
    let current_version = tauri::async_runtime::block_on(async {
        let mut connection = sqlite_connection(&database, true).await?;
        let migration_table_exists: i64 = sqlx::query_scalar(
            "SELECT COUNT(*) FROM sqlite_master WHERE type = 'table' AND name = '_sqlx_migrations'",
        )
        .fetch_one(&mut connection)
        .await
        .map_err(|error| format!("无法检查当前数据库版本：{error}"))?;
        let version = if migration_table_exists == 0 {
            0
        } else {
            sqlx::query_scalar("SELECT COALESCE(MAX(version), 0) FROM _sqlx_migrations")
                .fetch_one(&mut connection)
                .await
                .map_err(|error| format!("无法读取当前数据库版本：{error}"))?
        };
        connection.close().await.ok();
        Ok::<i64, String>(version)
    })?;
    if current_version >= migration_version {
        return Ok(());
    }

    let directory = backup_directory(app)?;
    let prefix = format!("pre-migration-v{migration_version}-");
    let already_created = fs::read_dir(directory)
        .ok()
        .into_iter()
        .flatten()
        .filter_map(Result::ok)
        .any(|entry| entry.file_name().to_string_lossy().starts_with(&prefix));
    if !already_created {
        tauri::async_runtime::block_on(create_backup_file(app, prefix.trim_end_matches('-')))?;
    }
    Ok(())
}

fn pre_migration_backup_plugin(migration_version: i64) -> tauri::plugin::TauriPlugin<tauri::Wry> {
    tauri::plugin::Builder::new("pre-migration-backup")
        .setup(move |app, _api| {
            let database = database_path(app).map_err(std::io::Error::other)?;
            tauri::async_runtime::block_on(recover_interrupted_database_restore(&database))
                .map_err(std::io::Error::other)?;
            create_pre_migration_backup(app, migration_version).map_err(std::io::Error::other)?;
            Ok(())
        })
        .build()
}

fn show_main_window(app: &tauri::AppHandle) {
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.show();
        let _ = window.unminimize();
        let _ = window.set_focus();
    }
}

fn validate_notification_item_id(value: &str) -> Result<String, String> {
    let item_id = value.trim();
    if item_id.is_empty() || item_id.len() > 128 || item_id.chars().any(char::is_control) {
        return Err("通知事项标识无效".into());
    }
    Ok(item_id.to_string())
}

fn push_notification_activation(pending: &mut VecDeque<String>, item_id: String) {
    if pending.len() >= MAX_PENDING_NOTIFICATION_ACTIVATIONS {
        pending.pop_front();
    }
    pending.push_back(item_id);
}

fn queue_notification_activation(app: &AppHandle, item_id: String) {
    if let Ok(mut pending) = app
        .state::<NotificationActivationState>()
        .pending_item_ids
        .lock()
    {
        push_notification_activation(&mut pending, item_id);
    }
}

#[tauri::command]
fn take_pending_notification_open(
    state: State<'_, NotificationActivationState>,
) -> Result<Option<String>, String> {
    state
        .pending_item_ids
        .lock()
        .map(|mut pending| pending.pop_front())
        .map_err(|_| "通知激活队列暂时不可用".to_string())
}

#[tauri::command]
fn send_clickable_notification(
    app: AppHandle,
    title: String,
    body: String,
    confirmation_item_id: String,
) -> Result<(), String> {
    let confirmation_item_id = validate_notification_item_id(&confirmation_item_id)?;
    let mut notification = Notification::new();
    notification.summary(&title).body(&body);

    // An installed Windows app owns its configured AppUserModelID. During development,
    // notify-rust's PowerShell identity keeps toast delivery working without registration.
    #[cfg(not(debug_assertions))]
    notification.app_id(&app.config().identifier);

    let handle = notification
        .show()
        .map_err(|error| format!("无法发送系统通知：{error}"))?;
    std::thread::spawn(move || {
        let action_app = app.clone();
        let _ = handle.wait_for_response(move |response: &NotificationResponse| {
            if matches!(
                response,
                NotificationResponse::Default | NotificationResponse::Action(_)
            ) {
                show_main_window(&action_app);
                queue_notification_activation(&action_app, confirmation_item_id.clone());
                let _ = action_app.emit("notification-open-item", confirmation_item_id);
            }
        });
    });
    Ok(())
}

fn create_tray(app: &tauri::App) -> tauri::Result<()> {
    let open = MenuItem::with_id(app, "open", "打开工作台", true, None::<&str>)?;
    let today = MenuItem::with_id(app, "today", "查看今日待确认", true, None::<&str>)?;
    let pause = MenuItem::with_id(app, "pause", "暂停/恢复提醒", true, None::<&str>)?;
    let quit = MenuItem::with_id(app, "quit", "退出", true, None::<&str>)?;
    let pause_for_state = pause.clone();
    app.listen("reminders-pause-state-changed", move |event| {
        let paused = event.payload() == "true";
        let label = if paused {
            "恢复提醒"
        } else {
            "暂停提醒"
        };
        let _ = pause_for_state.set_text(label);
    });
    let menu = Menu::with_items(app, &[&open, &today, &pause, &quit])?;

    let mut tray = TrayIconBuilder::new()
        .tooltip("Assistant Product Manager")
        .menu(&menu)
        .show_menu_on_left_click(false)
        .on_menu_event(|app, event| match event.id.as_ref() {
            "open" | "today" => show_main_window(app),
            "pause" => {
                let _ = app.emit("reminders-pause-requested", ());
            }
            "quit" => app.exit(0),
            _ => {}
        })
        .on_tray_icon_event(|tray, event| {
            if let TrayIconEvent::Click {
                button: MouseButton::Left,
                button_state: MouseButtonState::Up,
                ..
            } = event
            {
                show_main_window(tray.app_handle());
            }
        });

    if let Some(icon) = app.default_window_icon() {
        tray = tray.icon(icon.clone());
    }

    tray.build(app)?;
    Ok(())
}

const KEYRING_SERVICE: &str = "com.assistant-product-manager.desktop";

fn provider_credential_account(provider: &str) -> Result<&'static str, String> {
    match provider.trim() {
        "openai" => Ok("openai"),
        "anthropic" => Ok("anthropic"),
        "openai_compatible" => Ok("openai_compatible"),
        _ => Err("该 Provider 不允许由工作台保存凭据".to_string()),
    }
}

fn validate_provider_api_key_value(api_key: &str) -> Result<(), String> {
    if api_key.is_empty()
        || api_key.len() > 512
        || !api_key.bytes().all(|byte| (0x21..=0x7e).contains(&byte))
    {
        return Err("API Key 只能包含可见 ASCII 字符且不能超过 512 字节".to_string());
    }
    Ok(())
}

fn provider_key_entry(provider: &str) -> Result<keyring::Entry, String> {
    let account = provider_credential_account(provider)?;
    keyring::Entry::new(KEYRING_SERVICE, account)
        .map_err(|_| "无法访问 Windows 凭据存储".to_string())
}

enum StoredProviderApiKey {
    Missing,
    Invalid,
    Valid(String),
}

fn read_provider_api_key(provider: &str) -> Result<StoredProviderApiKey, String> {
    match provider_key_entry(provider)?.get_password() {
        Ok(api_key) => {
            if validate_provider_api_key_value(&api_key).is_ok() {
                Ok(StoredProviderApiKey::Valid(api_key))
            } else {
                Ok(StoredProviderApiKey::Invalid)
            }
        }
        Err(keyring::Error::NoEntry) => Ok(StoredProviderApiKey::Missing),
        Err(_) => Err("无法读取 Windows 凭据状态".to_string()),
    }
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct ProviderCredentialStatus {
    state: String,
    message: String,
}

fn provider_credential_status(stored: &StoredProviderApiKey) -> ProviderCredentialStatus {
    match stored {
        StoredProviderApiKey::Missing => ProviderCredentialStatus {
            state: "missing".into(),
            message: "尚未保存 API Key".into(),
        },
        StoredProviderApiKey::Invalid => ProviderCredentialStatus {
            state: "invalid".into(),
            message: "已保存的 API Key 格式无效，请替换或删除".into(),
        },
        StoredProviderApiKey::Valid(_) => ProviderCredentialStatus {
            state: "valid".into(),
            message: "API Key 已安全保存".into(),
        },
    }
}

#[tauri::command]
fn get_provider_credential_status(provider: String) -> Result<ProviderCredentialStatus, String> {
    read_provider_api_key(&provider).map(|stored| provider_credential_status(&stored))
}

#[tauri::command]
fn set_provider_api_key(provider: String, api_key: String) -> Result<(), String> {
    validate_provider_api_key_value(&api_key)?;
    provider_key_entry(&provider)?
        .set_password(&api_key)
        .map_err(|_| "无法保存 API Key 到 Windows 凭据存储".to_string())
}

#[tauri::command]
fn has_provider_api_key(provider: String) -> Result<bool, String> {
    read_provider_api_key(&provider)
        .map(|api_key| !matches!(api_key, StoredProviderApiKey::Missing))
}

#[tauri::command]
fn delete_provider_api_key(provider: String) -> Result<(), String> {
    match provider_key_entry(&provider)?.delete_credential() {
        Ok(()) | Err(keyring::Error::NoEntry) => Ok(()),
        Err(_) => Err("无法删除 Windows 凭据".to_string()),
    }
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct LocalModelRouteProbe {
    reachable: bool,
    latency_ms: u64,
}

fn parse_loopback_model_endpoint(endpoint: &str) -> Result<Vec<SocketAddr>, String> {
    let authority = endpoint
        .trim()
        .strip_prefix("http://")
        .ok_or_else(|| "CC Switch 地址必须使用 http:// 回环地址".to_string())?
        .split('/')
        .next()
        .unwrap_or_default();
    if authority.is_empty() || authority.contains('@') {
        return Err("CC Switch 地址无效".to_string());
    }
    let (host, port) = match authority.rsplit_once(':') {
        Some((host, port)) => (
            host,
            port.parse::<u16>()
                .map_err(|_| "CC Switch 端口无效".to_string())?,
        ),
        None => (authority, 80),
    };
    if host != "127.0.0.1" && host != "localhost" {
        return Err("CC Switch 连接测试只允许 127.0.0.1 或 localhost".to_string());
    }
    let addresses = (host, port)
        .to_socket_addrs()
        .map_err(|_| "无法解析 CC Switch 回环地址".to_string())?
        .filter(|address| address.ip().is_loopback())
        .collect::<Vec<_>>();
    if addresses.is_empty() {
        return Err("CC Switch 地址没有解析到回环接口".to_string());
    }
    Ok(addresses)
}

#[tauri::command]
fn probe_local_model_route(endpoint: String) -> Result<LocalModelRouteProbe, String> {
    let addresses = parse_loopback_model_endpoint(&endpoint)?;
    let started = Instant::now();
    let reachable = addresses
        .iter()
        .any(|address| TcpStream::connect_timeout(address, Duration::from_millis(1_500)).is_ok());
    Ok(LocalModelRouteProbe {
        reachable,
        latency_ms: started.elapsed().as_millis().min(u128::from(u64::MAX)) as u64,
    })
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct AiRuntimeStatus {
    state: String,
    host: Option<String>,
    port: Option<u16>,
    protocol_version: Option<u16>,
    restart_count: u8,
    message: String,
}

struct AiRuntimeInner {
    status: AiRuntimeStatus,
    stopping: bool,
}

#[derive(Clone)]
struct AiRuntimeManager {
    inner: Arc<Mutex<AiRuntimeInner>>,
    child: Arc<Mutex<Option<CommandChild>>>,
    session_token: Arc<Mutex<Option<String>>>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct SidecarReadyEvent {
    event: String,
    host: String,
    port: u16,
    protocol_version: u16,
}

#[derive(Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
struct ProviderConnectionProbe {
    state: String,
    message: String,
    latency_ms: Option<u64>,
}

#[derive(Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
struct StructuredGenerationRequest {
    run_id: String,
    run_type: String,
    agent_definition_id: String,
    project_id: Option<String>,
    entity_id: Option<String>,
    idempotency_key: String,
    kind: String,
    endpoint: String,
    model: String,
    system: String,
    prompt: String,
    response_schema: serde_json::Value,
    max_output_tokens: u16,
}

fn validate_generation_trace_scope(request: &StructuredGenerationRequest) -> bool {
    match (
        request.run_type.as_str(),
        request.agent_definition_id.as_str(),
    ) {
        ("meeting_analysis", "meeting-requirement-analyst:v1") => {
            request
                .project_id
                .as_deref()
                .is_some_and(|value| !value.trim().is_empty())
                && request
                    .entity_id
                    .as_deref()
                    .is_some_and(|value| !value.trim().is_empty())
        }
        ("provider_diagnostic", "provider-diagnostic:v1") => {
            request.project_id.is_none() && request.entity_id.is_none()
        }
        ("project_qa", "project-qa:v1") => {
            request
                .project_id
                .as_deref()
                .is_some_and(|value| !value.trim().is_empty())
                && request.entity_id.is_none()
        }
        ("project_qa", "project-qa:v2") => {
            request
                .project_id
                .as_deref()
                .is_some_and(|value| !value.trim().is_empty())
                && request.entity_id.is_none()
        }
        ("prd_draft", "prd-agent:v1") => {
            request
                .project_id
                .as_deref()
                .is_some_and(|value| !value.trim().is_empty())
                && request.entity_id.is_none()
        }
        ("document_diff_review", "document-diff-reviewer:v1") => {
            request
                .project_id
                .as_deref()
                .is_some_and(|value| !value.trim().is_empty())
                && request.entity_id.is_none()
        }
        ("analysis_explanation", "analysis-explainer:v1") => {
            request
                .project_id
                .as_deref()
                .is_some_and(|value| !value.trim().is_empty())
                && request
                    .entity_id
                    .as_deref()
                    .is_some_and(|value| !value.trim().is_empty())
        }
        ("research_insight", "research-insight:v1") => {
            request
                .project_id
                .as_deref()
                .is_some_and(|value| !value.trim().is_empty())
                && request.entity_id.is_none()
        }
        ("risk_review", "risk-review:v1" | "risk-review:v2") => {
            request
                .project_id
                .as_deref()
                .is_some_and(|value| !value.trim().is_empty())
                && request.entity_id.is_none()
        }
        ("dependency_review", "dependency-remediation:v1") => {
            request
                .project_id
                .as_deref()
                .is_some_and(|value| !value.trim().is_empty())
                && request.entity_id.is_none()
        }
        ("release_preparation", "release-preparation:v1") => {
            request
                .project_id
                .as_deref()
                .is_some_and(|value| !value.trim().is_empty())
                && request.entity_id.is_none()
        }
        ("release_review", "release-review:v1") => {
            request
                .project_id
                .as_deref()
                .is_some_and(|value| !value.trim().is_empty())
                && request.entity_id.is_none()
        }
        ("competitor_review", "competitor-review:v1") => {
            request
                .project_id
                .as_deref()
                .is_some_and(|value| !value.trim().is_empty())
                && request.entity_id.is_none()
        }
        ("knowledge_review", "knowledge-review:v1") => {
            request
                .project_id
                .as_deref()
                .is_some_and(|value| !value.trim().is_empty())
                && request.entity_id.is_none()
        }
        ("research_plan_review", "research-plan-review:v1") => {
            request
                .project_id
                .as_deref()
                .is_some_and(|value| !value.trim().is_empty())
                && request.entity_id.is_none()
        }
        ("plan_engineer", "plan-engineer:v1") => {
            request
                .project_id
                .as_deref()
                .is_some_and(|value| !value.trim().is_empty())
                && request.entity_id.is_none()
        }
        ("plan_engineer", "plan-engineer:v2") => {
            request
                .project_id
                .as_deref()
                .is_some_and(|value| !value.trim().is_empty())
                && request.entity_id.is_none()
        }
        _ => false,
    }
}

#[derive(Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
struct TokenUsage {
    input_tokens: Option<i64>,
    output_tokens: Option<i64>,
}

#[derive(Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
struct StructuredGenerationResult {
    state: String,
    message: String,
    output: Option<serde_json::Value>,
    usage: Option<TokenUsage>,
    duration_ms: u64,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct SidecarGenerationResponse {
    state: String,
    message: String,
    output: Option<serde_json::Value>,
    usage: Option<TokenUsage>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct ResearchSearchRequest {
    provider: String,
    query: String,
    endpoint: String,
    timeout_ms: u64,
}

#[derive(Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
struct ResearchSearchResult {
    title: String,
    url: String,
    snippet: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct SidecarResearchSearchResponse {
    state: String,
    message: String,
    results: Vec<ResearchSearchResult>,
}

fn new_ai_runtime_manager() -> AiRuntimeManager {
    AiRuntimeManager {
        inner: Arc::new(Mutex::new(AiRuntimeInner {
            status: AiRuntimeStatus {
                state: "starting".to_string(),
                host: None,
                port: None,
                protocol_version: None,
                restart_count: 0,
                message: "正在启动 AI Sidecar".to_string(),
            },
            stopping: false,
        })),
        child: Arc::new(Mutex::new(None)),
        session_token: Arc::new(Mutex::new(None)),
    }
}

fn update_ai_runtime_status(manager: &AiRuntimeManager, status: AiRuntimeStatus) {
    if let Ok(mut inner) = manager.inner.lock() {
        inner.status = status;
    }
}

fn ai_runtime_is_stopping(manager: &AiRuntimeManager) -> bool {
    manager
        .inner
        .lock()
        .map(|inner| inner.stopping)
        .unwrap_or(true)
}

#[derive(Debug, PartialEq, Eq)]
enum SidecarExitAction {
    Restart,
    Degrade,
}

fn sidecar_exit_action(restart_count: u8, stopping: bool) -> SidecarExitAction {
    if stopping || restart_count > 0 {
        SidecarExitAction::Degrade
    } else {
        SidecarExitAction::Restart
    }
}

fn mark_sidecar_unavailable(manager: &AiRuntimeManager, message: &str) {
    if let Ok(mut inner) = manager.inner.lock() {
        if inner.stopping {
            return;
        }
        let restart_count = inner.status.restart_count;
        inner.status = AiRuntimeStatus {
            state: "degraded".to_string(),
            host: None,
            port: None,
            protocol_version: None,
            restart_count,
            message: message.to_string(),
        };
    }
    if let Ok(mut child) = manager.child.lock() {
        if let Some(child) = child.take() {
            let _ = child.kill();
        }
    }
    if let Ok(mut session_token) = manager.session_token.lock() {
        session_token.take();
    }
}

fn new_sidecar_session_token() -> Result<String, String> {
    let mut bytes = [0_u8; 32];
    getrandom::fill(&mut bytes).map_err(|_| "无法生成 Sidecar 会话令牌".to_string())?;
    Ok(bytes.iter().map(|byte| format!("{byte:02x}")).collect())
}

fn sidecar_health_check(port: u16, token: &str) -> bool {
    let address = format!("127.0.0.1:{port}");
    let Ok(address) = address.parse::<SocketAddr>() else {
        return false;
    };
    let Ok(mut stream) = TcpStream::connect_timeout(&address, Duration::from_millis(1_500)) else {
        return false;
    };
    let _ = stream.set_read_timeout(Some(Duration::from_millis(1_500)));
    let request = format!(
        "GET /health HTTP/1.1\r\nHost: 127.0.0.1:{port}\r\nAuthorization: Bearer {token}\r\nConnection: close\r\n\r\n"
    );
    if stream.write_all(request.as_bytes()).is_err() {
        return false;
    }
    let mut response = Vec::with_capacity(1024);
    if stream.take(8 * 1024).read_to_end(&mut response).is_err() {
        return false;
    }
    let response = String::from_utf8_lossy(&response);
    response.starts_with("HTTP/1.1 200") && response.contains("\"status\":\"ok\"")
}

fn validated_provider_endpoint(kind: &str, endpoint: &str) -> Result<String, String> {
    if !matches!(
        kind,
        "cc_switch" | "openai" | "anthropic" | "openai_compatible"
    ) {
        return Err("不支持的 Provider 类型".to_string());
    }
    let parsed = url::Url::parse(endpoint).map_err(|_| "Provider 服务地址无效".to_string())?;
    if !parsed.username().is_empty()
        || parsed.password().is_some()
        || parsed.query().is_some()
        || parsed.fragment().is_some()
    {
        return Err("Provider 服务地址不能包含凭据、查询参数或片段".to_string());
    }
    let loopback = matches!(parsed.host_str(), Some("127.0.0.1" | "localhost"));
    let allowed = match kind {
        "cc_switch" => parsed.scheme() == "http" && loopback,
        "openai" | "anthropic" => parsed.scheme() == "https",
        "openai_compatible" => {
            parsed.scheme() == "https" || (parsed.scheme() == "http" && loopback)
        }
        _ => false,
    };
    if !allowed {
        return Err("Provider 服务地址不符合安全连接规则".to_string());
    }
    Ok(parsed.as_str().trim_end_matches('/').to_string())
}

fn validated_research_search_endpoint(endpoint: &str) -> Result<String, String> {
    if endpoint.is_empty() || endpoint.len() > 2_000 {
        return Err("搜索适配器端点无效".to_string());
    }
    let parsed = url::Url::parse(endpoint).map_err(|_| "搜索适配器端点无效".to_string())?;
    if !parsed.username().is_empty() || parsed.password().is_some() || parsed.fragment().is_some() {
        return Err("搜索适配器端点不得包含凭据或片段".to_string());
    }
    for (key, _) in parsed.query_pairs() {
        let normalized = key.to_ascii_lowercase().replace('-', "").replace('_', "");
        if matches!(
            normalized.as_str(),
            "apikey" | "accesstoken" | "token" | "secret" | "password"
        ) {
            return Err("搜索适配器端点不得在查询参数中包含凭据".to_string());
        }
    }
    let loopback = matches!(parsed.host_str(), Some("127.0.0.1" | "localhost"));
    if parsed.host_str().is_none()
        || (parsed.scheme() != "https" && !(parsed.scheme() == "http" && loopback))
    {
        return Err("搜索适配器仅允许 HTTPS 或本机回环 HTTP".to_string());
    }
    Ok(parsed.to_string())
}

fn validated_research_search_provider(provider: &str, endpoint: &str) -> Result<String, String> {
    if !matches!(provider, "wikipedia_zh" | "generic_json") {
        return Err("搜索提供商无效".to_string());
    }
    let endpoint = validated_research_search_endpoint(endpoint)?;
    if provider == "wikipedia_zh" && endpoint != "https://zh.wikipedia.org/w/api.php" {
        return Err("中文维基百科必须使用内置官方端点".to_string());
    }
    Ok(endpoint)
}

fn validate_research_search_result(
    mut result: ResearchSearchResult,
) -> Result<ResearchSearchResult, String> {
    result.title = result.title.trim().to_string();
    result.snippet = result.snippet.trim().to_string();
    if result.title.is_empty()
        || result.title.chars().count() > 300
        || result.title.chars().any(char::is_control)
        || result.snippet.is_empty()
        || result.snippet.chars().count() > 2_000
        || result.snippet.chars().any(char::is_control)
        || result.url.len() > 2_000
    {
        return Err("搜索适配器结果项无效".to_string());
    }
    let mut parsed =
        url::Url::parse(&result.url).map_err(|_| "搜索适配器结果来源地址无效".to_string())?;
    if !matches!(parsed.scheme(), "http" | "https")
        || parsed.host_str().is_none()
        || !parsed.username().is_empty()
        || parsed.password().is_some()
    {
        return Err("搜索适配器结果来源地址无效".to_string());
    }
    parsed.set_fragment(None);
    result.url = parsed.to_string();
    Ok(result)
}

fn call_sidecar_provider_test(
    manager: &AiRuntimeManager,
    kind: &str,
    endpoint: &str,
    model: &str,
) -> ProviderConnectionProbe {
    let started = Instant::now();
    let endpoint = match validated_provider_endpoint(kind, endpoint) {
        Ok(value) => value,
        Err(message) => {
            return ProviderConnectionProbe {
                state: "invalid".to_string(),
                message,
                latency_ms: None,
            };
        }
    };
    if model.trim().is_empty() || model.len() > 200 {
        return ProviderConnectionProbe {
            state: "invalid".to_string(),
            message: "模型名称无效".to_string(),
            latency_ms: None,
        };
    }
    let (port, token) = match (manager.inner.lock(), manager.session_token.lock()) {
        (Ok(inner), Ok(token)) if inner.status.state == "available" => {
            match (inner.status.port, token.clone()) {
                (Some(port), Some(token)) => (port, token),
                _ => {
                    return ProviderConnectionProbe {
                        state: "sidecar_required".to_string(),
                        message: "AI Sidecar 尚未就绪".to_string(),
                        latency_ms: None,
                    }
                }
            }
        }
        _ => {
            return ProviderConnectionProbe {
                state: "sidecar_required".to_string(),
                message: "AI Sidecar 尚未就绪".to_string(),
                latency_ms: None,
            }
        }
    };
    let api_key = if matches!(kind, "cc_switch") {
        String::new()
    } else {
        match read_provider_api_key(kind) {
            Ok(StoredProviderApiKey::Valid(value)) => value,
            _ => {
                return ProviderConnectionProbe {
                    state: "credential_missing".to_string(),
                    message: "请先在 Windows 凭据存储中保存 API Key".to_string(),
                    latency_ms: None,
                }
            }
        }
    };
    let body = serde_json::json!({ "kind": kind, "endpoint": endpoint, "model": model.trim(), "apiKey": api_key }).to_string();
    let address = SocketAddr::from(([127, 0, 0, 1], port));
    let Ok(mut stream) = TcpStream::connect_timeout(&address, Duration::from_millis(1_500)) else {
        return ProviderConnectionProbe {
            state: "unavailable".to_string(),
            message: "AI Sidecar 暂时不可访问".to_string(),
            latency_ms: Some(started.elapsed().as_millis() as u64),
        };
    };
    let _ = stream.set_read_timeout(Some(Duration::from_secs(7)));
    let request = format!(
        "POST /v1/provider/test HTTP/1.1\r\nHost: 127.0.0.1:{port}\r\nAuthorization: Bearer {token}\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{body}",
        body.len()
    );
    if stream.write_all(request.as_bytes()).is_err() {
        return ProviderConnectionProbe {
            state: "unavailable".to_string(),
            message: "无法向 AI Sidecar 发送请求".to_string(),
            latency_ms: Some(started.elapsed().as_millis() as u64),
        };
    }
    let mut response = Vec::new();
    if stream.take(32 * 1024).read_to_end(&mut response).is_err() {
        return ProviderConnectionProbe {
            state: "unavailable".to_string(),
            message: "AI Sidecar 响应超时".to_string(),
            latency_ms: Some(started.elapsed().as_millis() as u64),
        };
    }
    let response = String::from_utf8_lossy(&response);
    let Some(body) = response.split("\r\n\r\n").nth(1) else {
        return ProviderConnectionProbe {
            state: "unavailable".to_string(),
            message: "AI Sidecar 返回了无效响应".to_string(),
            latency_ms: Some(started.elapsed().as_millis() as u64),
        };
    };
    let mut probe =
        serde_json::from_str::<ProviderConnectionProbe>(body).unwrap_or(ProviderConnectionProbe {
            state: "unavailable".to_string(),
            message: "AI Sidecar 返回了无效响应".to_string(),
            latency_ms: None,
        });
    if !matches!(
        probe.state.as_str(),
        "available" | "unavailable" | "invalid"
    ) {
        probe.state = "unavailable".to_string();
        probe.message = "AI Sidecar 返回了未知状态".to_string();
    }
    probe.latency_ms = Some(started.elapsed().as_millis().min(u128::from(u64::MAX)) as u64);
    probe
}

#[tauri::command]
async fn test_ai_provider_connection(
    state: tauri::State<'_, AiRuntimeManager>,
    kind: String,
    endpoint: String,
    model: String,
) -> Result<ProviderConnectionProbe, String> {
    let manager = state.inner().clone();
    let result = tauri::async_runtime::spawn_blocking(move || {
        call_sidecar_provider_test(&manager, &kind, &endpoint, &model)
    })
    .await
    .map_err(|_| "Provider 连接检测任务失败".to_string())?;
    if result.message.starts_with("AI Sidecar") {
        mark_sidecar_unavailable(&state.inner().clone(), &result.message);
    }
    Ok(result)
}

fn active_sidecar_session(manager: &AiRuntimeManager) -> Result<(u16, String), String> {
    let inner = manager
        .inner
        .lock()
        .map_err(|_| "无法读取 AI Sidecar 状态".to_string())?;
    if inner.status.state != "available" {
        return Err("AI Sidecar 尚未就绪".to_string());
    }
    let port = inner
        .status
        .port
        .ok_or_else(|| "AI Sidecar 尚未就绪".to_string())?;
    drop(inner);
    let token = manager
        .session_token
        .lock()
        .map_err(|_| "无法读取 AI Sidecar 会话".to_string())?
        .clone()
        .ok_or_else(|| "AI Sidecar 尚未就绪".to_string())?;
    Ok((port, token))
}

fn call_sidecar_research_search(
    manager: &AiRuntimeManager,
    request: ResearchSearchRequest,
) -> Result<Vec<ResearchSearchResult>, String> {
    let query = request.query.trim();
    if query.is_empty()
        || query.chars().count() > 200
        || query.chars().any(char::is_control)
        || !(1_000..=30_000).contains(&request.timeout_ms)
    {
        return Err("搜索词或超时设置无效".to_string());
    }
    let endpoint = validated_research_search_provider(&request.provider, &request.endpoint)?;
    let (port, token) = active_sidecar_session(manager)?;
    let body = serde_json::json!({
        "provider": request.provider,
        "query": query,
        "endpoint": endpoint,
        "timeoutMs": request.timeout_ms,
    })
    .to_string();
    if body.len() > 16 * 1024 {
        return Err("搜索请求超过 16 KiB 限制".to_string());
    }
    let address = SocketAddr::from(([127, 0, 0, 1], port));
    let mut stream = TcpStream::connect_timeout(&address, Duration::from_millis(1_500))
        .map_err(|_| "AI Sidecar 暂时不可访问".to_string())?;
    let read_timeout = request.timeout_ms.saturating_add(2_000);
    let _ = stream.set_read_timeout(Some(Duration::from_millis(read_timeout)));
    let http_request = format!(
        "POST /v1/research/search HTTP/1.1\r\nHost: 127.0.0.1:{port}\r\nAuthorization: Bearer {token}\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{body}",
        body.len()
    );
    stream
        .write_all(http_request.as_bytes())
        .map_err(|_| "无法向 AI Sidecar 发送搜索请求".to_string())?;
    let mut response = Vec::new();
    stream
        .take(512 * 1024)
        .read_to_end(&mut response)
        .map_err(|_| "AI Sidecar 搜索响应超时".to_string())?;
    let response =
        String::from_utf8(response).map_err(|_| "AI Sidecar 返回了无效搜索响应".to_string())?;
    let body = response
        .split("\r\n\r\n")
        .nth(1)
        .ok_or_else(|| "AI Sidecar 返回了无效搜索响应".to_string())?;
    let sidecar = serde_json::from_str::<SidecarResearchSearchResponse>(body)
        .map_err(|_| "AI Sidecar 返回了无效搜索响应".to_string())?;
    if sidecar.state != "succeeded" {
        return Err(sidecar.message.chars().take(300).collect());
    }
    if sidecar.results.len() > 10 {
        return Err("AI Sidecar 返回了过多搜索结果".to_string());
    }
    sidecar
        .results
        .into_iter()
        .map(validate_research_search_result)
        .collect()
}

#[tauri::command]
async fn search_research_sources(
    state: tauri::State<'_, AiRuntimeManager>,
    request: ResearchSearchRequest,
) -> Result<Vec<ResearchSearchResult>, String> {
    let manager = state.inner().clone();
    tauri::async_runtime::spawn_blocking(move || call_sidecar_research_search(&manager, request))
        .await
        .map_err(|_| "外部研究搜索任务失败".to_string())?
}

fn call_sidecar_generation(
    manager: &AiRuntimeManager,
    request: &StructuredGenerationRequest,
) -> StructuredGenerationResult {
    let started = Instant::now();
    let failure = |message: &str| StructuredGenerationResult {
        state: "failed".to_string(),
        message: message.to_string(),
        output: None,
        usage: None,
        duration_ms: started.elapsed().as_millis().min(u128::from(u64::MAX)) as u64,
    };
    let endpoint = match validated_provider_endpoint(&request.kind, &request.endpoint) {
        Ok(value) => value,
        Err(message) => return failure(&message),
    };
    if request.model.trim().is_empty()
        || request.model.len() > 200
        || request.system.len() > 20_000
        || request.prompt.is_empty()
        || request.prompt.len() > 400_000
        || !(1..=8_192).contains(&request.max_output_tokens)
    {
        return failure("结构化生成参数无效");
    }
    let Ok(schema_text) = serde_json::to_string(&request.response_schema) else {
        return failure("输出 Schema 无效");
    };
    if !request.response_schema.is_object() || schema_text.len() > 64 * 1024 {
        return failure("输出 Schema 无效或过大");
    }
    let (port, token) = match active_sidecar_session(manager) {
        Ok(value) => value,
        Err(message) => return failure(&message),
    };
    let api_key = if request.kind == "cc_switch" {
        String::new()
    } else {
        match read_provider_api_key(&request.kind) {
            Ok(StoredProviderApiKey::Valid(value)) => value,
            _ => return failure("请先在 Windows 凭据存储中保存 API Key"),
        }
    };
    let body = serde_json::json!({
        "kind": request.kind,
        "endpoint": endpoint,
        "model": request.model.trim(),
        "apiKey": api_key,
        "system": request.system,
        "prompt": request.prompt,
        "responseSchema": request.response_schema,
        "maxOutputTokens": request.max_output_tokens,
    })
    .to_string();
    if body.len() > 512 * 1024 {
        return failure("结构化生成请求超过 512 KiB 限制");
    }
    let address = SocketAddr::from(([127, 0, 0, 1], port));
    let Ok(mut stream) = TcpStream::connect_timeout(&address, Duration::from_millis(1_500)) else {
        return failure("AI Sidecar 暂时不可访问");
    };
    let _ = stream.set_read_timeout(Some(Duration::from_secs(65)));
    let http_request = format!(
        "POST /v1/generate HTTP/1.1\r\nHost: 127.0.0.1:{port}\r\nAuthorization: Bearer {token}\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{body}",
        body.len()
    );
    if stream.write_all(http_request.as_bytes()).is_err() {
        return failure("无法向 AI Sidecar 发送生成请求");
    }
    let mut response = Vec::new();
    if stream
        .take(2 * 1024 * 1024 + 16 * 1024)
        .read_to_end(&mut response)
        .is_err()
    {
        return failure("AI Sidecar 生成响应超时");
    }
    let response = String::from_utf8_lossy(&response);
    let Some(body) = response.split("\r\n\r\n").nth(1) else {
        return failure("AI Sidecar 返回了无效生成响应");
    };
    let Ok(sidecar) = serde_json::from_str::<SidecarGenerationResponse>(body) else {
        return failure("AI Sidecar 返回了无效生成响应");
    };
    if !matches!(sidecar.state.as_str(), "succeeded" | "failed" | "invalid") {
        return failure("AI Sidecar 返回了未知生成状态");
    }
    StructuredGenerationResult {
        state: sidecar.state,
        message: sidecar.message.chars().take(500).collect(),
        output: sidecar.output,
        usage: sidecar.usage,
        duration_ms: started.elapsed().as_millis().min(u128::from(u64::MAX)) as u64,
    }
}

fn trace_timestamp() -> String {
    epoch_millis().to_string()
}

fn content_hash(value: &str) -> String {
    format!("{:x}", Sha256::digest(value.as_bytes()))
}

async fn insert_generation_trace_start(
    connection: &mut SqliteConnection,
    request: &StructuredGenerationRequest,
) -> Result<(), String> {
    let created_at = trace_timestamp();
    let mut transaction = connection
        .begin()
        .await
        .map_err(|error| error.to_string())?;
    sqlx::query(
        "INSERT INTO agent_runs
         (id, run_type, entity_id, provider_mode, model, status, created_at,
          agent_definition_id, project_id, trace_version, idempotency_key, metadata_json)
         VALUES (?, ?, ?, ?, ?, 'running', ?, ?, ?, 1, ?, ?)",
    )
    .bind(&request.run_id)
    .bind(&request.run_type)
    .bind(&request.entity_id)
    .bind(&request.kind)
    .bind(request.model.trim())
    .bind(&created_at)
    .bind(&request.agent_definition_id)
    .bind(&request.project_id)
    .bind(&request.idempotency_key)
    .bind(
        serde_json::json!({
            "businessWriteAccess": false,
            "syntheticInputOnly": request.run_type == "provider_diagnostic"
        })
        .to_string(),
    )
    .execute(&mut *transaction)
    .await
    .map_err(|_| "无法创建 Agent 运行记录；运行 ID 已存在或关联对象无效".to_string())?;
    sqlx::query(
        "INSERT INTO agent_run_steps
         (id, agent_run_id, ordinal, step_type, status, detail_json, created_at)
         VALUES (?, ?, 1, 'model_request', 'running', ?, ?)",
    )
    .bind(format!("{}:step:1", request.run_id))
    .bind(&request.run_id)
    .bind(serde_json::json!({ "maxOutputTokens": request.max_output_tokens }).to_string())
    .bind(&created_at)
    .execute(&mut *transaction)
    .await
    .map_err(|_| "无法创建 Agent 步骤记录".to_string())?;
    sqlx::query(
        "INSERT INTO agent_run_steps
         (id, agent_run_id, ordinal, step_type, status, detail_json, created_at)
         VALUES (?, ?, 2, 'validation', 'queued', '{}', ?)",
    )
    .bind(format!("{}:step:2", request.run_id))
    .bind(&request.run_id)
    .bind(&created_at)
    .execute(&mut *transaction)
    .await
    .map_err(|_| "无法创建 Agent 校验步骤记录".to_string())?;
    for (ordinal, role, value) in [
        (1_i64, "system", request.system.as_str()),
        (2_i64, "user", request.prompt.as_str()),
    ] {
        sqlx::query(
            "INSERT INTO agent_run_messages
             (id, agent_run_id, ordinal, role, content_summary, content_hash, created_at)
             VALUES (?, ?, ?, ?, ?, ?, ?)",
        )
        .bind(format!("{}:message:{ordinal}", request.run_id))
        .bind(&request.run_id)
        .bind(ordinal)
        .bind(role)
        .bind(format!("{role} input ({} chars)", value.chars().count()))
        .bind(content_hash(value))
        .bind(&created_at)
        .execute(&mut *transaction)
        .await
        .map_err(|_| "无法创建 Agent 消息摘要".to_string())?;
    }
    transaction
        .commit()
        .await
        .map_err(|error| error.to_string())
}

async fn finish_generation_trace(
    connection: &mut SqliteConnection,
    request: &StructuredGenerationRequest,
    result: &StructuredGenerationResult,
) -> Result<(), String> {
    let completed_at = trace_timestamp();
    let succeeded = result.state == "succeeded";
    let validation_failed =
        !succeeded && (result.message.contains("Schema") || result.message.contains("JSON"));
    let input_tokens = result.usage.as_ref().and_then(|usage| usage.input_tokens);
    let output_tokens = result.usage.as_ref().and_then(|usage| usage.output_tokens);
    let output_hash = result
        .output
        .as_ref()
        .and_then(|value| serde_json::to_string(value).ok())
        .map(|value| content_hash(&value));
    let mut transaction = connection
        .begin()
        .await
        .map_err(|error| error.to_string())?;
    sqlx::query(
        "UPDATE agent_run_steps
         SET status = ?, duration_ms = ?, input_tokens = ?, output_tokens = ?,
             error_code = ?, error_summary = ?, completed_at = ?
         WHERE agent_run_id = ? AND ordinal = 1",
    )
    .bind(if succeeded || validation_failed {
        "succeeded"
    } else {
        "failed"
    })
    .bind(result.duration_ms as i64)
    .bind(input_tokens)
    .bind(output_tokens)
    .bind((!succeeded && !validation_failed).then_some("provider_generation_failed"))
    .bind((!succeeded && !validation_failed).then_some(result.message.as_str()))
    .bind(&completed_at)
    .bind(&request.run_id)
    .execute(&mut *transaction)
    .await
    .map_err(|_| "无法完成 Agent 步骤记录".to_string())?;
    sqlx::query(
        "UPDATE agent_run_steps
         SET status = ?, error_code = ?, error_summary = ?, completed_at = ?
         WHERE agent_run_id = ? AND ordinal = 2",
    )
    .bind(if succeeded {
        "succeeded"
    } else if validation_failed {
        "failed"
    } else {
        "cancelled"
    })
    .bind(validation_failed.then_some("output_validation_failed"))
    .bind(validation_failed.then_some(result.message.as_str()))
    .bind(&completed_at)
    .bind(&request.run_id)
    .execute(&mut *transaction)
    .await
    .map_err(|_| "无法完成 Agent 校验步骤记录".to_string())?;
    if let Some(output_hash) = output_hash {
        sqlx::query(
            "INSERT INTO agent_run_messages
             (id, agent_run_id, ordinal, role, content_summary, content_hash, token_count, created_at)
             VALUES (?, ?, 3, 'assistant', 'structured JSON output', ?, ?, ?)",
        )
        .bind(format!("{}:message:3", request.run_id))
        .bind(&request.run_id)
        .bind(output_hash)
        .bind(output_tokens)
        .bind(&completed_at)
        .execute(&mut *transaction)
        .await
        .map_err(|_| "无法创建 Agent 输出摘要".to_string())?;
    }
    sqlx::query(
        "UPDATE agent_runs
         SET status = ?, duration_ms = ?, input_tokens = ?, output_tokens = ?,
             error_code = ?, error_summary = ?, completed_at = ?
         WHERE id = ?",
    )
    .bind(if succeeded { "succeeded" } else { "failed" })
    .bind(result.duration_ms as i64)
    .bind(input_tokens)
    .bind(output_tokens)
    .bind((!succeeded).then_some(if validation_failed {
        "output_validation_failed"
    } else {
        "provider_generation_failed"
    }))
    .bind((!succeeded).then_some(result.message.as_str()))
    .bind(&completed_at)
    .bind(&request.run_id)
    .execute(&mut *transaction)
    .await
    .map_err(|_| "无法完成 Agent 运行记录".to_string())?;
    transaction
        .commit()
        .await
        .map_err(|error| error.to_string())
}

async fn validate_project_qa_prompt(
    connection: &mut SqliteConnection,
    request: &StructuredGenerationRequest,
) -> Result<(), String> {
    let project_id = request.project_id.as_deref().unwrap_or_default();
    let prompt_value: serde_json::Value = serde_json::from_str(&request.prompt)
        .map_err(|_| "项目问答输入不是有效 JSON".to_string())?;
    let prompt_object = prompt_value
        .as_object()
        .filter(|object| {
            object.len() == 3
                && object.contains_key("projectId")
                && object.contains_key("question")
                && object.contains_key("evidence")
        })
        .ok_or_else(|| "项目问答输入包含未授权字段".to_string())?;
    let question = prompt_object
        .get("question")
        .and_then(serde_json::Value::as_str)
        .map(str::trim)
        .filter(|value| {
            !value.is_empty()
                && value.len() <= 500
                && value.chars().any(|character| character.is_alphanumeric())
        })
        .ok_or_else(|| "项目问答问题无效".to_string())?;
    if prompt_object
        .get("projectId")
        .and_then(serde_json::Value::as_str)
        != Some(project_id)
        || question
            != prompt_object
                .get("question")
                .and_then(serde_json::Value::as_str)
                .unwrap_or_default()
    {
        return Err("项目问答输入项目范围或问题格式无效".into());
    }
    let active_project: i64 =
        sqlx::query_scalar("SELECT COUNT(*) FROM projects WHERE id = ? AND archived_at IS NULL")
            .bind(project_id)
            .fetch_one(&mut *connection)
            .await
            .map_err(|error| format!("无法校验项目问答项目范围：{error}"))?;
    if active_project != 1 {
        return Err("项目问答只能读取当前未归档项目".into());
    }
    let evidence = prompt_object
        .get("evidence")
        .and_then(serde_json::Value::as_array)
        .ok_or_else(|| "项目问答缺少证据数组".to_string())?;
    if evidence.len() > 40 {
        return Err("项目问答证据数量超出限制".into());
    }
    let mut seen = std::collections::HashSet::new();
    for item in evidence {
        let object = item
            .as_object()
            .ok_or_else(|| "项目问答证据必须是对象".to_string())?;
        let source_type = object
            .get("sourceType")
            .and_then(serde_json::Value::as_str)
            .unwrap_or_default();
        let source_id = object
            .get("sourceId")
            .and_then(serde_json::Value::as_str)
            .unwrap_or_default();
        let supplied_title = object
            .get("title")
            .and_then(serde_json::Value::as_str)
            .unwrap_or_default();
        let supplied_content = object
            .get("content")
            .and_then(serde_json::Value::as_str)
            .unwrap_or_default();
        if source_id.is_empty()
            || source_id.len() > 200
            || supplied_title.is_empty()
            || supplied_content.chars().count() > 20_000
            || !seen.insert(format!("{source_type}:{source_id}"))
        {
            return Err("项目问答证据字段无效或重复".into());
        }
        let (title, canonical_content, structured, source_kind, source_id_detail) =
            match source_type {
                "memory" => {
                    let row = sqlx::query_as::<_, (String, String, String, Option<String>)>(
                        "SELECT m.title, m.content, m.source_kind, m.source_id
                         FROM project_memories m JOIN projects p ON p.id = m.project_id
                         WHERE m.id = ? AND m.project_id = ? AND m.status = 'confirmed'
                           AND p.archived_at IS NULL",
                    )
                    .bind(source_id)
                    .bind(project_id)
                    .fetch_optional(&mut *connection)
                    .await
                    .map_err(|error| format!("无法校验项目记忆证据：{error}"))?
                    .ok_or_else(|| "项目问答记忆证据不属于当前项目或未确认".to_string())?;
                    (row.0, row.1, false, Some(row.2), row.3)
                }
                "project" => {
                    let row = sqlx::query_as::<_, (String, String, String, String, String, i64, String, String, String, String, String, String, String)>(
                        "SELECT name, goal, status, COALESCE(start_date,''), COALESCE(end_date,''), progress,
                                background, phase, target_users, core_problem, success_metrics, constraints, owner
                         FROM projects WHERE id = ? AND id = ? AND archived_at IS NULL",
                    )
                    .bind(source_id)
                    .bind(project_id)
                    .fetch_optional(&mut *connection)
                    .await
                    .map_err(|error| format!("无法校验项目事实证据：{error}"))?
                    .ok_or_else(|| "项目问答项目事实不属于当前项目".to_string())?;
                    let content = serde_json::json!({
                        "goal": row.1, "status": row.2, "startDate": row.3, "endDate": row.4,
                        "progress": row.5, "background": row.6, "phase": row.7,
                        "targetUsers": row.8, "coreProblem": row.9, "successMetrics": row.10,
                        "constraints": row.11, "owner": row.12
                    });
                    (
                        format!("项目：{}", row.0),
                        content.to_string(),
                        true,
                        None,
                        None,
                    )
                }
                "milestone" => {
                    let row = sqlx::query_as::<_, (String, String, i64)>(
                        "SELECT m.title, m.due_date, m.progress FROM milestones m
                         JOIN projects p ON p.id = m.project_id
                         WHERE m.id = ? AND m.project_id = ? AND p.archived_at IS NULL",
                    )
                    .bind(source_id)
                    .bind(project_id)
                    .fetch_optional(&mut *connection)
                    .await
                    .map_err(|error| format!("无法校验项目里程碑证据：{error}"))?
                    .ok_or_else(|| "项目问答里程碑不属于当前项目".to_string())?;
                    (
                        row.0,
                        serde_json::json!({ "dueDate": row.1, "progress": row.2 }).to_string(),
                        true,
                        None,
                        None,
                    )
                }
                "confirmation" => {
                    let row = sqlx::query_as::<_, (String, String, String, Option<String>)>(
                        "SELECT c.title, c.due_date, c.status, c.conclusion FROM confirmation_items c
                         JOIN projects p ON p.id = c.project_id
                         WHERE c.id = ? AND c.project_id = ? AND p.archived_at IS NULL",
                    )
                    .bind(source_id)
                    .bind(project_id)
                    .fetch_optional(&mut *connection)
                    .await
                    .map_err(|error| format!("无法校验项目确认事项证据：{error}"))?
                    .ok_or_else(|| "项目问答确认事项不属于当前项目".to_string())?;
                    (row.0, serde_json::json!({ "dueDate": row.1, "status": row.2, "conclusion": row.3.unwrap_or_default() }).to_string(), true, None, None)
                }
                "risk" => {
                    let row = sqlx::query_as::<_, (String, String, String, String, String, String, String, String)>(
                        "SELECT r.title, r.description, r.severity, r.probability, r.status, r.owner, r.due_date, r.mitigation
                         FROM project_risks r JOIN projects p ON p.id = r.project_id
                         WHERE r.id = ? AND r.project_id = ? AND p.archived_at IS NULL",
                    )
                    .bind(source_id)
                    .bind(project_id)
                    .fetch_optional(&mut *connection)
                    .await
                    .map_err(|error| format!("无法校验项目风险证据：{error}"))?
                    .ok_or_else(|| "项目问答风险不属于当前项目".to_string())?;
                    (row.0, serde_json::json!({ "description": row.1, "severity": row.2, "probability": row.3, "status": row.4, "owner": row.5, "dueDate": row.6, "mitigation": row.7 }).to_string(), true, None, None)
                }
                "dependency" => {
                    let row = sqlx::query_as::<_, (String, String, String, String, String, String, String)>(
                        "SELECT d.title, d.description, d.dependency_type, d.owner, d.due_date, d.status, d.resolution
                         FROM project_dependencies d JOIN projects p ON p.id = d.project_id
                         WHERE d.id = ? AND d.project_id = ? AND p.archived_at IS NULL",
                    )
                    .bind(source_id)
                    .bind(project_id)
                    .fetch_optional(&mut *connection)
                    .await
                    .map_err(|error| format!("无法校验项目依赖证据：{error}"))?
                    .ok_or_else(|| "项目问答依赖不属于当前项目".to_string())?;
                    (row.0, serde_json::json!({ "description": row.1, "dependencyType": row.2, "owner": row.3, "dueDate": row.4, "status": row.5, "resolution": row.6 }).to_string(), true, None, None)
                }
                "release" => {
                    let row = sqlx::query_as::<
                        _,
                        (
                            String,
                            String,
                            String,
                            String,
                            String,
                            String,
                            String,
                            String,
                            String,
                        ),
                    >(
                        "SELECT r.title, r.scope_json, r.checklist_json, r.rollback_plan, r.result,
                                r.retrospective, r.follow_up_json, r.status, r.target_date
                         FROM releases r JOIN projects p ON p.id = r.project_id
                         WHERE r.id = ? AND r.project_id = ? AND p.archived_at IS NULL",
                    )
                    .bind(source_id)
                    .bind(project_id)
                    .fetch_optional(&mut *connection)
                    .await
                    .map_err(|error| format!("无法校验项目发布证据：{error}"))?
                    .ok_or_else(|| "项目问答发布记录不属于当前项目".to_string())?;
                    (row.0, serde_json::json!({ "scopeJson": row.1, "checklistJson": row.2, "rollbackPlan": row.3, "result": row.4, "retrospective": row.5, "followUpJson": row.6, "status": row.7, "targetDate": row.8 }).to_string(), true, None, None)
                }
                "research" => {
                    let row = sqlx::query_as::<_, (String, String, String, String, String, String)>(
                        "SELECT e.title, e.research_type, e.source_ref, e.accessed_at, e.insight, e.persona_suggestion
                         FROM research_entries e JOIN projects p ON p.id = e.project_id
                         WHERE e.id = ? AND e.project_id = ? AND p.archived_at IS NULL",
                    )
                    .bind(source_id)
                    .bind(project_id)
                    .fetch_optional(&mut *connection)
                    .await
                    .map_err(|error| format!("无法校验项目研究证据：{error}"))?
                    .ok_or_else(|| "项目问答研究记录不属于当前项目".to_string())?;
                    (row.0, serde_json::json!({ "researchType": row.1, "sourceRef": row.2, "accessedAt": row.3, "insight": row.4, "personaSuggestion": row.5 }).to_string(), true, None, None)
                }
                _ => return Err("项目问答证据类型未授权".into()),
            };
        let expected_keys = if source_type == "memory" {
            if source_id_detail.is_some() {
                6
            } else {
                5
            }
        } else {
            4
        };
        let content_matches = if structured {
            serde_json::from_str::<serde_json::Value>(supplied_content).ok()
                == serde_json::from_str::<serde_json::Value>(&canonical_content).ok()
        } else {
            supplied_content == canonical_content
        };
        if object.len() != expected_keys
            || supplied_title != title
            || !content_matches
            || object.get("sourceKind").and_then(serde_json::Value::as_str)
                != source_kind.as_deref()
            || object
                .get("sourceIdDetail")
                .and_then(serde_json::Value::as_str)
                != source_id_detail.as_deref()
        {
            return Err("项目问答证据必须与当前项目数据库快照完全一致".into());
        }
    }
    Ok(())
}

#[tauri::command]
async fn generate_structured_ai_output(
    app: AppHandle,
    state: tauri::State<'_, AiRuntimeManager>,
    request: StructuredGenerationRequest,
) -> Result<StructuredGenerationResult, String> {
    if request.run_id.trim().is_empty()
        || request.run_id.len() > 200
        || !validate_generation_trace_scope(&request)
        || request.idempotency_key.trim().is_empty()
        || request.idempotency_key.len() > 500
    {
        return Err("Agent 运行标识无效".to_string());
    }
    let path = database_path(&app)?;
    let mut connection = sqlite_connection(&path, false).await?;
    if request.run_type == "project_qa" {
        validate_project_qa_prompt(&mut connection, &request).await?;
    }
    if request.run_type == "analysis_explanation" {
        let run_id = request.entity_id.as_deref().unwrap_or_default();
        let project_id = request.project_id.as_deref().unwrap_or_default();
        let stored_run = sqlx::query_as::<_, (String, String, String)>(
            "SELECT r.operator, r.parameters_json, r.result_json
             FROM analysis_runs r
             JOIN analysis_datasets d ON d.id = r.dataset_id
             WHERE r.id = ? AND d.project_id = ?",
        )
        .bind(run_id)
        .bind(project_id)
        .fetch_optional(&mut connection)
        .await
        .map_err(|error| format!("无法校验分析运行范围：{error}"))?;
        let prompt_value: serde_json::Value = serde_json::from_str(&request.prompt)
            .map_err(|_| "分析解释输入不是有效 JSON".to_string())?;
        let stored_run =
            stored_run.ok_or_else(|| "分析解释只能读取当前项目已保存的分析运行".to_string())?;
        let stored_parameters: serde_json::Value = serde_json::from_str(&stored_run.1)
            .map_err(|_| "分析运行参数已损坏，无法生成解释".to_string())?;
        let stored_result: serde_json::Value = serde_json::from_str(&stored_run.2)
            .map_err(|_| "分析运行结果已损坏，无法生成解释".to_string())?;
        if prompt_value
            .get("analysisRunId")
            .and_then(serde_json::Value::as_str)
            != Some(run_id)
            || prompt_value
                .get("operator")
                .and_then(serde_json::Value::as_str)
                != Some(stored_run.0.as_str())
            || prompt_value.get("parameters") != Some(&stored_parameters)
            || prompt_value.get("result") != Some(&stored_result)
        {
            connection.close().await.ok();
            return Err("分析解释输入必须与已保存分析运行完全一致".into());
        }
    }
    if request.run_type == "research_insight" {
        let project_id = request.project_id.as_deref().unwrap_or_default();
        let rows = sqlx::query_as::<_, (String, String, String, String)>(
            "SELECT e.id, e.title, e.insight, e.source_ref FROM research_entries e JOIN projects p ON p.id = e.project_id WHERE e.project_id = ? AND p.archived_at IS NULL ORDER BY e.id",
        )
        .bind(project_id)
        .fetch_all(&mut connection)
        .await
        .map_err(|error| format!("无法校验研究记录范围：{error}"))?;
        if rows.is_empty() {
            connection.close().await.ok();
            return Err("研究洞察 Agent 只能读取当前活动项目已保存的研究记录".into());
        }
        let canonical_entries = serde_json::Value::Array(rows.into_iter().map(|row| serde_json::json!({ "entryId": row.0, "title": row.1, "insight": row.2, "sourceRef": row.3 })).collect());
        let prompt_value: serde_json::Value = serde_json::from_str(&request.prompt)
            .map_err(|_| "研究洞察输入不是有效 JSON".to_string())?;
        if prompt_value
            .get("projectId")
            .and_then(serde_json::Value::as_str)
            != Some(project_id)
            || prompt_value.get("researchEntries") != Some(&canonical_entries)
        {
            connection.close().await.ok();
            return Err("研究洞察输入必须与当前项目已保存研究记录完全一致".into());
        }
    }
    if request.run_type == "risk_review" {
        let project_id = request.project_id.as_deref().unwrap_or_default();
        let rows = sqlx::query_as::<_, (String, String, String, String, String, String, String, String, String, String)>(
            "SELECT r.id, r.title, r.description, r.severity, r.probability, r.status, r.owner, r.due_date, r.mitigation, r.updated_at
             FROM project_risks r JOIN projects p ON p.id = r.project_id
             WHERE r.project_id = ? AND r.status != 'closed' AND p.archived_at IS NULL
             ORDER BY r.id",
        )
        .bind(project_id)
        .fetch_all(&mut connection)
        .await
        .map_err(|error| format!("无法校验风险审阅范围：{error}"))?;
        if rows.is_empty() {
            connection.close().await.ok();
            return Err("风险审阅 Agent 只能读取当前活动项目已保存的开放风险".into());
        }
        let canonical_risks = serde_json::Value::Array(rows.into_iter().map(|row| serde_json::json!({ "id": row.0, "title": row.1, "description": row.2, "severity": row.3, "probability": row.4, "status": row.5, "owner": row.6, "dueDate": row.7, "mitigation": row.8, "updatedAt": row.9 })).collect());
        let prompt_value: serde_json::Value = serde_json::from_str(&request.prompt)
            .map_err(|_| "风险审阅输入不是有效 JSON".to_string())?;
        if prompt_value
            .get("projectId")
            .and_then(serde_json::Value::as_str)
            != Some(project_id)
            || prompt_value.get("risks") != Some(&canonical_risks)
        {
            connection.close().await.ok();
            return Err("风险审阅输入必须与当前项目已保存开放风险完全一致".into());
        }
    }
    if request.run_type == "dependency_review" {
        let project_id = request.project_id.as_deref().unwrap_or_default();
        let rows = sqlx::query_as::<_, (String, String, String, String, String, String, String, String, String, String)>(
            "SELECT d.id, d.title, d.description, d.dependency_type, d.owner, d.due_date, d.status, d.resolution, d.created_at, d.updated_at
             FROM project_dependencies d JOIN projects p ON p.id = d.project_id
             WHERE d.project_id = ? AND d.status != 'resolved' AND p.archived_at IS NULL
             ORDER BY d.id",
        )
        .bind(project_id)
        .fetch_all(&mut connection)
        .await
        .map_err(|error| format!("无法校验依赖处置范围：{error}"))?;
        if rows.is_empty() {
            connection.close().await.ok();
            return Err("依赖处置 Agent 只能读取当前活动项目已保存的未解决依赖".into());
        }
        let canonical_dependencies = serde_json::Value::Array(
            rows.into_iter()
                .map(|row| {
                    serde_json::json!({
                        "id": row.0, "projectId": project_id, "title": row.1, "description": row.2,
                        "dependencyType": row.3, "owner": row.4, "dueDate": row.5, "status": row.6,
                        "resolution": row.7, "createdAt": row.8, "updatedAt": row.9
                    })
                })
                .collect(),
        );
        let prompt_value: serde_json::Value = serde_json::from_str(&request.prompt)
            .map_err(|_| "依赖处置输入不是有效 JSON".to_string())?;
        if prompt_value
            .get("projectId")
            .and_then(serde_json::Value::as_str)
            != Some(project_id)
            || prompt_value.get("dependencies") != Some(&canonical_dependencies)
        {
            connection.close().await.ok();
            return Err("依赖处置输入必须与当前项目已保存未解决依赖快照完全一致".into());
        }
    }
    if request.run_type == "release_review" {
        let project_id = request.project_id.as_deref().unwrap_or_default();
        let rows = sqlx::query_as::<_, (String, String, String, String, String, String, String, String, String, String)>(
            "SELECT r.id, r.title, r.scope_json, r.checklist_json, r.rollback_plan, r.result, r.retrospective, r.follow_up_json, r.status, r.target_date
             FROM releases r JOIN projects p ON p.id = r.project_id
             WHERE r.project_id = ? AND r.status != 'cancelled' AND p.archived_at IS NULL
             ORDER BY r.id",
        )
        .bind(project_id)
        .fetch_all(&mut connection)
        .await
        .map_err(|error| format!("无法校验发布审阅范围：{error}"))?;
        if rows.is_empty() {
            connection.close().await.ok();
            return Err("发布审阅 Agent 只能读取当前活动项目已保存且未取消的发布记录".into());
        }
        let mut canonical_releases = Vec::with_capacity(rows.len());
        for row in rows {
            let scope: serde_json::Value =
                serde_json::from_str(&row.2).map_err(|_| "发布范围数据已损坏".to_string())?;
            let checklist: serde_json::Value =
                serde_json::from_str(&row.3).map_err(|_| "发布检查清单数据已损坏".to_string())?;
            let follow_up: serde_json::Value =
                serde_json::from_str(&row.7).map_err(|_| "发布后续行动数据已损坏".to_string())?;
            if !scope.is_array() || !checklist.is_array() || !follow_up.is_array() {
                connection.close().await.ok();
                return Err("发布记录列表字段已损坏".into());
            }
            canonical_releases.push(serde_json::json!({ "id": row.0, "title": row.1, "scope": scope, "checklist": checklist, "rollbackPlan": row.4, "result": row.5, "retrospective": row.6, "followUp": follow_up, "status": row.8, "targetDate": row.9 }));
        }
        let canonical_releases = serde_json::Value::Array(canonical_releases);
        let prompt_value: serde_json::Value = serde_json::from_str(&request.prompt)
            .map_err(|_| "发布审阅输入不是有效 JSON".to_string())?;
        if prompt_value
            .get("projectId")
            .and_then(serde_json::Value::as_str)
            != Some(project_id)
            || prompt_value.get("releases") != Some(&canonical_releases)
        {
            connection.close().await.ok();
            return Err("发布审阅输入必须与当前项目已保存发布记录完全一致".into());
        }
    }
    if request.run_type == "release_preparation" {
        let project_id = request.project_id.as_deref().unwrap_or_default();
        let rows = sqlx::query_as::<_, (String,String,String,String,String,String,String,String,String,String,String,String)>(
            "SELECT r.id,r.title,r.scope_json,r.checklist_json,r.rollback_plan,r.result,r.retrospective,r.follow_up_json,r.status,r.target_date,r.created_at,r.updated_at FROM releases r JOIN projects p ON p.id=r.project_id WHERE r.project_id=? AND r.status IN ('planned','ready') AND p.archived_at IS NULL ORDER BY r.id"
        ).bind(project_id).fetch_all(&mut connection).await.map_err(|error| format!("无法校验发布准备范围：{error}"))?;
        if rows.is_empty() {
            connection.close().await.ok();
            return Err("发布准备 Agent 只能读取当前活动项目的发布前记录".into());
        }
        let mut canonical = Vec::with_capacity(rows.len());
        for row in rows {
            let scope: serde_json::Value =
                serde_json::from_str(&row.2).map_err(|_| "发布范围数据已损坏".to_string())?;
            let checklist: serde_json::Value =
                serde_json::from_str(&row.3).map_err(|_| "检查清单数据已损坏".to_string())?;
            let follow: serde_json::Value =
                serde_json::from_str(&row.7).map_err(|_| "跟进事项数据已损坏".to_string())?;
            canonical.push(serde_json::json!({"id":row.0,"projectId":project_id,"title":row.1,"scope":scope,"checklist":checklist,"rollbackPlan":row.4,"result":row.5,"retrospective":row.6,"followUp":follow,"status":row.8,"targetDate":row.9,"createdAt":row.10,"updatedAt":row.11}));
        }
        let prompt: serde_json::Value = serde_json::from_str(&request.prompt)
            .map_err(|_| "发布准备输入不是有效 JSON".to_string())?;
        if prompt.get("projectId").and_then(serde_json::Value::as_str) != Some(project_id)
            || prompt.get("releases") != Some(&serde_json::Value::Array(canonical))
        {
            connection.close().await.ok();
            return Err("发布准备输入必须与当前项目发布前记录快照完全一致".into());
        }
    }
    if request.run_type == "competitor_review" {
        let project_id = request.project_id.as_deref().unwrap_or_default();
        let rows = sqlx::query_as::<_, (String, String, String, String, String, String, String)>(
            "SELECT c.id, c.name, c.source_ref, c.accessed_at, c.strengths, c.weaknesses, c.positioning
             FROM competitor_profiles c JOIN projects p ON p.id = c.project_id
             WHERE c.project_id = ? AND p.archived_at IS NULL
             ORDER BY c.id",
        )
        .bind(project_id)
        .fetch_all(&mut connection)
        .await
        .map_err(|error| format!("无法校验竞品审阅范围：{error}"))?;
        if rows.is_empty() {
            connection.close().await.ok();
            return Err("竞品审阅 Agent 只能读取当前活动项目已保存的竞品档案".into());
        }
        let canonical_profiles = serde_json::Value::Array(rows.into_iter().map(|row| serde_json::json!({ "id": row.0, "name": row.1, "sourceRef": row.2, "accessedAt": row.3, "strengths": row.4, "weaknesses": row.5, "positioning": row.6 })).collect());
        let prompt_value: serde_json::Value = serde_json::from_str(&request.prompt)
            .map_err(|_| "竞品审阅输入不是有效 JSON".to_string())?;
        if prompt_value
            .get("projectId")
            .and_then(serde_json::Value::as_str)
            != Some(project_id)
            || prompt_value.get("competitorProfiles") != Some(&canonical_profiles)
        {
            connection.close().await.ok();
            return Err("竞品审阅输入必须与当前项目已保存竞品档案完全一致".into());
        }
    }
    if request.run_type == "knowledge_review" {
        let project_id = request.project_id.as_deref().unwrap_or_default();
        let rows = sqlx::query_as::<_, (String, String, String, String, String, String, Option<String>, Option<String>, Option<String>, Option<String>, Option<f64>, String, String)>(
            "SELECT m.id, m.memory_type, m.status, m.title, m.content, m.source_kind, m.source_id, m.valid_from, m.valid_until, m.conflict_group, m.confidence, m.created_by, m.updated_at
             FROM project_memories m JOIN projects p ON p.id = m.project_id
             WHERE m.project_id = ? AND m.status NOT IN ('archived','rejected') AND p.archived_at IS NULL ORDER BY m.id",
        ).bind(project_id).fetch_all(&mut connection).await.map_err(|error| format!("无法校验知识管理审阅范围：{error}"))?;
        if rows.is_empty() {
            connection.close().await.ok();
            return Err("知识管理 Agent 只能读取当前项目的有效记忆".into());
        }
        let mut canonical_memories = Vec::with_capacity(rows.len());
        for row in rows {
            let sources = sqlx::query_as::<_, (String, String, Option<String>, Option<String>, String)>(
                "SELECT id, source_kind, source_id, quote, created_at FROM project_memory_sources WHERE memory_id = ? ORDER BY created_at, rowid LIMIT 50",
            ).bind(&row.0).fetch_all(&mut connection).await.map_err(|error| format!("无法读取项目记忆来源：{error}"))?;
            let conflicts = sqlx::query_as::<_, (String, String, String, String, String, String, String, String)>(
                "SELECT c.memory_id, c.conflicts_with_memory_id, c.relation_type, related.id, related.title, related.status,
                        CASE WHEN c.memory_id = ? THEN 'outgoing' ELSE 'incoming' END, c.created_at
                 FROM project_memory_conflicts c JOIN project_memories related ON related.id = CASE WHEN c.memory_id = ? THEN c.conflicts_with_memory_id ELSE c.memory_id END
                 WHERE (c.memory_id = ? OR c.conflicts_with_memory_id = ?) AND related.project_id = ? ORDER BY c.created_at DESC",
            ).bind(&row.0).bind(&row.0).bind(&row.0).bind(&row.0).bind(project_id).fetch_all(&mut connection).await.map_err(|error| format!("无法读取项目记忆冲突关系：{error}"))?;
            canonical_memories.push(serde_json::json!({
                "id": row.0, "memoryType": row.1, "status": row.2, "title": row.3, "content": row.4,
                "sourceKind": row.5, "sourceId": row.6, "validFrom": row.7, "validUntil": row.8,
                "conflictGroup": row.9, "confidence": row.10, "createdBy": row.11, "updatedAt": row.12,
                "sources": sources.into_iter().map(|source| serde_json::json!({ "id": source.0, "sourceKind": source.1, "sourceId": source.2, "quote": source.3, "createdAt": source.4 })).collect::<Vec<_>>(),
                    "conflicts": conflicts.into_iter().map(|item| serde_json::json!({ "memoryId": item.0, "conflictsWithMemoryId": item.1, "relationType": item.2, "relatedMemoryId": item.3, "relatedTitle": item.4, "relatedStatus": item.5, "direction": item.6, "createdAt": item.7 })).collect::<Vec<_>>()
            }));
        }
        let canonical = serde_json::Value::Array(canonical_memories);
        let prompt_value: serde_json::Value = serde_json::from_str(&request.prompt)
            .map_err(|_| "知识管理审阅输入不是有效 JSON".to_string())?;
        if prompt_value
            .get("projectId")
            .and_then(serde_json::Value::as_str)
            != Some(project_id)
            || prompt_value.get("memories") != Some(&canonical)
        {
            connection.close().await.ok();
            return Err("知识管理审阅输入必须与当前项目记忆快照完全一致".into());
        }
    }
    if request.run_type == "research_plan_review" || request.run_type == "plan_engineer" {
        let project_id = request.project_id.as_deref().unwrap_or_default();
        let plans = sqlx::query_as::<_, (String, String, String, String, String, String, String, String, String, String)>(
            "SELECT p.id, p.title, p.objective, p.target_persona, p.questions_json, p.status, p.start_date, p.end_date, p.project_id, p.updated_at
             FROM research_plans p JOIN projects project ON project.id = p.project_id
             WHERE p.project_id = ? AND p.status != 'cancelled' AND project.archived_at IS NULL
             ORDER BY p.id",
        )
        .bind(project_id)
        .fetch_all(&mut connection)
        .await
        .map_err(|error| format!("无法校验研究计划审阅范围：{error}"))?;
        if plans.is_empty() {
            connection.close().await.ok();
            return Err("研究计划审阅 Agent 只能读取当前活动项目未取消的研究计划".into());
        }
        let entries = sqlx::query_as::<_, (String, String, String, String, String, String, String, String)>(
            "SELECT id, plan_id, research_type, title, source_ref, accessed_at, insight, persona_suggestion
             FROM research_entries WHERE project_id = ? AND plan_id IS NOT NULL ORDER BY id",
        )
        .bind(project_id)
        .fetch_all(&mut connection)
        .await
        .map_err(|error| format!("无法读取研究计划关联结果：{error}"))?;
        let mut canonical_plans = Vec::with_capacity(plans.len());
        for plan in plans {
            let questions: serde_json::Value = serde_json::from_str(&plan.4)
                .map_err(|_| "研究计划问题提纲数据已损坏".to_string())?;
            if !questions.is_array() {
                connection.close().await.ok();
                return Err("研究计划问题提纲必须是数组".into());
            }
            let results = entries
                .iter()
                .filter(|entry| entry.1.as_str() == plan.0.as_str())
                .map(|entry| {
                    serde_json::json!({
                        "entryId": entry.0,
                        "researchType": entry.2,
                        "title": entry.3,
                        "sourceRef": entry.4,
                        "accessedAt": entry.5,
                        "insight": entry.6,
                        "personaSuggestion": entry.7
                    })
                })
                .collect::<Vec<_>>();
            canonical_plans.push(serde_json::json!({ "id": plan.0, "title": plan.1, "objective": plan.2, "targetPersona": plan.3, "questions": questions, "status": plan.5, "startDate": plan.6, "endDate": plan.7, "updatedAt": plan.9, "results": results }));
        }
        let canonical_plans = serde_json::Value::Array(canonical_plans);
        let prompt_value: serde_json::Value = serde_json::from_str(&request.prompt)
            .map_err(|_| "研究计划审阅输入不是有效 JSON".to_string())?;
        if prompt_value
            .get("projectId")
            .and_then(serde_json::Value::as_str)
            != Some(project_id)
            || prompt_value.get("researchPlans") != Some(&canonical_plans)
        {
            connection.close().await.ok();
            return Err("研究计划审阅输入必须与当前项目已保存计划及关联结果完全一致".into());
        }
    }
    insert_generation_trace_start(&mut connection, &request).await?;
    let manager = state.inner().clone();
    let generation_request = request.clone();
    let result = tauri::async_runtime::spawn_blocking(move || {
        call_sidecar_generation(&manager, &generation_request)
    })
    .await
    .unwrap_or(StructuredGenerationResult {
        state: "failed".to_string(),
        message: "结构化生成任务异常退出".to_string(),
        output: None,
        usage: None,
        duration_ms: 0,
    });
    if result.message.starts_with("AI Sidecar") {
        mark_sidecar_unavailable(&state.inner().clone(), &result.message);
    }
    finish_generation_trace(&mut connection, &request, &result).await?;
    connection.close().await.ok();
    Ok(result)
}

async fn run_ai_sidecar(app: AppHandle, manager: AiRuntimeManager) {
    let mut restart_count = 0_u8;
    loop {
        if ai_runtime_is_stopping(&manager) {
            return;
        }
        let Ok(token) = new_sidecar_session_token() else {
            update_ai_runtime_status(
                &manager,
                AiRuntimeStatus {
                    state: "degraded".to_string(),
                    host: None,
                    port: None,
                    protocol_version: None,
                    restart_count,
                    message: "无法生成 Sidecar 会话令牌，AI 已降级".to_string(),
                },
            );
            return;
        };
        update_ai_runtime_status(
            &manager,
            AiRuntimeStatus {
                state: if restart_count == 0 {
                    "starting"
                } else {
                    "restarting"
                }
                .to_string(),
                host: None,
                port: None,
                protocol_version: None,
                restart_count,
                message: if restart_count == 0 {
                    "正在启动 AI Sidecar"
                } else {
                    "Sidecar 首次退出，正在自动重启"
                }
                .to_string(),
            },
        );

        #[cfg(debug_assertions)]
        let command = {
            let project_root = Path::new(env!("CARGO_MANIFEST_DIR"))
                .parent()
                .unwrap_or_else(|| Path::new("."));
            let sidecar_entry = project_root.join("sidecar").join("src").join("index.mjs");
            app.shell()
                .command("node")
                .arg(sidecar_entry.as_os_str())
                .current_dir(project_root)
        };
        #[cfg(not(debug_assertions))]
        let command = match app.shell().sidecar("apm-sidecar") {
            Ok(command) => command,
            Err(_) => {
                update_ai_runtime_status(
                    &manager,
                    AiRuntimeStatus {
                        state: "degraded".to_string(),
                        host: None,
                        port: None,
                        protocol_version: None,
                        restart_count,
                        message: "安装包中的 AI Sidecar 不可用，AI 已降级".to_string(),
                    },
                );
                return;
            }
        };
        let command = command
            .env("APM_SIDECAR_TOKEN", &token)
            .env("APM_SIDECAR_PORT", "0");
        let Ok((mut events, child)) = command.spawn() else {
            update_ai_runtime_status(
                &manager,
                AiRuntimeStatus {
                    state: "degraded".to_string(),
                    host: None,
                    port: None,
                    protocol_version: None,
                    restart_count,
                    message: "无法启动 Node Sidecar，AI 已降级".to_string(),
                },
            );
            return;
        };
        if let Ok(mut current_child) = manager.child.lock() {
            *current_child = Some(child);
        }

        let mut ready = false;
        while let Some(event) = events.recv().await {
            match event {
                CommandEvent::Stdout(line) if !ready => {
                    let Ok(ready_event) = serde_json::from_slice::<SidecarReadyEvent>(&line) else {
                        continue;
                    };
                    if ready_event.event != "ready"
                        || ready_event.host != "127.0.0.1"
                        || ready_event.port == 0
                        || ready_event.protocol_version != 1
                    {
                        continue;
                    }
                    let healthy = sidecar_health_check(ready_event.port, &token);
                    ready = healthy;
                    if let Ok(mut session_token) = manager.session_token.lock() {
                        *session_token = healthy.then(|| token.clone());
                    }
                    update_ai_runtime_status(
                        &manager,
                        AiRuntimeStatus {
                            state: if healthy { "available" } else { "degraded" }.to_string(),
                            host: Some(ready_event.host),
                            port: Some(ready_event.port),
                            protocol_version: Some(ready_event.protocol_version),
                            restart_count,
                            message: if healthy {
                                "Sidecar 健康检查通过"
                            } else {
                                "Sidecar 已启动但健康检查失败，AI 已降级"
                            }
                            .to_string(),
                        },
                    );
                }
                CommandEvent::Terminated(_) => break,
                CommandEvent::Error(_) => {}
                CommandEvent::Stderr(_) | CommandEvent::Stdout(_) => {}
                _ => {}
            }
        }
        if let Ok(mut current_child) = manager.child.lock() {
            current_child.take();
        }
        if let Ok(mut session_token) = manager.session_token.lock() {
            session_token.take();
        }
        if ai_runtime_is_stopping(&manager) {
            return;
        }
        if sidecar_exit_action(restart_count, ai_runtime_is_stopping(&manager))
            == SidecarExitAction::Restart
        {
            restart_count = 1;
            continue;
        }
        update_ai_runtime_status(
            &manager,
            AiRuntimeStatus {
                state: "degraded".to_string(),
                host: None,
                port: None,
                protocol_version: None,
                restart_count,
                message: "Sidecar 连续退出，AI 已降级；项目、会议和备份仍可用".to_string(),
            },
        );
        return;
    }
}

fn start_ai_sidecar(app: AppHandle, manager: AiRuntimeManager) {
    tauri::async_runtime::spawn(run_ai_sidecar(app, manager));
}

fn stop_ai_sidecar(manager: &AiRuntimeManager) {
    if let Ok(mut inner) = manager.inner.lock() {
        inner.stopping = true;
        let restart_count = inner.status.restart_count;
        inner.status = AiRuntimeStatus {
            state: "stopped".to_string(),
            host: None,
            port: None,
            protocol_version: None,
            restart_count,
            message: "Sidecar 已停止".to_string(),
        };
    }
    if let Ok(mut child) = manager.child.lock() {
        if let Some(child) = child.take() {
            let _ = child.kill();
        }
    }
    if let Ok(mut session_token) = manager.session_token.lock() {
        session_token.take();
    }
}

#[tauri::command]
fn get_ai_runtime_status(state: tauri::State<'_, AiRuntimeManager>) -> AiRuntimeStatus {
    state
        .inner
        .lock()
        .map(|inner| inner.status.clone())
        .unwrap_or(AiRuntimeStatus {
            state: "degraded".to_string(),
            host: None,
            port: None,
            protocol_version: None,
            restart_count: 0,
            message: "无法读取 AI Sidecar 状态".to_string(),
        })
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct AgentRunSummary {
    id: String,
    run_type: String,
    entity_id: Option<String>,
    provider_mode: String,
    model: String,
    status: String,
    duration_ms: Option<i64>,
    input_tokens: Option<i64>,
    output_tokens: Option<i64>,
    error_code: Option<String>,
    error_summary: Option<String>,
    created_at: String,
    completed_at: Option<String>,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct AgentRunStepSummary {
    ordinal: i64,
    step_type: String,
    status: String,
    duration_ms: Option<i64>,
    input_tokens: Option<i64>,
    output_tokens: Option<i64>,
    error_code: Option<String>,
    error_summary: Option<String>,
    created_at: String,
    completed_at: Option<String>,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct AgentDefinitionSummary {
    id: String,
    definition_key: String,
    version: i64,
    name: String,
    description: String,
    input_schema_version: String,
    output_schema_version: String,
    permissions_json: String,
    created_at: String,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct ProductDocumentSummary {
    id: String,
    project_id: String,
    title: String,
    document_type: String,
    status: String,
    version_number: i64,
    content_markdown: String,
    source_json: String,
    change_summary: String,
    created_by: String,
    created_at: String,
    updated_at: String,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct ProductDocumentVersionSummary {
    id: String,
    document_id: String,
    version_number: i64,
    content_markdown: String,
    change_summary: String,
    created_by: String,
    created_at: String,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct AnalysisDatasetSummary {
    id: String,
    project_id: String,
    title: String,
    source_type: String,
    source_format: String,
    schema_json: String,
    rows_json: String,
    content_hash: String,
    created_at: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct CreateAnalysisDatasetRequest {
    id: String,
    project_id: String,
    title: String,
    source_type: String,
    source_format: String,
    schema_json: String,
    rows_json: String,
    content_hash: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct CreateAnalysisRunRequest {
    id: String,
    project_id: String,
    dataset_id: String,
    operator: String,
    parameters_json: String,
    result_json: String,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct AnalysisInsightSummary {
    id: String,
    project_id: String,
    analysis_run_id: String,
    title: String,
    content: String,
    status: String,
    created_by: String,
    target_kind: String,
    target_id: String,
    target_version_id: String,
    created_at: String,
    updated_at: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct CreateAnalysisInsightRequest {
    id: String,
    link_id: String,
    project_id: String,
    analysis_run_id: String,
    title: String,
    content: String,
    target_kind: String,
    target_id: String,
    target_version_id: String,
    created_by: String,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct VocFeedbackSummary {
    id: String,
    project_id: String,
    content: String,
    category: String,
    cluster_key: String,
    severity: String,
    source_type: String,
    source_ref: String,
    evidence: String,
    occurred_at: String,
    created_at: String,
    updated_at: String,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct VocRequirementCandidateSummary {
    id: String,
    project_id: String,
    title: String,
    description: String,
    feedback_ids_json: String,
    status: String,
    created_at: String,
    updated_at: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct CreateVocFeedbackRequest {
    id: String,
    project_id: String,
    content: String,
    category: String,
    cluster_key: String,
    severity: String,
    source_type: String,
    source_ref: String,
    evidence: String,
    occurred_at: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct CreateVocCandidateRequest {
    id: String,
    project_id: String,
    title: String,
    description: String,
    feedback_ids_json: String,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct ProductDecisionSummary {
    id: String,
    project_id: String,
    status: String,
    version_number: i64,
    title: String,
    context: String,
    decision: String,
    alternatives_json: String,
    evidence_json: String,
    objections_json: String,
    impact: String,
    review_date: String,
    created_by: String,
    created_at: String,
    updated_at: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct CreateProductDecisionRequest {
    id: String,
    version_id: String,
    project_id: String,
    title: String,
    context: String,
    decision: String,
    alternatives_json: String,
    evidence_json: String,
    objections_json: String,
    impact: String,
    review_date: String,
    created_by: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct CreateProductDecisionVersionRequest {
    version_id: String,
    project_id: String,
    decision_id: String,
    title: String,
    context: String,
    decision: String,
    alternatives_json: String,
    evidence_json: String,
    objections_json: String,
    impact: String,
    review_date: String,
    created_by: String,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct ProjectRiskSummary {
    id: String,
    project_id: String,
    title: String,
    description: String,
    severity: String,
    probability: String,
    status: String,
    owner: String,
    due_date: String,
    mitigation: String,
    created_at: String,
    updated_at: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct CreateProjectRiskRequest {
    id: String,
    project_id: String,
    title: String,
    description: String,
    severity: String,
    probability: String,
    owner: String,
    due_date: String,
    mitigation: String,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct ProjectDependencySummary {
    id: String,
    project_id: String,
    title: String,
    description: String,
    dependency_type: String,
    owner: String,
    due_date: String,
    status: String,
    resolution: String,
    created_at: String,
    updated_at: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct CreateProjectDependencyRequest {
    id: String,
    project_id: String,
    title: String,
    description: String,
    dependency_type: String,
    owner: String,
    due_date: String,
    resolution: String,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct ResearchEntrySummary {
    id: String,
    project_id: String,
    plan_id: Option<String>,
    research_type: String,
    title: String,
    source_ref: String,
    accessed_at: String,
    insight: String,
    persona_suggestion: String,
    created_at: String,
    updated_at: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct CreateResearchEntryRequest {
    id: String,
    project_id: String,
    plan_id: Option<String>,
    research_type: String,
    title: String,
    source_ref: String,
    accessed_at: String,
    insight: String,
    persona_suggestion: String,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct CompetitorProfileSummary {
    id: String,
    project_id: String,
    name: String,
    source_ref: String,
    accessed_at: String,
    strengths: String,
    weaknesses: String,
    positioning: String,
    created_at: String,
    updated_at: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct CreateCompetitorProfileRequest {
    id: String,
    project_id: String,
    name: String,
    source_ref: String,
    accessed_at: String,
    strengths: String,
    weaknesses: String,
    positioning: String,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct ReleaseSummary {
    id: String,
    project_id: String,
    title: String,
    scope_json: String,
    checklist_json: String,
    rollback_plan: String,
    result: String,
    retrospective: String,
    follow_up_json: String,
    status: String,
    target_date: String,
    created_at: String,
    updated_at: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct CreateReleaseRequest {
    id: String,
    project_id: String,
    title: String,
    scope_json: String,
    checklist_json: String,
    rollback_plan: String,
    result: String,
    retrospective: String,
    follow_up_json: String,
    target_date: String,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct ResearchPlanSummary {
    id: String,
    project_id: String,
    title: String,
    objective: String,
    target_persona: String,
    questions_json: String,
    status: String,
    start_date: String,
    end_date: String,
    created_at: String,
    updated_at: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct CreateResearchPlanRequest {
    id: String,
    project_id: String,
    title: String,
    objective: String,
    target_persona: String,
    questions_json: String,
    start_date: String,
    end_date: String,
}

#[derive(Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct ResearchPlanUpdateChanges {
    #[serde(skip_serializing_if = "Option::is_none")]
    objective: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    target_persona: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    questions: Option<Vec<String>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    start_date: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    end_date: Option<String>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct ResearchPlanUpdateProposalDraft {
    id: String,
    plan_id: String,
    expected_updated_at: String,
    changes: ResearchPlanUpdateChanges,
    rationale: String,
    citations: serde_json::Value,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct SaveResearchPlanUpdateProposalsRequest {
    project_id: String,
    run_id: String,
    proposals: Vec<ResearchPlanUpdateProposalDraft>,
}

#[derive(Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct ProjectRiskUpdateChanges {
    #[serde(skip_serializing_if = "Option::is_none")]
    mitigation: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    owner: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    due_date: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    severity: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    probability: Option<String>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct ProjectRiskUpdateProposalDraft {
    id: String,
    risk_id: String,
    expected_updated_at: String,
    changes: ProjectRiskUpdateChanges,
    rationale: String,
    citations: serde_json::Value,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct SaveProjectRiskUpdateProposalsRequest {
    project_id: String,
    run_id: String,
    proposals: Vec<ProjectRiskUpdateProposalDraft>,
}

#[derive(Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct ProjectDependencyUpdateChanges {
    #[serde(skip_serializing_if = "Option::is_none")]
    owner: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    due_date: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    resolution: Option<String>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct ProjectDependencyUpdateProposalDraft {
    id: String,
    dependency_id: String,
    expected_updated_at: String,
    changes: ProjectDependencyUpdateChanges,
    rationale: String,
    citations: serde_json::Value,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct SaveProjectDependencyUpdateProposalsRequest {
    project_id: String,
    run_id: String,
    proposals: Vec<ProjectDependencyUpdateProposalDraft>,
}

#[derive(Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct ReleasePreparationChanges {
    #[serde(skip_serializing_if = "Option::is_none")]
    scope: Option<Vec<String>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    checklist: Option<Vec<String>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    rollback_plan: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    target_date: Option<String>,
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct ReleasePreparationProposalDraft {
    id: String,
    release_id: String,
    expected_updated_at: String,
    changes: ReleasePreparationChanges,
    rationale: String,
    citations: serde_json::Value,
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct SaveReleasePreparationProposalsRequest {
    project_id: String,
    run_id: String,
    proposals: Vec<ReleasePreparationProposalDraft>,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct AgentToolProposalSummary {
    id: String,
    project_id: String,
    target_type: String,
    target_id: String,
    agent_run_id: String,
    agent_definition_id: String,
    tool_key: String,
    expected_target_updated_at: String,
    payload_json: String,
    evidence_json: String,
    rationale: String,
    status: String,
    created_at: String,
    updated_at: String,
    reviewed_at: Option<String>,
    executed_at: Option<String>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct AgentToolProposalActionResult {
    status: String,
}

type AgentToolProposalRow = (
    String,
    String,
    String,
    String,
    String,
    String,
    String,
    String,
    String,
    String,
    String,
    String,
    String,
    String,
    Option<String>,
    Option<String>,
);

fn agent_tool_proposal_summary(row: AgentToolProposalRow) -> AgentToolProposalSummary {
    AgentToolProposalSummary {
        id: row.0,
        project_id: row.1,
        target_type: row.2,
        target_id: row.3,
        agent_run_id: row.4,
        agent_definition_id: row.5,
        tool_key: row.6,
        expected_target_updated_at: row.7,
        payload_json: row.8,
        evidence_json: row.9,
        rationale: row.10,
        status: row.11,
        created_at: row.12,
        updated_at: row.13,
        reviewed_at: row.14,
        executed_at: row.15,
    }
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct ResearchInsightSummary {
    id: String,
    project_id: String,
    plan_id: Option<String>,
    entry_id: String,
    title: String,
    statement: String,
    evidence_json: String,
    status: String,
    created_at: String,
    updated_at: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct CreateResearchInsightRequest {
    id: String,
    project_id: String,
    plan_id: Option<String>,
    entry_id: String,
    title: String,
    statement: String,
    evidence_json: String,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct ResearchRequirementCandidateSummary {
    id: String,
    project_id: String,
    insight_id: String,
    title: String,
    description: String,
    status: String,
    requirement_card_id: Option<String>,
    created_at: String,
    updated_at: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct CreateResearchRequirementCandidateRequest {
    id: String,
    project_id: String,
    insight_id: String,
    title: String,
    description: String,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct MetricDefinitionSummary {
    id: String,
    project_id: String,
    version_number: i64,
    name: String,
    description: String,
    unit: String,
    formula_json: String,
    source_dataset_id: String,
    created_at: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct CreateMetricDefinitionRequest {
    id: String,
    project_id: String,
    name: String,
    description: String,
    unit: String,
    formula_json: String,
    source_dataset_id: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct CreateExperimentRequest {
    id: String,
    project_id: String,
    name: String,
    hypothesis: String,
    primary_metric: String,
    sample_plan: String,
    start_date: String,
    end_date: String,
    status: String,
    conclusion: String,
    decision: String,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct ExperimentSummary {
    id: String,
    project_id: String,
    version_number: i64,
    name: String,
    hypothesis: String,
    primary_metric: String,
    sample_plan: String,
    start_date: String,
    end_date: String,
    status: String,
    conclusion: String,
    decision: String,
    created_at: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct CreateProductDocumentRequest {
    id: String,
    project_id: String,
    title: String,
    document_type: String,
    content_markdown: String,
    change_summary: Option<String>,
    source_json: Option<String>,
}

fn validate_product_document_fields(
    id: &str,
    project_id: &str,
    title: &str,
    document_type: &str,
    content_markdown: &str,
    change_summary: &str,
) -> Result<(), String> {
    if id.trim().is_empty() || id.len() > 200 || id.contains(':') {
        return Err("文档标识无效".to_string());
    }
    if project_id.trim().is_empty() || project_id.len() > 200 {
        return Err("项目标识无效".to_string());
    }
    if title.trim().is_empty() || title.chars().count() > 200 {
        return Err("文档标题不能为空且不能超过 200 个字符".to_string());
    }
    if !matches!(document_type, "prd" | "design_brief" | "markdown") {
        return Err("文档类型无效".to_string());
    }
    if content_markdown.len() > 200_000 {
        return Err("Markdown 内容不能超过 200 KB".to_string());
    }
    if change_summary.chars().count() > 500 {
        return Err("版本说明不能超过 500 个字符".to_string());
    }
    Ok(())
}

type ProductDocumentRow = (
    String,
    String,
    String,
    String,
    String,
    i64,
    String,
    String,
    String,
    String,
    String,
    String,
);

fn product_document_from_row(row: ProductDocumentRow) -> ProductDocumentSummary {
    ProductDocumentSummary {
        id: row.0,
        project_id: row.1,
        title: row.2,
        document_type: row.3,
        status: row.4,
        version_number: row.5,
        content_markdown: row.6,
        source_json: row.7,
        change_summary: row.8,
        created_by: row.9,
        created_at: row.10,
        updated_at: row.11,
    }
}

async fn validate_product_document_sources(
    connection: &mut SqliteConnection,
    project_id: &str,
    source_json: &str,
) -> Result<String, String> {
    if source_json.len() > 20_000 {
        return Err("文档来源信息过长".to_string());
    }
    let values: serde_json::Value =
        serde_json::from_str(source_json).map_err(|_| "文档来源信息不是有效 JSON".to_string())?;
    let Some(items) = values.as_array() else {
        return Err("文档来源信息必须是 JSON 数组".to_string());
    };
    if items.len() > 50 {
        return Err("文档来源不能超过 50 条".to_string());
    }
    let mut canonical = Vec::with_capacity(items.len());
    let mut seen = std::collections::HashSet::new();
    for item in items {
        let Some(object) = item.as_object() else {
            return Err("文档来源条目格式无效".to_string());
        };
        if object.get("kind").and_then(serde_json::Value::as_str) != Some("requirement") {
            return Err("当前只允许关联已确认需求".to_string());
        }
        let Some(id) = object.get("id").and_then(serde_json::Value::as_str) else {
            return Err("需求来源缺少标识".to_string());
        };
        if id.trim().is_empty() || id.len() > 200 || !seen.insert(id.to_string()) {
            return Err("需求来源标识无效或重复".to_string());
        }
        let requested_version = object.get("versionId").and_then(serde_json::Value::as_str);
        let row = sqlx::query_as::<_, (String, String)>(
            "SELECT c.title, v.id
             FROM requirement_cards c
             JOIN requirement_versions v ON v.id = c.current_version_id
             WHERE c.id = ? AND c.project_id = ? AND c.status = 'confirmed' AND v.is_confirmed = 1
               AND (? IS NULL OR v.id = ?)",
        )
        .bind(id)
        .bind(project_id)
        .bind(requested_version)
        .bind(requested_version)
        .fetch_optional(&mut *connection)
        .await
        .map_err(|error| format!("无法校验需求来源: {error}"))?;
        let Some((title, version_id)) = row else {
            return Err("只能关联当前项目已确认的需求版本".to_string());
        };
        canonical.push(serde_json::json!({ "kind": "requirement", "id": id, "versionId": version_id, "title": title }));
    }
    serde_json::to_string(&canonical).map_err(|error| format!("无法规范化文档来源: {error}"))
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct ProjectMemorySearchResult {
    id: String,
    project_id: String,
    memory_type: String,
    status: String,
    title: String,
    content: String,
    source_kind: String,
    source_id: Option<String>,
    source_locator_json: String,
    valid_from: Option<String>,
    valid_until: Option<String>,
    conflict_group: Option<String>,
    confidence: Option<f64>,
    created_by: String,
    updated_at: String,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct ProjectMemorySourceResult {
    id: String,
    source_kind: String,
    source_id: Option<String>,
    locator_json: String,
    quote: Option<String>,
    created_at: String,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct ProjectMemoryConflictResult {
    memory_id: String,
    conflicts_with_memory_id: String,
    relation_type: String,
    direction: String,
    related_memory_id: String,
    related_title: String,
    related_status: String,
    created_at: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct CreateProjectMemoryCandidateRequest {
    id: String,
    project_id: String,
    title: String,
    content: String,
    memory_type: String,
    source_kind: String,
    source_id: Option<String>,
    source_locator_json: String,
    confidence: Option<f64>,
    created_by: String,
}

fn validate_memory_candidate(request: &CreateProjectMemoryCandidateRequest) -> Result<(), String> {
    if request.id.trim().is_empty() || request.id.len() > 200 {
        return Err("记忆标识无效".to_string());
    }
    if request.project_id.trim().is_empty() || request.project_id.len() > 200 {
        return Err("项目标识无效".to_string());
    }
    if request.title.trim().is_empty() || request.title.chars().count() > 200 {
        return Err("记忆标题不能为空且不能超过 200 个字符".to_string());
    }
    if request.content.trim().is_empty() || request.content.len() > 100_000 {
        return Err("记忆内容不能为空且不能超过 100 KB".to_string());
    }
    if !matches!(
        request.source_kind.as_str(),
        "project" | "meeting" | "requirement" | "manual" | "agent"
    ) {
        return Err("记忆来源类型无效".to_string());
    }
    if request
        .source_id
        .as_ref()
        .is_some_and(|value| value.len() > 200)
    {
        return Err("记忆来源标识不能超过 200 字节".to_string());
    }
    if !matches!(request.created_by.as_str(), "user" | "agent") {
        return Err("记忆候选创建者无效".to_string());
    }
    let allowed_type = match request.created_by.as_str() {
        "agent" => matches!(
            request.memory_type.as_str(),
            "pending_candidate" | "inference"
        ),
        _ => matches!(
            request.memory_type.as_str(),
            "pending_candidate" | "inference" | "temporary_context"
        ),
    };
    if !allowed_type {
        return Err("新记忆必须先作为候选；Agent 不能直接创建已确认事实".to_string());
    }
    if request
        .confidence
        .is_some_and(|value| !(0.0..=1.0).contains(&value))
    {
        return Err("记忆置信度必须位于 0 到 1 之间".to_string());
    }
    if request.source_locator_json.len() > 10_000 {
        return Err("记忆来源定位信息过长".to_string());
    }
    let locator: serde_json::Value = serde_json::from_str(&request.source_locator_json)
        .map_err(|_| "记忆来源定位信息不是有效 JSON".to_string())?;
    if !locator.is_object() {
        return Err("记忆来源定位信息必须是 JSON 对象".to_string());
    }
    Ok(())
}

fn memory_fts_query(query: &str) -> Result<String, String> {
    if query.trim().is_empty() || query.len() > 500 {
        return Err("记忆搜索词不能为空且不能超过 500 字节".to_string());
    }
    let terms = query
        .split_whitespace()
        .map(|term| {
            term.chars()
                .filter(|character| character.is_alphanumeric() || matches!(character, '_' | '-'))
                .collect::<String>()
        })
        .filter(|term| !term.is_empty())
        .map(|term| format!("\"{term}\"*"))
        .collect::<Vec<_>>();
    if terms.is_empty() {
        return Err("记忆搜索词不包含可搜索字符".to_string());
    }
    Ok(terms.join(" AND "))
}

fn valid_memory_status(status: Option<&str>) -> Result<(), String> {
    if let Some(status) = status {
        if !matches!(
            status,
            "pending" | "confirmed" | "rejected" | "expired" | "archived"
        ) {
            return Err("记忆状态筛选无效".to_string());
        }
    }
    Ok(())
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct KnowledgeItemResult {
    id: String,
    item_type: String,
    status: String,
    domain: String,
    project_id: Option<String>,
    scope_id: Option<String>,
    title: String,
    content_markdown: String,
    target_kind: Option<String>,
    target_id: Option<String>,
    target_version: Option<String>,
    content_version: i64,
    created_by: String,
    created_at: String,
    updated_at: String,
    confirmed_at: Option<String>,
    archived_at: Option<String>,
    archived_from_status: Option<String>,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct KnowledgeSourceResult {
    id: String,
    item_id: String,
    source_kind: String,
    source_ref: String,
    source_version: String,
    content_hash: String,
    title: String,
    locator_json: String,
    captured_at: String,
    created_at: String,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct KnowledgeRelationResult {
    id: String,
    from_item_id: String,
    to_item_id: String,
    relation_type: String,
    status: String,
    evidence_json: String,
    created_by: String,
    created_at: String,
    updated_at: String,
    confirmed_at: Option<String>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct CreateKnowledgeItemRequest {
    id: String,
    item_type: String,
    domain: String,
    project_id: Option<String>,
    title: String,
    content_markdown: String,
    target_kind: Option<String>,
    target_id: Option<String>,
    target_version: Option<String>,
    created_by: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct AddKnowledgeSourceRequest {
    id: String,
    item_id: String,
    domain: String,
    project_id: Option<String>,
    source_kind: String,
    source_ref: String,
    source_version: String,
    content_hash: String,
    title: String,
    locator_json: String,
    captured_at: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct CreateKnowledgeRelationRequest {
    id: String,
    from_item_id: String,
    to_item_id: String,
    domain: String,
    project_id: Option<String>,
    relation_type: String,
    evidence_json: String,
    created_by: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct UpdateKnowledgeItemRequest {
    item_id: String,
    domain: String,
    project_id: Option<String>,
    expected_content_version: i64,
    title: String,
    content_markdown: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct ImportKnowledgeSource {
    id: String,
    item_id: String,
    source_kind: String,
    source_ref: String,
    source_version: String,
    content_hash: String,
    title: String,
    locator: serde_json::Value,
    captured_at: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct ImportKnowledgeRelation {
    id: String,
    from_item_id: String,
    to_item_id: String,
    relation_type: String,
    evidence: serde_json::Value,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct ImportKnowledgeItem {
    id: String,
    item_type: String,
    domain: String,
    project_id: Option<String>,
    title: String,
    content_markdown: String,
    target_kind: Option<String>,
    target_id: Option<String>,
    target_version: Option<String>,
    content_version: i64,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct ImportKnowledgePackage {
    schema_version: String,
    item: ImportKnowledgeItem,
    sources: Vec<ImportKnowledgeSource>,
    relations: Vec<ImportKnowledgeRelation>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct ImportKnowledgePackageRequest {
    package_hash: String,
    package: ImportKnowledgePackage,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct ImportKnowledgePackageResult {
    status: String,
    item: Option<KnowledgeItemResult>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct KnowledgeAdapterCandidateResult {
    target_kind: String,
    target_id: String,
    target_version: String,
    project_id: Option<String>,
    title: String,
}

fn valid_knowledge_id(value: &str) -> bool {
    !value.trim().is_empty() && value.len() <= 200 && !value.chars().any(char::is_control)
}

fn validate_enabled_knowledge_scope(domain: &str, project_id: Option<&str>) -> Result<(), String> {
    match (
        domain,
        project_id.map(str::trim).filter(|value| !value.is_empty()),
    ) {
        ("project", Some(project_id)) if valid_knowledge_id(project_id) => Ok(()),
        ("personal", None) => Ok(()),
        ("company" | "team", _) => Err("公司域和团队域尚未启用".to_string()),
        _ => Err("知识域与项目标识不匹配".to_string()),
    }
}

fn validate_create_knowledge_item(request: &CreateKnowledgeItemRequest) -> Result<(), String> {
    if !valid_knowledge_id(&request.id) {
        return Err("知识标识无效".to_string());
    }
    validate_enabled_knowledge_scope(&request.domain, request.project_id.as_deref())?;
    if request.title.trim().is_empty() || request.title.chars().count() > 200 {
        return Err("知识标题不能为空且不能超过 200 个字符".to_string());
    }
    if request.content_markdown.len() > 500_000 {
        return Err("知识正文不能超过 500 KB".to_string());
    }
    if !matches!(request.created_by.as_str(), "user" | "agent") {
        return Err("知识创建者无效".to_string());
    }
    match request.item_type.as_str() {
        "meeting_record" => {
            if request.target_kind.as_deref() != Some("meeting")
                || request
                    .target_id
                    .as_deref()
                    .is_none_or(|value| !valid_knowledge_id(value))
                || request
                    .target_version
                    .as_deref()
                    .is_none_or(|value| value.trim().is_empty() || value.len() > 200)
                || !request.content_markdown.trim().is_empty()
            {
                return Err("会议知识必须引用准确的会议及来源版本，不能复制正文".to_string());
            }
        }
        "project_decision" => {
            if request.target_kind.as_deref() != Some("product_decision")
                || request
                    .target_id
                    .as_deref()
                    .is_none_or(|value| !valid_knowledge_id(value))
                || request
                    .target_version
                    .as_deref()
                    .is_none_or(|value| value.trim().is_empty() || value.len() > 200)
                || !request.content_markdown.trim().is_empty()
            {
                return Err("决策知识必须引用准确的决策及版本，不能复制正文".to_string());
            }
        }
        "technical_discussion" | "product_idea" | "ai_learning" => {
            if request.content_markdown.trim().is_empty()
                || request.target_kind.is_some()
                || request.target_id.is_some()
                || request.target_version.is_some()
            {
                return Err("技术讨论、产品想法和 AI 学习必须自行承载正文".to_string());
            }
        }
        _ => return Err("知识记录类型无效".to_string()),
    }
    Ok(())
}

fn validate_add_knowledge_source(request: &AddKnowledgeSourceRequest) -> Result<(), String> {
    if !valid_knowledge_id(&request.id) || !valid_knowledge_id(&request.item_id) {
        return Err("知识来源标识无效".to_string());
    }
    validate_enabled_knowledge_scope(&request.domain, request.project_id.as_deref())?;
    if !matches!(
        request.source_kind.as_str(),
        "manual"
            | "markdown"
            | "meeting"
            | "product_document"
            | "product_decision"
            | "research_entry"
            | "project_memory"
            | "external_url"
    ) {
        return Err("知识来源类型无效".to_string());
    }
    if request.source_ref.trim().is_empty() || request.source_ref.len() > 1_000 {
        return Err("知识来源引用无效".to_string());
    }
    if request.source_kind == "external_url" {
        let source_ref = request.source_ref.trim();
        let authority = source_ref
            .strip_prefix("https://")
            .and_then(|value| value.split('/').next())
            .filter(|value| !value.is_empty());
        if authority.is_none_or(|value| value.contains('@'))
            || source_ref.chars().any(char::is_whitespace)
        {
            return Err("外部来源只允许不含凭据的 HTTPS 地址".to_string());
        }
    }
    if request.source_version.trim().is_empty() || request.source_version.len() > 200 {
        return Err("知识来源版本无效".to_string());
    }
    if request.content_hash.len() != 64
        || !request
            .content_hash
            .bytes()
            .all(|byte| byte.is_ascii_digit() || (b'a'..=b'f').contains(&byte))
    {
        return Err("知识来源哈希必须是小写 SHA-256".to_string());
    }
    if request.title.trim().is_empty() || request.title.chars().count() > 200 {
        return Err("知识来源标题无效".to_string());
    }
    if request.locator_json.len() > 10_000 {
        return Err("知识来源定位信息过长".to_string());
    }
    let locator: serde_json::Value = serde_json::from_str(&request.locator_json)
        .map_err(|_| "知识来源定位信息不是有效 JSON".to_string())?;
    if !locator.is_object() {
        return Err("知识来源定位信息必须是 JSON 对象".to_string());
    }
    if request.captured_at.trim().is_empty() || request.captured_at.len() > 100 {
        return Err("知识来源采集时间无效".to_string());
    }
    Ok(())
}

fn validate_create_knowledge_relation(
    request: &CreateKnowledgeRelationRequest,
) -> Result<(), String> {
    if !valid_knowledge_id(&request.id)
        || !valid_knowledge_id(&request.from_item_id)
        || !valid_knowledge_id(&request.to_item_id)
        || request.from_item_id == request.to_item_id
    {
        return Err("知识关系标识无效".to_string());
    }
    validate_enabled_knowledge_scope(&request.domain, request.project_id.as_deref())?;
    if !matches!(
        request.relation_type.as_str(),
        "derived_from" | "supports" | "contradicts" | "relates_to" | "supersedes"
    ) {
        return Err("知识关系类型无效".to_string());
    }
    if !matches!(request.created_by.as_str(), "user" | "agent") {
        return Err("知识关系创建者无效".to_string());
    }
    if request.evidence_json.len() > 50_000 {
        return Err("知识关系证据过长".to_string());
    }
    let evidence: serde_json::Value = serde_json::from_str(&request.evidence_json)
        .map_err(|_| "知识关系证据不是有效 JSON".to_string())?;
    if !evidence.is_array() || evidence.as_array().is_some_and(|items| items.len() > 20) {
        return Err("知识关系证据必须是最多 20 项的 JSON 数组".to_string());
    }
    Ok(())
}

fn valid_lower_sha256(value: &str) -> bool {
    value.len() == 64
        && value
            .bytes()
            .all(|byte| byte.is_ascii_digit() || (b'a'..=b'f').contains(&byte))
}

fn validate_update_knowledge_item(request: &UpdateKnowledgeItemRequest) -> Result<(), String> {
    if !valid_knowledge_id(&request.item_id) || request.expected_content_version <= 0 {
        return Err("知识标识或预期版本无效".to_string());
    }
    validate_enabled_knowledge_scope(&request.domain, request.project_id.as_deref())?;
    if request.title.trim().is_empty() || request.title.chars().count() > 200 {
        return Err("知识标题不能为空且不能超过 200 个字符".to_string());
    }
    if request.content_markdown.trim().is_empty() || request.content_markdown.len() > 500_000 {
        return Err("知识正文不能为空且不能超过 500 KB".to_string());
    }
    Ok(())
}

fn map_knowledge_item_row(row: sqlx::sqlite::SqliteRow) -> Result<KnowledgeItemResult, String> {
    Ok(KnowledgeItemResult {
        id: row.try_get("id").map_err(|error| error.to_string())?,
        item_type: row
            .try_get("item_type")
            .map_err(|error| error.to_string())?,
        status: row.try_get("status").map_err(|error| error.to_string())?,
        domain: row.try_get("domain").map_err(|error| error.to_string())?,
        project_id: row
            .try_get("project_id")
            .map_err(|error| error.to_string())?,
        scope_id: row.try_get("scope_id").map_err(|error| error.to_string())?,
        title: row.try_get("title").map_err(|error| error.to_string())?,
        content_markdown: row
            .try_get("content_markdown")
            .map_err(|error| error.to_string())?,
        target_kind: row
            .try_get("target_kind")
            .map_err(|error| error.to_string())?,
        target_id: row
            .try_get("target_id")
            .map_err(|error| error.to_string())?,
        target_version: row
            .try_get("target_version")
            .map_err(|error| error.to_string())?,
        content_version: row
            .try_get("content_version")
            .map_err(|error| error.to_string())?,
        created_by: row
            .try_get("created_by")
            .map_err(|error| error.to_string())?,
        created_at: row
            .try_get("created_at")
            .map_err(|error| error.to_string())?,
        updated_at: row
            .try_get("updated_at")
            .map_err(|error| error.to_string())?,
        confirmed_at: row
            .try_get("confirmed_at")
            .map_err(|error| error.to_string())?,
        archived_at: row
            .try_get("archived_at")
            .map_err(|error| error.to_string())?,
        archived_from_status: row
            .try_get("archived_from_status")
            .map_err(|error| error.to_string())?,
    })
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct AgentRecoveryResult {
    recovered_runs: u64,
    recovered_steps: u64,
}

async fn recover_interrupted_agent_runs_in_connection(
    connection: &mut SqliteConnection,
) -> Result<AgentRecoveryResult, String> {
    let completed_at = trace_timestamp();
    let mut transaction = connection
        .begin()
        .await
        .map_err(|error| error.to_string())?;
    let recovered_steps = sqlx::query(
        "UPDATE agent_run_steps
         SET status = 'failed', error_code = 'process_interrupted',
             error_summary = '应用进程中断；未自动重试模型请求', completed_at = ?
         WHERE status IN ('queued', 'running')",
    )
    .bind(&completed_at)
    .execute(&mut *transaction)
    .await
    .map_err(|error| format!("无法恢复中断的 Agent 步骤: {error}"))?
    .rows_affected();
    let recovered_runs = sqlx::query(
        "UPDATE agent_runs
         SET status = 'failed', error_code = 'process_interrupted',
             error_summary = '应用进程中断；未自动重试模型请求', completed_at = ?
         WHERE status IN ('queued', 'running')",
    )
    .bind(&completed_at)
    .execute(&mut *transaction)
    .await
    .map_err(|error| format!("无法恢复中断的 Agent 运行: {error}"))?
    .rows_affected();
    transaction
        .commit()
        .await
        .map_err(|error| error.to_string())?;
    Ok(AgentRecoveryResult {
        recovered_runs,
        recovered_steps,
    })
}

#[tauri::command]
async fn recover_interrupted_agent_runs(app: AppHandle) -> Result<AgentRecoveryResult, String> {
    let path = database_path(&app)?;
    let mut connection = sqlite_connection(&path, false).await?;
    let result = recover_interrupted_agent_runs_in_connection(&mut connection).await;
    connection.close().await.ok();
    result
}

#[tauri::command]
async fn list_recent_agent_runs(
    app: AppHandle,
    limit: Option<u8>,
) -> Result<Vec<AgentRunSummary>, String> {
    let limit = i64::from(limit.unwrap_or(10).clamp(1, 50));
    let path = database_path(&app)?;
    let mut connection = sqlite_connection(&path, true).await?;
    let runs = sqlx::query_as::<
        _,
        (
            String,
            String,
            Option<String>,
            String,
            String,
            String,
            Option<i64>,
            Option<i64>,
            Option<i64>,
            Option<String>,
            Option<String>,
            String,
            Option<String>,
        ),
    >(
        "SELECT id, run_type, entity_id, provider_mode, model, status,
                duration_ms, input_tokens, output_tokens, error_code,
                error_summary, created_at, completed_at
         FROM agent_runs ORDER BY rowid DESC LIMIT ?",
    )
    .bind(limit)
    .fetch_all(&mut connection)
    .await
    .map(|rows| {
        rows.into_iter()
            .map(|row| AgentRunSummary {
                id: row.0,
                run_type: row.1,
                entity_id: row.2,
                provider_mode: row.3,
                model: row.4,
                status: row.5,
                duration_ms: row.6,
                input_tokens: row.7,
                output_tokens: row.8,
                error_code: row.9,
                error_summary: row.10,
                created_at: row.11,
                completed_at: row.12,
            })
            .collect()
    })
    .map_err(|error| format!("无法读取 Agent 运行记录: {error}"));
    connection.close().await.ok();
    runs
}

#[tauri::command]
async fn list_agent_run_steps(
    app: AppHandle,
    run_id: String,
) -> Result<Vec<AgentRunStepSummary>, String> {
    if run_id.trim().is_empty() || run_id.len() > 200 {
        return Err("Agent 运行标识无效".to_string());
    }
    let path = database_path(&app)?;
    let mut connection = sqlite_connection(&path, true).await?;
    let steps = sqlx::query_as::<
        _,
        (
            i64,
            String,
            String,
            Option<i64>,
            Option<i64>,
            Option<i64>,
            Option<String>,
            Option<String>,
            String,
            Option<String>,
        ),
    >(
        "SELECT ordinal, step_type, status, duration_ms, input_tokens, output_tokens,
                error_code, error_summary, created_at, completed_at
         FROM agent_run_steps WHERE agent_run_id = ? ORDER BY ordinal ASC",
    )
    .bind(&run_id)
    .fetch_all(&mut connection)
    .await
    .map(|rows| {
        rows.into_iter()
            .map(|row| AgentRunStepSummary {
                ordinal: row.0,
                step_type: row.1,
                status: row.2,
                duration_ms: row.3,
                input_tokens: row.4,
                output_tokens: row.5,
                error_code: row.6,
                error_summary: row.7,
                created_at: row.8,
                completed_at: row.9,
            })
            .collect()
    })
    .map_err(|error| format!("无法读取 Agent 步骤记录: {error}"));
    connection.close().await.ok();
    steps
}

#[tauri::command]
async fn list_agent_definitions(app: AppHandle) -> Result<Vec<AgentDefinitionSummary>, String> {
    let path = database_path(&app)?;
    let mut connection = sqlite_connection(&path, true).await?;
    let definitions = sqlx::query_as::<
        _,
        (
            String,
            String,
            i64,
            String,
            String,
            String,
            String,
            String,
            String,
        ),
    >(
        "SELECT id, definition_key, version, name, description, input_schema_version,
                output_schema_version, permissions_json, created_at
         FROM agent_definitions ORDER BY definition_key ASC, version DESC LIMIT 50",
    )
    .fetch_all(&mut connection)
    .await
    .map(|rows| {
        rows.into_iter()
            .map(|row| AgentDefinitionSummary {
                id: row.0,
                definition_key: row.1,
                version: row.2,
                name: row.3,
                description: row.4,
                input_schema_version: row.5,
                output_schema_version: row.6,
                permissions_json: row.7,
                created_at: row.8,
            })
            .collect()
    })
    .map_err(|error| format!("无法读取 Agent 定义: {error}"));
    connection.close().await.ok();
    definitions
}

async fn fetch_product_document(
    connection: &mut SqliteConnection,
    project_id: &str,
    document_id: &str,
) -> Result<ProductDocumentSummary, String> {
    sqlx::query_as::<_, ProductDocumentRow>(
        "SELECT d.id, d.project_id, d.title, d.document_type, d.status,
                v.version_number, v.content_markdown, v.source_json, v.change_summary,
                v.created_by, d.created_at, d.updated_at
         FROM product_documents d
         JOIN product_document_versions v ON v.document_id = d.id
           AND v.version_number = (SELECT MAX(version_number) FROM product_document_versions WHERE document_id = d.id)
         WHERE d.project_id = ? AND d.id = ?",
    )
    .bind(project_id)
    .bind(document_id)
    .fetch_one(connection)
    .await
    .map(product_document_from_row)
    .map_err(|error| format!("无法读取产品文档: {error}"))
}

#[tauri::command]
async fn create_analysis_dataset(
    app: AppHandle,
    request: CreateAnalysisDatasetRequest,
) -> Result<AnalysisDatasetSummary, String> {
    if request.id.trim().is_empty()
        || request.id.len() > 200
        || request.id.contains(':')
        || request.project_id.trim().is_empty()
        || request.title.trim().is_empty()
        || request.title.chars().count() > 200
    {
        return Err("数据集标识、项目或标题无效".into());
    }
    if !matches!(request.source_type.as_str(), "csv" | "json")
        || !matches!(request.source_format.as_str(), "csv" | "json" | "xlsx")
        || (request.source_format == "xlsx" && request.source_type != "json")
        || (request.source_format != "xlsx" && request.source_format != request.source_type)
        || request.schema_json.len() > 100_000
        || request.rows_json.len() > 10 * 1024 * 1024
        || request.content_hash.len() != 64
    {
        return Err("数据集格式或大小无效".into());
    }
    let schema: serde_json::Value = serde_json::from_str(&request.schema_json)
        .map_err(|_| "schema_json 不是有效 JSON".to_string())?;
    let rows: serde_json::Value = serde_json::from_str(&request.rows_json)
        .map_err(|_| "rows_json 不是有效 JSON".to_string())?;
    if !schema.is_object()
        || !rows.is_array()
        || rows.as_array().is_some_and(|items| items.len() > 100_000)
    {
        return Err("数据集 JSON 结构无效".into());
    }
    let path = database_path(&app)?;
    let mut connection = sqlite_connection(&path, false).await?;
    let project_exists: i64 =
        sqlx::query_scalar("SELECT COUNT(*) FROM projects WHERE id = ? AND archived_at IS NULL")
            .bind(request.project_id.trim())
            .fetch_one(&mut connection)
            .await
            .map_err(|error| error.to_string())?;
    if project_exists == 0 {
        connection.close().await.ok();
        return Err("项目不存在或已归档".into());
    }
    let created_at = trace_timestamp();
    let result = sqlx::query("INSERT INTO analysis_datasets (id, project_id, title, source_type, source_format, schema_json, rows_json, content_hash, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)")
        .bind(request.id.trim()).bind(request.project_id.trim()).bind(request.title.trim()).bind(&request.source_type).bind(&request.source_format).bind(&request.schema_json).bind(&request.rows_json).bind(&request.content_hash).bind(&created_at).execute(&mut connection).await;
    if let Err(error) = result {
        connection.close().await.ok();
        return Err(format!("无法保存数据集：{error}"));
    }
    let row = sqlx::query_as::<_, (String, String, String, String, String, String, String, String, String)>("SELECT id, project_id, title, source_type, source_format, schema_json, rows_json, content_hash, created_at FROM analysis_datasets WHERE id = ? AND project_id = ?").bind(request.id.trim()).bind(request.project_id.trim()).fetch_one(&mut connection).await;
    connection.close().await.ok();
    row.map(|value| AnalysisDatasetSummary {
        id: value.0,
        project_id: value.1,
        title: value.2,
        source_type: value.3,
        source_format: value.4,
        schema_json: value.5,
        rows_json: value.6,
        content_hash: value.7,
        created_at: value.8,
    })
    .map_err(|error| format!("无法读取数据集：{error}"))
}

#[tauri::command]
async fn list_analysis_datasets(
    app: AppHandle,
    project_id: String,
) -> Result<Vec<AnalysisDatasetSummary>, String> {
    if project_id.trim().is_empty() || project_id.len() > 200 {
        return Err("项目标识无效".into());
    }
    let path = database_path(&app)?;
    let mut connection = sqlite_connection(&path, true).await?;
    let rows = sqlx::query_as::<_, (String, String, String, String, String, String, String, String, String)>("SELECT id, project_id, title, source_type, source_format, schema_json, rows_json, content_hash, created_at FROM analysis_datasets WHERE project_id = ? ORDER BY created_at DESC LIMIT 50").bind(project_id.trim()).fetch_all(&mut connection).await;
    connection.close().await.ok();
    rows.map(|items| {
        items
            .into_iter()
            .map(|value| AnalysisDatasetSummary {
                id: value.0,
                project_id: value.1,
                title: value.2,
                source_type: value.3,
                source_format: value.4,
                schema_json: value.5,
                rows_json: value.6,
                content_hash: value.7,
                created_at: value.8,
            })
            .collect()
    })
    .map_err(|error| format!("无法读取数据集：{error}"))
}

#[tauri::command]
async fn create_analysis_run(
    app: AppHandle,
    request: CreateAnalysisRunRequest,
) -> Result<(), String> {
    if request.id.trim().is_empty()
        || request.id.len() > 200
        || request.project_id.trim().is_empty()
        || request.dataset_id.trim().is_empty()
        || !matches!(
            request.operator.as_str(),
            "summary" | "funnel" | "cohort" | "trend"
        )
        || request.parameters_json.len() > 50_000
        || request.result_json.len() > 1_000_000
    {
        return Err("分析运行参数无效".into());
    }
    serde_json::from_str::<serde_json::Value>(&request.parameters_json)
        .map_err(|_| "parameters_json 不是有效 JSON".to_string())?;
    serde_json::from_str::<serde_json::Value>(&request.result_json)
        .map_err(|_| "result_json 不是有效 JSON".to_string())?;
    let path = database_path(&app)?;
    let mut connection = sqlite_connection(&path, false).await?;
    let result = sqlx::query("INSERT INTO analysis_runs (id, dataset_id, operator, parameters_json, result_json, created_at) SELECT ?, d.id, ?, ?, ?, ? FROM analysis_datasets d WHERE d.id = ? AND d.project_id = ?")
        .bind(request.id.trim()).bind(&request.operator).bind(&request.parameters_json).bind(&request.result_json).bind(trace_timestamp()).bind(request.dataset_id.trim()).bind(request.project_id.trim()).execute(&mut connection).await;
    connection.close().await.ok();
    match result {
        Ok(outcome) if outcome.rows_affected() == 1 => Ok(()),
        Ok(_) => Err("数据集不存在或不属于当前项目".into()),
        Err(error) => Err(format!("无法保存分析运行：{error}")),
    }
}

#[tauri::command]
async fn create_analysis_insight(
    app: AppHandle,
    request: CreateAnalysisInsightRequest,
) -> Result<AnalysisInsightSummary, String> {
    if request.id.trim().is_empty()
        || request.id.len() > 200
        || request.link_id.trim().is_empty()
        || request.link_id.len() > 200
        || request.project_id.trim().is_empty()
        || request.analysis_run_id.trim().is_empty()
        || request.title.trim().is_empty()
        || request.title.chars().count() > 200
        || request.content.trim().is_empty()
        || request.content.chars().count() > 10_000
        || request.target_id.trim().is_empty()
        || !matches!(
            request.target_kind.as_str(),
            "project" | "requirement" | "experiment"
        )
        || !matches!(request.created_by.as_str(), "user" | "agent")
    {
        return Err("分析洞察字段无效".into());
    }
    if request.target_kind == "project"
        && (request.target_id.trim() != request.project_id.trim()
            || !request.target_version_id.trim().is_empty())
    {
        return Err("项目洞察关联无效".into());
    }
    if request.target_kind != "project" && request.target_version_id.trim().is_empty() {
        return Err("需求或实验关联必须固定到具体版本".into());
    }

    let path = database_path(&app)?;
    let mut connection = sqlite_connection(&path, false).await?;
    let mut transaction = connection
        .begin()
        .await
        .map_err(|error| format!("无法开始保存洞察：{error}"))?;
    let run_exists: i64 = sqlx::query_scalar(
        "SELECT COUNT(*) FROM analysis_runs r
         JOIN analysis_datasets d ON d.id = r.dataset_id
         WHERE r.id = ? AND d.project_id = ?",
    )
    .bind(request.analysis_run_id.trim())
    .bind(request.project_id.trim())
    .fetch_one(&mut *transaction)
    .await
    .map_err(|error| error.to_string())?;
    if run_exists != 1 {
        transaction.rollback().await.ok();
        connection.close().await.ok();
        return Err("分析运行不存在或不属于当前项目".into());
    }

    let target_exists = match request.target_kind.as_str() {
        "project" => {
            sqlx::query_scalar::<_, i64>(
                "SELECT COUNT(*) FROM projects WHERE id = ? AND id = ? AND archived_at IS NULL",
            )
            .bind(request.target_id.trim())
            .bind(request.project_id.trim())
            .fetch_one(&mut *transaction)
            .await
        }
        "requirement" => {
            sqlx::query_scalar::<_, i64>(
                "SELECT COUNT(*) FROM requirement_cards c
             JOIN requirement_versions v ON v.id = c.current_version_id
             WHERE c.id = ? AND c.project_id = ? AND v.id = ?
               AND c.status = 'confirmed' AND v.is_confirmed = 1",
            )
            .bind(request.target_id.trim())
            .bind(request.project_id.trim())
            .bind(request.target_version_id.trim())
            .fetch_one(&mut *transaction)
            .await
        }
        "experiment" => {
            sqlx::query_scalar::<_, i64>(
                "SELECT COUNT(*) FROM experiments
             WHERE id = ? AND project_id = ? AND CAST(version_number AS TEXT) = ?",
            )
            .bind(request.target_id.trim())
            .bind(request.project_id.trim())
            .bind(request.target_version_id.trim())
            .fetch_one(&mut *transaction)
            .await
        }
        _ => unreachable!(),
    }
    .map_err(|error| error.to_string())?;
    if target_exists != 1 {
        transaction.rollback().await.ok();
        connection.close().await.ok();
        return Err("关联目标不存在、不属于当前项目或版本已变化".into());
    }

    let timestamp = trace_timestamp();
    sqlx::query(
        "INSERT INTO analysis_insights
         (id, project_id, analysis_run_id, title, content, status, created_by, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, 'draft', ?, ?, ?)",
    )
    .bind(request.id.trim())
    .bind(request.project_id.trim())
    .bind(request.analysis_run_id.trim())
    .bind(request.title.trim())
    .bind(request.content.trim())
    .bind(&request.created_by)
    .bind(&timestamp)
    .bind(&timestamp)
    .execute(&mut *transaction)
    .await
    .map_err(|error| format!("无法保存分析洞察：{error}"))?;
    sqlx::query(
        "INSERT INTO analysis_insight_links
         (id, insight_id, target_kind, target_id, target_version_id, created_at)
         VALUES (?, ?, ?, ?, ?, ?)",
    )
    .bind(request.link_id.trim())
    .bind(request.id.trim())
    .bind(&request.target_kind)
    .bind(request.target_id.trim())
    .bind(request.target_version_id.trim())
    .bind(&timestamp)
    .execute(&mut *transaction)
    .await
    .map_err(|error| format!("无法保存洞察关联：{error}"))?;
    transaction
        .commit()
        .await
        .map_err(|error| format!("无法提交分析洞察：{error}"))?;
    connection.close().await.ok();
    Ok(AnalysisInsightSummary {
        id: request.id.trim().into(),
        project_id: request.project_id.trim().into(),
        analysis_run_id: request.analysis_run_id.trim().into(),
        title: request.title.trim().into(),
        content: request.content.trim().into(),
        status: "draft".into(),
        created_by: request.created_by,
        target_kind: request.target_kind,
        target_id: request.target_id.trim().into(),
        target_version_id: request.target_version_id.trim().into(),
        created_at: timestamp.clone(),
        updated_at: timestamp,
    })
}

#[tauri::command]
async fn list_analysis_insights(
    app: AppHandle,
    project_id: String,
) -> Result<Vec<AnalysisInsightSummary>, String> {
    if project_id.trim().is_empty() || project_id.len() > 200 {
        return Err("项目标识无效".into());
    }
    let path = database_path(&app)?;
    let mut connection = sqlite_connection(&path, true).await?;
    let rows = sqlx::query_as::<
        _,
        (
            String,
            String,
            String,
            String,
            String,
            String,
            String,
            String,
            String,
            String,
            String,
            String,
        ),
    >(
        "SELECT i.id, i.project_id, i.analysis_run_id, i.title, i.content, i.status,
                i.created_by, l.target_kind, l.target_id, l.target_version_id,
                i.created_at, i.updated_at
         FROM analysis_insights i
         JOIN analysis_insight_links l ON l.insight_id = i.id
         WHERE i.project_id = ?
         ORDER BY i.updated_at DESC LIMIT 200",
    )
    .bind(project_id.trim())
    .fetch_all(&mut connection)
    .await;
    connection.close().await.ok();
    rows.map(|items| {
        items
            .into_iter()
            .map(|value| AnalysisInsightSummary {
                id: value.0,
                project_id: value.1,
                analysis_run_id: value.2,
                title: value.3,
                content: value.4,
                status: value.5,
                created_by: value.6,
                target_kind: value.7,
                target_id: value.8,
                target_version_id: value.9,
                created_at: value.10,
                updated_at: value.11,
            })
            .collect()
    })
    .map_err(|error| format!("无法读取分析洞察：{error}"))
}

#[tauri::command]
async fn review_analysis_insight(
    app: AppHandle,
    project_id: String,
    insight_id: String,
    action: String,
) -> Result<(), String> {
    if project_id.trim().is_empty()
        || insight_id.trim().is_empty()
        || !matches!(action.as_str(), "confirm" | "archive")
    {
        return Err("洞察审核参数无效".into());
    }
    let (next_status, allowed_status) = if action == "confirm" {
        ("confirmed", "draft")
    } else {
        ("archived", "draft,confirmed")
    };
    let path = database_path(&app)?;
    let mut connection = sqlite_connection(&path, false).await?;
    let result = if action == "confirm" {
        sqlx::query("UPDATE analysis_insights SET status = ?, updated_at = ? WHERE id = ? AND project_id = ? AND status = ?")
            .bind(next_status).bind(trace_timestamp()).bind(insight_id.trim()).bind(project_id.trim()).bind(allowed_status).execute(&mut connection).await
    } else {
        sqlx::query("UPDATE analysis_insights SET status = ?, updated_at = ? WHERE id = ? AND project_id = ? AND status IN ('draft', 'confirmed')")
            .bind(next_status).bind(trace_timestamp()).bind(insight_id.trim()).bind(project_id.trim()).execute(&mut connection).await
    };
    connection.close().await.ok();
    match result {
        Ok(outcome) if outcome.rows_affected() == 1 => Ok(()),
        Ok(_) => Err("洞察状态已变化，请刷新后重试".into()),
        Err(error) => Err(format!("无法审核分析洞察：{error}")),
    }
}

fn valid_voc_date(value: &str) -> bool {
    let bytes = value.as_bytes();
    if !(bytes.len() >= 10
        && bytes[4] == b'-'
        && bytes[7] == b'-'
        && bytes[..10]
            .iter()
            .enumerate()
            .all(|(index, byte)| index == 4 || index == 7 || byte.is_ascii_digit()))
    {
        return false;
    }
    let month = value[5..7].parse::<u8>().unwrap_or_default();
    let day = value[8..10].parse::<u8>().unwrap_or_default();
    (1..=12).contains(&month) && (1..=31).contains(&day)
}

#[tauri::command]
async fn create_voc_feedback(
    app: AppHandle,
    request: CreateVocFeedbackRequest,
) -> Result<VocFeedbackSummary, String> {
    if request.id.trim().is_empty()
        || request.id.len() > 200
        || request.project_id.trim().is_empty()
        || request.content.trim().is_empty()
        || request.content.chars().count() > 5_000
        || request.category.trim().is_empty()
        || request.category.chars().count() > 100
        || request.cluster_key.trim().is_empty()
        || request.cluster_key.chars().count() > 300
        || !matches!(
            request.severity.as_str(),
            "low" | "medium" | "high" | "critical"
        )
        || !matches!(
            request.source_type.as_str(),
            "manual" | "interview" | "survey" | "support" | "import"
        )
        || request.source_ref.chars().count() > 200
        || request.evidence.chars().count() > 2_000
        || !valid_voc_date(request.occurred_at.trim())
    {
        return Err("VOC 反馈字段无效".into());
    }
    let path = database_path(&app)?;
    let mut connection = sqlite_connection(&path, false).await?;
    let project_exists: i64 =
        sqlx::query_scalar("SELECT COUNT(*) FROM projects WHERE id = ? AND archived_at IS NULL")
            .bind(request.project_id.trim())
            .fetch_one(&mut connection)
            .await
            .map_err(|error| error.to_string())?;
    if project_exists != 1 {
        connection.close().await.ok();
        return Err("项目不存在或已归档".into());
    }
    let timestamp = trace_timestamp();
    sqlx::query("INSERT INTO voc_feedback (id, project_id, content, category, cluster_key, severity, source_type, source_ref, evidence, occurred_at, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)")
        .bind(request.id.trim()).bind(request.project_id.trim()).bind(request.content.trim()).bind(request.category.trim()).bind(request.cluster_key.trim()).bind(&request.severity).bind(&request.source_type).bind(request.source_ref.trim()).bind(request.evidence.trim()).bind(request.occurred_at.trim()).bind(&timestamp).bind(&timestamp).execute(&mut connection).await.map_err(|error| format!("无法保存 VOC 反馈：{error}"))?;
    connection.close().await.ok();
    Ok(VocFeedbackSummary {
        id: request.id.trim().into(),
        project_id: request.project_id.trim().into(),
        content: request.content.trim().into(),
        category: request.category.trim().into(),
        cluster_key: request.cluster_key.trim().into(),
        severity: request.severity,
        source_type: request.source_type,
        source_ref: request.source_ref.trim().into(),
        evidence: request.evidence.trim().into(),
        occurred_at: request.occurred_at.trim().into(),
        created_at: timestamp.clone(),
        updated_at: timestamp,
    })
}

#[tauri::command]
async fn create_voc_feedback_batch(
    app: AppHandle,
    requests: Vec<CreateVocFeedbackRequest>,
) -> Result<Vec<VocFeedbackSummary>, String> {
    if requests.is_empty() || requests.len() > 500 {
        return Err("单次必须导入 1–500 条 VOC 反馈".into());
    }
    let project_id = requests[0].project_id.trim().to_string();
    for request in &requests {
        if request.id.trim().is_empty()
            || request.id.len() > 200
            || request.project_id.trim() != project_id
            || request.content.trim().is_empty()
            || request.content.chars().count() > 5_000
            || request.category.trim().is_empty()
            || request.category.chars().count() > 100
            || request.cluster_key.trim().is_empty()
            || request.cluster_key.chars().count() > 300
            || !matches!(
                request.severity.as_str(),
                "low" | "medium" | "high" | "critical"
            )
            || !matches!(
                request.source_type.as_str(),
                "manual" | "interview" | "survey" | "support" | "import"
            )
            || request.source_ref.chars().count() > 200
            || request.evidence.chars().count() > 2_000
            || !valid_voc_date(request.occurred_at.trim())
        {
            return Err("VOC 批量反馈字段无效或项目不一致".into());
        }
    }
    let path = database_path(&app)?;
    let mut connection = sqlite_connection(&path, false).await?;
    let project_exists: i64 =
        sqlx::query_scalar("SELECT COUNT(*) FROM projects WHERE id = ? AND archived_at IS NULL")
            .bind(&project_id)
            .fetch_one(&mut connection)
            .await
            .map_err(|error| error.to_string())?;
    if project_exists != 1 {
        connection.close().await.ok();
        return Err("项目不存在或已归档".into());
    }
    let mut transaction = connection
        .begin()
        .await
        .map_err(|error| error.to_string())?;
    let timestamp = trace_timestamp();
    let mut summaries = Vec::with_capacity(requests.len());
    for request in requests {
        sqlx::query("INSERT INTO voc_feedback (id, project_id, content, category, cluster_key, severity, source_type, source_ref, evidence, occurred_at, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)")
            .bind(request.id.trim()).bind(&project_id).bind(request.content.trim()).bind(request.category.trim()).bind(request.cluster_key.trim()).bind(&request.severity).bind(&request.source_type).bind(request.source_ref.trim()).bind(request.evidence.trim()).bind(request.occurred_at.trim()).bind(&timestamp).bind(&timestamp).execute(&mut *transaction).await.map_err(|error| format!("VOC 批量导入已回滚：{error}"))?;
        summaries.push(VocFeedbackSummary {
            id: request.id.trim().into(),
            project_id: project_id.clone(),
            content: request.content.trim().into(),
            category: request.category.trim().into(),
            cluster_key: request.cluster_key.trim().into(),
            severity: request.severity,
            source_type: request.source_type,
            source_ref: request.source_ref.trim().into(),
            evidence: request.evidence.trim().into(),
            occurred_at: request.occurred_at.trim().into(),
            created_at: timestamp.clone(),
            updated_at: timestamp.clone(),
        });
    }
    transaction
        .commit()
        .await
        .map_err(|error| format!("VOC 批量导入提交失败：{error}"))?;
    connection.close().await.ok();
    Ok(summaries)
}

#[tauri::command]
async fn list_voc_feedback(
    app: AppHandle,
    project_id: String,
) -> Result<Vec<VocFeedbackSummary>, String> {
    if project_id.trim().is_empty() || project_id.len() > 200 {
        return Err("项目标识无效".into());
    }
    let path = database_path(&app)?;
    let mut connection = sqlite_connection(&path, true).await?;
    let rows = sqlx::query_as::<_, (String, String, String, String, String, String, String, String, String, String, String, String)>("SELECT id, project_id, content, category, cluster_key, severity, source_type, source_ref, evidence, occurred_at, created_at, updated_at FROM voc_feedback WHERE project_id = ? ORDER BY occurred_at DESC, created_at DESC LIMIT 500").bind(project_id.trim()).fetch_all(&mut connection).await;
    connection.close().await.ok();
    rows.map(|items| {
        items
            .into_iter()
            .map(|value| VocFeedbackSummary {
                id: value.0,
                project_id: value.1,
                content: value.2,
                category: value.3,
                cluster_key: value.4,
                severity: value.5,
                source_type: value.6,
                source_ref: value.7,
                evidence: value.8,
                occurred_at: value.9,
                created_at: value.10,
                updated_at: value.11,
            })
            .collect()
    })
    .map_err(|error| format!("无法读取 VOC 反馈：{error}"))
}

#[tauri::command]
async fn create_voc_requirement_candidate(
    app: AppHandle,
    request: CreateVocCandidateRequest,
) -> Result<VocRequirementCandidateSummary, String> {
    if request.id.trim().is_empty()
        || request.id.len() > 200
        || request.project_id.trim().is_empty()
        || request.title.trim().is_empty()
        || request.title.chars().count() > 200
        || request.description.trim().is_empty()
        || request.description.chars().count() > 5_000
        || request.feedback_ids_json.len() > 50_000
    {
        return Err("VOC 需求候选字段无效".into());
    }
    let feedback_ids: serde_json::Value = serde_json::from_str(&request.feedback_ids_json)
        .map_err(|_| "feedback_ids_json 不是有效 JSON".to_string())?;
    let ids = feedback_ids
        .as_array()
        .ok_or_else(|| "反馈候选必须是数组".to_string())?;
    if ids.is_empty() || ids.len() > 100 || ids.iter().any(|item| item.as_str().is_none()) {
        return Err("反馈候选必须包含 1–100 个有效 ID".into());
    }
    let path = database_path(&app)?;
    let mut connection = sqlite_connection(&path, false).await?;
    let project_exists: i64 =
        sqlx::query_scalar("SELECT COUNT(*) FROM projects WHERE id = ? AND archived_at IS NULL")
            .bind(request.project_id.trim())
            .fetch_one(&mut connection)
            .await
            .map_err(|error| error.to_string())?;
    let placeholders = std::iter::repeat("?")
        .take(ids.len())
        .collect::<Vec<_>>()
        .join(",");
    let sql = format!(
        "SELECT COUNT(*) FROM voc_feedback WHERE project_id = ? AND id IN ({placeholders})"
    );
    let mut query = sqlx::query_scalar::<_, i64>(&sql).bind(request.project_id.trim());
    for id in ids {
        query = query.bind(id.as_str().unwrap());
    }
    let feedback_count = query
        .fetch_one(&mut connection)
        .await
        .map_err(|error| error.to_string())?;
    if project_exists != 1 || feedback_count != ids.len() as i64 {
        connection.close().await.ok();
        return Err("项目不存在、已归档或反馈不属于当前项目".into());
    }
    let timestamp = trace_timestamp();
    sqlx::query("INSERT INTO voc_requirement_candidates (id, project_id, title, description, feedback_ids_json, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, 'draft', ?, ?)").bind(request.id.trim()).bind(request.project_id.trim()).bind(request.title.trim()).bind(request.description.trim()).bind(&request.feedback_ids_json).bind(&timestamp).bind(&timestamp).execute(&mut connection).await.map_err(|error| format!("无法保存 VOC 需求候选：{error}"))?;
    connection.close().await.ok();
    Ok(VocRequirementCandidateSummary {
        id: request.id.trim().into(),
        project_id: request.project_id.trim().into(),
        title: request.title.trim().into(),
        description: request.description.trim().into(),
        feedback_ids_json: request.feedback_ids_json,
        status: "draft".into(),
        created_at: timestamp.clone(),
        updated_at: timestamp,
    })
}

#[tauri::command]
async fn list_voc_requirement_candidates(
    app: AppHandle,
    project_id: String,
) -> Result<Vec<VocRequirementCandidateSummary>, String> {
    if project_id.trim().is_empty() || project_id.len() > 200 {
        return Err("项目标识无效".into());
    }
    let path = database_path(&app)?;
    let mut connection = sqlite_connection(&path, true).await?;
    let rows = sqlx::query_as::<_, (String, String, String, String, String, String, String, String)>("SELECT id, project_id, title, description, feedback_ids_json, status, created_at, updated_at FROM voc_requirement_candidates WHERE project_id = ? ORDER BY updated_at DESC LIMIT 200").bind(project_id.trim()).fetch_all(&mut connection).await;
    connection.close().await.ok();
    rows.map(|items| {
        items
            .into_iter()
            .map(|value| VocRequirementCandidateSummary {
                id: value.0,
                project_id: value.1,
                title: value.2,
                description: value.3,
                feedback_ids_json: value.4,
                status: value.5,
                created_at: value.6,
                updated_at: value.7,
            })
            .collect()
    })
    .map_err(|error| format!("无法读取 VOC 需求候选：{error}"))
}

#[tauri::command]
async fn review_voc_requirement_candidate(
    app: AppHandle,
    project_id: String,
    candidate_id: String,
    action: String,
) -> Result<(), String> {
    if project_id.trim().is_empty()
        || candidate_id.trim().is_empty()
        || !matches!(action.as_str(), "accept" | "reject")
    {
        return Err("VOC 候选审核参数无效".into());
    }
    let status = if action == "accept" {
        "accepted"
    } else {
        "rejected"
    };
    let path = database_path(&app)?;
    let mut connection = sqlite_connection(&path, false).await?;
    let result = sqlx::query("UPDATE voc_requirement_candidates SET status = ?, updated_at = ? WHERE id = ? AND project_id = ? AND status = 'draft'").bind(status).bind(trace_timestamp()).bind(candidate_id.trim()).bind(project_id.trim()).execute(&mut connection).await;
    connection.close().await.ok();
    match result {
        Ok(outcome) if outcome.rows_affected() == 1 => Ok(()),
        Ok(_) => Err("VOC 候选状态已变化，请刷新后重试".into()),
        Err(error) => Err(format!("无法审核 VOC 候选：{error}")),
    }
}

fn validate_decision_json_list(value: &str, label: &str) -> Result<(), String> {
    if value.len() > 50_000 {
        return Err(format!("{label}过长"));
    }
    let parsed: serde_json::Value =
        serde_json::from_str(value).map_err(|_| format!("{label}不是有效 JSON"))?;
    let items = parsed
        .as_array()
        .ok_or_else(|| format!("{label}必须是数组"))?;
    if items.len() > 50
        || items.iter().any(|item| {
            item.as_str()
                .is_none_or(|text| text.trim().is_empty() || text.chars().count() > 1_000)
        })
    {
        return Err(format!("{label}包含无效条目"));
    }
    Ok(())
}

fn validate_decision_fields(
    title: &str,
    context: &str,
    decision: &str,
    alternatives_json: &str,
    evidence_json: &str,
    objections_json: &str,
    impact: &str,
    review_date: &str,
    created_by: &str,
) -> Result<(), String> {
    if title.trim().is_empty()
        || title.chars().count() > 200
        || context.trim().is_empty()
        || context.chars().count() > 5_000
        || decision.trim().is_empty()
        || decision.chars().count() > 5_000
        || impact.trim().is_empty()
        || impact.chars().count() > 3_000
        || !valid_voc_date(review_date)
        || !matches!(created_by, "user" | "agent")
    {
        return Err("决策字段无效".into());
    }
    validate_decision_json_list(alternatives_json, "备选方案")?;
    validate_decision_json_list(evidence_json, "证据")?;
    validate_decision_json_list(objections_json, "异议")
}

type ProductDecisionRow = (
    String,
    String,
    String,
    i64,
    String,
    String,
    String,
    String,
    String,
    String,
    String,
    String,
    String,
    String,
    String,
);
fn product_decision_from_row(value: ProductDecisionRow) -> ProductDecisionSummary {
    ProductDecisionSummary {
        id: value.0,
        project_id: value.1,
        status: value.2,
        version_number: value.3,
        title: value.4,
        context: value.5,
        decision: value.6,
        alternatives_json: value.7,
        evidence_json: value.8,
        objections_json: value.9,
        impact: value.10,
        review_date: value.11,
        created_by: value.12,
        created_at: value.13,
        updated_at: value.14,
    }
}

#[tauri::command]
async fn create_product_decision(
    app: AppHandle,
    request: CreateProductDecisionRequest,
) -> Result<ProductDecisionSummary, String> {
    if request.id.trim().is_empty()
        || request.version_id.trim().is_empty()
        || request.project_id.trim().is_empty()
    {
        return Err("决策标识无效".into());
    }
    validate_decision_fields(
        &request.title,
        &request.context,
        &request.decision,
        &request.alternatives_json,
        &request.evidence_json,
        &request.objections_json,
        &request.impact,
        &request.review_date,
        &request.created_by,
    )?;
    let path = database_path(&app)?;
    let mut connection = sqlite_connection(&path, false).await?;
    let project_exists: i64 =
        sqlx::query_scalar("SELECT COUNT(*) FROM projects WHERE id = ? AND archived_at IS NULL")
            .bind(request.project_id.trim())
            .fetch_one(&mut connection)
            .await
            .map_err(|error| error.to_string())?;
    if project_exists != 1 {
        connection.close().await.ok();
        return Err("项目不存在或已归档".into());
    }
    let mut transaction = connection
        .begin()
        .await
        .map_err(|error| error.to_string())?;
    let timestamp = trace_timestamp();
    sqlx::query("INSERT INTO product_decisions (id, project_id, status, current_version_number, created_at, updated_at) VALUES (?, ?, 'proposed', 1, ?, ?)").bind(request.id.trim()).bind(request.project_id.trim()).bind(&timestamp).bind(&timestamp).execute(&mut *transaction).await.map_err(|error| format!("无法保存决策：{error}"))?;
    sqlx::query("INSERT INTO product_decision_versions (id, decision_id, version_number, title, context, decision_text, alternatives_json, evidence_json, objections_json, impact, review_date, created_by, created_at) VALUES (?, ?, 1, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)").bind(request.version_id.trim()).bind(request.id.trim()).bind(request.title.trim()).bind(request.context.trim()).bind(request.decision.trim()).bind(&request.alternatives_json).bind(&request.evidence_json).bind(&request.objections_json).bind(request.impact.trim()).bind(&request.review_date).bind(&request.created_by).bind(&timestamp).execute(&mut *transaction).await.map_err(|error| format!("无法保存决策版本：{error}"))?;
    transaction
        .commit()
        .await
        .map_err(|error| error.to_string())?;
    connection.close().await.ok();
    Ok(ProductDecisionSummary {
        id: request.id.trim().into(),
        project_id: request.project_id.trim().into(),
        status: "proposed".into(),
        version_number: 1,
        title: request.title.trim().into(),
        context: request.context.trim().into(),
        decision: request.decision.trim().into(),
        alternatives_json: request.alternatives_json,
        evidence_json: request.evidence_json,
        objections_json: request.objections_json,
        impact: request.impact.trim().into(),
        review_date: request.review_date,
        created_by: request.created_by,
        created_at: timestamp.clone(),
        updated_at: timestamp,
    })
}

#[tauri::command]
async fn create_product_decision_version(
    app: AppHandle,
    request: CreateProductDecisionVersionRequest,
) -> Result<ProductDecisionSummary, String> {
    if request.version_id.trim().is_empty()
        || request.project_id.trim().is_empty()
        || request.decision_id.trim().is_empty()
    {
        return Err("决策版本标识无效".into());
    }
    validate_decision_fields(
        &request.title,
        &request.context,
        &request.decision,
        &request.alternatives_json,
        &request.evidence_json,
        &request.objections_json,
        &request.impact,
        &request.review_date,
        &request.created_by,
    )?;
    let path = database_path(&app)?;
    let mut connection = sqlite_connection(&path, false).await?;
    let mut transaction = connection
        .begin()
        .await
        .map_err(|error| error.to_string())?;
    let next_version: Option<i64> = sqlx::query_scalar("SELECT current_version_number + 1 FROM product_decisions WHERE id = ? AND project_id = ? AND status != 'archived'").bind(request.decision_id.trim()).bind(request.project_id.trim()).fetch_optional(&mut *transaction).await.map_err(|error| error.to_string())?;
    let next_version =
        next_version.ok_or_else(|| "决策不存在、已归档或不属于当前项目".to_string())?;
    let timestamp = trace_timestamp();
    sqlx::query("INSERT INTO product_decision_versions (id, decision_id, version_number, title, context, decision_text, alternatives_json, evidence_json, objections_json, impact, review_date, created_by, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)").bind(request.version_id.trim()).bind(request.decision_id.trim()).bind(next_version).bind(request.title.trim()).bind(request.context.trim()).bind(request.decision.trim()).bind(&request.alternatives_json).bind(&request.evidence_json).bind(&request.objections_json).bind(request.impact.trim()).bind(&request.review_date).bind(&request.created_by).bind(&timestamp).execute(&mut *transaction).await.map_err(|error| format!("无法保存决策新版本：{error}"))?;
    let updated = sqlx::query("UPDATE product_decisions SET current_version_number = ?, status = 'proposed', updated_at = ? WHERE id = ? AND project_id = ? AND current_version_number = ?").bind(next_version).bind(&timestamp).bind(request.decision_id.trim()).bind(request.project_id.trim()).bind(next_version - 1).execute(&mut *transaction).await.map_err(|error| error.to_string())?;
    if updated.rows_affected() != 1 {
        transaction.rollback().await.ok();
        connection.close().await.ok();
        return Err("决策版本并发变化，请刷新后重试".into());
    }
    transaction
        .commit()
        .await
        .map_err(|error| error.to_string())?;
    connection.close().await.ok();
    Ok(ProductDecisionSummary {
        id: request.decision_id.trim().into(),
        project_id: request.project_id.trim().into(),
        status: "proposed".into(),
        version_number: next_version,
        title: request.title.trim().into(),
        context: request.context.trim().into(),
        decision: request.decision.trim().into(),
        alternatives_json: request.alternatives_json,
        evidence_json: request.evidence_json,
        objections_json: request.objections_json,
        impact: request.impact.trim().into(),
        review_date: request.review_date,
        created_by: request.created_by,
        created_at: timestamp.clone(),
        updated_at: timestamp,
    })
}

#[tauri::command]
async fn list_product_decisions(
    app: AppHandle,
    project_id: String,
) -> Result<Vec<ProductDecisionSummary>, String> {
    if project_id.trim().is_empty() {
        return Err("项目标识无效".into());
    }
    let path = database_path(&app)?;
    let mut connection = sqlite_connection(&path, true).await?;
    let rows = sqlx::query_as::<_, ProductDecisionRow>("SELECT d.id, d.project_id, d.status, v.version_number, v.title, v.context, v.decision_text, v.alternatives_json, v.evidence_json, v.objections_json, v.impact, v.review_date, v.created_by, v.created_at, d.updated_at FROM product_decisions d JOIN product_decision_versions v ON v.decision_id = d.id AND v.version_number = d.current_version_number WHERE d.project_id = ? ORDER BY d.updated_at DESC LIMIT 200").bind(project_id.trim()).fetch_all(&mut connection).await;
    connection.close().await.ok();
    rows.map(|items| items.into_iter().map(product_decision_from_row).collect())
        .map_err(|error| format!("无法读取决策日志：{error}"))
}

#[tauri::command]
async fn list_product_decision_versions(
    app: AppHandle,
    project_id: String,
    decision_id: String,
) -> Result<Vec<ProductDecisionSummary>, String> {
    if project_id.trim().is_empty() || decision_id.trim().is_empty() {
        return Err("决策版本查询参数无效".into());
    }
    let path = database_path(&app)?;
    let mut connection = sqlite_connection(&path, true).await?;
    let rows = sqlx::query_as::<_, ProductDecisionRow>("SELECT d.id, d.project_id, d.status, v.version_number, v.title, v.context, v.decision_text, v.alternatives_json, v.evidence_json, v.objections_json, v.impact, v.review_date, v.created_by, v.created_at, d.updated_at FROM product_decisions d JOIN product_decision_versions v ON v.decision_id = d.id WHERE d.project_id = ? AND d.id = ? ORDER BY v.version_number DESC LIMIT 100").bind(project_id.trim()).bind(decision_id.trim()).fetch_all(&mut connection).await;
    connection.close().await.ok();
    rows.map(|items| items.into_iter().map(product_decision_from_row).collect())
        .map_err(|error| format!("无法读取决策版本：{error}"))
}

#[tauri::command]
async fn review_product_decision(
    app: AppHandle,
    project_id: String,
    decision_id: String,
    action: String,
) -> Result<(), String> {
    if project_id.trim().is_empty()
        || decision_id.trim().is_empty()
        || !matches!(action.as_str(), "confirm" | "revisit" | "archive")
    {
        return Err("决策审核参数无效".into());
    }
    let path = database_path(&app)?;
    let mut connection = sqlite_connection(&path, false).await?;
    let timestamp = trace_timestamp();
    let result = match action.as_str() {
        "confirm" => sqlx::query("UPDATE product_decisions SET status = 'confirmed', updated_at = ? WHERE id = ? AND project_id = ? AND status IN ('proposed', 'revisit')").bind(&timestamp).bind(decision_id.trim()).bind(project_id.trim()).execute(&mut connection).await,
        "revisit" => sqlx::query("UPDATE product_decisions SET status = 'revisit', updated_at = ? WHERE id = ? AND project_id = ? AND status = 'confirmed'").bind(&timestamp).bind(decision_id.trim()).bind(project_id.trim()).execute(&mut connection).await,
        _ => sqlx::query("UPDATE product_decisions SET status = 'archived', updated_at = ? WHERE id = ? AND project_id = ? AND status != 'archived'").bind(&timestamp).bind(decision_id.trim()).bind(project_id.trim()).execute(&mut connection).await,
    };
    connection.close().await.ok();
    match result {
        Ok(outcome) if outcome.rows_affected() == 1 => Ok(()),
        Ok(_) => Err("决策状态已变化，请刷新后重试".into()),
        Err(error) => Err(format!("无法更新决策状态：{error}")),
    }
}

fn validate_project_risk_request(request: &CreateProjectRiskRequest) -> Result<(), String> {
    if request.id.trim().is_empty()
        || request.id.len() > 200
        || request.project_id.trim().is_empty()
        || request.title.trim().is_empty()
        || request.title.chars().count() > 200
        || request.description.chars().count() > 5_000
        || request.owner.chars().count() > 200
        || request.mitigation.chars().count() > 5_000
        || !matches!(
            request.severity.as_str(),
            "low" | "medium" | "high" | "critical"
        )
        || !matches!(
            request.probability.as_str(),
            "unlikely" | "possible" | "likely"
        )
        || !valid_voc_date(&request.due_date)
    {
        return Err("风险字段无效".into());
    }
    Ok(())
}

#[tauri::command]
async fn create_project_risk(
    app: AppHandle,
    request: CreateProjectRiskRequest,
) -> Result<ProjectRiskSummary, String> {
    validate_project_risk_request(&request)?;
    let path = database_path(&app)?;
    let mut connection = sqlite_connection(&path, false).await?;
    let timestamp = trace_timestamp();
    let result = sqlx::query("INSERT INTO project_risks (id, project_id, title, description, severity, probability, status, owner, due_date, mitigation, created_at, updated_at) SELECT ?, id, ?, ?, ?, ?, 'open', ?, ?, ?, ?, ? FROM projects WHERE id = ? AND archived_at IS NULL")
        .bind(request.id.trim()).bind(request.title.trim()).bind(request.description.trim()).bind(request.severity.trim()).bind(request.probability.trim()).bind(request.owner.trim()).bind(request.due_date.trim()).bind(request.mitigation.trim()).bind(&timestamp).bind(&timestamp).bind(request.project_id.trim()).execute(&mut connection).await;
    let row = match result {
        Ok(outcome) if outcome.rows_affected() == 1 => sqlx::query_as::<_, (String, String, String, String, String, String, String, String, String, String, String, String)>("SELECT id, project_id, title, description, severity, probability, status, owner, due_date, mitigation, created_at, updated_at FROM project_risks WHERE id = ?").bind(request.id.trim()).fetch_one(&mut connection).await.map_err(|error| format!("无法读取风险：{error}")),
        Ok(_) => Err("项目不存在、已归档或不属于当前工作区".into()),
        Err(error) => Err(format!("无法保存风险：{error}")),
    };
    connection.close().await.ok();
    row.map(|value| ProjectRiskSummary {
        id: value.0,
        project_id: value.1,
        title: value.2,
        description: value.3,
        severity: value.4,
        probability: value.5,
        status: value.6,
        owner: value.7,
        due_date: value.8,
        mitigation: value.9,
        created_at: value.10,
        updated_at: value.11,
    })
}

#[tauri::command]
async fn list_project_risks(
    app: AppHandle,
    project_id: String,
) -> Result<Vec<ProjectRiskSummary>, String> {
    if project_id.trim().is_empty() || project_id.len() > 200 {
        return Err("项目标识无效".into());
    }
    let path = database_path(&app)?;
    let mut connection = sqlite_connection(&path, true).await?;
    let rows = sqlx::query_as::<_, (String, String, String, String, String, String, String, String, String, String, String, String)>("SELECT id, project_id, title, description, severity, probability, status, owner, due_date, mitigation, created_at, updated_at FROM project_risks WHERE project_id = ? ORDER BY CASE status WHEN 'open' THEN 0 WHEN 'mitigated' THEN 1 WHEN 'accepted' THEN 2 ELSE 3 END, due_date ASC LIMIT 200").bind(project_id.trim()).fetch_all(&mut connection).await;
    connection.close().await.ok();
    rows.map(|items| {
        items
            .into_iter()
            .map(|value| ProjectRiskSummary {
                id: value.0,
                project_id: value.1,
                title: value.2,
                description: value.3,
                severity: value.4,
                probability: value.5,
                status: value.6,
                owner: value.7,
                due_date: value.8,
                mitigation: value.9,
                created_at: value.10,
                updated_at: value.11,
            })
            .collect()
    })
    .map_err(|error| format!("无法读取风险：{error}"))
}

#[tauri::command]
async fn update_project_risk_status(
    app: AppHandle,
    project_id: String,
    risk_id: String,
    status: String,
) -> Result<(), String> {
    if project_id.trim().is_empty()
        || risk_id.trim().is_empty()
        || !matches!(
            status.as_str(),
            "open" | "mitigated" | "accepted" | "closed"
        )
    {
        return Err("风险状态参数无效".into());
    }
    let path = database_path(&app)?;
    let mut connection = sqlite_connection(&path, false).await?;
    let result = sqlx::query(
        "UPDATE project_risks SET status = ?, updated_at = ? WHERE id = ? AND project_id = ?",
    )
    .bind(status.trim())
    .bind(trace_timestamp())
    .bind(risk_id.trim())
    .bind(project_id.trim())
    .execute(&mut connection)
    .await;
    connection.close().await.ok();
    match result {
        Ok(outcome) if outcome.rows_affected() == 1 => Ok(()),
        Ok(_) => Err("风险不存在或项目不匹配".into()),
        Err(error) => Err(format!("无法更新风险状态：{error}")),
    }
}

fn validate_project_dependency_request(
    request: &CreateProjectDependencyRequest,
) -> Result<(), String> {
    if request.id.trim().is_empty()
        || request.id.len() > 200
        || request.project_id.trim().is_empty()
        || request.title.trim().is_empty()
        || request.title.chars().count() > 200
        || request.description.chars().count() > 5_000
        || request.owner.chars().count() > 200
        || request.resolution.chars().count() > 5_000
        || !matches!(
            request.dependency_type.as_str(),
            "internal" | "external" | "technical" | "approval"
        )
        || !valid_voc_date(&request.due_date)
    {
        return Err("依赖字段无效".into());
    }
    Ok(())
}

#[tauri::command]
async fn create_project_dependency(
    app: AppHandle,
    request: CreateProjectDependencyRequest,
) -> Result<ProjectDependencySummary, String> {
    validate_project_dependency_request(&request)?;
    let path = database_path(&app)?;
    let mut connection = sqlite_connection(&path, false).await?;
    let timestamp = trace_timestamp();
    let result = sqlx::query("INSERT INTO project_dependencies (id, project_id, title, description, dependency_type, owner, due_date, status, resolution, created_at, updated_at) SELECT ?, id, ?, ?, ?, ?, ?, 'pending', ?, ?, ? FROM projects WHERE id = ? AND archived_at IS NULL").bind(request.id.trim()).bind(request.title.trim()).bind(request.description.trim()).bind(request.dependency_type.trim()).bind(request.owner.trim()).bind(request.due_date.trim()).bind(request.resolution.trim()).bind(&timestamp).bind(&timestamp).bind(request.project_id.trim()).execute(&mut connection).await;
    let row = match result { Ok(outcome) if outcome.rows_affected() == 1 => sqlx::query_as::<_, (String,String,String,String,String,String,String,String,String,String,String)>("SELECT id, project_id, title, description, dependency_type, owner, due_date, status, resolution, created_at, updated_at FROM project_dependencies WHERE id = ?").bind(request.id.trim()).fetch_one(&mut connection).await.map_err(|error| format!("无法读取依赖：{error}")), Ok(_) => Err("项目不存在、已归档或不属于当前工作区".into()), Err(error) => Err(format!("无法保存依赖：{error}")) };
    connection.close().await.ok();
    row.map(|v| ProjectDependencySummary {
        id: v.0,
        project_id: v.1,
        title: v.2,
        description: v.3,
        dependency_type: v.4,
        owner: v.5,
        due_date: v.6,
        status: v.7,
        resolution: v.8,
        created_at: v.9,
        updated_at: v.10,
    })
}

#[tauri::command]
async fn list_project_dependencies(
    app: AppHandle,
    project_id: String,
) -> Result<Vec<ProjectDependencySummary>, String> {
    if project_id.trim().is_empty() || project_id.len() > 200 {
        return Err("项目标识无效".into());
    }
    let path = database_path(&app)?;
    let mut connection = sqlite_connection(&path, true).await?;
    let rows = sqlx::query_as::<_, (String,String,String,String,String,String,String,String,String,String,String)>("SELECT id, project_id, title, description, dependency_type, owner, due_date, status, resolution, created_at, updated_at FROM project_dependencies WHERE project_id = ? ORDER BY CASE status WHEN 'blocked' THEN 0 WHEN 'pending' THEN 1 WHEN 'ready' THEN 2 ELSE 3 END, due_date ASC LIMIT 200").bind(project_id.trim()).fetch_all(&mut connection).await;
    connection.close().await.ok();
    rows.map(|items| {
        items
            .into_iter()
            .map(|v| ProjectDependencySummary {
                id: v.0,
                project_id: v.1,
                title: v.2,
                description: v.3,
                dependency_type: v.4,
                owner: v.5,
                due_date: v.6,
                status: v.7,
                resolution: v.8,
                created_at: v.9,
                updated_at: v.10,
            })
            .collect()
    })
    .map_err(|error| format!("无法读取依赖：{error}"))
}

#[tauri::command]
async fn update_project_dependency_status(
    app: AppHandle,
    project_id: String,
    dependency_id: String,
    status: String,
) -> Result<(), String> {
    if project_id.trim().is_empty()
        || dependency_id.trim().is_empty()
        || !matches!(
            status.as_str(),
            "pending" | "blocked" | "ready" | "resolved"
        )
    {
        return Err("依赖状态参数无效".into());
    }
    let path = database_path(&app)?;
    let mut connection = sqlite_connection(&path, false).await?;
    let result = sqlx::query("UPDATE project_dependencies SET status = ?, updated_at = ? WHERE id = ? AND project_id = ?").bind(status.trim()).bind(trace_timestamp()).bind(dependency_id.trim()).bind(project_id.trim()).execute(&mut connection).await;
    connection.close().await.ok();
    match result {
        Ok(outcome) if outcome.rows_affected() == 1 => Ok(()),
        Ok(_) => Err("依赖不存在或项目不匹配".into()),
        Err(error) => Err(format!("无法更新依赖状态：{error}")),
    }
}

fn validate_research_entry_request(request: &CreateResearchEntryRequest) -> Result<(), String> {
    if request.id.trim().is_empty()
        || request.id.len() > 200
        || request.project_id.trim().is_empty()
        || request.title.trim().is_empty()
        || request.title.chars().count() > 200
        || request.source_ref.trim().is_empty()
        || request.source_ref.chars().count() > 2_000
        || request.insight.trim().is_empty()
        || request.insight.chars().count() > 5_000
        || request.persona_suggestion.chars().count() > 2_000
        || !matches!(
            request.research_type.as_str(),
            "interview" | "survey" | "desk" | "observation"
        )
        || !valid_voc_date(&request.accessed_at)
    {
        return Err("研究记录字段无效".into());
    }
    Ok(())
}

#[tauri::command]
async fn create_research_entry(
    app: AppHandle,
    request: CreateResearchEntryRequest,
) -> Result<ResearchEntrySummary, String> {
    validate_research_entry_request(&request)?;
    let path = database_path(&app)?;
    let mut connection = sqlite_connection(&path, false).await?;
    let timestamp = trace_timestamp();
    let plan_id = request
        .plan_id
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty());
    let result = sqlx::query("INSERT INTO research_entries (id, project_id, plan_id, research_type, title, source_ref, accessed_at, insight, persona_suggestion, created_at, updated_at) SELECT ?, id, ?, ?, ?, ?, ?, ?, ?, ?, ?, ? FROM projects WHERE id = ? AND archived_at IS NULL AND (? IS NULL OR EXISTS (SELECT 1 FROM research_plans WHERE id = ? AND project_id = projects.id))").bind(request.id.trim()).bind(plan_id).bind(request.research_type.trim()).bind(request.title.trim()).bind(request.source_ref.trim()).bind(request.accessed_at.trim()).bind(request.insight.trim()).bind(request.persona_suggestion.trim()).bind(&timestamp).bind(&timestamp).bind(request.project_id.trim()).bind(plan_id).bind(plan_id).execute(&mut connection).await;
    let row = match result { Ok(outcome) if outcome.rows_affected() == 1 => sqlx::query_as::<_, (String,String,Option<String>,String,String,String,String,String,String,String,String)>("SELECT id, project_id, plan_id, research_type, title, source_ref, accessed_at, insight, persona_suggestion, created_at, updated_at FROM research_entries WHERE id = ?").bind(request.id.trim()).fetch_one(&mut connection).await.map_err(|error| format!("无法读取研究记录：{error}")), Ok(_) => Err("项目不存在、已归档、研究计划不存在或不属于当前项目".into()), Err(error) => Err(format!("无法保存研究记录：{error}")) };
    connection.close().await.ok();
    row.map(|v| ResearchEntrySummary {
        id: v.0,
        project_id: v.1,
        plan_id: v.2,
        research_type: v.3,
        title: v.4,
        source_ref: v.5,
        accessed_at: v.6,
        insight: v.7,
        persona_suggestion: v.8,
        created_at: v.9,
        updated_at: v.10,
    })
}

#[tauri::command]
async fn list_research_entries(
    app: AppHandle,
    project_id: String,
) -> Result<Vec<ResearchEntrySummary>, String> {
    if project_id.trim().is_empty() || project_id.len() > 200 {
        return Err("项目标识无效".into());
    }
    let path = database_path(&app)?;
    let mut connection = sqlite_connection(&path, true).await?;
    let rows = sqlx::query_as::<_, (String,String,Option<String>,String,String,String,String,String,String,String,String)>("SELECT id, project_id, plan_id, research_type, title, source_ref, accessed_at, insight, persona_suggestion, created_at, updated_at FROM research_entries WHERE project_id = ? ORDER BY accessed_at DESC, updated_at DESC LIMIT 200").bind(project_id.trim()).fetch_all(&mut connection).await;
    connection.close().await.ok();
    rows.map(|items| {
        items
            .into_iter()
            .map(|v| ResearchEntrySummary {
                id: v.0,
                project_id: v.1,
                plan_id: v.2,
                research_type: v.3,
                title: v.4,
                source_ref: v.5,
                accessed_at: v.6,
                insight: v.7,
                persona_suggestion: v.8,
                created_at: v.9,
                updated_at: v.10,
            })
            .collect()
    })
    .map_err(|error| format!("无法读取研究记录：{error}"))
}

fn validate_competitor_profile_request(
    request: &CreateCompetitorProfileRequest,
) -> Result<(), String> {
    if request.id.trim().is_empty()
        || request.id.len() > 200
        || request.project_id.trim().is_empty()
        || request.name.trim().is_empty()
        || request.name.chars().count() > 200
        || request.source_ref.trim().is_empty()
        || request.source_ref.chars().count() > 2_000
        || request.strengths.chars().count() > 5_000
        || request.weaknesses.chars().count() > 5_000
        || request.positioning.chars().count() > 5_000
        || !valid_voc_date(&request.accessed_at)
    {
        return Err("竞品档案字段无效".into());
    }
    Ok(())
}

#[tauri::command]
async fn create_competitor_profile(
    app: AppHandle,
    request: CreateCompetitorProfileRequest,
) -> Result<CompetitorProfileSummary, String> {
    validate_competitor_profile_request(&request)?;
    let path = database_path(&app)?;
    let mut connection = sqlite_connection(&path, false).await?;
    let timestamp = trace_timestamp();
    let result = sqlx::query("INSERT INTO competitor_profiles (id, project_id, name, source_ref, accessed_at, strengths, weaknesses, positioning, created_at, updated_at) SELECT ?, id, ?, ?, ?, ?, ?, ?, ?, ? FROM projects WHERE id = ? AND archived_at IS NULL").bind(request.id.trim()).bind(request.name.trim()).bind(request.source_ref.trim()).bind(request.accessed_at.trim()).bind(request.strengths.trim()).bind(request.weaknesses.trim()).bind(request.positioning.trim()).bind(&timestamp).bind(&timestamp).bind(request.project_id.trim()).execute(&mut connection).await;
    let row = match result { Ok(outcome) if outcome.rows_affected() == 1 => sqlx::query_as::<_, (String,String,String,String,String,String,String,String,String,String)>("SELECT id, project_id, name, source_ref, accessed_at, strengths, weaknesses, positioning, created_at, updated_at FROM competitor_profiles WHERE id = ?").bind(request.id.trim()).fetch_one(&mut connection).await.map_err(|error| format!("无法读取竞品档案：{error}")), Ok(_) => Err("项目不存在、已归档或不属于当前工作区".into()), Err(error) => Err(format!("无法保存竞品档案：{error}")) };
    connection.close().await.ok();
    row.map(|v| CompetitorProfileSummary {
        id: v.0,
        project_id: v.1,
        name: v.2,
        source_ref: v.3,
        accessed_at: v.4,
        strengths: v.5,
        weaknesses: v.6,
        positioning: v.7,
        created_at: v.8,
        updated_at: v.9,
    })
}

#[tauri::command]
async fn list_competitor_profiles(
    app: AppHandle,
    project_id: String,
) -> Result<Vec<CompetitorProfileSummary>, String> {
    if project_id.trim().is_empty() || project_id.len() > 200 {
        return Err("项目标识无效".into());
    }
    let path = database_path(&app)?;
    let mut connection = sqlite_connection(&path, true).await?;
    let rows = sqlx::query_as::<_, (String,String,String,String,String,String,String,String,String,String)>("SELECT id, project_id, name, source_ref, accessed_at, strengths, weaknesses, positioning, created_at, updated_at FROM competitor_profiles WHERE project_id = ? ORDER BY updated_at DESC LIMIT 200").bind(project_id.trim()).fetch_all(&mut connection).await;
    connection.close().await.ok();
    rows.map(|items| {
        items
            .into_iter()
            .map(|v| CompetitorProfileSummary {
                id: v.0,
                project_id: v.1,
                name: v.2,
                source_ref: v.3,
                accessed_at: v.4,
                strengths: v.5,
                weaknesses: v.6,
                positioning: v.7,
                created_at: v.8,
                updated_at: v.9,
            })
            .collect()
    })
    .map_err(|error| format!("无法读取竞品档案：{error}"))
}

fn validate_release_list(value: &str, field: &str) -> Result<(), String> {
    if value.len() > 50_000 {
        return Err(format!("{field}过长"));
    }
    let parsed: serde_json::Value =
        serde_json::from_str(value).map_err(|_| format!("{field}不是有效 JSON"))?;
    let items = parsed
        .as_array()
        .ok_or_else(|| format!("{field}必须是数组"))?;
    if items.len() > 100
        || items.iter().any(|item| {
            item.as_str()
                .map(|text| text.trim().is_empty() || text.chars().count() > 1_000)
                .unwrap_or(true)
        })
    {
        return Err(format!("{field}条目无效"));
    }
    Ok(())
}

fn validate_release_request(request: &CreateReleaseRequest) -> Result<(), String> {
    if request.id.trim().is_empty()
        || request.id.len() > 200
        || request.project_id.trim().is_empty()
        || request.title.trim().is_empty()
        || request.title.chars().count() > 200
        || request.rollback_plan.chars().count() > 5_000
        || request.result.chars().count() > 5_000
        || request.retrospective.chars().count() > 5_000
        || !valid_voc_date(&request.target_date)
    {
        return Err("发布记录字段无效".into());
    }
    validate_release_list(&request.scope_json, "发布范围")?;
    validate_release_list(&request.checklist_json, "检查清单")?;
    validate_release_list(&request.follow_up_json, "后续行动")?;
    Ok(())
}

#[tauri::command]
async fn create_release(
    app: AppHandle,
    request: CreateReleaseRequest,
) -> Result<ReleaseSummary, String> {
    validate_release_request(&request)?;
    let path = database_path(&app)?;
    let mut connection = sqlite_connection(&path, false).await?;
    let timestamp = trace_timestamp();
    let result = sqlx::query("INSERT INTO releases (id, project_id, title, scope_json, checklist_json, rollback_plan, result, retrospective, follow_up_json, status, target_date, created_at, updated_at) SELECT ?, id, ?, ?, ?, ?, ?, ?, ?, 'planned', ?, ?, ? FROM projects WHERE id = ? AND archived_at IS NULL").bind(request.id.trim()).bind(request.title.trim()).bind(&request.scope_json).bind(&request.checklist_json).bind(request.rollback_plan.trim()).bind(request.result.trim()).bind(request.retrospective.trim()).bind(&request.follow_up_json).bind(request.target_date.trim()).bind(&timestamp).bind(&timestamp).bind(request.project_id.trim()).execute(&mut connection).await;
    let row = match result { Ok(outcome) if outcome.rows_affected() == 1 => sqlx::query_as::<_, (String,String,String,String,String,String,String,String,String,String,String,String,String)>("SELECT id, project_id, title, scope_json, checklist_json, rollback_plan, result, retrospective, follow_up_json, status, target_date, created_at, updated_at FROM releases WHERE id = ?").bind(request.id.trim()).fetch_one(&mut connection).await.map_err(|error| format!("无法读取发布记录：{error}")), Ok(_) => Err("项目不存在、已归档或不属于当前工作区".into()), Err(error) => Err(format!("无法保存发布记录：{error}")) };
    connection.close().await.ok();
    row.map(|v| ReleaseSummary {
        id: v.0,
        project_id: v.1,
        title: v.2,
        scope_json: v.3,
        checklist_json: v.4,
        rollback_plan: v.5,
        result: v.6,
        retrospective: v.7,
        follow_up_json: v.8,
        status: v.9,
        target_date: v.10,
        created_at: v.11,
        updated_at: v.12,
    })
}

#[tauri::command]
async fn list_releases(app: AppHandle, project_id: String) -> Result<Vec<ReleaseSummary>, String> {
    if project_id.trim().is_empty() || project_id.len() > 200 {
        return Err("项目标识无效".into());
    }
    let path = database_path(&app)?;
    let mut connection = sqlite_connection(&path, true).await?;
    let rows = sqlx::query_as::<_, (String,String,String,String,String,String,String,String,String,String,String,String,String)>("SELECT id, project_id, title, scope_json, checklist_json, rollback_plan, result, retrospective, follow_up_json, status, target_date, created_at, updated_at FROM releases WHERE project_id = ? ORDER BY target_date DESC, updated_at DESC LIMIT 100").bind(project_id.trim()).fetch_all(&mut connection).await;
    connection.close().await.ok();
    rows.map(|items| {
        items
            .into_iter()
            .map(|v| ReleaseSummary {
                id: v.0,
                project_id: v.1,
                title: v.2,
                scope_json: v.3,
                checklist_json: v.4,
                rollback_plan: v.5,
                result: v.6,
                retrospective: v.7,
                follow_up_json: v.8,
                status: v.9,
                target_date: v.10,
                created_at: v.11,
                updated_at: v.12,
            })
            .collect()
    })
    .map_err(|error| format!("无法读取发布记录：{error}"))
}

#[tauri::command]
async fn update_release_status(
    app: AppHandle,
    project_id: String,
    release_id: String,
    status: String,
) -> Result<(), String> {
    if project_id.trim().is_empty()
        || release_id.trim().is_empty()
        || !matches!(
            status.as_str(),
            "planned" | "ready" | "released" | "reviewed" | "cancelled"
        )
    {
        return Err("发布状态参数无效".into());
    }
    let path = database_path(&app)?;
    let mut connection = sqlite_connection(&path, false).await?;
    let result = sqlx::query("UPDATE releases SET status = ?, updated_at = ? WHERE id = ? AND project_id = ? AND (status != 'cancelled' OR ? = 'cancelled')").bind(status.trim()).bind(trace_timestamp()).bind(release_id.trim()).bind(project_id.trim()).bind(status.trim()).execute(&mut connection).await;
    connection.close().await.ok();
    match result {
        Ok(outcome) if outcome.rows_affected() == 1 => Ok(()),
        Ok(_) => Err("发布记录不存在、已取消或项目不匹配".into()),
        Err(error) => Err(format!("无法更新发布状态：{error}")),
    }
}

fn validate_research_plan_request(request: &CreateResearchPlanRequest) -> Result<(), String> {
    if request.id.trim().is_empty()
        || request.id.len() > 200
        || request.project_id.trim().is_empty()
        || request.title.trim().is_empty()
        || request.title.chars().count() > 200
        || request.objective.trim().is_empty()
        || request.objective.chars().count() > 5_000
        || request.target_persona.chars().count() > 2_000
        || !valid_voc_date(&request.start_date)
        || !valid_voc_date(&request.end_date)
        || request.start_date > request.end_date
    {
        return Err("研究计划字段无效".into());
    }
    validate_release_list(&request.questions_json, "访谈提纲")
}

#[tauri::command]
async fn create_research_plan(
    app: AppHandle,
    request: CreateResearchPlanRequest,
) -> Result<ResearchPlanSummary, String> {
    validate_research_plan_request(&request)?;
    let path = database_path(&app)?;
    let mut connection = sqlite_connection(&path, false).await?;
    let timestamp = trace_timestamp();
    let result = sqlx::query("INSERT INTO research_plans (id, project_id, title, objective, target_persona, questions_json, status, start_date, end_date, created_at, updated_at) SELECT ?, id, ?, ?, ?, ?, 'planned', ?, ?, ?, ? FROM projects WHERE id = ? AND archived_at IS NULL").bind(request.id.trim()).bind(request.title.trim()).bind(request.objective.trim()).bind(request.target_persona.trim()).bind(&request.questions_json).bind(request.start_date.trim()).bind(request.end_date.trim()).bind(&timestamp).bind(&timestamp).bind(request.project_id.trim()).execute(&mut connection).await;
    let row = match result { Ok(outcome) if outcome.rows_affected() == 1 => sqlx::query_as::<_, (String,String,String,String,String,String,String,String,String,String,String)>("SELECT id, project_id, title, objective, target_persona, questions_json, status, start_date, end_date, created_at, updated_at FROM research_plans WHERE id = ?").bind(request.id.trim()).fetch_one(&mut connection).await.map_err(|error| format!("无法读取研究计划：{error}")), Ok(_) => Err("项目不存在、已归档或不属于当前工作区".into()), Err(error) => Err(format!("无法保存研究计划：{error}")) };
    connection.close().await.ok();
    row.map(|v| ResearchPlanSummary {
        id: v.0,
        project_id: v.1,
        title: v.2,
        objective: v.3,
        target_persona: v.4,
        questions_json: v.5,
        status: v.6,
        start_date: v.7,
        end_date: v.8,
        created_at: v.9,
        updated_at: v.10,
    })
}

#[tauri::command]
async fn list_research_plans(
    app: AppHandle,
    project_id: String,
) -> Result<Vec<ResearchPlanSummary>, String> {
    if project_id.trim().is_empty() || project_id.len() > 200 {
        return Err("项目标识无效".into());
    }
    let path = database_path(&app)?;
    let mut connection = sqlite_connection(&path, true).await?;
    let rows = sqlx::query_as::<_, (String,String,String,String,String,String,String,String,String,String,String)>("SELECT id, project_id, title, objective, target_persona, questions_json, status, start_date, end_date, created_at, updated_at FROM research_plans WHERE project_id = ? ORDER BY start_date DESC, updated_at DESC LIMIT 100").bind(project_id.trim()).fetch_all(&mut connection).await;
    connection.close().await.ok();
    rows.map(|items| {
        items
            .into_iter()
            .map(|v| ResearchPlanSummary {
                id: v.0,
                project_id: v.1,
                title: v.2,
                objective: v.3,
                target_persona: v.4,
                questions_json: v.5,
                status: v.6,
                start_date: v.7,
                end_date: v.8,
                created_at: v.9,
                updated_at: v.10,
            })
            .collect()
    })
    .map_err(|error| format!("无法读取研究计划：{error}"))
}

#[tauri::command]
async fn update_research_plan_status(
    app: AppHandle,
    project_id: String,
    plan_id: String,
    status: String,
) -> Result<(), String> {
    if project_id.trim().is_empty()
        || plan_id.trim().is_empty()
        || !matches!(
            status.as_str(),
            "planned" | "active" | "completed" | "cancelled"
        )
    {
        return Err("研究计划状态参数无效".into());
    }
    let path = database_path(&app)?;
    let mut connection = sqlite_connection(&path, false).await?;
    let result = sqlx::query(
        "UPDATE research_plans SET status = ?, updated_at = ? WHERE id = ? AND project_id = ?",
    )
    .bind(status.trim())
    .bind(trace_timestamp())
    .bind(plan_id.trim())
    .bind(project_id.trim())
    .execute(&mut connection)
    .await;
    connection.close().await.ok();
    match result {
        Ok(outcome) if outcome.rows_affected() == 1 => Ok(()),
        Ok(_) => Err("研究计划不存在或项目不匹配".into()),
        Err(error) => Err(format!("无法更新研究计划状态：{error}")),
    }
}

fn normalize_research_plan_changes(
    mut changes: ResearchPlanUpdateChanges,
    current_start_date: &str,
    current_end_date: &str,
) -> Result<ResearchPlanUpdateChanges, String> {
    if changes.objective.is_none()
        && changes.target_persona.is_none()
        && changes.questions.is_none()
        && changes.start_date.is_none()
        && changes.end_date.is_none()
    {
        return Err("研究计划提案没有字段变化".into());
    }
    if let Some(value) = &mut changes.objective {
        *value = value.trim().to_string();
        if value.is_empty() || value.chars().count() > 5_000 {
            return Err("研究计划提案目标无效".into());
        }
    }
    if let Some(value) = &mut changes.target_persona {
        *value = value.trim().to_string();
        if value.chars().count() > 2_000 {
            return Err("研究计划提案画像无效".into());
        }
    }
    if let Some(questions) = &mut changes.questions {
        for question in questions.iter_mut() {
            *question = question.trim().to_string();
        }
        if questions.len() > 100
            || questions
                .iter()
                .any(|item| item.is_empty() || item.chars().count() > 1_000)
        {
            return Err("研究计划提案访谈提纲无效".into());
        }
    }
    if let Some(value) = &mut changes.start_date {
        *value = value.trim().to_string();
        if !valid_voc_date(value) {
            return Err("研究计划提案开始日期无效".into());
        }
    }
    if let Some(value) = &mut changes.end_date {
        *value = value.trim().to_string();
        if !valid_voc_date(value) {
            return Err("研究计划提案结束日期无效".into());
        }
    }
    let start_date = changes.start_date.as_deref().unwrap_or(current_start_date);
    let end_date = changes.end_date.as_deref().unwrap_or(current_end_date);
    if start_date > end_date {
        return Err("研究计划提案日期范围无效".into());
    }
    Ok(changes)
}

fn validate_research_plan_proposal_citations(
    citations: &serde_json::Value,
    plan_id: &str,
    plan: &(
        String,
        String,
        String,
        String,
        String,
        String,
        String,
        String,
    ),
    entries: &[(String, String, String, String, String, String, String)],
) -> Result<(), String> {
    let items = citations
        .as_array()
        .filter(|items| !items.is_empty() && items.len() <= 20)
        .ok_or_else(|| "研究计划提案必须包含 1–20 条精确引用".to_string())?;
    let questions = serde_json::from_str::<Vec<String>>(&plan.3)
        .map_err(|_| "研究计划访谈提纲数据已损坏".to_string())?;
    for item in items {
        let object = item
            .as_object()
            .ok_or_else(|| "研究计划提案引用必须是对象".to_string())?;
        if object.len() != 4 {
            return Err("研究计划提案引用包含未授权字段".into());
        }
        let source_type = object
            .get("sourceType")
            .and_then(serde_json::Value::as_str)
            .unwrap_or_default();
        let source_id = object
            .get("sourceId")
            .and_then(serde_json::Value::as_str)
            .unwrap_or_default();
        let field = object
            .get("field")
            .and_then(serde_json::Value::as_str)
            .unwrap_or_default();
        let quote = object
            .get("quote")
            .and_then(serde_json::Value::as_str)
            .unwrap_or_default();
        let exact = match source_type {
            "plan" if source_id == plan_id => match field {
                "title" => quote == plan.0,
                "objective" => quote == plan.1,
                "targetPersona" => quote == plan.2,
                "questions" => questions.iter().any(|question| question == quote),
                "status" => quote == plan.4,
                "startDate" => quote == plan.5,
                "endDate" => quote == plan.6,
                _ => false,
            },
            "result" => entries
                .iter()
                .find(|entry| entry.0 == source_id)
                .is_some_and(|entry| match field {
                    "researchType" => quote == entry.1,
                    "title" => quote == entry.2,
                    "sourceRef" => quote == entry.3,
                    "accessedAt" => quote == entry.4,
                    "insight" => quote == entry.5,
                    "personaSuggestion" => quote == entry.6,
                    _ => false,
                }),
            _ => false,
        };
        if !exact {
            return Err("研究计划提案引用未精确命中当前计划或关联研究结果".into());
        }
    }
    Ok(())
}

#[tauri::command]
async fn save_research_plan_update_proposals(
    app: AppHandle,
    request: SaveResearchPlanUpdateProposalsRequest,
) -> Result<Vec<AgentToolProposalSummary>, String> {
    if request.project_id.trim().is_empty()
        || request.project_id.len() > 200
        || request.run_id.trim().is_empty()
        || request.run_id.len() > 200
        || request.proposals.is_empty()
        || request.proposals.len() > 20
    {
        return Err("研究计划提案批次无效".into());
    }
    let path = database_path(&app)?;
    let mut connection = sqlite_connection(&path, false).await?;
    let mut transaction = connection
        .begin()
        .await
        .map_err(|error| format!("无法开始保存研究计划提案：{error}"))?;
    let valid_run: i64 = sqlx::query_scalar(
        "SELECT COUNT(*) FROM agent_runs r JOIN projects p ON p.id = r.project_id
         WHERE r.id = ? AND r.project_id = ? AND r.agent_definition_id = 'plan-engineer:v2'
           AND r.run_type = 'plan_engineer' AND r.status = 'succeeded' AND p.archived_at IS NULL",
    )
    .bind(request.run_id.trim())
    .bind(request.project_id.trim())
    .fetch_one(&mut *transaction)
    .await
    .map_err(|error| format!("无法校验计划工程师运行记录：{error}"))?;
    if valid_run != 1 {
        return Err("研究计划提案必须来自当前项目已成功的计划工程师 v2 运行".into());
    }
    let timestamp = trace_timestamp();
    let mut saved_ids = Vec::with_capacity(request.proposals.len());
    for (index, proposal) in request.proposals.into_iter().enumerate() {
        if proposal.id.trim().is_empty()
            || proposal.id.len() > 200
            || proposal.plan_id.trim().is_empty()
            || proposal.plan_id.len() > 200
            || proposal.expected_updated_at.trim().is_empty()
            || proposal.expected_updated_at.len() > 100
            || proposal.rationale.trim().is_empty()
            || proposal.rationale.chars().count() > 2_000
            || saved_ids.iter().any(|id: &String| id == proposal.id.trim())
        {
            return Err(format!("第 {} 条研究计划提案字段无效", index + 1));
        }
        let plan = sqlx::query_as::<_, (String, String, String, String, String, String, String, String)>(
            "SELECT title, objective, target_persona, questions_json, status, start_date, end_date, updated_at
             FROM research_plans WHERE id = ? AND project_id = ? AND status != 'cancelled'",
        )
        .bind(proposal.plan_id.trim())
        .bind(request.project_id.trim())
        .fetch_optional(&mut *transaction)
        .await
        .map_err(|error| format!("无法读取研究计划提案目标：{error}"))?
        .ok_or_else(|| "研究计划提案目标不存在、已取消或项目不匹配".to_string())?;
        if plan.7 != proposal.expected_updated_at {
            return Err("研究计划已变化，请重新生成计划工程师提案".into());
        }
        let changes = normalize_research_plan_changes(proposal.changes, &plan.5, &plan.6)?;
        let current_questions = serde_json::from_str::<Vec<String>>(&plan.3)
            .map_err(|_| "研究计划访谈提纲数据已损坏".to_string())?;
        let changed = changes
            .objective
            .as_ref()
            .is_some_and(|value| value != &plan.1)
            || changes
                .target_persona
                .as_ref()
                .is_some_and(|value| value != &plan.2)
            || changes
                .questions
                .as_ref()
                .is_some_and(|value| value != &current_questions)
            || changes
                .start_date
                .as_ref()
                .is_some_and(|value| value != &plan.5)
            || changes
                .end_date
                .as_ref()
                .is_some_and(|value| value != &plan.6);
        if !changed {
            return Err("研究计划提案没有产生实际字段变化".into());
        }
        let entries = sqlx::query_as::<_, (String, String, String, String, String, String, String)>(
            "SELECT id, research_type, title, source_ref, accessed_at, insight, persona_suggestion
             FROM research_entries WHERE project_id = ? AND plan_id = ? ORDER BY id",
        )
        .bind(request.project_id.trim())
        .bind(proposal.plan_id.trim())
        .fetch_all(&mut *transaction)
        .await
        .map_err(|error| format!("无法校验研究计划提案引用：{error}"))?;
        validate_research_plan_proposal_citations(
            &proposal.citations,
            proposal.plan_id.trim(),
            &plan,
            &entries,
        )?;
        let payload_json = serde_json::to_string(&changes)
            .map_err(|_| "无法序列化研究计划提案字段".to_string())?;
        let evidence_json = serde_json::to_string(&proposal.citations)
            .map_err(|_| "无法序列化研究计划提案证据".to_string())?;
        sqlx::query(
            "INSERT INTO agent_tool_proposals
             (id, project_id, target_type, target_id, agent_run_id, agent_definition_id,
              tool_key, expected_target_updated_at, payload_json, evidence_json, rationale,
              status, created_at, updated_at)
             VALUES (?, ?, 'research_plan', ?, ?, 'plan-engineer:v2', 'update_research_plan',
                     ?, ?, ?, ?, 'pending_confirmation', ?, ?)",
        )
        .bind(proposal.id.trim())
        .bind(request.project_id.trim())
        .bind(proposal.plan_id.trim())
        .bind(request.run_id.trim())
        .bind(proposal.expected_updated_at.trim())
        .bind(payload_json)
        .bind(evidence_json)
        .bind(proposal.rationale.trim())
        .bind(&timestamp)
        .bind(&timestamp)
        .execute(&mut *transaction)
        .await
        .map_err(|_| "无法保存研究计划提案；提案可能已保存或标识重复".to_string())?;
        saved_ids.push(proposal.id.trim().to_string());
    }
    transaction
        .commit()
        .await
        .map_err(|error| format!("无法提交研究计划提案：{error}"))?;
    let rows = sqlx::query_as::<_, AgentToolProposalRow>(
        "SELECT id, project_id, target_type, target_id, agent_run_id, agent_definition_id, tool_key,
                expected_target_updated_at, payload_json, evidence_json, rationale, status,
                created_at, updated_at, reviewed_at, executed_at
         FROM agent_tool_proposals WHERE agent_run_id = ? ORDER BY created_at DESC, id",
    )
    .bind(request.run_id.trim())
    .fetch_all(&mut connection)
    .await
    .map_err(|error| format!("无法读取已保存研究计划提案：{error}"))?;
    connection.close().await.ok();
    Ok(rows.into_iter().map(agent_tool_proposal_summary).collect())
}

fn normalize_project_risk_changes(
    changes: ProjectRiskUpdateChanges,
) -> Result<ProjectRiskUpdateChanges, String> {
    let mitigation = changes.mitigation.map(|value| value.trim().to_string());
    let owner = changes.owner.map(|value| value.trim().to_string());
    let due_date = changes.due_date.map(|value| value.trim().to_string());
    let severity = changes.severity.map(|value| value.trim().to_string());
    let probability = changes.probability.map(|value| value.trim().to_string());
    if mitigation
        .as_ref()
        .is_some_and(|value| value.is_empty() || value.chars().count() > 5_000)
        || owner
            .as_ref()
            .is_some_and(|value| value.is_empty() || value.chars().count() > 200)
        || due_date
            .as_ref()
            .is_some_and(|value| !valid_voc_date(value))
        || severity
            .as_ref()
            .is_some_and(|value| !matches!(value.as_str(), "low" | "medium" | "high" | "critical"))
        || probability
            .as_ref()
            .is_some_and(|value| !matches!(value.as_str(), "unlikely" | "possible" | "likely"))
        || (mitigation.is_none()
            && owner.is_none()
            && due_date.is_none()
            && severity.is_none()
            && probability.is_none())
    {
        return Err("风险缓解提案包含无效或未授权字段".into());
    }
    Ok(ProjectRiskUpdateChanges {
        mitigation,
        owner,
        due_date,
        severity,
        probability,
    })
}

fn validate_project_risk_proposal_citations(
    citations: &serde_json::Value,
    risk: &(
        String,
        String,
        String,
        String,
        String,
        String,
        String,
        String,
        String,
    ),
) -> Result<(), String> {
    let items = citations
        .as_array()
        .ok_or_else(|| "风险缓解提案引用必须是数组".to_string())?;
    if items.is_empty() || items.len() > 8 {
        return Err("风险缓解提案必须包含 1 至 8 条精确引用".into());
    }
    for item in items {
        let object = item
            .as_object()
            .filter(|value| value.len() == 2)
            .ok_or_else(|| "风险缓解提案引用结构无效".to_string())?;
        let field = object
            .get("field")
            .and_then(serde_json::Value::as_str)
            .unwrap_or_default();
        let quote = object
            .get("quote")
            .and_then(serde_json::Value::as_str)
            .unwrap_or_default();
        let exact = match field {
            "title" => quote == risk.0,
            "description" => quote == risk.1,
            "severity" => quote == risk.2,
            "probability" => quote == risk.3,
            "status" => quote == risk.4,
            "owner" => quote == risk.5,
            "dueDate" => quote == risk.6,
            "mitigation" => quote == risk.7,
            _ => false,
        };
        if !exact {
            return Err("风险缓解提案引用未精确命中当前风险字段".into());
        }
    }
    Ok(())
}

#[tauri::command]
async fn save_project_risk_update_proposals(
    app: AppHandle,
    request: SaveProjectRiskUpdateProposalsRequest,
) -> Result<Vec<AgentToolProposalSummary>, String> {
    if request.project_id.trim().is_empty()
        || request.project_id.len() > 200
        || request.run_id.trim().is_empty()
        || request.run_id.len() > 200
        || request.proposals.is_empty()
        || request.proposals.len() > 20
    {
        return Err("风险缓解提案批次无效".into());
    }
    let path = database_path(&app)?;
    let mut connection = sqlite_connection(&path, false).await?;
    let mut transaction = connection
        .begin()
        .await
        .map_err(|error| format!("无法开始保存风险缓解提案：{error}"))?;
    let valid_run: i64 = sqlx::query_scalar(
        "SELECT COUNT(*) FROM agent_runs r JOIN projects p ON p.id = r.project_id
         WHERE r.id = ? AND r.project_id = ? AND r.agent_definition_id = 'risk-review:v2'
           AND r.run_type = 'risk_review' AND r.status = 'succeeded' AND p.archived_at IS NULL",
    )
    .bind(request.run_id.trim())
    .bind(request.project_id.trim())
    .fetch_one(&mut *transaction)
    .await
    .map_err(|error| format!("无法校验风险缓解 Agent 运行记录：{error}"))?;
    if valid_run != 1 {
        return Err("风险缓解提案必须来自当前活动项目已成功的 risk-review:v2 运行".into());
    }
    let timestamp = trace_timestamp();
    let mut saved_ids = Vec::with_capacity(request.proposals.len());
    for (index, proposal) in request.proposals.into_iter().enumerate() {
        if proposal.id.trim().is_empty()
            || proposal.id.len() > 200
            || proposal.risk_id.trim().is_empty()
            || proposal.risk_id.len() > 200
            || proposal.expected_updated_at.trim().is_empty()
            || proposal.expected_updated_at.len() > 100
            || proposal.rationale.trim().is_empty()
            || proposal.rationale.chars().count() > 2_000
            || saved_ids.iter().any(|id: &String| id == proposal.id.trim())
        {
            return Err(format!("第 {} 条风险缓解提案字段无效", index + 1));
        }
        let risk = sqlx::query_as::<_, (String, String, String, String, String, String, String, String, String)>(
            "SELECT r.title, r.description, r.severity, r.probability, r.status, r.owner, r.due_date, r.mitigation, r.updated_at
             FROM project_risks r JOIN projects p ON p.id = r.project_id
             WHERE r.id = ? AND r.project_id = ? AND r.status != 'closed' AND p.archived_at IS NULL",
        ).bind(proposal.risk_id.trim()).bind(request.project_id.trim()).fetch_optional(&mut *transaction).await
            .map_err(|error| format!("无法读取风险缓解提案目标：{error}"))?
            .ok_or_else(|| "风险缓解提案目标不存在、已关闭或项目不匹配".to_string())?;
        if risk.8 != proposal.expected_updated_at {
            return Err("风险记录已变化，请重新生成风险缓解提案".into());
        }
        let changes = normalize_project_risk_changes(proposal.changes)?;
        let changed = changes
            .mitigation
            .as_ref()
            .is_some_and(|value| value != &risk.7)
            || changes.owner.as_ref().is_some_and(|value| value != &risk.5)
            || changes
                .due_date
                .as_ref()
                .is_some_and(|value| value != &risk.6)
            || changes
                .severity
                .as_ref()
                .is_some_and(|value| value != &risk.2)
            || changes
                .probability
                .as_ref()
                .is_some_and(|value| value != &risk.3);
        if !changed {
            return Err("风险缓解提案没有产生实际字段变化".into());
        }
        validate_project_risk_proposal_citations(&proposal.citations, &risk)?;
        let payload_json = serde_json::to_string(&changes)
            .map_err(|_| "无法序列化风险缓解提案字段".to_string())?;
        let evidence_json = serde_json::to_string(&proposal.citations)
            .map_err(|_| "无法序列化风险缓解提案证据".to_string())?;
        sqlx::query(
            "INSERT INTO agent_tool_proposals
             (id, project_id, target_type, target_id, agent_run_id, agent_definition_id, tool_key,
              expected_target_updated_at, payload_json, evidence_json, rationale, status, created_at, updated_at)
             VALUES (?, ?, 'project_risk', ?, ?, 'risk-review:v2', 'update_project_risk', ?, ?, ?, ?, 'pending_confirmation', ?, ?)",
        ).bind(proposal.id.trim()).bind(request.project_id.trim()).bind(proposal.risk_id.trim())
          .bind(request.run_id.trim()).bind(proposal.expected_updated_at.trim()).bind(payload_json)
          .bind(evidence_json).bind(proposal.rationale.trim()).bind(&timestamp).bind(&timestamp)
          .execute(&mut *transaction).await.map_err(|_| "无法保存风险缓解提案；提案可能已保存或标识重复".to_string())?;
        saved_ids.push(proposal.id.trim().to_string());
    }
    transaction
        .commit()
        .await
        .map_err(|error| format!("无法提交风险缓解提案：{error}"))?;
    let rows = sqlx::query_as::<_, AgentToolProposalRow>(
        "SELECT id, project_id, target_type, target_id, agent_run_id, agent_definition_id, tool_key,
                expected_target_updated_at, payload_json, evidence_json, rationale, status,
                created_at, updated_at, reviewed_at, executed_at
         FROM agent_tool_proposals WHERE agent_run_id = ? ORDER BY created_at DESC, id",
    ).bind(request.run_id.trim()).fetch_all(&mut connection).await
      .map_err(|error| format!("无法读取已保存风险缓解提案：{error}"))?;
    connection.close().await.ok();
    Ok(rows.into_iter().map(agent_tool_proposal_summary).collect())
}

fn normalize_project_dependency_changes(
    changes: ProjectDependencyUpdateChanges,
) -> Result<ProjectDependencyUpdateChanges, String> {
    let owner = changes.owner.map(|value| value.trim().to_string());
    let due_date = changes.due_date.map(|value| value.trim().to_string());
    let resolution = changes.resolution.map(|value| value.trim().to_string());
    if owner
        .as_ref()
        .is_some_and(|value| value.is_empty() || value.chars().count() > 200)
        || due_date
            .as_ref()
            .is_some_and(|value| !valid_voc_date(value))
        || resolution
            .as_ref()
            .is_some_and(|value| value.is_empty() || value.chars().count() > 5_000)
        || (owner.is_none() && due_date.is_none() && resolution.is_none())
    {
        return Err("依赖处置提案包含无效或未授权字段".into());
    }
    Ok(ProjectDependencyUpdateChanges {
        owner,
        due_date,
        resolution,
    })
}

fn validate_project_dependency_proposal_citations(
    citations: &serde_json::Value,
    dependency: &(
        String,
        String,
        String,
        String,
        String,
        String,
        String,
        String,
    ),
) -> Result<(), String> {
    let items = citations
        .as_array()
        .ok_or_else(|| "依赖处置提案引用必须是数组".to_string())?;
    if items.is_empty() || items.len() > 8 {
        return Err("依赖处置提案必须包含 1 至 8 条精确引用".into());
    }
    for item in items {
        let object = item
            .as_object()
            .filter(|value| value.len() == 2)
            .ok_or_else(|| "依赖处置提案引用结构无效".to_string())?;
        let field = object
            .get("field")
            .and_then(serde_json::Value::as_str)
            .unwrap_or_default();
        let quote = object
            .get("quote")
            .and_then(serde_json::Value::as_str)
            .unwrap_or_default();
        let exact = match field {
            "title" => quote == dependency.0,
            "description" => quote == dependency.1,
            "dependencyType" => quote == dependency.2,
            "owner" => quote == dependency.3,
            "dueDate" => quote == dependency.4,
            "status" => quote == dependency.5,
            "resolution" => quote == dependency.6,
            _ => false,
        };
        if !exact {
            return Err("依赖处置提案引用未精确命中当前依赖字段".into());
        }
    }
    Ok(())
}

#[tauri::command]
async fn save_project_dependency_update_proposals(
    app: AppHandle,
    request: SaveProjectDependencyUpdateProposalsRequest,
) -> Result<Vec<AgentToolProposalSummary>, String> {
    if request.project_id.trim().is_empty()
        || request.project_id.len() > 200
        || request.run_id.trim().is_empty()
        || request.run_id.len() > 200
        || request.proposals.is_empty()
        || request.proposals.len() > 20
    {
        return Err("依赖处置提案批次无效".into());
    }
    let path = database_path(&app)?;
    let mut connection = sqlite_connection(&path, false).await?;
    let mut transaction = connection
        .begin()
        .await
        .map_err(|error| format!("无法开始保存依赖处置提案：{error}"))?;
    let valid_run: i64 = sqlx::query_scalar(
        "SELECT COUNT(*) FROM agent_runs r JOIN projects p ON p.id = r.project_id
         WHERE r.id = ? AND r.project_id = ? AND r.agent_definition_id = 'dependency-remediation:v1'
           AND r.run_type = 'dependency_review' AND r.status = 'succeeded' AND p.archived_at IS NULL",
    ).bind(request.run_id.trim()).bind(request.project_id.trim()).fetch_one(&mut *transaction).await
      .map_err(|error| format!("无法校验依赖处置 Agent 运行记录：{error}"))?;
    if valid_run != 1 {
        return Err("依赖处置提案必须来自当前活动项目已成功的固定 Agent 运行".into());
    }
    let timestamp = trace_timestamp();
    let mut saved_ids = Vec::with_capacity(request.proposals.len());
    for (index, proposal) in request.proposals.into_iter().enumerate() {
        if proposal.id.trim().is_empty()
            || proposal.id.len() > 200
            || proposal.dependency_id.trim().is_empty()
            || proposal.dependency_id.len() > 200
            || proposal.expected_updated_at.trim().is_empty()
            || proposal.expected_updated_at.len() > 100
            || proposal.rationale.trim().is_empty()
            || proposal.rationale.chars().count() > 2_000
            || saved_ids.iter().any(|id: &String| id == proposal.id.trim())
        {
            return Err(format!("第 {} 条依赖处置提案字段无效", index + 1));
        }
        let dependency = sqlx::query_as::<_, (String, String, String, String, String, String, String, String)>(
            "SELECT d.title, d.description, d.dependency_type, d.owner, d.due_date, d.status, d.resolution, d.updated_at
             FROM project_dependencies d JOIN projects p ON p.id = d.project_id
             WHERE d.id = ? AND d.project_id = ? AND d.status != 'resolved' AND p.archived_at IS NULL",
        ).bind(proposal.dependency_id.trim()).bind(request.project_id.trim()).fetch_optional(&mut *transaction).await
          .map_err(|error| format!("无法读取依赖处置提案目标：{error}"))?
          .ok_or_else(|| "依赖处置提案目标不存在、已解决或项目不匹配".to_string())?;
        if dependency.7 != proposal.expected_updated_at {
            return Err("依赖记录已变化，请重新生成处置提案".into());
        }
        let changes = normalize_project_dependency_changes(proposal.changes)?;
        let changed = changes
            .owner
            .as_ref()
            .is_some_and(|value| value != &dependency.3)
            || changes
                .due_date
                .as_ref()
                .is_some_and(|value| value != &dependency.4)
            || changes
                .resolution
                .as_ref()
                .is_some_and(|value| value != &dependency.6);
        if !changed {
            return Err("依赖处置提案没有产生实际字段变化".into());
        }
        validate_project_dependency_proposal_citations(&proposal.citations, &dependency)?;
        let payload_json = serde_json::to_string(&changes)
            .map_err(|_| "无法序列化依赖处置提案字段".to_string())?;
        let evidence_json = serde_json::to_string(&proposal.citations)
            .map_err(|_| "无法序列化依赖处置提案证据".to_string())?;
        sqlx::query(
            "INSERT INTO agent_tool_proposals
             (id, project_id, target_type, target_id, agent_run_id, agent_definition_id, tool_key,
              expected_target_updated_at, payload_json, evidence_json, rationale, status, created_at, updated_at)
             VALUES (?, ?, 'project_dependency', ?, ?, 'dependency-remediation:v1', 'update_project_dependency',
                     ?, ?, ?, ?, 'pending_confirmation', ?, ?)",
        ).bind(proposal.id.trim()).bind(request.project_id.trim()).bind(proposal.dependency_id.trim())
          .bind(request.run_id.trim()).bind(proposal.expected_updated_at.trim()).bind(payload_json)
          .bind(evidence_json).bind(proposal.rationale.trim()).bind(&timestamp).bind(&timestamp)
          .execute(&mut *transaction).await.map_err(|_| "无法保存依赖处置提案；提案可能已保存或标识重复".to_string())?;
        saved_ids.push(proposal.id.trim().to_string());
    }
    transaction
        .commit()
        .await
        .map_err(|error| format!("无法提交依赖处置提案：{error}"))?;
    let rows = sqlx::query_as::<_, AgentToolProposalRow>(
        "SELECT id, project_id, target_type, target_id, agent_run_id, agent_definition_id, tool_key,
                expected_target_updated_at, payload_json, evidence_json, rationale, status,
                created_at, updated_at, reviewed_at, executed_at
         FROM agent_tool_proposals WHERE agent_run_id = ? ORDER BY created_at DESC, id",
    ).bind(request.run_id.trim()).fetch_all(&mut connection).await
      .map_err(|error| format!("无法读取已保存依赖处置提案：{error}"))?;
    connection.close().await.ok();
    Ok(rows.into_iter().map(agent_tool_proposal_summary).collect())
}

fn normalize_release_preparation_changes(
    mut changes: ReleasePreparationChanges,
) -> Result<ReleasePreparationChanges, String> {
    fn clean(values: Vec<String>) -> Result<Vec<String>, String> {
        let values: Vec<String> = values
            .into_iter()
            .map(|v| v.trim().to_string())
            .filter(|v| !v.is_empty())
            .collect();
        if values.len() > 100 || values.iter().any(|v| v.chars().count() > 1000) {
            return Err("发布提案列表字段无效".into());
        }
        Ok(values)
    }
    changes.scope = changes.scope.map(clean).transpose()?;
    changes.checklist = changes.checklist.map(clean).transpose()?;
    changes.rollback_plan = changes.rollback_plan.map(|v| v.trim().to_string());
    changes.target_date = changes.target_date.map(|v| v.trim().to_string());
    if changes
        .rollback_plan
        .as_ref()
        .is_some_and(|v| v.is_empty() || v.chars().count() > 5000)
        || changes
            .target_date
            .as_ref()
            .is_some_and(|v| !valid_voc_date(v))
        || (changes.scope.is_none()
            && changes.checklist.is_none()
            && changes.rollback_plan.is_none()
            && changes.target_date.is_none())
    {
        return Err("发布准备提案包含无效或未授权字段".into());
    }
    Ok(changes)
}
fn validate_release_preparation_citations(
    citations: &serde_json::Value,
    release: &(
        String,
        String,
        String,
        String,
        String,
        String,
        String,
        String,
        String,
        String,
    ),
) -> Result<(), String> {
    let items = citations
        .as_array()
        .ok_or_else(|| "发布提案引用必须是数组".to_string())?;
    if items.is_empty() || items.len() > 8 {
        return Err("发布提案必须包含 1 至 8 条精确引用".into());
    }
    let scope: Vec<String> =
        serde_json::from_str(&release.1).map_err(|_| "发布范围数据已损坏".to_string())?;
    let checklist: Vec<String> =
        serde_json::from_str(&release.2).map_err(|_| "检查清单数据已损坏".to_string())?;
    let follow: Vec<String> =
        serde_json::from_str(&release.6).map_err(|_| "跟进事项数据已损坏".to_string())?;
    for item in items {
        let o = item
            .as_object()
            .filter(|o| o.len() == 2)
            .ok_or_else(|| "发布提案引用结构无效".to_string())?;
        let f = o
            .get("field")
            .and_then(serde_json::Value::as_str)
            .unwrap_or_default();
        let q = o
            .get("quote")
            .and_then(serde_json::Value::as_str)
            .unwrap_or_default();
        let exact = match f {
            "title" => q == release.0,
            "scope" => scope.iter().any(|v| v == q),
            "checklist" => checklist.iter().any(|v| v == q),
            "rollbackPlan" => q == release.3,
            "result" => q == release.4,
            "retrospective" => q == release.5,
            "followUp" => follow.iter().any(|v| v == q),
            "status" => q == release.7,
            "targetDate" => q == release.8,
            _ => false,
        };
        if !exact {
            return Err("发布提案引用未精确命中当前字段".into());
        }
    }
    Ok(())
}
#[tauri::command]
async fn save_release_preparation_proposals(
    app: AppHandle,
    request: SaveReleasePreparationProposalsRequest,
) -> Result<Vec<AgentToolProposalSummary>, String> {
    if request.project_id.trim().is_empty()
        || request.run_id.trim().is_empty()
        || request.proposals.is_empty()
        || request.proposals.len() > 20
    {
        return Err("发布准备提案批次无效".into());
    }
    let path = database_path(&app)?;
    let mut connection = sqlite_connection(&path, false).await?;
    let mut tx = connection
        .begin()
        .await
        .map_err(|e| format!("无法开始保存发布提案：{e}"))?;
    let valid:i64=sqlx::query_scalar("SELECT COUNT(*) FROM agent_runs r JOIN projects p ON p.id=r.project_id WHERE r.id=? AND r.project_id=? AND r.agent_definition_id='release-preparation:v1' AND r.run_type='release_preparation' AND r.status='succeeded' AND p.archived_at IS NULL").bind(request.run_id.trim()).bind(request.project_id.trim()).fetch_one(&mut *tx).await.map_err(|e|format!("无法校验发布准备运行：{e}"))?;
    if valid != 1 {
        return Err("发布提案必须来自当前项目成功的固定 Agent 运行".into());
    }
    let timestamp = trace_timestamp();
    let mut ids = Vec::new();
    for (index, p) in request.proposals.into_iter().enumerate() {
        if p.id.trim().is_empty()
            || p.release_id.trim().is_empty()
            || p.expected_updated_at.trim().is_empty()
            || p.rationale.trim().is_empty()
            || p.rationale.chars().count() > 2000
            || ids.iter().any(|v: &String| v == p.id.trim())
        {
            return Err(format!("第 {} 条发布提案字段无效", index + 1));
        }
        let release=sqlx::query_as::<_,(String,String,String,String,String,String,String,String,String,String)>("SELECT r.title,r.scope_json,r.checklist_json,r.rollback_plan,r.result,r.retrospective,r.follow_up_json,r.status,r.target_date,r.updated_at FROM releases r JOIN projects p ON p.id=r.project_id WHERE r.id=? AND r.project_id=? AND r.status IN ('planned','ready') AND p.archived_at IS NULL").bind(p.release_id.trim()).bind(request.project_id.trim()).fetch_optional(&mut *tx).await.map_err(|e|format!("无法读取发布提案目标：{e}"))?.ok_or_else(||"发布提案目标不存在、状态不允许或项目不匹配".to_string())?;
        if release.9 != p.expected_updated_at {
            return Err("发布记录已变化，请重新生成提案".into());
        }
        let changes = normalize_release_preparation_changes(p.changes)?;
        let current_scope: Vec<String> =
            serde_json::from_str(&release.1).map_err(|_| "发布范围数据已损坏".to_string())?;
        let current_check: Vec<String> =
            serde_json::from_str(&release.2).map_err(|_| "检查清单数据已损坏".to_string())?;
        let changed = changes.scope.as_ref().is_some_and(|v| v != &current_scope)
            || changes
                .checklist
                .as_ref()
                .is_some_and(|v| v != &current_check)
            || changes
                .rollback_plan
                .as_ref()
                .is_some_and(|v| v != &release.3)
            || changes
                .target_date
                .as_ref()
                .is_some_and(|v| v != &release.8);
        if !changed {
            return Err("发布提案没有实际字段变化".into());
        }
        validate_release_preparation_citations(&p.citations, &release)?;
        let payload =
            serde_json::to_string(&changes).map_err(|_| "无法序列化发布提案".to_string())?;
        let evidence =
            serde_json::to_string(&p.citations).map_err(|_| "无法序列化发布证据".to_string())?;
        sqlx::query("INSERT INTO agent_tool_proposals(id,project_id,target_type,target_id,agent_run_id,agent_definition_id,tool_key,expected_target_updated_at,payload_json,evidence_json,rationale,status,created_at,updated_at) VALUES(?,?,'release',?,?,'release-preparation:v1','update_release_preparation',?,?,?,?,'pending_confirmation',?,?)").bind(p.id.trim()).bind(request.project_id.trim()).bind(p.release_id.trim()).bind(request.run_id.trim()).bind(p.expected_updated_at.trim()).bind(payload).bind(evidence).bind(p.rationale.trim()).bind(&timestamp).bind(&timestamp).execute(&mut *tx).await.map_err(|_|"无法保存发布提案".to_string())?;
        ids.push(p.id.trim().to_string());
    }
    tx.commit()
        .await
        .map_err(|e| format!("无法提交发布提案：{e}"))?;
    let rows=sqlx::query_as::<_,AgentToolProposalRow>("SELECT id,project_id,target_type,target_id,agent_run_id,agent_definition_id,tool_key,expected_target_updated_at,payload_json,evidence_json,rationale,status,created_at,updated_at,reviewed_at,executed_at FROM agent_tool_proposals WHERE agent_run_id=? ORDER BY created_at DESC,id").bind(request.run_id.trim()).fetch_all(&mut connection).await.map_err(|e|format!("无法读取发布提案：{e}"))?;
    connection.close().await.ok();
    Ok(rows.into_iter().map(agent_tool_proposal_summary).collect())
}

#[tauri::command]
async fn list_agent_tool_proposals(
    app: AppHandle,
    project_id: String,
) -> Result<Vec<AgentToolProposalSummary>, String> {
    if project_id.trim().is_empty() || project_id.len() > 200 {
        return Err("项目标识无效".into());
    }
    let path = database_path(&app)?;
    let mut connection = sqlite_connection(&path, true).await?;
    let rows = sqlx::query_as::<_, AgentToolProposalRow>(
        "SELECT id, project_id, target_type, target_id, agent_run_id, agent_definition_id, tool_key,
                expected_target_updated_at, payload_json, evidence_json, rationale, status,
                created_at, updated_at, reviewed_at, executed_at
         FROM agent_tool_proposals WHERE project_id = ?
         ORDER BY CASE status WHEN 'pending_confirmation' THEN 0 ELSE 1 END, created_at DESC LIMIT 100",
    )
    .bind(project_id.trim())
    .fetch_all(&mut connection)
    .await;
    connection.close().await.ok();
    rows.map(|items| items.into_iter().map(agent_tool_proposal_summary).collect())
        .map_err(|error| format!("无法读取 Agent 工具提案：{error}"))
}

#[tauri::command]
async fn confirm_agent_tool_proposal(
    app: AppHandle,
    project_id: String,
    proposal_id: String,
    user_confirmed: bool,
) -> Result<AgentToolProposalActionResult, String> {
    if !user_confirmed {
        return Err("高风险工具提案必须由用户显式确认".into());
    }
    if project_id.trim().is_empty() || proposal_id.trim().is_empty() {
        return Err("Agent 工具提案确认参数无效".into());
    }
    let path = database_path(&app)?;
    let mut connection = sqlite_connection(&path, false).await?;
    let mut transaction = connection
        .begin()
        .await
        .map_err(|error| format!("无法开始确认 Agent 工具提案：{error}"))?;
    let proposal = sqlx::query_as::<_, (String, String, String, String, String, String, String)>(
        "SELECT target_type, target_id, agent_definition_id, tool_key, expected_target_updated_at, payload_json, status
         FROM agent_tool_proposals
         WHERE id = ? AND project_id = ?",
    )
    .bind(proposal_id.trim())
    .bind(project_id.trim())
    .fetch_optional(&mut *transaction)
    .await
    .map_err(|error| format!("无法读取 Agent 工具提案：{error}"))?
    .ok_or_else(|| "Agent 工具提案不存在或项目不匹配".to_string())?;
    if proposal.6 != "pending_confirmation" {
        return Err("Agent 工具提案已经处理，不能重复执行".into());
    }
    if proposal.0 == "release"
        && proposal.2 == "release-preparation:v1"
        && proposal.3 == "update_release_preparation"
    {
        let release=sqlx::query_as::<_,(String,String,String)>("SELECT r.updated_at,r.status,r.target_date FROM releases r JOIN projects p ON p.id=r.project_id WHERE r.id=? AND r.project_id=? AND p.archived_at IS NULL").bind(&proposal.1).bind(project_id.trim()).fetch_optional(&mut *transaction).await.map_err(|e|format!("无法读取发布提案目标：{e}"))?.ok_or_else(||"发布记录不存在或项目已归档".to_string())?;
        let reviewed = trace_timestamp();
        if release.0 != proposal.4 || !matches!(release.1.as_str(), "planned" | "ready") {
            sqlx::query("UPDATE agent_tool_proposals SET status='stale',reviewed_at=?,updated_at=? WHERE id=? AND status='pending_confirmation'").bind(&reviewed).bind(&reviewed).bind(proposal_id.trim()).execute(&mut *transaction).await.map_err(|e|format!("无法标记过期发布提案：{e}"))?;
            transaction
                .commit()
                .await
                .map_err(|e| format!("无法提交过期状态：{e}"))?;
            connection.close().await.ok();
            return Ok(AgentToolProposalActionResult {
                status: "stale".into(),
            });
        }
        let changes = normalize_release_preparation_changes(
            serde_json::from_str::<ReleasePreparationChanges>(&proposal.5)
                .map_err(|_| "发布提案字段已损坏".to_string())?,
        )?;
        let scope = changes
            .scope
            .as_ref()
            .map(serde_json::to_string)
            .transpose()
            .map_err(|_| "无法序列化发布范围".to_string())?;
        let checklist = changes
            .checklist
            .as_ref()
            .map(serde_json::to_string)
            .transpose()
            .map_err(|_| "无法序列化检查清单".to_string())?;
        let executed = if reviewed == release.0 {
            reviewed
                .parse::<u128>()
                .map(|v| (v + 1).to_string())
                .unwrap_or_else(|_| format!("{reviewed}.1"))
        } else {
            reviewed.clone()
        };
        let outcome=sqlx::query("UPDATE releases SET scope_json=COALESCE(?,scope_json),checklist_json=COALESCE(?,checklist_json),rollback_plan=COALESCE(?,rollback_plan),target_date=COALESCE(?,target_date),updated_at=? WHERE id=? AND project_id=? AND updated_at=? AND status IN ('planned','ready')").bind(scope).bind(checklist).bind(changes.rollback_plan).bind(changes.target_date).bind(&executed).bind(&proposal.1).bind(project_id.trim()).bind(&proposal.4).execute(&mut *transaction).await.map_err(|e|format!("无法执行发布准备更新：{e}"))?;
        let status = if outcome.rows_affected() == 1 {
            "executed"
        } else {
            "stale"
        };
        sqlx::query("UPDATE agent_tool_proposals SET status=?,reviewed_at=?,executed_at=CASE WHEN ?='executed' THEN ? ELSE executed_at END,updated_at=? WHERE id=? AND status='pending_confirmation'").bind(status).bind(&executed).bind(status).bind(&executed).bind(&executed).bind(proposal_id.trim()).execute(&mut *transaction).await.map_err(|e|format!("无法更新发布提案状态：{e}"))?;
        transaction
            .commit()
            .await
            .map_err(|e| format!("无法提交发布提案：{e}"))?;
        connection.close().await.ok();
        return Ok(AgentToolProposalActionResult {
            status: status.into(),
        });
    }
    if proposal.0 == "project_dependency"
        && proposal.2 == "dependency-remediation:v1"
        && proposal.3 == "update_project_dependency"
    {
        let dependency = sqlx::query_as::<_, (String, String)>(
            "SELECT d.updated_at, d.status
             FROM project_dependencies d JOIN projects p ON p.id = d.project_id
             WHERE d.id = ? AND d.project_id = ? AND p.archived_at IS NULL",
        )
        .bind(&proposal.1)
        .bind(project_id.trim())
        .fetch_optional(&mut *transaction)
        .await
        .map_err(|error| format!("无法读取依赖处置提案目标：{error}"))?
        .ok_or_else(|| "依赖记录不存在或项目已归档".to_string())?;
        let reviewed_at = trace_timestamp();
        if dependency.0 != proposal.4 || dependency.1 == "resolved" {
            sqlx::query("UPDATE agent_tool_proposals SET status = 'stale', reviewed_at = ?, updated_at = ? WHERE id = ? AND status = 'pending_confirmation'")
                .bind(&reviewed_at).bind(&reviewed_at).bind(proposal_id.trim()).execute(&mut *transaction).await
                .map_err(|error| format!("无法标记过期依赖提案：{error}"))?;
            transaction
                .commit()
                .await
                .map_err(|error| format!("无法提交过期依赖提案状态：{error}"))?;
            connection.close().await.ok();
            return Ok(AgentToolProposalActionResult {
                status: "stale".into(),
            });
        }
        let raw_changes = serde_json::from_str::<ProjectDependencyUpdateChanges>(&proposal.5)
            .map_err(|_| "依赖处置提案字段数据已损坏".to_string())?;
        let changes = normalize_project_dependency_changes(raw_changes)?;
        let executed_at = if reviewed_at == dependency.0 {
            reviewed_at
                .parse::<u128>()
                .map(|value| (value + 1).to_string())
                .unwrap_or_else(|_| format!("{reviewed_at}.1"))
        } else {
            reviewed_at.clone()
        };
        let outcome = sqlx::query(
            "UPDATE project_dependencies
             SET owner = COALESCE(?, owner), due_date = COALESCE(?, due_date),
                 resolution = COALESCE(?, resolution), updated_at = ?
             WHERE id = ? AND project_id = ? AND updated_at = ? AND status != 'resolved'",
        )
        .bind(changes.owner)
        .bind(changes.due_date)
        .bind(changes.resolution)
        .bind(&executed_at)
        .bind(&proposal.1)
        .bind(project_id.trim())
        .bind(&proposal.4)
        .execute(&mut *transaction)
        .await
        .map_err(|error| format!("无法执行依赖处置更新：{error}"))?;
        if outcome.rows_affected() != 1 {
            sqlx::query("UPDATE agent_tool_proposals SET status = 'stale', reviewed_at = ?, updated_at = ? WHERE id = ? AND status = 'pending_confirmation'")
                .bind(&executed_at).bind(&executed_at).bind(proposal_id.trim()).execute(&mut *transaction).await
                .map_err(|error| format!("无法标记确认期间过期的依赖提案：{error}"))?;
            transaction
                .commit()
                .await
                .map_err(|error| format!("无法提交过期依赖提案状态：{error}"))?;
            connection.close().await.ok();
            return Ok(AgentToolProposalActionResult {
                status: "stale".into(),
            });
        }
        let proposal_outcome = sqlx::query(
            "UPDATE agent_tool_proposals SET status = 'executed', reviewed_at = ?, executed_at = ?, updated_at = ?
             WHERE id = ? AND status = 'pending_confirmation'",
        ).bind(&executed_at).bind(&executed_at).bind(&executed_at).bind(proposal_id.trim())
          .execute(&mut *transaction).await.map_err(|error| format!("无法完成依赖处置提案状态：{error}"))?;
        if proposal_outcome.rows_affected() != 1 {
            return Err("依赖处置提案在确认期间已被处理".into());
        }
        transaction
            .commit()
            .await
            .map_err(|error| format!("无法提交依赖处置提案执行：{error}"))?;
        connection.close().await.ok();
        return Ok(AgentToolProposalActionResult {
            status: "executed".into(),
        });
    }
    if proposal.0 == "project_risk"
        && proposal.2 == "risk-review:v2"
        && proposal.3 == "update_project_risk"
    {
        let risk = sqlx::query_as::<_, (String, String)>(
            "SELECT r.updated_at, r.status
             FROM project_risks r JOIN projects p ON p.id = r.project_id
             WHERE r.id = ? AND r.project_id = ? AND p.archived_at IS NULL",
        )
        .bind(&proposal.1)
        .bind(project_id.trim())
        .fetch_optional(&mut *transaction)
        .await
        .map_err(|error| format!("无法读取风险缓解提案目标：{error}"))?
        .ok_or_else(|| "风险记录不存在或项目已归档".to_string())?;
        let reviewed_at = trace_timestamp();
        if risk.0 != proposal.4 || risk.1 == "closed" {
            sqlx::query(
                "UPDATE agent_tool_proposals
                 SET status = 'stale', reviewed_at = ?, updated_at = ?
                 WHERE id = ? AND status = 'pending_confirmation'",
            )
            .bind(&reviewed_at)
            .bind(&reviewed_at)
            .bind(proposal_id.trim())
            .execute(&mut *transaction)
            .await
            .map_err(|error| format!("无法标记过期风险提案：{error}"))?;
            transaction
                .commit()
                .await
                .map_err(|error| format!("无法提交过期风险提案状态：{error}"))?;
            connection.close().await.ok();
            return Ok(AgentToolProposalActionResult {
                status: "stale".into(),
            });
        }
        let raw_changes = serde_json::from_str::<ProjectRiskUpdateChanges>(&proposal.5)
            .map_err(|_| "风险缓解提案字段数据已损坏".to_string())?;
        let changes = normalize_project_risk_changes(raw_changes)?;
        let executed_at = if reviewed_at == risk.0 {
            reviewed_at
                .parse::<u128>()
                .map(|value| (value + 1).to_string())
                .unwrap_or_else(|_| format!("{reviewed_at}.1"))
        } else {
            reviewed_at.clone()
        };
        let outcome = sqlx::query(
            "UPDATE project_risks
             SET mitigation = COALESCE(?, mitigation), owner = COALESCE(?, owner),
                 due_date = COALESCE(?, due_date), severity = COALESCE(?, severity),
                 probability = COALESCE(?, probability), updated_at = ?
             WHERE id = ? AND project_id = ? AND updated_at = ? AND status != 'closed'",
        )
        .bind(changes.mitigation)
        .bind(changes.owner)
        .bind(changes.due_date)
        .bind(changes.severity)
        .bind(changes.probability)
        .bind(&executed_at)
        .bind(&proposal.1)
        .bind(project_id.trim())
        .bind(&proposal.4)
        .execute(&mut *transaction)
        .await
        .map_err(|error| format!("无法执行风险缓解更新：{error}"))?;
        if outcome.rows_affected() != 1 {
            sqlx::query(
                "UPDATE agent_tool_proposals
                 SET status = 'stale', reviewed_at = ?, updated_at = ?
                 WHERE id = ? AND status = 'pending_confirmation'",
            )
            .bind(&executed_at)
            .bind(&executed_at)
            .bind(proposal_id.trim())
            .execute(&mut *transaction)
            .await
            .map_err(|error| format!("无法标记确认期间过期的风险提案：{error}"))?;
            transaction
                .commit()
                .await
                .map_err(|error| format!("无法提交过期风险提案状态：{error}"))?;
            connection.close().await.ok();
            return Ok(AgentToolProposalActionResult {
                status: "stale".into(),
            });
        }
        let proposal_outcome = sqlx::query(
            "UPDATE agent_tool_proposals
             SET status = 'executed', reviewed_at = ?, executed_at = ?, updated_at = ?
             WHERE id = ? AND status = 'pending_confirmation'",
        )
        .bind(&executed_at)
        .bind(&executed_at)
        .bind(&executed_at)
        .bind(proposal_id.trim())
        .execute(&mut *transaction)
        .await
        .map_err(|error| format!("无法完成风险缓解提案状态：{error}"))?;
        if proposal_outcome.rows_affected() != 1 {
            return Err("风险缓解提案在确认期间已被处理".into());
        }
        transaction
            .commit()
            .await
            .map_err(|error| format!("无法提交风险缓解提案执行：{error}"))?;
        connection.close().await.ok();
        return Ok(AgentToolProposalActionResult {
            status: "executed".into(),
        });
    }
    if proposal.0 != "research_plan"
        || proposal.2 != "plan-engineer:v2"
        || proposal.3 != "update_research_plan"
    {
        return Err("Agent 工具提案类型与执行器不匹配".into());
    }
    let plan = sqlx::query_as::<_, (String, String, String)>(
        "SELECT p.start_date, p.end_date, p.updated_at
         FROM research_plans p JOIN projects project ON project.id = p.project_id
         WHERE p.id = ? AND p.project_id = ? AND p.status != 'cancelled' AND project.archived_at IS NULL",
    )
    .bind(&proposal.1)
    .bind(project_id.trim())
    .fetch_optional(&mut *transaction)
    .await
    .map_err(|error| format!("无法读取 Agent 工具提案目标：{error}"))?
    .ok_or_else(|| "研究计划不存在、已取消或项目已归档".to_string())?;
    let reviewed_at = trace_timestamp();
    if plan.2 != proposal.4 {
        sqlx::query(
            "UPDATE agent_tool_proposals
             SET status = 'stale', reviewed_at = ?, updated_at = ?
             WHERE id = ? AND status = 'pending_confirmation'",
        )
        .bind(&reviewed_at)
        .bind(&reviewed_at)
        .bind(proposal_id.trim())
        .execute(&mut *transaction)
        .await
        .map_err(|error| format!("无法标记过期提案：{error}"))?;
        transaction
            .commit()
            .await
            .map_err(|error| format!("无法提交过期提案状态：{error}"))?;
        connection.close().await.ok();
        return Ok(AgentToolProposalActionResult {
            status: "stale".into(),
        });
    }
    let raw_changes = serde_json::from_str::<ResearchPlanUpdateChanges>(&proposal.5)
        .map_err(|_| "Agent 工具提案字段数据已损坏".to_string())?;
    let changes = normalize_research_plan_changes(raw_changes, &plan.0, &plan.1)?;
    let questions_json = changes
        .questions
        .as_ref()
        .map(serde_json::to_string)
        .transpose()
        .map_err(|_| "无法序列化研究计划提纲".to_string())?;
    let executed_at = if reviewed_at == plan.2 {
        reviewed_at
            .parse::<u128>()
            .map(|value| (value + 1).to_string())
            .unwrap_or_else(|_| format!("{reviewed_at}.1"))
    } else {
        reviewed_at.clone()
    };
    let outcome = sqlx::query(
        "UPDATE research_plans
         SET objective = COALESCE(?, objective), target_persona = COALESCE(?, target_persona),
             questions_json = COALESCE(?, questions_json), start_date = COALESCE(?, start_date),
             end_date = COALESCE(?, end_date), updated_at = ?
         WHERE id = ? AND project_id = ? AND updated_at = ? AND status != 'cancelled'",
    )
    .bind(changes.objective)
    .bind(changes.target_persona)
    .bind(questions_json)
    .bind(changes.start_date)
    .bind(changes.end_date)
    .bind(&executed_at)
    .bind(&proposal.1)
    .bind(project_id.trim())
    .bind(&proposal.4)
    .execute(&mut *transaction)
    .await
    .map_err(|error| format!("无法执行研究计划更新：{error}"))?;
    if outcome.rows_affected() != 1 {
        sqlx::query(
            "UPDATE agent_tool_proposals
             SET status = 'stale', reviewed_at = ?, updated_at = ?
             WHERE id = ? AND status = 'pending_confirmation'",
        )
        .bind(&executed_at)
        .bind(&executed_at)
        .bind(proposal_id.trim())
        .execute(&mut *transaction)
        .await
        .map_err(|error| format!("无法标记确认期间过期的提案：{error}"))?;
        transaction
            .commit()
            .await
            .map_err(|error| format!("无法提交过期提案状态：{error}"))?;
        connection.close().await.ok();
        return Ok(AgentToolProposalActionResult {
            status: "stale".into(),
        });
    }
    let proposal_outcome = sqlx::query(
        "UPDATE agent_tool_proposals
         SET status = 'executed', reviewed_at = ?, executed_at = ?, updated_at = ?
         WHERE id = ? AND status = 'pending_confirmation'",
    )
    .bind(&executed_at)
    .bind(&executed_at)
    .bind(&executed_at)
    .bind(proposal_id.trim())
    .execute(&mut *transaction)
    .await
    .map_err(|error| format!("无法完成 Agent 工具提案状态：{error}"))?;
    if proposal_outcome.rows_affected() != 1 {
        return Err("Agent 工具提案在确认期间已被处理".into());
    }
    transaction
        .commit()
        .await
        .map_err(|error| format!("无法提交 Agent 工具提案执行：{error}"))?;
    connection.close().await.ok();
    Ok(AgentToolProposalActionResult {
        status: "executed".into(),
    })
}

#[tauri::command]
async fn reject_agent_tool_proposal(
    app: AppHandle,
    project_id: String,
    proposal_id: String,
) -> Result<(), String> {
    if project_id.trim().is_empty() || proposal_id.trim().is_empty() {
        return Err("Agent 工具提案拒绝参数无效".into());
    }
    let path = database_path(&app)?;
    let mut connection = sqlite_connection(&path, false).await?;
    let timestamp = trace_timestamp();
    let outcome = sqlx::query(
        "UPDATE agent_tool_proposals SET status = 'rejected', reviewed_at = ?, updated_at = ?
         WHERE id = ? AND project_id = ? AND status = 'pending_confirmation'",
    )
    .bind(&timestamp)
    .bind(&timestamp)
    .bind(proposal_id.trim())
    .bind(project_id.trim())
    .execute(&mut connection)
    .await;
    connection.close().await.ok();
    match outcome {
        Ok(result) if result.rows_affected() == 1 => Ok(()),
        Ok(_) => Err("Agent 工具提案不存在、项目不匹配或已经处理".into()),
        Err(error) => Err(format!("无法拒绝 Agent 工具提案：{error}")),
    }
}

#[tauri::command]
async fn create_research_insight(
    app: AppHandle,
    request: CreateResearchInsightRequest,
) -> Result<ResearchInsightSummary, String> {
    if request.id.trim().is_empty()
        || request.project_id.trim().is_empty()
        || request.entry_id.trim().is_empty()
        || request.title.trim().is_empty()
        || request.title.chars().count() > 200
        || request.statement.trim().is_empty()
        || request.statement.chars().count() > 5_000
    {
        return Err("研究洞察字段无效".into());
    }
    validate_release_list(&request.evidence_json, "洞察证据")?;
    let path = database_path(&app)?;
    let mut connection = sqlite_connection(&path, false).await?;
    let timestamp = trace_timestamp();
    let plan_id = request
        .plan_id
        .as_deref()
        .map(str::trim)
        .filter(|v| !v.is_empty());
    let result = sqlx::query("INSERT INTO research_insights (id, project_id, plan_id, entry_id, title, statement, evidence_json, status, created_at, updated_at) SELECT ?, e.project_id, ?, e.id, ?, ?, ?, 'draft', ?, ? FROM research_entries e WHERE e.id = ? AND e.project_id = ? AND (? IS NULL OR EXISTS (SELECT 1 FROM research_plans p WHERE p.id = ? AND p.project_id = e.project_id))").bind(request.id.trim()).bind(plan_id).bind(request.title.trim()).bind(request.statement.trim()).bind(&request.evidence_json).bind(&timestamp).bind(&timestamp).bind(request.entry_id.trim()).bind(request.project_id.trim()).bind(plan_id).bind(plan_id).execute(&mut connection).await;
    let row = match result { Ok(outcome) if outcome.rows_affected() == 1 => sqlx::query_as::<_, (String,String,Option<String>,String,String,String,String,String,String,String)>("SELECT id, project_id, plan_id, entry_id, title, statement, evidence_json, status, created_at, updated_at FROM research_insights WHERE id = ?").bind(request.id.trim()).fetch_one(&mut connection).await.map_err(|error| format!("无法读取研究洞察：{error}")), Ok(_) => Err("研究记录、计划不存在或不属于当前项目".into()), Err(error) => Err(format!("无法保存研究洞察：{error}")) };
    connection.close().await.ok();
    row.map(|v| ResearchInsightSummary {
        id: v.0,
        project_id: v.1,
        plan_id: v.2,
        entry_id: v.3,
        title: v.4,
        statement: v.5,
        evidence_json: v.6,
        status: v.7,
        created_at: v.8,
        updated_at: v.9,
    })
}

#[tauri::command]
async fn list_research_insights(
    app: AppHandle,
    project_id: String,
) -> Result<Vec<ResearchInsightSummary>, String> {
    if project_id.trim().is_empty() {
        return Err("项目标识无效".into());
    }
    let path = database_path(&app)?;
    let mut connection = sqlite_connection(&path, true).await?;
    let rows = sqlx::query_as::<_, (String,String,Option<String>,String,String,String,String,String,String,String)>("SELECT id, project_id, plan_id, entry_id, title, statement, evidence_json, status, created_at, updated_at FROM research_insights WHERE project_id = ? ORDER BY updated_at DESC LIMIT 200").bind(project_id.trim()).fetch_all(&mut connection).await;
    connection.close().await.ok();
    rows.map(|items| {
        items
            .into_iter()
            .map(|v| ResearchInsightSummary {
                id: v.0,
                project_id: v.1,
                plan_id: v.2,
                entry_id: v.3,
                title: v.4,
                statement: v.5,
                evidence_json: v.6,
                status: v.7,
                created_at: v.8,
                updated_at: v.9,
            })
            .collect()
    })
    .map_err(|error| format!("无法读取研究洞察：{error}"))
}

#[tauri::command]
async fn review_research_insight(
    app: AppHandle,
    project_id: String,
    insight_id: String,
    status: String,
) -> Result<(), String> {
    if project_id.trim().is_empty()
        || insight_id.trim().is_empty()
        || !matches!(status.as_str(), "accepted" | "rejected")
    {
        return Err("研究洞察审核参数无效".into());
    }
    let path = database_path(&app)?;
    let mut connection = sqlite_connection(&path, false).await?;
    let result = sqlx::query("UPDATE research_insights SET status = ?, updated_at = ? WHERE id = ? AND project_id = ? AND status = 'draft'").bind(status.trim()).bind(trace_timestamp()).bind(insight_id.trim()).bind(project_id.trim()).execute(&mut connection).await;
    connection.close().await.ok();
    match result {
        Ok(outcome) if outcome.rows_affected() == 1 => Ok(()),
        Ok(_) => Err("研究洞察不存在、已审核或项目不匹配".into()),
        Err(error) => Err(format!("无法审核研究洞察：{error}")),
    }
}

#[tauri::command]
async fn create_research_requirement_candidate(
    app: AppHandle,
    request: CreateResearchRequirementCandidateRequest,
) -> Result<ResearchRequirementCandidateSummary, String> {
    if request.id.trim().is_empty()
        || request.project_id.trim().is_empty()
        || request.insight_id.trim().is_empty()
        || request.title.trim().is_empty()
        || request.title.chars().count() > 200
        || request.description.trim().is_empty()
        || request.description.chars().count() > 5_000
    {
        return Err("研究需求候选字段无效".into());
    }
    let path = database_path(&app)?;
    let mut connection = sqlite_connection(&path, false).await?;
    let timestamp = trace_timestamp();
    let result = sqlx::query("INSERT INTO research_requirement_candidates (id, project_id, insight_id, title, description, status, created_at, updated_at) SELECT ?, project_id, id, ?, ?, 'draft', ?, ? FROM research_insights WHERE id = ? AND project_id = ? AND status = 'accepted'").bind(request.id.trim()).bind(request.title.trim()).bind(request.description.trim()).bind(&timestamp).bind(&timestamp).bind(request.insight_id.trim()).bind(request.project_id.trim()).execute(&mut connection).await;
    let row = match result { Ok(outcome) if outcome.rows_affected() == 1 => sqlx::query_as::<_, (String,String,String,String,String,String,Option<String>,String,String)>("SELECT id, project_id, insight_id, title, description, status, requirement_card_id, created_at, updated_at FROM research_requirement_candidates WHERE id = ?").bind(request.id.trim()).fetch_one(&mut connection).await.map_err(|error| format!("无法读取研究需求候选：{error}")), Ok(_) => Err("洞察不存在、未接受、重复创建或项目不匹配".into()), Err(error) => Err(format!("无法保存研究需求候选：{error}")) };
    connection.close().await.ok();
    row.map(|v| ResearchRequirementCandidateSummary {
        id: v.0,
        project_id: v.1,
        insight_id: v.2,
        title: v.3,
        description: v.4,
        status: v.5,
        requirement_card_id: v.6,
        created_at: v.7,
        updated_at: v.8,
    })
}

#[tauri::command]
async fn list_research_requirement_candidates(
    app: AppHandle,
    project_id: String,
) -> Result<Vec<ResearchRequirementCandidateSummary>, String> {
    if project_id.trim().is_empty() {
        return Err("项目标识无效".into());
    }
    let path = database_path(&app)?;
    let mut connection = sqlite_connection(&path, true).await?;
    let rows = sqlx::query_as::<_, (String,String,String,String,String,String,Option<String>,String,String)>("SELECT id, project_id, insight_id, title, description, status, requirement_card_id, created_at, updated_at FROM research_requirement_candidates WHERE project_id = ? ORDER BY updated_at DESC LIMIT 200").bind(project_id.trim()).fetch_all(&mut connection).await;
    connection.close().await.ok();
    rows.map(|items| {
        items
            .into_iter()
            .map(|v| ResearchRequirementCandidateSummary {
                id: v.0,
                project_id: v.1,
                insight_id: v.2,
                title: v.3,
                description: v.4,
                status: v.5,
                requirement_card_id: v.6,
                created_at: v.7,
                updated_at: v.8,
            })
            .collect()
    })
    .map_err(|error| format!("无法读取研究需求候选：{error}"))
}

#[tauri::command]
async fn review_research_requirement_candidate(
    app: AppHandle,
    project_id: String,
    candidate_id: String,
    status: String,
) -> Result<(), String> {
    if project_id.trim().is_empty()
        || candidate_id.trim().is_empty()
        || !matches!(status.as_str(), "accepted" | "rejected")
    {
        return Err("研究需求候选审核参数无效".into());
    }
    let path = database_path(&app)?;
    let mut connection = sqlite_connection(&path, false).await?;
    let result = sqlx::query("UPDATE research_requirement_candidates SET status = ?, updated_at = ? WHERE id = ? AND project_id = ? AND status = 'draft'").bind(status.trim()).bind(trace_timestamp()).bind(candidate_id.trim()).bind(project_id.trim()).execute(&mut connection).await;
    connection.close().await.ok();
    match result {
        Ok(outcome) if outcome.rows_affected() == 1 => Ok(()),
        Ok(_) => Err("研究需求候选不存在、已审核或项目不匹配".into()),
        Err(error) => Err(format!("无法审核研究需求候选：{error}")),
    }
}

#[tauri::command]
async fn create_metric_definition(
    app: AppHandle,
    request: CreateMetricDefinitionRequest,
) -> Result<MetricDefinitionSummary, String> {
    if request.id.trim().is_empty()
        || request.id.len() > 200
        || request.project_id.trim().is_empty()
        || request.name.trim().is_empty()
        || request.name.chars().count() > 200
        || request.description.chars().count() > 1_000
        || request.unit.chars().count() > 50
        || request.formula_json.len() > 20_000
    {
        return Err("指标定义字段无效".into());
    }
    let formula: serde_json::Value = serde_json::from_str(&request.formula_json)
        .map_err(|_| "formula_json 不是有效 JSON".to_string())?;
    let operator = formula
        .get("operator")
        .and_then(serde_json::Value::as_str)
        .ok_or_else(|| "指标公式缺少 operator".to_string())?;
    if !matches!(operator, "count" | "sum" | "mean" | "conversion") {
        return Err("指标公式不在白名单内".into());
    }
    let path = database_path(&app)?;
    let mut connection = sqlite_connection(&path, false).await?;
    let version: i64 = sqlx::query_scalar("SELECT COALESCE(MAX(version_number), 0) + 1 FROM metric_definitions WHERE id = ? AND project_id = ?").bind(request.id.trim()).bind(request.project_id.trim()).fetch_one(&mut connection).await.map_err(|error| error.to_string())?;
    let result = sqlx::query("INSERT INTO metric_definitions (id, project_id, version_number, name, description, unit, formula_json, source_dataset_id, created_at) SELECT ?, ?, ?, ?, ?, ?, ?, d.id, ? FROM analysis_datasets d WHERE d.id = ? AND d.project_id = ?")
        .bind(request.id.trim()).bind(request.project_id.trim()).bind(version).bind(request.name.trim()).bind(&request.description).bind(&request.unit).bind(&request.formula_json).bind(trace_timestamp()).bind(request.source_dataset_id.trim()).bind(request.project_id.trim()).execute(&mut connection).await;
    let row = match result { Ok(outcome) if outcome.rows_affected() == 1 => sqlx::query_as::<_, (String, String, i64, String, String, String, String, String, String)>("SELECT id, project_id, version_number, name, description, unit, formula_json, source_dataset_id, created_at FROM metric_definitions WHERE id = ? AND project_id = ? AND version_number = ?").bind(request.id.trim()).bind(request.project_id.trim()).bind(version).fetch_one(&mut connection).await.map_err(|error| format!("无法读取指标定义：{error}")), Ok(_) => Err("数据集不存在或不属于当前项目".into()), Err(error) => Err(format!("无法保存指标定义：{error}")), };
    connection.close().await.ok();
    row.map(|value| MetricDefinitionSummary {
        id: value.0,
        project_id: value.1,
        version_number: value.2,
        name: value.3,
        description: value.4,
        unit: value.5,
        formula_json: value.6,
        source_dataset_id: value.7,
        created_at: value.8,
    })
}

#[tauri::command]
async fn list_metric_definitions(
    app: AppHandle,
    project_id: String,
) -> Result<Vec<MetricDefinitionSummary>, String> {
    if project_id.trim().is_empty() || project_id.len() > 200 {
        return Err("项目标识无效".into());
    }
    let path = database_path(&app)?;
    let mut connection = sqlite_connection(&path, true).await?;
    let rows = sqlx::query_as::<_, (String, String, i64, String, String, String, String, String, String)>("SELECT id, project_id, version_number, name, description, unit, formula_json, source_dataset_id, created_at FROM metric_definitions WHERE project_id = ? ORDER BY id, version_number DESC LIMIT 200").bind(project_id.trim()).fetch_all(&mut connection).await;
    connection.close().await.ok();
    rows.map(|items| {
        items
            .into_iter()
            .map(|value| MetricDefinitionSummary {
                id: value.0,
                project_id: value.1,
                version_number: value.2,
                name: value.3,
                description: value.4,
                unit: value.5,
                formula_json: value.6,
                source_dataset_id: value.7,
                created_at: value.8,
            })
            .collect()
    })
    .map_err(|error| format!("无法读取指标定义：{error}"))
}

#[tauri::command]
async fn create_experiment(
    app: AppHandle,
    request: CreateExperimentRequest,
) -> Result<ExperimentSummary, String> {
    if request.id.trim().is_empty()
        || request.id.len() > 200
        || request.project_id.trim().is_empty()
        || request.name.trim().is_empty()
        || request.name.chars().count() > 200
        || request.hypothesis.chars().count() > 2_000
        || request.primary_metric.trim().is_empty()
        || request.sample_plan.chars().count() > 2_000
        || !matches!(
            request.status.as_str(),
            "draft" | "running" | "completed" | "cancelled"
        )
        || request.start_date.len() != 10
        || request.end_date.len() != 10
        || request.end_date < request.start_date
    {
        return Err("实验定义字段无效".into());
    }
    let path = database_path(&app)?;
    let mut connection = sqlite_connection(&path, false).await?;
    let version: i64 = sqlx::query_scalar(
        "SELECT COALESCE(MAX(version_number), 0) + 1 FROM experiments WHERE id = ?",
    )
    .bind(request.id.trim())
    .fetch_one(&mut connection)
    .await
    .map_err(|error| error.to_string())?;
    let result = sqlx::query("INSERT INTO experiments (id, project_id, version_number, name, hypothesis, primary_metric, sample_plan, start_date, end_date, status, conclusion, decision, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)").bind(request.id.trim()).bind(request.project_id.trim()).bind(version).bind(request.name.trim()).bind(&request.hypothesis).bind(request.primary_metric.trim()).bind(&request.sample_plan).bind(&request.start_date).bind(&request.end_date).bind(&request.status).bind(&request.conclusion).bind(&request.decision).bind(trace_timestamp()).execute(&mut connection).await;
    let row = match result { Ok(_) => sqlx::query_as::<_, (String, String, i64, String, String, String, String, String, String, String, String, String, String)>("SELECT id, project_id, version_number, name, hypothesis, primary_metric, sample_plan, start_date, end_date, status, conclusion, decision, created_at FROM experiments WHERE id = ? AND version_number = ?").bind(request.id.trim()).bind(version).fetch_one(&mut connection).await.map_err(|error| format!("无法读取实验：{error}")), Err(error) => Err(format!("无法保存实验：{error}")), };
    connection.close().await.ok();
    row.map(|value| ExperimentSummary {
        id: value.0,
        project_id: value.1,
        version_number: value.2,
        name: value.3,
        hypothesis: value.4,
        primary_metric: value.5,
        sample_plan: value.6,
        start_date: value.7,
        end_date: value.8,
        status: value.9,
        conclusion: value.10,
        decision: value.11,
        created_at: value.12,
    })
}

#[tauri::command]
async fn list_experiments(
    app: AppHandle,
    project_id: String,
) -> Result<Vec<ExperimentSummary>, String> {
    if project_id.trim().is_empty() || project_id.len() > 200 {
        return Err("项目标识无效".into());
    }
    let path = database_path(&app)?;
    let mut connection = sqlite_connection(&path, true).await?;
    let rows = sqlx::query_as::<_, (String, String, i64, String, String, String, String, String, String, String, String, String, String)>("SELECT id, project_id, version_number, name, hypothesis, primary_metric, sample_plan, start_date, end_date, status, conclusion, decision, created_at FROM experiments WHERE project_id = ? ORDER BY created_at DESC LIMIT 100").bind(project_id.trim()).fetch_all(&mut connection).await;
    connection.close().await.ok();
    rows.map(|items| {
        items
            .into_iter()
            .map(|value| ExperimentSummary {
                id: value.0,
                project_id: value.1,
                version_number: value.2,
                name: value.3,
                hypothesis: value.4,
                primary_metric: value.5,
                sample_plan: value.6,
                start_date: value.7,
                end_date: value.8,
                status: value.9,
                conclusion: value.10,
                decision: value.11,
                created_at: value.12,
            })
            .collect()
    })
    .map_err(|error| format!("无法读取实验：{error}"))
}

#[tauri::command]
async fn create_experiment_result(
    app: AppHandle,
    id: String,
    experiment_id: String,
    result_json: String,
    analysis_json: String,
) -> Result<(), String> {
    if id.trim().is_empty()
        || experiment_id.trim().is_empty()
        || result_json.len() > 100_000
        || analysis_json.len() > 100_000
    {
        return Err("实验结果无效".into());
    }
    serde_json::from_str::<serde_json::Value>(&result_json)
        .map_err(|_| "result_json 不是有效 JSON".to_string())?;
    serde_json::from_str::<serde_json::Value>(&analysis_json)
        .map_err(|_| "analysis_json 不是有效 JSON".to_string())?;
    let path = database_path(&app)?;
    let mut connection = sqlite_connection(&path, false).await?;
    let result = sqlx::query("INSERT INTO experiment_results (id, experiment_id, result_json, analysis_json, imported_at) SELECT ?, id, ?, ?, ? FROM experiments WHERE id = ? ORDER BY version_number DESC LIMIT 1").bind(id.trim()).bind(result_json).bind(analysis_json).bind(trace_timestamp()).bind(experiment_id.trim()).execute(&mut connection).await;
    connection.close().await.ok();
    match result {
        Ok(outcome) if outcome.rows_affected() == 1 => Ok(()),
        Ok(_) => Err("实验不存在".into()),
        Err(error) => Err(format!("无法保存实验结果：{error}")),
    }
}

#[tauri::command]
async fn create_product_document(
    app: AppHandle,
    request: CreateProductDocumentRequest,
) -> Result<ProductDocumentSummary, String> {
    let change_summary = request.change_summary.as_deref().unwrap_or("");
    validate_product_document_fields(
        &request.id,
        &request.project_id,
        &request.title,
        &request.document_type,
        &request.content_markdown,
        change_summary,
    )?;
    let path = database_path(&app)?;
    let mut connection = sqlite_connection(&path, false).await?;
    let source_json = validate_product_document_sources(
        &mut connection,
        request.project_id.trim(),
        request.source_json.as_deref().unwrap_or("[]"),
    )
    .await?;
    let created_at = trace_timestamp();
    let version_id = format!("{}:v1", request.id.trim());
    let mut transaction = connection
        .begin()
        .await
        .map_err(|error| error.to_string())?;
    let result = async {
        sqlx::query(
            "INSERT INTO product_documents
             (id, project_id, title, document_type, status, created_at, updated_at)
             VALUES (?, ?, ?, ?, 'draft', ?, ?)",
        )
        .bind(request.id.trim())
        .bind(request.project_id.trim())
        .bind(request.title.trim())
        .bind(&request.document_type)
        .bind(&created_at)
        .bind(&created_at)
        .execute(&mut *transaction)
        .await
        .map_err(|error| format!("无法创建产品文档: {error}"))?;
        sqlx::query(
            "INSERT INTO product_document_versions
             (id, document_id, version_number, content_markdown, source_json, change_summary, created_by, created_at)
             VALUES (?, ?, 1, ?, ?, ?, 'user', ?)",
        )
        .bind(version_id)
        .bind(request.id.trim())
        .bind(&request.content_markdown)
        .bind(&source_json)
        .bind(change_summary)
        .bind(&created_at)
        .execute(&mut *transaction)
        .await
        .map_err(|error| format!("无法创建产品文档初始版本: {error}"))?;
        transaction.commit().await.map_err(|error| format!("无法提交产品文档: {error}"))?;
        Ok::<(), String>(())
    }.await;
    if let Err(error) = result {
        connection.close().await.ok();
        return Err(error);
    }
    let document = fetch_product_document(
        &mut connection,
        request.project_id.trim(),
        request.id.trim(),
    )
    .await;
    connection.close().await.ok();
    document
}

#[tauri::command]
async fn list_product_documents(
    app: AppHandle,
    project_id: String,
) -> Result<Vec<ProductDocumentSummary>, String> {
    if project_id.trim().is_empty() || project_id.len() > 200 {
        return Err("项目标识无效".to_string());
    }
    let path = database_path(&app)?;
    let mut connection = sqlite_connection(&path, true).await?;
    let documents = sqlx::query_as::<_, ProductDocumentRow>(
        "SELECT d.id, d.project_id, d.title, d.document_type, d.status,
                v.version_number, v.content_markdown, v.source_json, v.change_summary,
                v.created_by, d.created_at, d.updated_at
         FROM product_documents d
         JOIN product_document_versions v ON v.document_id = d.id
           AND v.version_number = (SELECT MAX(version_number) FROM product_document_versions WHERE document_id = d.id)
         WHERE d.project_id = ? ORDER BY d.updated_at DESC, d.rowid DESC LIMIT 50",
    )
    .bind(project_id.trim())
    .fetch_all(&mut connection)
    .await
    .map(|rows| rows.into_iter().map(product_document_from_row).collect())
    .map_err(|error| format!("无法读取产品文档: {error}"));
    connection.close().await.ok();
    documents
}

#[tauri::command]
async fn list_product_document_versions(
    app: AppHandle,
    project_id: String,
    document_id: String,
) -> Result<Vec<ProductDocumentVersionSummary>, String> {
    if project_id.trim().is_empty()
        || project_id.len() > 200
        || document_id.trim().is_empty()
        || document_id.len() > 200
    {
        return Err("项目文档标识无效".to_string());
    }
    let path = database_path(&app)?;
    let mut connection = sqlite_connection(&path, true).await?;
    let versions = sqlx::query_as::<_, (String, String, i64, String, String, String, String)>(
        "SELECT v.id, v.document_id, v.version_number, v.content_markdown,
                v.change_summary, v.created_by, v.created_at
         FROM product_document_versions v
         JOIN product_documents d ON d.id = v.document_id
         WHERE d.project_id = ? AND d.id = ?
         ORDER BY v.version_number DESC LIMIT 50",
    )
    .bind(project_id.trim())
    .bind(document_id.trim())
    .fetch_all(&mut connection)
    .await
    .map(|rows| {
        rows.into_iter()
            .map(|row| ProductDocumentVersionSummary {
                id: row.0,
                document_id: row.1,
                version_number: row.2,
                content_markdown: row.3,
                change_summary: row.4,
                created_by: row.5,
                created_at: row.6,
            })
            .collect()
    })
    .map_err(|error| format!("无法读取产品文档版本: {error}"));
    connection.close().await.ok();
    versions
}

#[tauri::command]
async fn create_product_document_version(
    app: AppHandle,
    project_id: String,
    document_id: String,
    content_markdown: String,
    change_summary: String,
    source_json: Option<String>,
) -> Result<ProductDocumentSummary, String> {
    validate_product_document_fields(
        &document_id,
        &project_id,
        "版本",
        "markdown",
        &content_markdown,
        &change_summary,
    )?;
    let path = database_path(&app)?;
    let mut connection = sqlite_connection(&path, false).await?;
    let source_json = validate_product_document_sources(
        &mut connection,
        project_id.trim(),
        source_json.as_deref().unwrap_or("[]"),
    )
    .await?;
    let current = sqlx::query_as::<_, (String, String)>(
        "SELECT d.status, d.project_id FROM product_documents d WHERE d.id = ? AND d.project_id = ?",
    )
    .bind(document_id.trim())
    .bind(project_id.trim())
    .fetch_optional(&mut connection)
    .await
    .map_err(|error| format!("无法读取产品文档状态: {error}"))?;
    let Some((status, _)) = current else {
        connection.close().await.ok();
        return Err("产品文档不存在或不属于当前项目".to_string());
    };
    if status == "archived" {
        connection.close().await.ok();
        return Err("已归档文档不能创建新版本".to_string());
    }
    let next_version: i64 = sqlx::query_scalar(
        "SELECT COALESCE(MAX(version_number), 0) + 1 FROM product_document_versions WHERE document_id = ?",
    )
    .bind(document_id.trim())
    .fetch_one(&mut connection)
    .await
    .map_err(|error| format!("无法计算文档版本号: {error}"))?;
    let created_at = trace_timestamp();
    let version_id = format!("{}:v{}", document_id.trim(), next_version);
    let mut transaction = connection
        .begin()
        .await
        .map_err(|error| error.to_string())?;
    let result = async {
        sqlx::query(
            "INSERT INTO product_document_versions
             (id, document_id, version_number, content_markdown, source_json, change_summary, created_by, created_at)
             VALUES (?, ?, ?, ?, ?, ?, 'user', ?)",
        )
        .bind(version_id)
        .bind(document_id.trim())
        .bind(next_version)
        .bind(&content_markdown)
        .bind(&source_json)
        .bind(&change_summary)
        .bind(&created_at)
        .execute(&mut *transaction)
        .await
        .map_err(|error| format!("无法创建产品文档版本: {error}"))?;
        sqlx::query("UPDATE product_documents SET updated_at = ? WHERE id = ? AND project_id = ?")
            .bind(&created_at)
            .bind(document_id.trim())
            .bind(project_id.trim())
            .execute(&mut *transaction)
            .await
            .map_err(|error| format!("无法更新产品文档时间: {error}"))?;
        transaction.commit().await.map_err(|error| format!("无法提交产品文档版本: {error}"))?;
        Ok::<(), String>(())
    }.await;
    if let Err(error) = result {
        connection.close().await.ok();
        return Err(error);
    }
    let document =
        fetch_product_document(&mut connection, project_id.trim(), document_id.trim()).await;
    connection.close().await.ok();
    document
}

#[tauri::command]
async fn archive_product_document(
    app: AppHandle,
    project_id: String,
    document_id: String,
) -> Result<(), String> {
    if project_id.trim().is_empty()
        || project_id.len() > 200
        || document_id.trim().is_empty()
        || document_id.len() > 200
    {
        return Err("项目文档标识无效".to_string());
    }
    let path = database_path(&app)?;
    let mut connection = sqlite_connection(&path, false).await?;
    let rows = sqlx::query("UPDATE product_documents SET status = 'archived', updated_at = ? WHERE project_id = ? AND id = ? AND status <> 'archived'")
        .bind(trace_timestamp())
        .bind(project_id.trim())
        .bind(document_id.trim())
        .execute(&mut connection)
        .await
        .map_err(|error| format!("无法归档产品文档: {error}"))?
        .rows_affected();
    connection.close().await.ok();
    if rows == 1 {
        Ok(())
    } else {
        Err("产品文档不存在、已归档或不属于当前项目".to_string())
    }
}

#[tauri::command]
async fn create_knowledge_item(
    app: AppHandle,
    request: CreateKnowledgeItemRequest,
) -> Result<KnowledgeItemResult, String> {
    validate_create_knowledge_item(&request)?;
    let path = database_path(&app)?;
    let mut connection = sqlite_connection(&path, false).await?;

    if let Some(project_id) = request.project_id.as_deref() {
        let project_exists: i64 = sqlx::query_scalar(
            "SELECT COUNT(*) FROM projects WHERE id = ? AND archived_at IS NULL",
        )
        .bind(project_id.trim())
        .fetch_one(&mut connection)
        .await
        .map_err(|error| format!("无法校验知识所属项目: {error}"))?;
        if project_exists != 1 {
            connection.close().await.ok();
            return Err("知识所属项目不存在或已归档".to_string());
        }
    }

    if request.item_type == "meeting_record" {
        let target_exists: i64 = sqlx::query_scalar(
            "SELECT COUNT(*) FROM meetings meeting
             JOIN meeting_sources source ON source.meeting_id = meeting.id
             WHERE meeting.id = ? AND source.content_hash = ?
               AND ((? = 'personal' AND meeting.project_id IS NULL)
                 OR (? = 'project' AND meeting.project_id = ?))",
        )
        .bind(request.target_id.as_deref())
        .bind(request.target_version.as_deref())
        .bind(&request.domain)
        .bind(&request.domain)
        .bind(request.project_id.as_deref())
        .fetch_one(&mut connection)
        .await
        .map_err(|error| format!("无法校验会议知识目标: {error}"))?;
        if target_exists == 0 {
            connection.close().await.ok();
            return Err("会议目标、来源版本或知识域不匹配".to_string());
        }
    } else if request.item_type == "project_decision" {
        let target_exists: i64 = sqlx::query_scalar(
            "SELECT COUNT(*) FROM product_decisions
             WHERE id = ? AND project_id = ? AND CAST(current_version_number AS TEXT) = ?",
        )
        .bind(request.target_id.as_deref())
        .bind(request.project_id.as_deref())
        .bind(request.target_version.as_deref())
        .fetch_one(&mut connection)
        .await
        .map_err(|error| format!("无法校验决策知识目标: {error}"))?;
        if request.domain != "project" || target_exists != 1 {
            connection.close().await.ok();
            return Err("决策目标、版本或项目不匹配".to_string());
        }
    }

    let timestamp = trace_timestamp();
    sqlx::query(
        "INSERT INTO knowledge_items
         (id, item_type, status, domain, project_id, title, content_markdown,
          target_kind, target_id, target_version, content_version, created_by,
          created_at, updated_at)
         VALUES (?, ?, 'draft', ?, ?, ?, ?, ?, ?, ?, 1, ?, ?, ?)",
    )
    .bind(request.id.trim())
    .bind(&request.item_type)
    .bind(&request.domain)
    .bind(request.project_id.as_deref().map(str::trim))
    .bind(request.title.trim())
    .bind(request.content_markdown.trim())
    .bind(request.target_kind.as_deref())
    .bind(request.target_id.as_deref().map(str::trim))
    .bind(request.target_version.as_deref().map(str::trim))
    .bind(&request.created_by)
    .bind(&timestamp)
    .bind(&timestamp)
    .execute(&mut connection)
    .await
    .map_err(|error| {
        if error.to_string().contains("UNIQUE constraint failed") {
            "知识标识或正式对象适配已经存在".to_string()
        } else {
            format!("无法创建知识条目: {error}")
        }
    })?;

    let row = sqlx::query("SELECT * FROM knowledge_items WHERE id = ?")
        .bind(request.id.trim())
        .fetch_one(&mut connection)
        .await
        .map_err(|error| format!("无法读取新建知识条目: {error}"))?;
    connection.close().await.ok();
    map_knowledge_item_row(row)
}

#[tauri::command]
async fn update_knowledge_item(
    app: AppHandle,
    request: UpdateKnowledgeItemRequest,
) -> Result<KnowledgeItemResult, String> {
    validate_update_knowledge_item(&request)?;
    let path = database_path(&app)?;
    let mut connection = sqlite_connection(&path, false).await?;
    let timestamp = trace_timestamp();
    let rows = sqlx::query(
        "UPDATE knowledge_items
         SET title = ?, content_markdown = ?, content_version = content_version + 1,
             status = 'draft', confirmed_at = NULL, archived_at = NULL,
             archived_from_status = NULL, updated_at = ?
         WHERE id = ? AND domain = ? AND status <> 'archived'
           AND item_type IN ('technical_discussion', 'product_idea', 'ai_learning')
           AND content_version = ?
           AND ((? = 'personal' AND project_id IS NULL)
             OR (? = 'project' AND project_id = ?))",
    )
    .bind(request.title.trim())
    .bind(request.content_markdown.trim())
    .bind(&timestamp)
    .bind(request.item_id.trim())
    .bind(&request.domain)
    .bind(request.expected_content_version)
    .bind(&request.domain)
    .bind(&request.domain)
    .bind(request.project_id.as_deref().map(str::trim))
    .execute(&mut connection)
    .await
    .map_err(|error| format!("无法更新知识条目: {error}"))?
    .rows_affected();
    if rows != 1 {
        connection.close().await.ok();
        return Err("知识不存在、已归档、是正式对象适配或内容版本已变化".to_string());
    }
    let row = sqlx::query("SELECT * FROM knowledge_items WHERE id = ?")
        .bind(request.item_id.trim())
        .fetch_one(&mut connection)
        .await
        .map_err(|error| format!("无法读取更新后的知识条目: {error}"))?;
    connection.close().await.ok();
    map_knowledge_item_row(row)
}

#[tauri::command]
async fn import_knowledge_markdown_package(
    app: AppHandle,
    request: ImportKnowledgePackageRequest,
) -> Result<ImportKnowledgePackageResult, String> {
    if request.package.schema_version != "1.0.0"
        || !valid_lower_sha256(&request.package_hash)
        || request.package.sources.len() > 100
        || request.package.relations.len() > 100
        || request.package.item.content_version <= 0
    {
        return Err("知识 Markdown 包版本、哈希或条目数量无效".to_string());
    }
    let item_request = CreateKnowledgeItemRequest {
        id: request.package.item.id.clone(),
        item_type: request.package.item.item_type.clone(),
        domain: request.package.item.domain.clone(),
        project_id: request.package.item.project_id.clone(),
        title: request.package.item.title.clone(),
        content_markdown: request.package.item.content_markdown.clone(),
        target_kind: request.package.item.target_kind.clone(),
        target_id: request.package.item.target_id.clone(),
        target_version: request.package.item.target_version.clone(),
        created_by: "user".to_string(),
    };
    validate_create_knowledge_item(&item_request)?;
    if request
        .package
        .sources
        .iter()
        .any(|source| source.item_id != item_request.id)
    {
        return Err("知识 Markdown 包含不属于当前条目的来源".to_string());
    }
    if request.package.relations.iter().any(|relation| {
        relation.from_item_id != item_request.id && relation.to_item_id != item_request.id
    }) {
        return Err("知识 Markdown 包含与当前条目无关的关系".to_string());
    }

    let path = database_path(&app)?;
    let mut connection = sqlite_connection(&path, false).await?;
    let existing = sqlx::query(
        "SELECT item.*, receipt.package_hash
         FROM knowledge_items item
         LEFT JOIN knowledge_import_receipts receipt ON receipt.item_id = item.id
         WHERE item.id = ?",
    )
    .bind(item_request.id.trim())
    .fetch_optional(&mut connection)
    .await
    .map_err(|error| format!("无法检查知识导入冲突: {error}"))?;
    if let Some(existing) = existing {
        let receipt_hash: Option<String> = existing
            .try_get("package_hash")
            .map_err(|error| error.to_string())?;
        if receipt_hash.as_deref() == Some(request.package_hash.as_str()) {
            let item = map_knowledge_item_row(existing)?;
            connection.close().await.ok();
            return Ok(ImportKnowledgePackageResult {
                status: "unchanged".to_string(),
                item: Some(item),
            });
        }
        connection.close().await.ok();
        return Ok(ImportKnowledgePackageResult {
            status: "conflict".to_string(),
            item: None,
        });
    }
    if let Some(project_id) = item_request.project_id.as_deref() {
        let project_exists: i64 = sqlx::query_scalar(
            "SELECT COUNT(*) FROM projects WHERE id = ? AND archived_at IS NULL",
        )
        .bind(project_id.trim())
        .fetch_one(&mut connection)
        .await
        .map_err(|error| format!("无法校验导入知识所属项目: {error}"))?;
        if project_exists != 1 {
            connection.close().await.ok();
            return Err("导入知识所属项目不存在或已归档".to_string());
        }
    }

    let timestamp = trace_timestamp();
    let mut transaction = connection
        .begin()
        .await
        .map_err(|error| error.to_string())?;
    let result = async {
        sqlx::query(
            "INSERT INTO knowledge_items
             (id, item_type, status, domain, project_id, title, content_markdown,
              target_kind, target_id, target_version, content_version, created_by,
              created_at, updated_at)
             VALUES (?, ?, 'draft', ?, ?, ?, ?, ?, ?, ?, ?, 'user', ?, ?)",
        )
        .bind(item_request.id.trim())
        .bind(&item_request.item_type)
        .bind(&item_request.domain)
        .bind(item_request.project_id.as_deref().map(str::trim))
        .bind(item_request.title.trim())
        .bind(item_request.content_markdown.trim())
        .bind(item_request.target_kind.as_deref())
        .bind(item_request.target_id.as_deref().map(str::trim))
        .bind(item_request.target_version.as_deref().map(str::trim))
        .bind(request.package.item.content_version)
        .bind(&timestamp)
        .bind(&timestamp)
        .execute(&mut *transaction)
        .await
        .map_err(|error| format!("无法导入知识条目: {error}"))?;

        for source in &request.package.sources {
            let locator_json = serde_json::to_string(&source.locator)
                .map_err(|_| "无法序列化知识来源定位".to_string())?;
            let source_request = AddKnowledgeSourceRequest {
                id: source.id.clone(),
                item_id: source.item_id.clone(),
                domain: item_request.domain.clone(),
                project_id: item_request.project_id.clone(),
                source_kind: source.source_kind.clone(),
                source_ref: source.source_ref.clone(),
                source_version: source.source_version.clone(),
                content_hash: source.content_hash.clone(),
                title: source.title.clone(),
                locator_json,
                captured_at: source.captured_at.clone(),
            };
            validate_add_knowledge_source(&source_request)?;
            sqlx::query(
                "INSERT INTO knowledge_sources
                 (id, item_id, source_kind, source_ref, source_version, content_hash,
                  title, locator_json, captured_at, created_at)
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
            )
            .bind(source_request.id.trim())
            .bind(source_request.item_id.trim())
            .bind(&source_request.source_kind)
            .bind(source_request.source_ref.trim())
            .bind(source_request.source_version.trim())
            .bind(&source_request.content_hash)
            .bind(source_request.title.trim())
            .bind(&source_request.locator_json)
            .bind(source_request.captured_at.trim())
            .bind(&timestamp)
            .execute(&mut *transaction)
            .await
            .map_err(|error| format!("无法导入知识来源: {error}"))?;
        }

        for relation in &request.package.relations {
            let evidence_json = serde_json::to_string(&relation.evidence)
                .map_err(|_| "无法序列化知识关系证据".to_string())?;
            let relation_request = CreateKnowledgeRelationRequest {
                id: relation.id.clone(),
                from_item_id: relation.from_item_id.clone(),
                to_item_id: relation.to_item_id.clone(),
                domain: item_request.domain.clone(),
                project_id: item_request.project_id.clone(),
                relation_type: relation.relation_type.clone(),
                evidence_json,
                created_by: "user".to_string(),
            };
            validate_create_knowledge_relation(&relation_request)?;
            sqlx::query(
                "INSERT INTO knowledge_relations
                 (id, from_item_id, to_item_id, relation_type, status, evidence_json,
                  created_by, created_at, updated_at)
                 VALUES (?, ?, ?, ?, 'draft', ?, 'user', ?, ?)",
            )
            .bind(relation_request.id.trim())
            .bind(relation_request.from_item_id.trim())
            .bind(relation_request.to_item_id.trim())
            .bind(&relation_request.relation_type)
            .bind(&relation_request.evidence_json)
            .bind(&timestamp)
            .bind(&timestamp)
            .execute(&mut *transaction)
            .await
            .map_err(|error| format!("无法导入知识关系: {error}"))?;
        }

        sqlx::query(
            "INSERT INTO knowledge_import_receipts (item_id, package_hash, imported_at)
             VALUES (?, ?, ?)",
        )
        .bind(item_request.id.trim())
        .bind(&request.package_hash)
        .bind(&timestamp)
        .execute(&mut *transaction)
        .await
        .map_err(|error| format!("无法记录知识导入凭据: {error}"))?;
        transaction
            .commit()
            .await
            .map_err(|error| format!("无法提交知识 Markdown 包: {error}"))?;
        Ok::<(), String>(())
    }
    .await;
    if let Err(error) = result {
        connection.close().await.ok();
        return Err(error);
    }
    let row = sqlx::query("SELECT * FROM knowledge_items WHERE id = ?")
        .bind(item_request.id.trim())
        .fetch_one(&mut connection)
        .await
        .map_err(|error| format!("无法读取导入后的知识条目: {error}"))?;
    connection.close().await.ok();
    Ok(ImportKnowledgePackageResult {
        status: "created".to_string(),
        item: Some(map_knowledge_item_row(row)?),
    })
}

#[tauri::command]
async fn list_knowledge_items(
    app: AppHandle,
    domain: String,
    project_id: Option<String>,
    status: Option<String>,
    item_type: Option<String>,
    limit: Option<u8>,
) -> Result<Vec<KnowledgeItemResult>, String> {
    validate_enabled_knowledge_scope(&domain, project_id.as_deref())?;
    if status
        .as_deref()
        .is_some_and(|value| !matches!(value, "draft" | "confirmed" | "archived"))
    {
        return Err("知识状态筛选无效".to_string());
    }
    if item_type.as_deref().is_some_and(|value| {
        !matches!(
            value,
            "meeting_record"
                | "technical_discussion"
                | "product_idea"
                | "ai_learning"
                | "project_decision"
        )
    }) {
        return Err("知识类型筛选无效".to_string());
    }
    let limit = i64::from(limit.unwrap_or(50).clamp(1, 100));
    let path = database_path(&app)?;
    let mut connection = sqlite_connection(&path, true).await?;
    let rows = sqlx::query(
        "SELECT * FROM knowledge_items
         WHERE domain = ?
           AND ((? = 'personal' AND project_id IS NULL)
             OR (? = 'project' AND project_id = ?))
           AND (? IS NULL OR status = ?)
           AND (? IS NULL OR item_type = ?)
         ORDER BY updated_at DESC, rowid DESC LIMIT ?",
    )
    .bind(&domain)
    .bind(&domain)
    .bind(&domain)
    .bind(project_id.as_deref().map(str::trim))
    .bind(status.as_deref())
    .bind(status.as_deref())
    .bind(item_type.as_deref())
    .bind(item_type.as_deref())
    .bind(limit)
    .fetch_all(&mut connection)
    .await
    .map_err(|error| format!("无法读取知识条目: {error}"))?;
    connection.close().await.ok();
    rows.into_iter().map(map_knowledge_item_row).collect()
}

#[tauri::command]
async fn list_knowledge_adapter_candidates(
    app: AppHandle,
    domain: String,
    project_id: Option<String>,
    target_kind: String,
) -> Result<Vec<KnowledgeAdapterCandidateResult>, String> {
    validate_enabled_knowledge_scope(&domain, project_id.as_deref())?;
    if !matches!(target_kind.as_str(), "meeting" | "product_decision") {
        return Err("知识适配目标类型无效".to_string());
    }
    if target_kind == "product_decision" && domain != "project" {
        return Err("项目决策只能注册到项目知识域".to_string());
    }
    let path = database_path(&app)?;
    let mut connection = sqlite_connection(&path, true).await?;
    let results = if target_kind == "meeting" {
        let rows = sqlx::query_as::<_, (String, String, String, Option<String>)>(
            "SELECT meeting.id, meeting.title, source.content_hash, meeting.project_id
             FROM meetings meeting
             JOIN meeting_sources source ON source.id = (
               SELECT latest.id FROM meeting_sources latest
               WHERE latest.meeting_id = meeting.id
               ORDER BY latest.updated_at DESC, latest.rowid DESC LIMIT 1
             )
             WHERE ((? = 'personal' AND meeting.project_id IS NULL)
                OR (? = 'project' AND meeting.project_id = ?))
               AND NOT EXISTS (
                 SELECT 1 FROM knowledge_items item
                 WHERE item.target_kind = 'meeting' AND item.target_id = meeting.id
               )
             ORDER BY meeting.updated_at DESC, meeting.id LIMIT 100",
        )
        .bind(&domain)
        .bind(&domain)
        .bind(project_id.as_deref().map(str::trim))
        .fetch_all(&mut connection)
        .await
        .map_err(|error| format!("无法读取会议知识候选: {error}"))?;
        rows.into_iter()
            .map(|row| KnowledgeAdapterCandidateResult {
                target_kind: "meeting".to_string(),
                target_id: row.0,
                title: row.1,
                target_version: row.2,
                project_id: row.3,
            })
            .collect()
    } else {
        let rows = sqlx::query_as::<_, (String, String, i64, String)>(
            "SELECT decision.id, version.title, decision.current_version_number,
                    decision.project_id
             FROM product_decisions decision
             JOIN product_decision_versions version
               ON version.decision_id = decision.id
              AND version.version_number = decision.current_version_number
             WHERE decision.project_id = ?
               AND NOT EXISTS (
                 SELECT 1 FROM knowledge_items item
                 WHERE item.target_kind = 'product_decision' AND item.target_id = decision.id
               )
             ORDER BY decision.updated_at DESC, decision.id LIMIT 100",
        )
        .bind(project_id.as_deref().map(str::trim))
        .fetch_all(&mut connection)
        .await
        .map_err(|error| format!("无法读取决策知识候选: {error}"))?;
        rows.into_iter()
            .map(|row| KnowledgeAdapterCandidateResult {
                target_kind: "product_decision".to_string(),
                target_id: row.0,
                title: row.1,
                target_version: row.2.to_string(),
                project_id: Some(row.3),
            })
            .collect()
    };
    connection.close().await.ok();
    Ok(results)
}

#[tauri::command]
async fn review_knowledge_item(
    app: AppHandle,
    item_id: String,
    domain: String,
    project_id: Option<String>,
    action: String,
) -> Result<KnowledgeItemResult, String> {
    if !valid_knowledge_id(&item_id) {
        return Err("知识标识无效".to_string());
    }
    validate_enabled_knowledge_scope(&domain, project_id.as_deref())?;
    if !matches!(action.as_str(), "confirm" | "archive" | "restore") {
        return Err("知识审核动作无效".to_string());
    }
    let path = database_path(&app)?;
    let mut connection = sqlite_connection(&path, false).await?;
    let current = sqlx::query(
        "SELECT status, archived_from_status FROM knowledge_items
         WHERE id = ? AND domain = ?
           AND ((? = 'personal' AND project_id IS NULL)
             OR (? = 'project' AND project_id = ?))",
    )
    .bind(item_id.trim())
    .bind(&domain)
    .bind(&domain)
    .bind(&domain)
    .bind(project_id.as_deref().map(str::trim))
    .fetch_optional(&mut connection)
    .await
    .map_err(|error| format!("无法读取知识状态: {error}"))?;
    let Some(current) = current else {
        connection.close().await.ok();
        return Err("知识条目不存在或不属于当前知识域".to_string());
    };
    let current_status: String = current
        .try_get("status")
        .map_err(|error| error.to_string())?;
    let archived_from_status: Option<String> = current
        .try_get("archived_from_status")
        .map_err(|error| error.to_string())?;
    let timestamp = trace_timestamp();
    let (next_status, confirmed_at, archived_at, archived_from) =
        match (current_status.as_str(), action.as_str()) {
            ("draft", "confirm") => ("confirmed", Some(timestamp.as_str()), None, None),
            ("draft" | "confirmed", "archive") => (
                "archived",
                None,
                Some(timestamp.as_str()),
                Some(current_status.as_str()),
            ),
            ("archived", "restore") => {
                let restored = archived_from_status
                    .as_deref()
                    .filter(|value| matches!(*value, "draft" | "confirmed"))
                    .ok_or_else(|| "归档前状态缺失，不能恢复".to_string())?;
                (restored, None, None, None)
            }
            _ => {
                connection.close().await.ok();
                return Err("当前知识状态不允许执行该操作".to_string());
            }
        };
    let rows = if current_status == "confirmed" && action == "archive" {
        sqlx::query(
            "UPDATE knowledge_items
             SET status = ?, archived_at = ?, archived_from_status = ?, updated_at = ?
             WHERE id = ? AND status = ?",
        )
        .bind(next_status)
        .bind(archived_at)
        .bind(archived_from)
        .bind(&timestamp)
        .bind(item_id.trim())
        .bind(&current_status)
        .execute(&mut connection)
        .await
    } else if current_status == "archived" && action == "restore" {
        sqlx::query(
            "UPDATE knowledge_items
             SET status = ?, archived_at = NULL, archived_from_status = NULL, updated_at = ?
             WHERE id = ? AND status = ?",
        )
        .bind(next_status)
        .bind(&timestamp)
        .bind(item_id.trim())
        .bind(&current_status)
        .execute(&mut connection)
        .await
    } else {
        sqlx::query(
            "UPDATE knowledge_items
             SET status = ?, confirmed_at = COALESCE(?, confirmed_at), archived_at = ?,
                 archived_from_status = ?, updated_at = ?
             WHERE id = ? AND status = ?",
        )
        .bind(next_status)
        .bind(confirmed_at)
        .bind(archived_at)
        .bind(archived_from)
        .bind(&timestamp)
        .bind(item_id.trim())
        .bind(&current_status)
        .execute(&mut connection)
        .await
    }
    .map_err(|error| format!("无法更新知识状态: {error}"))?
    .rows_affected();
    if rows != 1 {
        connection.close().await.ok();
        return Err("知识状态已变化，请刷新后重试".to_string());
    }
    let row = sqlx::query("SELECT * FROM knowledge_items WHERE id = ?")
        .bind(item_id.trim())
        .fetch_one(&mut connection)
        .await
        .map_err(|error| format!("无法读取更新后的知识条目: {error}"))?;
    connection.close().await.ok();
    map_knowledge_item_row(row)
}

#[tauri::command]
async fn add_knowledge_source(
    app: AppHandle,
    request: AddKnowledgeSourceRequest,
) -> Result<KnowledgeSourceResult, String> {
    validate_add_knowledge_source(&request)?;
    let path = database_path(&app)?;
    let mut connection = sqlite_connection(&path, false).await?;
    let item_exists: i64 = sqlx::query_scalar(
        "SELECT COUNT(*) FROM knowledge_items
         WHERE id = ? AND domain = ? AND status <> 'archived'
           AND ((? = 'personal' AND project_id IS NULL)
             OR (? = 'project' AND project_id = ?))",
    )
    .bind(request.item_id.trim())
    .bind(&request.domain)
    .bind(&request.domain)
    .bind(&request.domain)
    .bind(request.project_id.as_deref().map(str::trim))
    .fetch_one(&mut connection)
    .await
    .map_err(|error| format!("无法校验知识来源归属: {error}"))?;
    if item_exists != 1 {
        connection.close().await.ok();
        return Err("知识条目不存在、已归档或不属于当前知识域".to_string());
    }
    let created_at = trace_timestamp();
    sqlx::query(
        "INSERT INTO knowledge_sources
         (id, item_id, source_kind, source_ref, source_version, content_hash, title,
          locator_json, captured_at, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
    )
    .bind(request.id.trim())
    .bind(request.item_id.trim())
    .bind(&request.source_kind)
    .bind(request.source_ref.trim())
    .bind(request.source_version.trim())
    .bind(&request.content_hash)
    .bind(request.title.trim())
    .bind(&request.locator_json)
    .bind(request.captured_at.trim())
    .bind(&created_at)
    .execute(&mut connection)
    .await
    .map_err(|error| {
        if error.to_string().contains("UNIQUE constraint failed") {
            "该知识来源版本已经存在".to_string()
        } else {
            format!("无法添加知识来源: {error}")
        }
    })?;
    connection.close().await.ok();
    Ok(KnowledgeSourceResult {
        id: request.id.trim().to_string(),
        item_id: request.item_id.trim().to_string(),
        source_kind: request.source_kind,
        source_ref: request.source_ref.trim().to_string(),
        source_version: request.source_version.trim().to_string(),
        content_hash: request.content_hash,
        title: request.title.trim().to_string(),
        locator_json: request.locator_json,
        captured_at: request.captured_at.trim().to_string(),
        created_at,
    })
}

#[tauri::command]
async fn list_knowledge_sources(
    app: AppHandle,
    item_id: String,
    domain: String,
    project_id: Option<String>,
) -> Result<Vec<KnowledgeSourceResult>, String> {
    if !valid_knowledge_id(&item_id) {
        return Err("知识标识无效".to_string());
    }
    validate_enabled_knowledge_scope(&domain, project_id.as_deref())?;
    let path = database_path(&app)?;
    let mut connection = sqlite_connection(&path, true).await?;
    let rows = sqlx::query_as::<
        _,
        (
            String,
            String,
            String,
            String,
            String,
            String,
            String,
            String,
            String,
            String,
        ),
    >(
        "SELECT source.id, source.item_id, source.source_kind, source.source_ref,
                source.source_version, source.content_hash, source.title,
                source.locator_json, source.captured_at, source.created_at
         FROM knowledge_sources source
         JOIN knowledge_items item ON item.id = source.item_id
         WHERE item.id = ? AND item.domain = ?
           AND ((? = 'personal' AND item.project_id IS NULL)
             OR (? = 'project' AND item.project_id = ?))
         ORDER BY source.created_at, source.id LIMIT 100",
    )
    .bind(item_id.trim())
    .bind(&domain)
    .bind(&domain)
    .bind(&domain)
    .bind(project_id.as_deref().map(str::trim))
    .fetch_all(&mut connection)
    .await
    .map_err(|error| format!("无法读取知识来源: {error}"))?;
    connection.close().await.ok();
    Ok(rows
        .into_iter()
        .map(|row| KnowledgeSourceResult {
            id: row.0,
            item_id: row.1,
            source_kind: row.2,
            source_ref: row.3,
            source_version: row.4,
            content_hash: row.5,
            title: row.6,
            locator_json: row.7,
            captured_at: row.8,
            created_at: row.9,
        })
        .collect())
}

#[tauri::command]
async fn create_knowledge_relation(
    app: AppHandle,
    request: CreateKnowledgeRelationRequest,
) -> Result<KnowledgeRelationResult, String> {
    validate_create_knowledge_relation(&request)?;
    let path = database_path(&app)?;
    let mut connection = sqlite_connection(&path, false).await?;
    let eligible: i64 = sqlx::query_scalar(
        "SELECT COUNT(*) FROM knowledge_items
         WHERE id IN (?, ?) AND domain = ? AND status <> 'archived'
           AND ((? = 'personal' AND project_id IS NULL)
             OR (? = 'project' AND project_id = ?))",
    )
    .bind(request.from_item_id.trim())
    .bind(request.to_item_id.trim())
    .bind(&request.domain)
    .bind(&request.domain)
    .bind(&request.domain)
    .bind(request.project_id.as_deref().map(str::trim))
    .fetch_one(&mut connection)
    .await
    .map_err(|error| format!("无法校验知识关系范围: {error}"))?;
    if eligible != 2 {
        connection.close().await.ok();
        return Err("知识关系两端必须属于同一知识域和项目且未归档".to_string());
    }
    let created_at = trace_timestamp();
    sqlx::query(
        "INSERT INTO knowledge_relations
         (id, from_item_id, to_item_id, relation_type, status, evidence_json,
          created_by, created_at, updated_at)
         VALUES (?, ?, ?, ?, 'draft', ?, ?, ?, ?)",
    )
    .bind(request.id.trim())
    .bind(request.from_item_id.trim())
    .bind(request.to_item_id.trim())
    .bind(&request.relation_type)
    .bind(&request.evidence_json)
    .bind(&request.created_by)
    .bind(&created_at)
    .bind(&created_at)
    .execute(&mut connection)
    .await
    .map_err(|error| {
        if error.to_string().contains("UNIQUE constraint failed") {
            "该知识关系已经存在".to_string()
        } else {
            format!("无法创建知识关系: {error}")
        }
    })?;
    connection.close().await.ok();
    Ok(KnowledgeRelationResult {
        id: request.id.trim().to_string(),
        from_item_id: request.from_item_id.trim().to_string(),
        to_item_id: request.to_item_id.trim().to_string(),
        relation_type: request.relation_type,
        status: "draft".to_string(),
        evidence_json: request.evidence_json,
        created_by: request.created_by,
        created_at: created_at.clone(),
        updated_at: created_at,
        confirmed_at: None,
    })
}

#[tauri::command]
async fn review_knowledge_relation(
    app: AppHandle,
    relation_id: String,
    domain: String,
    project_id: Option<String>,
    action: String,
) -> Result<(), String> {
    if !valid_knowledge_id(&relation_id) {
        return Err("知识关系标识无效".to_string());
    }
    validate_enabled_knowledge_scope(&domain, project_id.as_deref())?;
    if !matches!(action.as_str(), "confirm" | "reject") {
        return Err("知识关系审核动作无效".to_string());
    }
    let path = database_path(&app)?;
    let mut connection = sqlite_connection(&path, false).await?;
    let timestamp = trace_timestamp();
    let next_status = if action == "confirm" {
        "confirmed"
    } else {
        "rejected"
    };
    let confirmed_at = if action == "confirm" {
        Some(timestamp.as_str())
    } else {
        None
    };
    let rows = sqlx::query(
        "UPDATE knowledge_relations SET status = ?, confirmed_at = ?, updated_at = ?
         WHERE id = ? AND status = 'draft'
           AND EXISTS (
             SELECT 1 FROM knowledge_items from_item
             JOIN knowledge_items to_item ON to_item.id = knowledge_relations.to_item_id
             WHERE from_item.id = knowledge_relations.from_item_id
               AND from_item.domain = ? AND to_item.domain = ?
               AND ((? = 'personal' AND from_item.project_id IS NULL AND to_item.project_id IS NULL)
                 OR (? = 'project' AND from_item.project_id = ? AND to_item.project_id = ?))
           )",
    )
    .bind(next_status)
    .bind(confirmed_at)
    .bind(&timestamp)
    .bind(relation_id.trim())
    .bind(&domain)
    .bind(&domain)
    .bind(&domain)
    .bind(&domain)
    .bind(project_id.as_deref().map(str::trim))
    .bind(project_id.as_deref().map(str::trim))
    .execute(&mut connection)
    .await
    .map_err(|error| format!("无法审核知识关系: {error}"))?
    .rows_affected();
    connection.close().await.ok();
    if rows == 1 {
        Ok(())
    } else {
        Err("知识关系不存在、已处理或不属于当前知识域".to_string())
    }
}

#[tauri::command]
async fn list_knowledge_relations(
    app: AppHandle,
    item_id: String,
    domain: String,
    project_id: Option<String>,
) -> Result<Vec<KnowledgeRelationResult>, String> {
    if !valid_knowledge_id(&item_id) {
        return Err("知识标识无效".to_string());
    }
    validate_enabled_knowledge_scope(&domain, project_id.as_deref())?;
    let path = database_path(&app)?;
    let mut connection = sqlite_connection(&path, true).await?;
    let rows = sqlx::query_as::<
        _,
        (
            String,
            String,
            String,
            String,
            String,
            String,
            String,
            String,
            String,
            Option<String>,
        ),
    >(
        "SELECT relation.id, relation.from_item_id, relation.to_item_id,
                relation.relation_type, relation.status, relation.evidence_json,
                relation.created_by, relation.created_at, relation.updated_at,
                relation.confirmed_at
         FROM knowledge_relations relation
         JOIN knowledge_items from_item ON from_item.id = relation.from_item_id
         JOIN knowledge_items to_item ON to_item.id = relation.to_item_id
         WHERE (relation.from_item_id = ? OR relation.to_item_id = ?)
           AND from_item.domain = ? AND to_item.domain = ?
           AND ((? = 'personal' AND from_item.project_id IS NULL AND to_item.project_id IS NULL)
             OR (? = 'project' AND from_item.project_id = ? AND to_item.project_id = ?))
         ORDER BY relation.updated_at DESC, relation.id LIMIT 100",
    )
    .bind(item_id.trim())
    .bind(item_id.trim())
    .bind(&domain)
    .bind(&domain)
    .bind(&domain)
    .bind(&domain)
    .bind(project_id.as_deref().map(str::trim))
    .bind(project_id.as_deref().map(str::trim))
    .fetch_all(&mut connection)
    .await
    .map_err(|error| format!("无法读取知识关系: {error}"))?;
    connection.close().await.ok();
    Ok(rows
        .into_iter()
        .map(|row| KnowledgeRelationResult {
            id: row.0,
            from_item_id: row.1,
            to_item_id: row.2,
            relation_type: row.3,
            status: row.4,
            evidence_json: row.5,
            created_by: row.6,
            created_at: row.7,
            updated_at: row.8,
            confirmed_at: row.9,
        })
        .collect())
}

#[tauri::command]
async fn create_project_memory_candidate(
    app: AppHandle,
    request: CreateProjectMemoryCandidateRequest,
) -> Result<ProjectMemorySearchResult, String> {
    validate_memory_candidate(&request)?;
    let path = database_path(&app)?;
    let mut connection = sqlite_connection(&path, false).await?;
    let created_at = trace_timestamp();
    let mut transaction = connection
        .begin()
        .await
        .map_err(|error| error.to_string())?;
    let source_record_id = format!("{}:source", request.id);
    let result = async {
        sqlx::query(
            "INSERT INTO project_memories
             (id, project_id, memory_type, status, title, content, source_kind, source_id,
              source_locator_json, confidence, created_by, created_at, updated_at)
             VALUES (?, ?, ?, 'pending', ?, ?, ?, ?, ?, ?, ?, ?, ?)",
        )
        .bind(request.id.trim())
        .bind(request.project_id.trim())
        .bind(&request.memory_type)
        .bind(request.title.trim())
        .bind(request.content.trim())
        .bind(&request.source_kind)
        .bind(request.source_id.as_deref())
        .bind(&request.source_locator_json)
        .bind(request.confidence)
        .bind(&request.created_by)
        .bind(&created_at)
        .bind(&created_at)
        .execute(&mut *transaction)
        .await
        .map_err(|error| format!("无法创建项目记忆候选: {error}"))?;
        sqlx::query(
            "INSERT INTO project_memory_sources
             (id, memory_id, source_kind, source_id, locator_json, created_at)
             VALUES (?, ?, ?, ?, ?, ?)",
        )
        .bind(source_record_id)
        .bind(request.id.trim())
        .bind(&request.source_kind)
        .bind(request.source_id.as_deref())
        .bind(&request.source_locator_json)
        .bind(&created_at)
        .execute(&mut *transaction)
        .await
        .map_err(|error| format!("无法记录项目记忆来源: {error}"))?;
        transaction
            .commit()
            .await
            .map_err(|error| format!("无法提交项目记忆候选: {error}"))?;
        Ok::<(), String>(())
    }
    .await;
    if let Err(error) = result {
        connection.close().await.ok();
        return Err(error);
    }
    let memory = sqlx::query_as::<_, (String, String, String, String, String, String, String, Option<String>, String, Option<String>, Option<String>, Option<String>, Option<f64>, String, String)>(
        "SELECT id, project_id, memory_type, status, title, content, source_kind, source_id,
                source_locator_json, valid_from, valid_until, conflict_group, confidence, created_by, updated_at
         FROM project_memories WHERE id = ?",
    )
    .bind(request.id.trim())
    .fetch_one(&mut connection)
    .await
    .map(|row| ProjectMemorySearchResult {
        id: row.0, project_id: row.1, memory_type: row.2, status: row.3,
        title: row.4, content: row.5, source_kind: row.6, source_id: row.7,
        source_locator_json: row.8, valid_from: row.9, valid_until: row.10,
        conflict_group: row.11, confidence: row.12, created_by: row.13, updated_at: row.14,
    })
    .map_err(|error| format!("无法读取新建项目记忆候选: {error}"));
    connection.close().await.ok();
    memory
}

#[tauri::command]
async fn review_project_memory_candidate(
    app: AppHandle,
    memory_id: String,
    action: String,
) -> Result<(), String> {
    if memory_id.trim().is_empty() || memory_id.len() > 200 {
        return Err("记忆标识无效".to_string());
    }
    if !matches!(action.as_str(), "confirm" | "reject" | "expire" | "archive") {
        return Err("记忆审核动作无效".to_string());
    }
    let path = database_path(&app)?;
    let mut connection = sqlite_connection(&path, false).await?;
    let current: Option<(String, String)> =
        sqlx::query_as("SELECT status, memory_type FROM project_memories WHERE id = ?")
            .bind(memory_id.trim())
            .fetch_optional(&mut connection)
            .await
            .map_err(|error| format!("无法读取项目记忆: {error}"))?;
    let Some((current_status, current_type)) = current else {
        connection.close().await.ok();
        return Err("项目记忆不存在或已被删除".to_string());
    };
    let (next_status, next_type) = match (current_status.as_str(), action.as_str()) {
        ("pending", "confirm") => ("confirmed", "confirmed_memory"),
        ("pending", "reject") => ("rejected", current_type.as_str()),
        ("confirmed", "expire") => ("expired", current_type.as_str()),
        (status, "archive") if status != "archived" => ("archived", current_type.as_str()),
        _ => {
            connection.close().await.ok();
            return Err("当前记忆状态不允许执行该审核动作".to_string());
        }
    };
    let updated_at = trace_timestamp();
    let rows = sqlx::query(
        "UPDATE project_memories SET status = ?, memory_type = ?, updated_at = ?
         WHERE id = ? AND status = ?",
    )
    .bind(next_status)
    .bind(next_type)
    .bind(updated_at)
    .bind(memory_id.trim())
    .bind(&current_status)
    .execute(&mut connection)
    .await
    .map_err(|error| format!("无法更新项目记忆状态: {error}"))?
    .rows_affected();
    connection.close().await.ok();
    if rows == 1 {
        Ok(())
    } else {
        Err("项目记忆状态已变化，请刷新后重试".to_string())
    }
}

#[tauri::command]
async fn list_project_memories(
    app: AppHandle,
    project_id: String,
    status: Option<String>,
    limit: Option<u8>,
) -> Result<Vec<ProjectMemorySearchResult>, String> {
    if project_id.trim().is_empty() || project_id.len() > 200 {
        return Err("项目标识无效".to_string());
    }
    valid_memory_status(status.as_deref())?;
    let limit = i64::from(limit.unwrap_or(20).clamp(1, 50));
    let path = database_path(&app)?;
    let mut connection = sqlite_connection(&path, true).await?;
    let results = sqlx::query_as::<_, (String, String, String, String, String, String, String, Option<String>, String, Option<String>, Option<String>, Option<String>, Option<f64>, String, String)>(
        "SELECT id, project_id, memory_type, status, title, content, source_kind, source_id,
                source_locator_json, valid_from, valid_until, conflict_group, confidence, created_by, updated_at
         FROM project_memories WHERE project_id = ? AND (? IS NULL OR status = ?)
         ORDER BY updated_at DESC, rowid DESC LIMIT ?",
    )
    .bind(project_id.trim())
    .bind(status.as_deref())
    .bind(status.as_deref())
    .bind(limit)
    .fetch_all(&mut connection)
    .await
    .map(|rows| rows.into_iter().map(|row| ProjectMemorySearchResult {
        id: row.0, project_id: row.1, memory_type: row.2, status: row.3,
        title: row.4, content: row.5, source_kind: row.6, source_id: row.7,
        source_locator_json: row.8, valid_from: row.9, valid_until: row.10,
        conflict_group: row.11, confidence: row.12, created_by: row.13, updated_at: row.14,
    }).collect())
    .map_err(|error| format!("无法读取项目记忆: {error}"));
    connection.close().await.ok();
    results
}

#[tauri::command]
async fn list_project_memory_sources(
    app: AppHandle,
    project_id: String,
    memory_id: String,
) -> Result<Vec<ProjectMemorySourceResult>, String> {
    if project_id.trim().is_empty() || project_id.len() > 200 {
        return Err("项目标识无效".to_string());
    }
    if memory_id.trim().is_empty() || memory_id.len() > 200 {
        return Err("记忆标识无效".to_string());
    }
    let path = database_path(&app)?;
    let mut connection = sqlite_connection(&path, true).await?;
    let results = sqlx::query_as::<
        _,
        (
            String,
            String,
            Option<String>,
            String,
            Option<String>,
            String,
        ),
    >(
        "SELECT s.id, s.source_kind, s.source_id, s.locator_json, s.quote, s.created_at
         FROM project_memory_sources s
         JOIN project_memories m ON m.id = s.memory_id
         WHERE m.project_id = ? AND m.id = ?
         ORDER BY s.created_at ASC, s.rowid ASC
         LIMIT 50",
    )
    .bind(project_id.trim())
    .bind(memory_id.trim())
    .fetch_all(&mut connection)
    .await
    .map(|rows| {
        rows.into_iter()
            .map(|row| ProjectMemorySourceResult {
                id: row.0,
                source_kind: row.1,
                source_id: row.2,
                locator_json: row.3,
                quote: row.4,
                created_at: row.5,
            })
            .collect()
    })
    .map_err(|error| format!("无法读取项目记忆来源: {error}"));
    connection.close().await.ok();
    results
}

fn normalized_memory_relation<'a>(
    memory_id: &'a str,
    related_memory_id: &'a str,
    relation_type: &str,
) -> Result<(&'a str, &'a str), String> {
    if memory_id == related_memory_id {
        return Err("不能将记忆与自身建立冲突关系".to_string());
    }
    match relation_type {
        "conflicts" if memory_id < related_memory_id => Ok((memory_id, related_memory_id)),
        "conflicts" => Ok((related_memory_id, memory_id)),
        "supersedes" => Ok((memory_id, related_memory_id)),
        _ => Err("记忆关系类型无效".to_string()),
    }
}

#[tauri::command]
async fn create_project_memory_conflict(
    app: AppHandle,
    project_id: String,
    memory_id: String,
    related_memory_id: String,
    relation_type: String,
) -> Result<(), String> {
    if project_id.trim().is_empty() || project_id.len() > 200 {
        return Err("项目标识无效".to_string());
    }
    if memory_id.trim().is_empty()
        || memory_id.len() > 200
        || related_memory_id.trim().is_empty()
        || related_memory_id.len() > 200
    {
        return Err("记忆标识无效".to_string());
    }
    let (left_id, right_id) =
        normalized_memory_relation(memory_id.trim(), related_memory_id.trim(), &relation_type)?;
    let path = database_path(&app)?;
    let mut connection = sqlite_connection(&path, false).await?;
    let eligible_count: i64 = sqlx::query_scalar(
        "SELECT COUNT(*) FROM project_memories
         WHERE project_id = ? AND id IN (?, ?) AND status <> 'archived'",
    )
    .bind(project_id.trim())
    .bind(left_id)
    .bind(right_id)
    .fetch_one(&mut connection)
    .await
    .map_err(|error| format!("无法校验项目记忆关系: {error}"))?;
    if eligible_count != 2 {
        connection.close().await.ok();
        return Err("两条记忆必须存在于当前项目且未归档".to_string());
    }
    let result = sqlx::query(
        "INSERT INTO project_memory_conflicts
         (memory_id, conflicts_with_memory_id, relation_type, created_at)
         VALUES (?, ?, ?, ?)",
    )
    .bind(left_id)
    .bind(right_id)
    .bind(&relation_type)
    .bind(trace_timestamp())
    .execute(&mut connection)
    .await
    .map(|_| ())
    .map_err(|error| {
        if error.to_string().contains("UNIQUE constraint failed") {
            "该记忆关系已经存在".to_string()
        } else {
            format!("无法创建项目记忆关系: {error}")
        }
    });
    connection.close().await.ok();
    result
}

#[tauri::command]
async fn delete_project_memory_conflict(
    app: AppHandle,
    project_id: String,
    memory_id: String,
    related_memory_id: String,
    relation_type: String,
) -> Result<(), String> {
    if project_id.trim().is_empty() || project_id.len() > 200 {
        return Err("项目标识无效".to_string());
    }
    if memory_id.trim().is_empty()
        || memory_id.len() > 200
        || related_memory_id.trim().is_empty()
        || related_memory_id.len() > 200
    {
        return Err("记忆标识无效".to_string());
    }
    let (left_id, right_id) =
        normalized_memory_relation(memory_id.trim(), related_memory_id.trim(), &relation_type)?;
    let path = database_path(&app)?;
    let mut connection = sqlite_connection(&path, false).await?;
    let rows = sqlx::query(
        "DELETE FROM project_memory_conflicts
         WHERE memory_id = ? AND conflicts_with_memory_id = ? AND relation_type = ?
           AND EXISTS (
             SELECT 1 FROM project_memories left_memory
             JOIN project_memories right_memory ON right_memory.id = ?
             WHERE left_memory.id = ? AND left_memory.project_id = ?
               AND right_memory.project_id = ?
           )",
    )
    .bind(left_id)
    .bind(right_id)
    .bind(&relation_type)
    .bind(right_id)
    .bind(left_id)
    .bind(project_id.trim())
    .bind(project_id.trim())
    .execute(&mut connection)
    .await
    .map_err(|error| format!("无法解除项目记忆关系: {error}"))?
    .rows_affected();
    connection.close().await.ok();
    if rows == 1 {
        Ok(())
    } else {
        Err("记忆关系不存在或不属于当前项目".to_string())
    }
}

#[tauri::command]
async fn list_project_memory_conflicts(
    app: AppHandle,
    project_id: String,
    memory_id: String,
) -> Result<Vec<ProjectMemoryConflictResult>, String> {
    if project_id.trim().is_empty() || project_id.len() > 200 {
        return Err("项目标识无效".to_string());
    }
    if memory_id.trim().is_empty() || memory_id.len() > 200 {
        return Err("记忆标识无效".to_string());
    }
    let path = database_path(&app)?;
    let mut connection = sqlite_connection(&path, true).await?;
    let results = sqlx::query_as::<_, (String, String, String, String, String, String, String, String)>(
        "SELECT c.memory_id, c.conflicts_with_memory_id, c.relation_type,
                CASE WHEN c.memory_id = ? THEN 'outgoing' ELSE 'incoming' END,
                related.id, related.title, related.status, c.created_at
         FROM project_memory_conflicts c
         JOIN project_memories origin
           ON origin.id = CASE WHEN c.memory_id = ? THEN c.memory_id ELSE c.conflicts_with_memory_id END
         JOIN project_memories related
           ON related.id = CASE WHEN c.memory_id = ? THEN c.conflicts_with_memory_id ELSE c.memory_id END
         WHERE (c.memory_id = ? OR c.conflicts_with_memory_id = ?)
           AND origin.project_id = ? AND related.project_id = ?
         ORDER BY c.created_at DESC",
    )
    .bind(memory_id.trim())
    .bind(memory_id.trim())
    .bind(memory_id.trim())
    .bind(memory_id.trim())
    .bind(memory_id.trim())
    .bind(project_id.trim())
    .bind(project_id.trim())
    .fetch_all(&mut connection)
    .await
    .map(|rows| rows.into_iter().map(|row| ProjectMemoryConflictResult {
        memory_id: row.0,
        conflicts_with_memory_id: row.1,
        relation_type: row.2,
        direction: row.3,
        related_memory_id: row.4,
        related_title: row.5,
        related_status: row.6,
        created_at: row.7,
    }).collect())
    .map_err(|error| format!("无法读取项目记忆关系: {error}"));
    connection.close().await.ok();
    results
}

#[tauri::command]
async fn search_project_memories(
    app: AppHandle,
    project_id: String,
    query: String,
    status: Option<String>,
    limit: Option<u8>,
) -> Result<Vec<ProjectMemorySearchResult>, String> {
    if project_id.trim().is_empty() || project_id.len() > 200 {
        return Err("项目标识无效".to_string());
    }
    valid_memory_status(status.as_deref())?;
    let fts_query = memory_fts_query(&query)?;
    let limit = i64::from(limit.unwrap_or(20).clamp(1, 50));
    let path = database_path(&app)?;
    let mut connection = sqlite_connection(&path, true).await?;
    let results = sqlx::query_as::<
        _,
        (
            String,
            String,
            String,
            String,
            String,
            String,
            String,
            Option<String>,
            String,
            Option<String>,
            Option<String>,
            Option<String>,
            Option<f64>,
            String,
            String,
        ),
    >(
        "SELECT m.id, m.project_id, m.memory_type, m.status, m.title, m.content,
                m.source_kind, m.source_id, m.source_locator_json, m.valid_from,
                m.valid_until, m.conflict_group, m.confidence, m.created_by, m.updated_at
         FROM project_memory_fts f
         JOIN project_memories m ON m.rowid = f.rowid
         WHERE f.project_id = ? AND project_memory_fts MATCH ?
           AND (? IS NULL OR m.status = ?)
         ORDER BY bm25(project_memory_fts), m.updated_at DESC
         LIMIT ?",
    )
    .bind(&project_id)
    .bind(&fts_query)
    .bind(status.as_deref())
    .bind(status.as_deref())
    .bind(limit)
    .fetch_all(&mut connection)
    .await
    .map(|rows| {
        rows.into_iter()
            .map(|row| ProjectMemorySearchResult {
                id: row.0,
                project_id: row.1,
                memory_type: row.2,
                status: row.3,
                title: row.4,
                content: row.5,
                source_kind: row.6,
                source_id: row.7,
                source_locator_json: row.8,
                valid_from: row.9,
                valid_until: row.10,
                conflict_group: row.11,
                confidence: row.12,
                created_by: row.13,
                updated_at: row.14,
            })
            .collect()
    })
    .map_err(|error| format!("无法搜索项目记忆: {error}"));
    connection.close().await.ok();
    results
}

#[tauri::command]
async fn rebuild_project_memory_index(app: AppHandle) -> Result<(), String> {
    let path = database_path(&app)?;
    let mut connection = sqlite_connection(&path, false).await?;
    let result =
        sqlx::query("INSERT INTO project_memory_fts(project_memory_fts) VALUES ('rebuild')")
            .execute(&mut connection)
            .await
            .map(|_| ())
            .map_err(|error| format!("无法重建项目记忆索引: {error}"));
    connection.close().await.ok();
    result
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let migrations = migrations();
    let latest_migration_version = migrations
        .last()
        .map(|migration| migration.version)
        .unwrap_or_default();
    let ai_runtime = new_ai_runtime_manager();
    let ai_runtime_for_setup = ai_runtime.clone();
    let ai_runtime_for_run = ai_runtime.clone();

    let mut builder = tauri::Builder::default();

    // This plugin must be registered before setup so a later process exits before
    // it can initialize SQLite or spawn another Sidecar.
    #[cfg(desktop)]
    {
        builder = builder.plugin(tauri_plugin_single_instance::init(
            |app, _arguments, _working_directory| {
                if let Some(window) = app.get_webview_window("main") {
                    let _ = window.show();
                    let _ = window.unminimize();
                    let _ = window.set_focus();
                }
            },
        ));
    }

    let app = builder
        .manage(ai_runtime)
        .manage(NotificationActivationState::default())
        .invoke_handler(tauri::generate_handler![
            create_backup,
            list_backups,
            export_backup,
            export_product_document_docx,
            export_product_document_pdf,
            restore_backup,
            send_clickable_notification,
            take_pending_notification_open,
            set_provider_api_key,
            get_provider_credential_status,
            has_provider_api_key,
            delete_provider_api_key,
            probe_local_model_route,
            get_ai_runtime_status,
            test_ai_provider_connection,
            search_research_sources,
            generate_structured_ai_output,
            list_recent_agent_runs,
            list_agent_run_steps,
            list_agent_definitions,
            create_product_document,
            list_product_documents,
            list_product_document_versions,
            create_product_document_version,
            archive_product_document,
            create_knowledge_item,
            update_knowledge_item,
            import_knowledge_markdown_package,
            list_knowledge_items,
            list_knowledge_adapter_candidates,
            review_knowledge_item,
            add_knowledge_source,
            list_knowledge_sources,
            create_knowledge_relation,
            review_knowledge_relation,
            list_knowledge_relations,
            create_analysis_dataset,
            list_analysis_datasets,
            create_analysis_run,
            create_analysis_insight,
            list_analysis_insights,
            review_analysis_insight,
            create_voc_feedback,
            create_voc_feedback_batch,
            list_voc_feedback,
            create_voc_requirement_candidate,
            list_voc_requirement_candidates,
            review_voc_requirement_candidate,
            create_product_decision,
            create_product_decision_version,
            list_product_decisions,
            list_product_decision_versions,
            review_product_decision,
            create_project_risk,
            list_project_risks,
            update_project_risk_status,
            create_project_dependency,
            list_project_dependencies,
            update_project_dependency_status,
            create_research_entry,
            list_research_entries,
            create_competitor_profile,
            list_competitor_profiles,
            create_release,
            list_releases,
            update_release_status,
            create_research_plan,
            list_research_plans,
            update_research_plan_status,
            save_research_plan_update_proposals,
            save_project_risk_update_proposals,
            save_project_dependency_update_proposals,
            save_release_preparation_proposals,
            list_agent_tool_proposals,
            confirm_agent_tool_proposal,
            reject_agent_tool_proposal,
            create_research_insight,
            list_research_insights,
            review_research_insight,
            create_research_requirement_candidate,
            list_research_requirement_candidates,
            review_research_requirement_candidate,
            create_metric_definition,
            list_metric_definitions,
            create_experiment,
            list_experiments,
            create_experiment_result,
            recover_interrupted_agent_runs,
            create_project_memory_candidate,
            review_project_memory_candidate,
            list_project_memories,
            list_project_memory_sources,
            create_project_memory_conflict,
            delete_project_memory_conflict,
            list_project_memory_conflicts,
            search_project_memories,
            rebuild_project_memory_index,
            create_meeting_document,
            inspect_text_meeting_file,
            create_file_meeting_document,
            delete_meeting_document,
            retry_docx_meeting
        ])
        // Plugins initialize in registration order. The backup must finish before the SQL
        // plugin can apply any pending migration.
        .plugin(pre_migration_backup_plugin(latest_migration_version))
        .plugin(
            tauri_plugin_sql::Builder::default()
                .add_migrations(DATABASE_URL, migrations)
                .build(),
        )
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_autostart::init(
            tauri_plugin_autostart::MacosLauncher::LaunchAgent,
            Some(vec!["--hidden"]),
        ))
        .plugin(tauri_plugin_shell::init())
        .setup(move |app| {
            if cfg!(debug_assertions) {
                app.handle().plugin(
                    tauri_plugin_log::Builder::default()
                        .level(log::LevelFilter::Info)
                        .build(),
                )?;
            }
            create_tray(app)?;
            if std::env::args().any(|argument| argument == "--hidden") {
                if let Some(window) = app.get_webview_window("main") {
                    let _ = window.hide();
                }
            }
            start_ai_sidecar(app.handle().clone(), ai_runtime_for_setup.clone());
            Ok(())
        })
        .build(tauri::generate_context!())
        .expect("error while building tauri application");

    app.run(move |app, event| {
        if let RunEvent::ExitRequested { .. } = &event {
            stop_ai_sidecar(&ai_runtime_for_run);
        }
        if let RunEvent::WindowEvent {
            label,
            event: WindowEvent::CloseRequested { api, .. },
            ..
        } = event
        {
            if label == "main" {
                api.prevent_close();
                if let Some(window) = app.get_webview_window("main") {
                    let _ = window.hide();
                }
            }
        }
    });
}

#[cfg(test)]
mod migration_tests {
    use super::*;
    use std::io::Write;

    #[test]
    fn sidecar_exit_policy_restarts_once_then_degrades() {
        assert_eq!(sidecar_exit_action(0, false), SidecarExitAction::Restart);
        assert_eq!(sidecar_exit_action(1, false), SidecarExitAction::Degrade);
        assert_eq!(sidecar_exit_action(0, true), SidecarExitAction::Degrade);
    }

    #[test]
    fn model_route_probe_only_accepts_loopback_http_endpoints() {
        assert!(parse_loopback_model_endpoint("http://127.0.0.1:15721").is_ok());
        assert!(parse_loopback_model_endpoint("http://localhost:15721/v1").is_ok());
        assert!(parse_loopback_model_endpoint("http://192.168.1.8:15721").is_err());
        assert!(parse_loopback_model_endpoint("https://127.0.0.1:15721").is_err());
        assert!(parse_loopback_model_endpoint("http://user@127.0.0.1:15721").is_err());
    }

    #[test]
    fn notification_activation_ids_are_bounded_and_control_free() {
        assert_eq!(
            validate_notification_item_id(" confirmation-1 ").unwrap(),
            "confirmation-1"
        );
        assert!(validate_notification_item_id("").is_err());
        assert!(validate_notification_item_id("confirmation\n1").is_err());
        assert!(validate_notification_item_id(&"x".repeat(129)).is_err());
    }

    #[test]
    fn credential_accounts_are_limited_to_key_bearing_providers() {
        assert_eq!(provider_credential_account("openai").unwrap(), "openai");
        assert_eq!(
            provider_credential_account("openai_compatible").unwrap(),
            "openai_compatible"
        );
        assert!(provider_credential_account("cc_switch").is_err());
        assert!(provider_credential_account("none").is_err());
        assert!(provider_credential_account("arbitrary-provider").is_err());
    }

    #[test]
    fn credential_values_require_bounded_visible_ascii() {
        assert!(validate_provider_api_key_value("sk-test_123-ABC").is_ok());
        assert!(validate_provider_api_key_value(&"x".repeat(512)).is_ok());
        assert!(validate_provider_api_key_value("").is_err());
        assert!(validate_provider_api_key_value("key value").is_err());
        assert!(validate_provider_api_key_value("key\nvalue").is_err());
        assert!(validate_provider_api_key_value("key\u{200b}value").is_err());
        assert!(validate_provider_api_key_value("密钥").is_err());
        assert!(validate_provider_api_key_value(&"x".repeat(513)).is_err());
    }

    #[test]
    fn credential_status_distinguishes_missing_invalid_and_valid_values() {
        let missing = provider_credential_status(&StoredProviderApiKey::Missing);
        let invalid = provider_credential_status(&StoredProviderApiKey::Invalid);
        let valid = provider_credential_status(&StoredProviderApiKey::Valid("secret".into()));

        assert_eq!(missing.state, "missing");
        assert_eq!(invalid.state, "invalid");
        assert!(invalid.message.contains("替换或删除"));
        assert_eq!(valid.state, "valid");
    }

    #[test]
    fn research_search_endpoint_rejects_insecure_or_credentialed_routes() {
        assert_eq!(
            validated_research_search_endpoint("https://search.example.test/api").unwrap(),
            "https://search.example.test/api"
        );
        assert!(validated_research_search_endpoint("http://127.0.0.1:8787/api").is_ok());
        assert!(validated_research_search_endpoint("http://search.example.test/api").is_err());
        assert!(validated_research_search_endpoint(
            "https://search.example.test/api?access_token=hidden"
        )
        .is_err());
        assert!(validated_research_search_endpoint("https://user:pass@example.test/api").is_err());
        assert!(validated_research_search_endpoint("https://example.test/api#fragment").is_err());
    }

    #[test]
    fn research_search_provider_is_forwarded_and_bounded() {
        assert_eq!(
            validated_research_search_provider(
                "wikipedia_zh",
                "https://zh.wikipedia.org/w/api.php"
            )
            .unwrap(),
            "https://zh.wikipedia.org/w/api.php"
        );
        assert!(
            validated_research_search_provider("wikipedia_zh", "https://example.test/api").is_err()
        );
        assert!(
            validated_research_search_provider("arbitrary", "https://search.example.test/api")
                .is_err()
        );
    }

    #[test]
    fn research_search_result_is_bounded_and_strips_fragments() {
        let result = validate_research_search_result(ResearchSearchResult {
            title: " 标题 ".into(),
            url: "https://example.test/report#section".into(),
            snippet: " 摘要 ".into(),
        })
        .unwrap();
        assert_eq!(result.title, "标题");
        assert_eq!(result.url, "https://example.test/report");
        assert_eq!(result.snippet, "摘要");
        assert!(validate_research_search_result(ResearchSearchResult {
            title: "标题".into(),
            url: "file:///private.txt".into(),
            snippet: "摘要".into(),
        })
        .is_err());
    }

    #[test]
    fn notification_activation_queue_is_bounded_and_ordered() {
        let mut pending = VecDeque::new();
        for ordinal in 0..=MAX_PENDING_NOTIFICATION_ACTIVATIONS {
            push_notification_activation(&mut pending, format!("confirmation-{ordinal}"));
        }
        assert_eq!(pending.len(), MAX_PENDING_NOTIFICATION_ACTIVATIONS);
        assert_eq!(pending.front().map(String::as_str), Some("confirmation-1"));
        assert_eq!(pending.back().map(String::as_str), Some("confirmation-32"));
    }

    #[test]
    fn disk_write_budget_adds_reserve_without_overflow() {
        assert_eq!(required_disk_space(1024), DISK_WRITE_RESERVE_BYTES + 1024);
        assert_eq!(required_disk_space(u64::MAX), u64::MAX);
        assert_eq!(parent_directory(Path::new("backup.db")), Path::new("."));
    }

    #[test]
    fn disk_write_budget_rejects_one_byte_short_with_clear_error() {
        let required = required_disk_space(1024);
        assert!(validate_disk_space(required, required).is_ok());
        let error = validate_disk_space(required - 1, required).unwrap_err();
        assert!(error.contains("磁盘空间不足"));
        assert!(error.contains("至少需要"));
    }

    struct TempDatabase {
        path: PathBuf,
    }

    impl TempDatabase {
        fn new(label: &str) -> Self {
            Self {
                path: std::env::temp_dir().join(format!(
                    "assistant-product-manager-{label}-{}-{}.db",
                    std::process::id(),
                    epoch_millis()
                )),
            }
        }
    }

    impl Drop for TempDatabase {
        fn drop(&mut self) {
            let _ = fs::remove_file(&self.path);
            let _ = fs::remove_file(format!("{}-wal", self.path.to_string_lossy()));
            let _ = fs::remove_file(format!("{}-shm", self.path.to_string_lossy()));
        }
    }

    struct TempDirectory {
        path: PathBuf,
    }

    impl TempDirectory {
        fn new(label: &str) -> Self {
            let path = std::env::temp_dir().join(format!(
                "assistant-product-manager-{label}-{}-{}",
                std::process::id(),
                epoch_millis()
            ));
            fs::create_dir_all(&path).unwrap();
            Self { path }
        }
    }

    impl Drop for TempDirectory {
        fn drop(&mut self) {
            let _ = fs::remove_dir_all(&self.path);
        }
    }

    async fn create_test_connection(path: &Path) -> SqliteConnection {
        let options = SqliteConnectOptions::new()
            .filename(path)
            .create_if_missing(true)
            .foreign_keys(true);
        SqliteConnection::connect_with(&options).await.unwrap()
    }

    async fn create_marker_database(path: &Path, marker: &str) {
        let mut connection = create_test_connection(path).await;
        sqlx::query("CREATE TABLE restore_marker (value TEXT NOT NULL)")
            .execute(&mut connection)
            .await
            .unwrap();
        sqlx::query("INSERT INTO restore_marker (value) VALUES (?)")
            .bind(marker)
            .execute(&mut connection)
            .await
            .unwrap();
        connection.close().await.unwrap();
    }

    async fn read_marker(path: &Path) -> String {
        let mut connection = sqlite_connection(path, true).await.unwrap();
        let marker = sqlx::query_scalar("SELECT value FROM restore_marker")
            .fetch_one(&mut connection)
            .await
            .unwrap();
        connection.close().await.unwrap();
        marker
    }

    async fn apply_migration(
        connection: &mut SqliteConnection,
        sql: &str,
    ) -> Result<(), sqlx::Error> {
        let mut transaction = connection.begin().await?;
        sqlx::raw_sql(sql).execute(&mut *transaction).await?;
        transaction.commit().await
    }

    fn file_meeting_document(
        inspection: &TextFileInspection,
        ordinal: i64,
    ) -> MeetingDocumentWrite {
        MeetingDocumentWrite {
            meeting: MeetingWrite {
                id: "meeting-file-1".into(),
                project_id: "project-1".into(),
                title: "文件会议".into(),
                meeting_date: "2026-07-13".into(),
                status: "pending_analysis".into(),
                created_at: "2026-07-13".into(),
                updated_at: "2026-07-13".into(),
            },
            source: MeetingSourceWrite {
                id: "source-file-1".into(),
                meeting_id: "meeting-file-1".into(),
                source_type: inspection.source_type.clone(),
                file_name: Some(inspection.file_name.clone()),
                file_path: None,
                content_hash: inspection.content_hash.clone(),
                parsed_text: inspection.text.clone(),
                mime_type: inspection.mime_type.clone(),
                byte_size: inspection.byte_size as i64,
                parse_status: "parsed".into(),
                parse_error: None,
                created_at: "2026-07-13".into(),
                updated_at: "2026-07-13".into(),
            },
            paragraphs: vec![MeetingParagraphWrite {
                id: "paragraph-file-1".into(),
                meeting_id: "meeting-file-1".into(),
                source_id: "source-file-1".into(),
                ordinal,
                text: inspection.text.clone(),
                start_offset: 0,
                end_offset: inspection.text.len() as i64,
                content_hash: "paragraph-hash".into(),
                created_at: "2026-07-13".into(),
            }],
        }
    }

    fn write_docx(path: &Path, document_xml: &str) {
        let file = fs::File::create(path).unwrap();
        let mut archive = zip::ZipWriter::new(file);
        let options = zip::write::SimpleFileOptions::default()
            .compression_method(zip::CompressionMethod::Deflated);
        archive.start_file("[Content_Types].xml", options).unwrap();
        archive
            .write_all(
                br#"<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>"#,
            )
            .unwrap();
        archive.start_file("word/document.xml", options).unwrap();
        archive.write_all(document_xml.as_bytes()).unwrap();
        archive.finish().unwrap();
    }

    #[test]
    fn empty_database_installs_every_migration_and_is_valid() {
        tauri::async_runtime::block_on(async {
            let database = TempDatabase::new("empty-install");
            let mut connection = create_test_connection(&database.path).await;

            for migration in MIGRATION_SPECS {
                apply_migration(&mut connection, migration.sql)
                    .await
                    .unwrap();
            }

            let table_count: i64 = sqlx::query_scalar(
                "SELECT COUNT(*) FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'",
            )
            .fetch_one(&mut connection)
            .await
            .unwrap();
            assert_eq!(table_count, 49);
            let project_extension_count: i64 = sqlx::query_scalar(
                "SELECT COUNT(*) FROM pragma_table_info('projects') WHERE name IN ('archived_at', 'background', 'phase', 'target_users', 'core_problem', 'success_metrics', 'constraints', 'owner', 'roles')",
            )
            .fetch_one(&mut connection)
            .await
            .unwrap();
            assert_eq!(project_extension_count, 9);
            let requirement_title_count: i64 = sqlx::query_scalar(
                "SELECT COUNT(*) FROM pragma_table_info('requirement_versions') WHERE name = 'title'",
            )
            .fetch_one(&mut connection)
            .await
            .unwrap();
            assert_eq!(requirement_title_count, 1);
            let agent_trace_table_count: i64 = sqlx::query_scalar(
                "SELECT COUNT(*) FROM sqlite_master WHERE type = 'table' AND name IN ('agent_definitions', 'agent_run_steps', 'agent_run_messages')",
            )
            .fetch_one(&mut connection)
            .await
            .unwrap();
            assert_eq!(agent_trace_table_count, 3);
            let agent_run_extension_count: i64 = sqlx::query_scalar(
                "SELECT COUNT(*) FROM pragma_table_info('agent_runs') WHERE name IN ('agent_definition_id', 'project_id', 'trace_version', 'idempotency_key', 'metadata_json')",
            )
            .fetch_one(&mut connection)
            .await
            .unwrap();
            assert_eq!(agent_run_extension_count, 5);
            let definition_count: i64 = sqlx::query_scalar(
                "SELECT COUNT(*) FROM agent_definitions WHERE id = 'meeting-requirement-analyst:v1'",
            )
            .fetch_one(&mut connection)
            .await
            .unwrap();
            assert_eq!(definition_count, 1);
            let diagnostic_definition_count: i64 = sqlx::query_scalar(
                "SELECT COUNT(*) FROM agent_definitions WHERE id = 'provider-diagnostic:v1' AND permissions_json LIKE '%\"businessWriteAccess\":false%'",
            )
            .fetch_one(&mut connection)
            .await
            .unwrap();
            assert_eq!(diagnostic_definition_count, 1);
            let analysis_explainer_definition_count: i64 = sqlx::query_scalar(
                "SELECT COUNT(*) FROM agent_definitions WHERE id = 'analysis-explainer:v1' AND permissions_json LIKE '%\"read_analysis_run\"%'",
            )
            .fetch_one(&mut connection)
            .await
            .unwrap();
            assert_eq!(analysis_explainer_definition_count, 1);
            let risk_review_definition_count: i64 = sqlx::query_scalar(
                "SELECT COUNT(*) FROM agent_definitions WHERE id = 'risk-review:v1' AND permissions_json LIKE '%\"businessWriteAccess\":false%'",
            )
            .fetch_one(&mut connection)
            .await
            .unwrap();
            assert_eq!(risk_review_definition_count, 1);
            let release_review_definition_count: i64 = sqlx::query_scalar(
                "SELECT COUNT(*) FROM agent_definitions WHERE id = 'release-review:v1' AND permissions_json LIKE '%\"businessWriteAccess\":false%'",
            )
            .fetch_one(&mut connection)
            .await
            .unwrap();
            assert_eq!(release_review_definition_count, 1);
            let competitor_review_definition_count: i64 = sqlx::query_scalar(
                "SELECT COUNT(*) FROM agent_definitions WHERE id = 'competitor-review:v1' AND permissions_json LIKE '%\"externalSearchAccess\":false%'",
            )
            .fetch_one(&mut connection)
            .await
            .unwrap();
            assert_eq!(competitor_review_definition_count, 1);
            let research_plan_review_definition_count: i64 = sqlx::query_scalar(
                "SELECT COUNT(*) FROM agent_definitions WHERE id = 'research-plan-review:v1' AND permissions_json LIKE '%\"businessWriteAccess\":false%'",
            )
            .fetch_one(&mut connection)
            .await
            .unwrap();
            assert_eq!(research_plan_review_definition_count, 1);
            let plan_engineer_v2_definition_count: i64 = sqlx::query_scalar(
                "SELECT COUNT(*) FROM agent_definitions WHERE id = 'plan-engineer:v2' AND output_schema_version = '2.0.0' AND permissions_json LIKE '%\"userConfirmationRequired\":true%'",
            )
            .fetch_one(&mut connection)
            .await
            .unwrap();
            assert_eq!(plan_engineer_v2_definition_count, 1);
            let risk_review_v2_definition_count: i64 = sqlx::query_scalar(
                "SELECT COUNT(*) FROM agent_definitions WHERE id = 'risk-review:v2' AND output_schema_version = '2.0.0' AND permissions_json LIKE '%\"proposalOnly\":true%' AND permissions_json LIKE '%\"userConfirmationRequired\":true%'",
            )
            .fetch_one(&mut connection)
            .await
            .unwrap();
            assert_eq!(risk_review_v2_definition_count, 1);
            let dependency_remediation_definition_count: i64 = sqlx::query_scalar(
                "SELECT COUNT(*) FROM agent_definitions WHERE id = 'dependency-remediation:v1' AND output_schema_version = '1.0.0' AND permissions_json LIKE '%\"proposalOnly\":true%' AND permissions_json LIKE '%\"userConfirmationRequired\":true%'",
            )
            .fetch_one(&mut connection)
            .await
            .unwrap();
            assert_eq!(dependency_remediation_definition_count, 1);
            let release_preparation_definition_count:i64=sqlx::query_scalar("SELECT COUNT(*) FROM agent_definitions WHERE id='release-preparation:v1' AND permissions_json LIKE '%\"userConfirmationRequired\":true%'").fetch_one(&mut connection).await.unwrap();
            assert_eq!(release_preparation_definition_count, 1);
            let proposal_cleanup_trigger_count: i64 = sqlx::query_scalar(
                "SELECT COUNT(*) FROM sqlite_master WHERE type = 'trigger' AND name IN ('delete_research_plan_tool_proposals', 'delete_project_risk_tool_proposals', 'delete_project_dependency_tool_proposals', 'delete_release_tool_proposals')",
            )
            .fetch_one(&mut connection)
            .await
            .unwrap();
            assert_eq!(proposal_cleanup_trigger_count, 4);
            let agent_tool_proposal_table_count: i64 = sqlx::query_scalar(
                "SELECT COUNT(*) FROM sqlite_master WHERE type = 'table' AND name = 'agent_tool_proposals'",
            )
            .fetch_one(&mut connection)
            .await
            .unwrap();
            assert_eq!(agent_tool_proposal_table_count, 1);
            let project_qa_v2_definition_count: i64 = sqlx::query_scalar(
                "SELECT COUNT(*) FROM agent_definitions WHERE id = 'project-qa:v2' AND input_schema_version = '2.0.0' AND permissions_json LIKE '%\"read_project_risks\"%'",
            )
            .fetch_one(&mut connection)
            .await
            .unwrap();
            assert_eq!(project_qa_v2_definition_count, 1);
            let memory_table_count: i64 = sqlx::query_scalar(
                "SELECT COUNT(*) FROM sqlite_master WHERE type = 'table' AND name IN ('project_memories', 'project_memory_sources', 'project_memory_conflicts', 'project_memory_fts')",
            )
            .fetch_one(&mut connection)
            .await
            .unwrap();
            assert_eq!(memory_table_count, 4);
            let document_table_count: i64 = sqlx::query_scalar(
                "SELECT COUNT(*) FROM sqlite_master WHERE type = 'table' AND name IN ('product_documents', 'product_document_versions')",
            )
            .fetch_one(&mut connection)
            .await
            .unwrap();
            assert_eq!(document_table_count, 2);
            let analysis_insight_table_count: i64 = sqlx::query_scalar(
                "SELECT COUNT(*) FROM sqlite_master WHERE type = 'table' AND name IN ('analysis_insights', 'analysis_insight_links')",
            )
            .fetch_one(&mut connection)
            .await
            .unwrap();
            assert_eq!(analysis_insight_table_count, 2);
            let source_format_column_count: i64 = sqlx::query_scalar(
                "SELECT COUNT(*) FROM pragma_table_info('analysis_datasets') WHERE name = 'source_format'",
            )
            .fetch_one(&mut connection)
            .await
            .unwrap();
            assert_eq!(source_format_column_count, 1);
            let voc_table_count: i64 = sqlx::query_scalar(
                "SELECT COUNT(*) FROM sqlite_master WHERE type = 'table' AND name IN ('voc_feedback', 'voc_requirement_candidates')",
            )
            .fetch_one(&mut connection)
            .await
            .unwrap();
            assert_eq!(voc_table_count, 2);
            let decision_table_count: i64 = sqlx::query_scalar(
                "SELECT COUNT(*) FROM sqlite_master WHERE type = 'table' AND name IN ('product_decisions', 'product_decision_versions')",
            )
            .fetch_one(&mut connection)
            .await
            .unwrap();
            assert_eq!(decision_table_count, 2);
            let risk_table_count: i64 = sqlx::query_scalar(
                "SELECT COUNT(*) FROM sqlite_master WHERE type = 'table' AND name = 'project_risks'",
            )
            .fetch_one(&mut connection)
            .await
            .unwrap();
            assert_eq!(risk_table_count, 1);
            let dependency_table_count: i64 = sqlx::query_scalar(
                "SELECT COUNT(*) FROM sqlite_master WHERE type = 'table' AND name = 'project_dependencies'",
            )
            .fetch_one(&mut connection)
            .await
            .unwrap();
            assert_eq!(dependency_table_count, 1);
            let research_table_count: i64 = sqlx::query_scalar(
                "SELECT COUNT(*) FROM sqlite_master WHERE type = 'table' AND name = 'research_entries'",
            )
            .fetch_one(&mut connection)
            .await
            .unwrap();
            assert_eq!(research_table_count, 1);
            let competitor_table_count: i64 = sqlx::query_scalar(
                "SELECT COUNT(*) FROM sqlite_master WHERE type = 'table' AND name = 'competitor_profiles'",
            )
            .fetch_one(&mut connection)
            .await
            .unwrap();
            assert_eq!(competitor_table_count, 1);
            let release_table_count: i64 = sqlx::query_scalar(
                "SELECT COUNT(*) FROM sqlite_master WHERE type = 'table' AND name = 'releases'",
            )
            .fetch_one(&mut connection)
            .await
            .unwrap();
            assert_eq!(release_table_count, 1);
            let research_plan_table_count: i64 = sqlx::query_scalar(
                "SELECT COUNT(*) FROM sqlite_master WHERE type = 'table' AND name = 'research_plans'",
            )
            .fetch_one(&mut connection)
            .await
            .unwrap();
            assert_eq!(research_plan_table_count, 1);
            let research_plan_link_count: i64 = sqlx::query_scalar(
                "SELECT COUNT(*) FROM pragma_table_info('research_entries') WHERE name = 'plan_id'",
            )
            .fetch_one(&mut connection)
            .await
            .unwrap();
            assert_eq!(research_plan_link_count, 1);
            let research_insight_table_count: i64 = sqlx::query_scalar(
                "SELECT COUNT(*) FROM sqlite_master WHERE type = 'table' AND name = 'research_insights'",
            )
            .fetch_one(&mut connection)
            .await
            .unwrap();
            assert_eq!(research_insight_table_count, 1);
            let research_candidate_table_count: i64 = sqlx::query_scalar(
                "SELECT COUNT(*) FROM sqlite_master WHERE type = 'table' AND name = 'research_requirement_candidates'",
            )
            .fetch_one(&mut connection)
            .await
            .unwrap();
            assert_eq!(research_candidate_table_count, 1);
            let research_candidate_requirement_link_count: i64 = sqlx::query_scalar(
                "SELECT COUNT(*) FROM pragma_table_info('research_requirement_candidates') WHERE name = 'requirement_card_id'",
            )
            .fetch_one(&mut connection)
            .await
            .unwrap();
            assert_eq!(research_candidate_requirement_link_count, 1);
            connection.close().await.unwrap();
            validate_database_file(&database.path).await.unwrap();
        });
    }

    #[test]
    fn interrupted_agent_runs_are_failed_once_without_replay() {
        tauri::async_runtime::block_on(async {
            let database = TempDatabase::new("agent-recovery");
            let mut connection = create_test_connection(&database.path).await;
            for migration in MIGRATION_SPECS {
                apply_migration(&mut connection, migration.sql)
                    .await
                    .unwrap();
            }
            sqlx::raw_sql(
                "INSERT INTO agent_runs
                 (id, run_type, provider_mode, model, status, created_at, agent_definition_id, trace_version, idempotency_key, metadata_json)
                 VALUES
                 ('run-interrupted', 'provider_diagnostic', 'openai', 'test', 'running', '1', 'provider-diagnostic:v1', 1, 'recovery-1', '{}'),
                 ('run-complete', 'provider_diagnostic', 'openai', 'test', 'succeeded', '1', 'provider-diagnostic:v1', 1, 'recovery-2', '{}');
                 INSERT INTO agent_run_steps
                 (id, agent_run_id, ordinal, step_type, status, detail_json, created_at)
                 VALUES
                 ('step-interrupted', 'run-interrupted', 1, 'model_request', 'running', '{}', '1'),
                 ('step-complete', 'run-complete', 1, 'model_request', 'succeeded', '{}', '1');",
            )
            .execute(&mut connection)
            .await
            .unwrap();

            let first = recover_interrupted_agent_runs_in_connection(&mut connection)
                .await
                .unwrap();
            assert_eq!(first.recovered_runs, 1);
            assert_eq!(first.recovered_steps, 1);
            let interrupted: (String, String, String) = sqlx::query_as(
                "SELECT status, error_code, error_summary FROM agent_runs WHERE id = 'run-interrupted'",
            )
            .fetch_one(&mut connection)
            .await
            .unwrap();
            assert_eq!(interrupted.0, "failed");
            assert_eq!(interrupted.1, "process_interrupted");
            assert!(interrupted.2.contains("未自动重试"));
            let completed_status: String =
                sqlx::query_scalar("SELECT status FROM agent_runs WHERE id = 'run-complete'")
                    .fetch_one(&mut connection)
                    .await
                    .unwrap();
            assert_eq!(completed_status, "succeeded");

            let second = recover_interrupted_agent_runs_in_connection(&mut connection)
                .await
                .unwrap();
            assert_eq!(second.recovered_runs, 0);
            assert_eq!(second.recovered_steps, 0);
            connection.close().await.unwrap();
        });
    }

    #[test]
    fn project_memory_fts_is_project_scoped_and_rebuildable() {
        tauri::async_runtime::block_on(async {
            let database = TempDatabase::new("project-memory-fts");
            let mut connection = create_test_connection(&database.path).await;
            for migration in MIGRATION_SPECS {
                apply_migration(&mut connection, migration.sql)
                    .await
                    .unwrap();
            }
            sqlx::raw_sql(
                "INSERT INTO projects (id, name, status, created_at, updated_at) VALUES
                 ('p1', 'One', 'active', '1', '1'), ('p2', 'Two', 'active', '1', '1');
                 INSERT INTO project_memories
                 (id, project_id, memory_type, status, title, content, source_kind, created_by, created_at, updated_at) VALUES
                 ('m1', 'p1', 'confirmed_memory', 'confirmed', 'Billing', 'Billing exports are required', 'meeting', 'user', '1', '1'),
                 ('m2', 'p2', 'confirmed_memory', 'confirmed', 'Billing', 'Billing exports are optional', 'meeting', 'user', '1', '1');",
            )
            .execute(&mut connection)
            .await
            .unwrap();
            let ids: Vec<String> = sqlx::query_scalar(
                "SELECT m.id FROM project_memory_fts f
                 JOIN project_memories m ON m.rowid = f.rowid
                 WHERE f.project_id = ? AND project_memory_fts MATCH ?",
            )
            .bind("p1")
            .bind(memory_fts_query("billing exports").unwrap())
            .fetch_all(&mut connection)
            .await
            .unwrap();
            assert_eq!(ids, vec!["m1"]);
            sqlx::query("INSERT INTO project_memory_fts(project_memory_fts) VALUES ('rebuild')")
                .execute(&mut connection)
                .await
                .unwrap();
            let rebuilt_count: i64 = sqlx::query_scalar(
                "SELECT COUNT(*) FROM project_memory_fts WHERE project_memory_fts MATCH 'optional'",
            )
            .fetch_one(&mut connection)
            .await
            .unwrap();
            assert_eq!(rebuilt_count, 1);
            connection.close().await.unwrap();
        });
    }

    #[test]
    fn project_memory_query_rejects_fts_operators() {
        assert_eq!(
            memory_fts_query("billing OR exports").unwrap(),
            "\"billing\"* AND \"OR\"* AND \"exports\"*"
        );
        assert!(memory_fts_query("***").is_err());
        assert!(valid_memory_status(Some("unknown")).is_err());
    }

    #[test]
    fn project_memory_candidate_never_accepts_agent_confirmed_fact() {
        let mut request = CreateProjectMemoryCandidateRequest {
            id: "memory-1".to_string(),
            project_id: "project-1".to_string(),
            title: "Launch scope".to_string(),
            content: "Desktop first".to_string(),
            memory_type: "confirmed_memory".to_string(),
            source_kind: "agent".to_string(),
            source_id: None,
            source_locator_json: "{}".to_string(),
            confidence: Some(0.8),
            created_by: "agent".to_string(),
        };
        assert!(validate_memory_candidate(&request).is_err());
        request.memory_type = "inference".to_string();
        assert!(validate_memory_candidate(&request).is_ok());
        request.source_locator_json = "[]".to_string();
        assert!(validate_memory_candidate(&request).is_err());
    }

    #[test]
    fn project_memory_conflicts_are_canonical_but_supersedes_keeps_direction() {
        assert_eq!(
            normalized_memory_relation("m1", "m2", "conflicts").unwrap(),
            ("m1", "m2")
        );
        assert_eq!(
            normalized_memory_relation("m2", "m1", "conflicts").unwrap(),
            ("m1", "m2")
        );
        assert_eq!(
            normalized_memory_relation("m2", "m1", "supersedes").unwrap(),
            ("m2", "m1")
        );
        assert!(normalized_memory_relation("m1", "m1", "conflicts").is_err());
        assert!(normalized_memory_relation("m1", "m2", "unknown").is_err());
    }

    #[test]
    fn project_qa_trace_requires_current_project_and_no_entity_write_scope() {
        let request = StructuredGenerationRequest {
            run_id: "qa-run".to_string(),
            run_type: "project_qa".to_string(),
            agent_definition_id: "project-qa:v1".to_string(),
            project_id: Some("project-1".to_string()),
            entity_id: None,
            idempotency_key: "qa-key".to_string(),
            kind: "openai".to_string(),
            endpoint: "https://api.example.test/v1".to_string(),
            model: "test".to_string(),
            system: "read-only".to_string(),
            prompt: "question".to_string(),
            response_schema: serde_json::json!({"type":"object"}),
            max_output_tokens: 128,
        };
        assert!(validate_generation_trace_scope(&request));
        let mut v2 = request.clone();
        v2.agent_definition_id = "project-qa:v2".to_string();
        assert!(validate_generation_trace_scope(&v2));
        let mut escalated = request;
        escalated.entity_id = Some("meeting-1".to_string());
        assert!(!validate_generation_trace_scope(&escalated));
        escalated.entity_id = None;
        escalated.run_type = "document_diff_review".to_string();
        escalated.agent_definition_id = "document-diff-reviewer:v1".to_string();
        assert!(validate_generation_trace_scope(&escalated));
        escalated.entity_id = Some("document-1".to_string());
        assert!(!validate_generation_trace_scope(&escalated));
        escalated.entity_id = None;
        escalated.run_type = "risk_review".to_string();
        escalated.agent_definition_id = "risk-review:v1".to_string();
        assert!(validate_generation_trace_scope(&escalated));
        escalated.agent_definition_id = "release-review:v1".to_string();
        assert!(!validate_generation_trace_scope(&escalated));
        escalated.run_type = "research_plan_review".to_string();
        escalated.agent_definition_id = "research-plan-review:v1".to_string();
        assert!(validate_generation_trace_scope(&escalated));
        escalated.entity_id = Some("plan-1".to_string());
        assert!(!validate_generation_trace_scope(&escalated));
        escalated.entity_id = None;
        escalated.run_type = "plan_engineer".to_string();
        escalated.agent_definition_id = "plan-engineer:v2".to_string();
        assert!(validate_generation_trace_scope(&escalated));
        escalated.agent_definition_id = "plan-engineer:v1".to_string();
        assert!(validate_generation_trace_scope(&escalated));
        escalated.run_type = "release_review".to_string();
        escalated.agent_definition_id = "release-review:v1".to_string();
        assert!(validate_generation_trace_scope(&escalated));
        escalated.entity_id = Some("release-1".to_string());
        assert!(!validate_generation_trace_scope(&escalated));
        escalated.entity_id = None;
        escalated.run_type = "competitor_review".to_string();
        escalated.agent_definition_id = "competitor-review:v1".to_string();
        assert!(validate_generation_trace_scope(&escalated));
        escalated.agent_definition_id = "release-review:v1".to_string();
        assert!(!validate_generation_trace_scope(&escalated));
    }

    #[test]
    fn project_qa_v2_rechecks_complete_evidence_and_project_scope() {
        tauri::async_runtime::block_on(async {
            let database = TempDatabase::new("project-qa-v2-evidence");
            let mut connection = create_test_connection(&database.path).await;
            for migration in MIGRATION_SPECS {
                sqlx::raw_sql(migration.sql)
                    .execute(&mut connection)
                    .await
                    .unwrap();
            }
            for (id, name) in [("p1", "项目一"), ("p2", "项目二")] {
                sqlx::query("INSERT INTO projects (id, name, goal, status, start_date, end_date, progress, created_at, updated_at) VALUES (?, ?, '目标', 'active', '2026-01-01', '2026-12-31', 10, '1', '1')")
                    .bind(id)
                    .bind(name)
                    .execute(&mut connection)
                    .await
                    .unwrap();
            }
            for (id, project_id, title, progress) in [
                ("m1", "p1", "首发里程碑", 20_i64),
                ("m2", "p2", "其他项目里程碑", 99_i64),
            ] {
                sqlx::query("INSERT INTO milestones (id, project_id, title, due_date, progress, created_at, updated_at) VALUES (?, ?, ?, '2026-07-20', ?, '1', '1')")
                    .bind(id)
                    .bind(project_id)
                    .bind(title)
                    .bind(progress)
                    .execute(&mut connection)
                    .await
                    .unwrap();
            }
            let mut request = StructuredGenerationRequest {
                run_id: "qa-v2-run".to_string(),
                run_type: "project_qa".to_string(),
                agent_definition_id: "project-qa:v2".to_string(),
                project_id: Some("p1".to_string()),
                entity_id: None,
                idempotency_key: "qa-v2-key".to_string(),
                kind: "openai".to_string(),
                endpoint: "https://api.example.test/v1".to_string(),
                model: "test".to_string(),
                system: "read-only".to_string(),
                prompt: serde_json::json!({
                    "projectId": "p1",
                    "question": "首发进度？",
                    "evidence": [{
                        "sourceType": "milestone",
                        "sourceId": "m1",
                        "title": "首发里程碑",
                        "content": serde_json::json!({ "dueDate": "2026-07-20", "progress": 20 }).to_string()
                    }]
                })
                .to_string(),
                response_schema: serde_json::json!({"type":"object"}),
                max_output_tokens: 128,
            };
            validate_project_qa_prompt(&mut connection, &request)
                .await
                .unwrap();

            let mut tampered: serde_json::Value = serde_json::from_str(&request.prompt).unwrap();
            tampered["evidence"][0]["content"] = serde_json::Value::String(
                serde_json::json!({ "dueDate": "2026-07-20", "progress": 99 }).to_string(),
            );
            request.prompt = tampered.to_string();
            assert!(validate_project_qa_prompt(&mut connection, &request)
                .await
                .unwrap_err()
                .contains("数据库快照"));

            tampered["evidence"][0] = serde_json::json!({
                "sourceType": "milestone",
                "sourceId": "m2",
                "title": "其他项目里程碑",
                "content": serde_json::json!({ "dueDate": "2026-07-20", "progress": 99 }).to_string()
            });
            request.prompt = tampered.to_string();
            assert!(validate_project_qa_prompt(&mut connection, &request)
                .await
                .unwrap_err()
                .contains("不属于当前项目"));
        });
    }

    #[test]
    fn product_document_validation_rejects_unsafe_or_oversized_fields() {
        assert!(
            validate_product_document_fields("d1", "p1", "PRD", "prd", "# draft", "初始").is_ok()
        );
        assert!(
            validate_product_document_fields("d:1", "p1", "PRD", "prd", "# draft", "").is_err()
        );
        assert!(
            validate_product_document_fields("d1", "p1", "PRD", "html", "# draft", "").is_err()
        );
        assert!(validate_product_document_fields(
            "d1",
            "p1",
            "PRD",
            "prd",
            &"x".repeat(200_001),
            ""
        )
        .is_err());
    }

    #[test]
    fn output_schema_failure_is_attributed_to_validation_step() {
        tauri::async_runtime::block_on(async {
            let database = TempDatabase::new("agent-validation-trace");
            let mut connection = create_test_connection(&database.path).await;
            for migration in MIGRATION_SPECS {
                apply_migration(&mut connection, migration.sql)
                    .await
                    .unwrap();
            }
            let request = StructuredGenerationRequest {
                run_id: "run-validation".into(),
                run_type: "provider_diagnostic".into(),
                agent_definition_id: "provider-diagnostic:v1".into(),
                project_id: None,
                entity_id: None,
                idempotency_key: "validation-trace".into(),
                kind: "openai".into(),
                endpoint: "https://api.example.test/v1".into(),
                model: "test".into(),
                system: "system".into(),
                prompt: "prompt".into(),
                response_schema: serde_json::json!({ "type": "object" }),
                max_output_tokens: 100,
            };
            insert_generation_trace_start(&mut connection, &request)
                .await
                .unwrap();
            finish_generation_trace(
                &mut connection,
                &request,
                &StructuredGenerationResult {
                    state: "failed".into(),
                    message: "Provider 输出不符合约定 Schema".into(),
                    output: None,
                    usage: Some(TokenUsage {
                        input_tokens: Some(10),
                        output_tokens: Some(4),
                    }),
                    duration_ms: 20,
                },
            )
            .await
            .unwrap();
            let steps: Vec<(i64, String, Option<String>)> = sqlx::query_as(
                "SELECT ordinal, status, error_code FROM agent_run_steps WHERE agent_run_id = 'run-validation' ORDER BY ordinal",
            )
            .fetch_all(&mut connection)
            .await
            .unwrap();
            assert_eq!(steps[0], (1, "succeeded".into(), None));
            assert_eq!(
                steps[1],
                (2, "failed".into(), Some("output_validation_failed".into()))
            );
            let run: (String, Option<String>) = sqlx::query_as(
                "SELECT status, error_code FROM agent_runs WHERE id = 'run-validation'",
            )
            .fetch_one(&mut connection)
            .await
            .unwrap();
            assert_eq!(
                run,
                ("failed".into(), Some("output_validation_failed".into()))
            );
            connection.close().await.unwrap();
        });
    }

    #[test]
    fn old_database_is_snapshotted_before_upgrade() {
        tauri::async_runtime::block_on(async {
            let source = TempDatabase::new("old-source");
            let snapshot = TempDatabase::new("old-snapshot");
            let mut connection = create_test_connection(&source.path).await;
            apply_migration(&mut connection, MIGRATION_SPECS[0].sql)
                .await
                .unwrap();
            sqlx::raw_sql(
                "INSERT INTO projects
                 (id, name, goal, status, start_date, end_date, progress, created_at, updated_at)
                 VALUES ('project-apm', 'APM', '', 'active', '2026-07-13', '2026-07-20', 0, '2026-07-13', '2026-07-13');
                 INSERT INTO confirmation_items
                 (id, project_id, title, due_date, priority, status, created_at, updated_at)
                 VALUES ('confirmation-rust', 'project-apm', '安装 Rust', '2026-07-13', 'medium', 'pending', '2026-07-13', '2026-07-13');",
            )
            .execute(&mut connection)
            .await
            .unwrap();
            connection.close().await.unwrap();

            create_consistent_snapshot(&source.path, &snapshot.path)
                .await
                .unwrap();

            let mut upgraded = sqlite_connection(&source.path, false).await.unwrap();
            for migration in &MIGRATION_SPECS[1..] {
                apply_migration(&mut upgraded, migration.sql).await.unwrap();
            }
            let upgraded_status: String = sqlx::query_scalar(
                "SELECT status FROM confirmation_items WHERE id = 'confirmation-rust'",
            )
            .fetch_one(&mut upgraded)
            .await
            .unwrap();
            assert_eq!(upgraded_status, "confirmed");
            upgraded.close().await.unwrap();

            let mut old_snapshot = sqlite_connection(&snapshot.path, true).await.unwrap();
            let snapshot_status: String = sqlx::query_scalar(
                "SELECT status FROM confirmation_items WHERE id = 'confirmation-rust'",
            )
            .fetch_one(&mut old_snapshot)
            .await
            .unwrap();
            assert_eq!(snapshot_status, "pending");
            old_snapshot.close().await.unwrap();
            validate_database_file(&source.path).await.unwrap();
            validate_database_file(&snapshot.path).await.unwrap();
        });
    }

    #[test]
    fn restore_replaces_database_and_keeps_consistent_rollback_snapshot() {
        tauri::async_runtime::block_on(async {
            let current = TempDatabase::new("restore-current");
            let source = TempDatabase::new("restore-source");
            let backups = TempDirectory::new("restore-backups");
            create_marker_database(&current.path, "current").await;
            create_marker_database(&source.path, "restored").await;

            let rollback = replace_database_from_backup(&source.path, &current.path, &backups.path)
                .await
                .unwrap()
                .expect("existing database must produce a rollback snapshot");

            assert_eq!(read_marker(&current.path).await, "restored");
            assert_eq!(read_marker(&rollback).await, "current");
            validate_database_file(&current.path).await.unwrap();
            validate_database_file(&rollback).await.unwrap();
        });
    }

    #[test]
    fn restore_rejects_corrupt_source_before_touching_current_database() {
        tauri::async_runtime::block_on(async {
            let current = TempDatabase::new("restore-corrupt-current");
            let source = TempDatabase::new("restore-corrupt-source");
            let backups = TempDirectory::new("restore-corrupt-backups");
            create_marker_database(&current.path, "current").await;
            fs::write(&source.path, b"not a sqlite database").unwrap();

            let error = replace_database_from_backup(&source.path, &current.path, &backups.path)
                .await
                .unwrap_err();

            assert!(error.contains("SQLite") || error.contains("完整性"));
            assert_eq!(read_marker(&current.path).await, "current");
            assert_eq!(fs::read_dir(&backups.path).unwrap().count(), 0);
        });
    }

    #[test]
    fn restore_aborts_before_mutation_when_rollback_directory_is_unusable() {
        tauri::async_runtime::block_on(async {
            let current = TempDatabase::new("restore-unwritable-current");
            let source = TempDatabase::new("restore-unwritable-source");
            let directory = TempDirectory::new("restore-unwritable-root");
            let unusable_directory = directory.path.join("not-a-directory");
            create_marker_database(&current.path, "current").await;
            create_marker_database(&source.path, "restored").await;
            fs::write(&unusable_directory, b"file blocks backup directory").unwrap();

            let error =
                replace_database_from_backup(&source.path, &current.path, &unusable_directory)
                    .await
                    .unwrap_err();

            assert!(error.contains("恢复前备份目录"));
            assert_eq!(read_marker(&current.path).await, "current");
        });
    }

    #[test]
    fn snapshot_never_overwrites_an_existing_destination() {
        tauri::async_runtime::block_on(async {
            let source = TempDatabase::new("snapshot-source");
            let destination = TempDatabase::new("snapshot-existing");
            create_marker_database(&source.path, "source").await;
            fs::write(&destination.path, b"keep existing destination").unwrap();

            let error = create_consistent_snapshot(&source.path, &destination.path)
                .await
                .unwrap_err();

            assert!(error.contains("拒绝覆盖"));
            assert_eq!(
                fs::read(&destination.path).unwrap(),
                b"keep existing destination"
            );
        });
    }

    #[test]
    fn interrupted_restore_keeps_valid_current_and_cleans_stale_files() {
        tauri::async_runtime::block_on(async {
            let directory = TempDirectory::new("recover-keep-current");
            let database = directory.path.join("workspace.db");
            let previous = database.with_extension("previous");
            let temporary = database.with_extension("restore.tmp");
            let rejected = database.with_extension("restore.invalid");
            create_marker_database(&database, "current").await;
            create_marker_database(&previous, "previous").await;
            create_marker_database(&temporary, "temporary").await;
            fs::write(&rejected, b"rejected database").unwrap();

            let outcome = recover_interrupted_database_restore(&database)
                .await
                .unwrap();

            assert_eq!(outcome, RestoreRecoveryOutcome::KeptValidCurrent);
            assert_eq!(read_marker(&database).await, "current");
            assert!(!previous.exists());
            assert!(!temporary.exists());
            assert!(!rejected.exists());
        });
    }

    #[test]
    fn interrupted_restore_prefers_previous_when_switch_was_not_completed() {
        tauri::async_runtime::block_on(async {
            let directory = TempDirectory::new("recover-previous");
            let database = directory.path.join("workspace.db");
            let previous = database.with_extension("previous");
            let temporary = database.with_extension("restore.tmp");
            create_marker_database(&previous, "previous").await;
            create_marker_database(&temporary, "temporary").await;

            let outcome = recover_interrupted_database_restore(&database)
                .await
                .unwrap();

            assert_eq!(outcome, RestoreRecoveryOutcome::RestoredPrevious);
            assert_eq!(read_marker(&database).await, "previous");
            assert!(!previous.exists());
            assert!(!temporary.exists());
        });
    }

    #[test]
    fn interrupted_restore_replaces_corrupt_current_with_valid_previous() {
        tauri::async_runtime::block_on(async {
            let directory = TempDirectory::new("recover-corrupt-current");
            let database = directory.path.join("workspace.db");
            let previous = database.with_extension("previous");
            fs::write(&database, b"corrupt current database").unwrap();
            create_marker_database(&previous, "previous").await;

            let outcome = recover_interrupted_database_restore(&database)
                .await
                .unwrap();

            assert_eq!(outcome, RestoreRecoveryOutcome::RestoredPrevious);
            assert_eq!(read_marker(&database).await, "previous");
            assert!(!database.with_extension("restore.invalid").exists());
        });
    }

    #[test]
    fn interrupted_restore_promotes_valid_temporary_when_no_previous_exists() {
        tauri::async_runtime::block_on(async {
            let directory = TempDirectory::new("recover-temporary");
            let database = directory.path.join("workspace.db");
            let temporary = database.with_extension("restore.tmp");
            create_marker_database(&temporary, "temporary").await;

            let outcome = recover_interrupted_database_restore(&database)
                .await
                .unwrap();

            assert_eq!(outcome, RestoreRecoveryOutcome::PromotedTemporary);
            assert_eq!(read_marker(&database).await, "temporary");
            assert!(!temporary.exists());
        });
    }

    #[test]
    fn interrupted_restore_aborts_when_every_candidate_is_corrupt() {
        tauri::async_runtime::block_on(async {
            let directory = TempDirectory::new("recover-no-valid-candidate");
            let database = directory.path.join("workspace.db");
            let previous = database.with_extension("previous");
            let temporary = database.with_extension("restore.tmp");
            fs::write(&database, b"corrupt current").unwrap();
            fs::write(&previous, b"corrupt previous").unwrap();
            fs::write(&temporary, b"corrupt temporary").unwrap();

            let error = recover_interrupted_database_restore(&database)
                .await
                .unwrap_err();

            assert!(error.contains("均无法安全使用"));
            assert_eq!(fs::read(&database).unwrap(), b"corrupt current");
            assert!(previous.exists());
            assert!(temporary.exists());
        });
    }

    #[test]
    fn failed_migration_rolls_back_partial_changes() {
        tauri::async_runtime::block_on(async {
            let database = TempDatabase::new("failed-migration");
            let mut connection = create_test_connection(&database.path).await;
            apply_migration(&mut connection, MIGRATION_SPECS[0].sql)
                .await
                .unwrap();
            sqlx::query(
                "INSERT INTO projects
                 (id, name, goal, status, start_date, end_date, progress, created_at, updated_at)
                 VALUES ('keep-me', '保留项目', '', 'active', '2026-07-13', '2026-07-20', 0, '2026-07-13', '2026-07-13')",
            )
            .execute(&mut connection)
            .await
            .unwrap();

            let result = apply_migration(
                &mut connection,
                "CREATE TABLE migration_must_rollback (id TEXT PRIMARY KEY); INSERT INTO missing_table VALUES ('fail');",
            )
            .await;
            assert!(result.is_err());

            let partial_table_count: i64 = sqlx::query_scalar(
                "SELECT COUNT(*) FROM sqlite_master WHERE type = 'table' AND name = 'migration_must_rollback'",
            )
            .fetch_one(&mut connection)
            .await
            .unwrap();
            let preserved_project_count: i64 =
                sqlx::query_scalar("SELECT COUNT(*) FROM projects WHERE id = 'keep-me'")
                    .fetch_one(&mut connection)
                    .await
                    .unwrap();
            assert_eq!(partial_table_count, 0);
            assert_eq!(preserved_project_count, 1);
            connection.close().await.unwrap();
            validate_database_file(&database.path).await.unwrap();
        });
    }

    #[test]
    fn meeting_document_write_is_atomic() {
        tauri::async_runtime::block_on(async {
            let database = TempDatabase::new("meeting-atomic-write");
            let mut connection = create_test_connection(&database.path).await;
            for migration in MIGRATION_SPECS {
                apply_migration(&mut connection, migration.sql)
                    .await
                    .unwrap();
            }
            sqlx::query(
                "INSERT INTO projects
                 (id, name, goal, status, start_date, end_date, progress, created_at, updated_at)
                 VALUES ('project-1', '项目', '', 'active', '2026-07-13', '2026-07-20', 0, '2026-07-13', '2026-07-13')",
            )
            .execute(&mut connection)
            .await
            .unwrap();

            let result = insert_meeting_document(
                &mut connection,
                MeetingDocumentWrite {
                    meeting: MeetingWrite {
                        id: "meeting-1".into(),
                        project_id: "project-1".into(),
                        title: "测试会议".into(),
                        meeting_date: "2026-07-13".into(),
                        status: "pending_analysis".into(),
                        created_at: "2026-07-13".into(),
                        updated_at: "2026-07-13".into(),
                    },
                    source: MeetingSourceWrite {
                        id: "source-1".into(),
                        meeting_id: "meeting-1".into(),
                        source_type: "paste".into(),
                        file_name: None,
                        file_path: None,
                        content_hash: "source-hash".into(),
                        parsed_text: "原文".into(),
                        mime_type: "text/plain".into(),
                        byte_size: 6,
                        parse_status: "parsed".into(),
                        parse_error: None,
                        created_at: "2026-07-13".into(),
                        updated_at: "2026-07-13".into(),
                    },
                    paragraphs: vec![MeetingParagraphWrite {
                        id: "paragraph-invalid".into(),
                        meeting_id: "meeting-1".into(),
                        source_id: "source-1".into(),
                        ordinal: 0,
                        text: "原文".into(),
                        start_offset: 0,
                        end_offset: 2,
                        content_hash: "paragraph-hash".into(),
                        created_at: "2026-07-13".into(),
                    }],
                },
            )
            .await;
            assert!(result.is_err());

            let meeting_count: i64 =
                sqlx::query_scalar("SELECT COUNT(*) FROM meetings WHERE id = 'meeting-1'")
                    .fetch_one(&mut connection)
                    .await
                    .unwrap();
            let source_count: i64 =
                sqlx::query_scalar("SELECT COUNT(*) FROM meeting_sources WHERE id = 'source-1'")
                    .fetch_one(&mut connection)
                    .await
                    .unwrap();
            assert_eq!(meeting_count, 0);
            assert_eq!(source_count, 0);
            connection.close().await.unwrap();
            validate_database_file(&database.path).await.unwrap();
        });
    }

    #[test]
    fn text_file_inspection_rejects_invalid_inputs() {
        let directory = TempDirectory::new("file-inspection");
        let valid = directory.path.join("notes.md");
        fs::write(&valid, "# 会议\n\n有效内容").unwrap();
        let inspection = inspect_text_file(&valid).unwrap();
        assert_eq!(inspection.source_type, "md");
        assert_eq!(inspection.mime_type, "text/markdown; charset=utf-8");
        assert_eq!(inspection.content_hash.len(), 64);

        let empty = directory.path.join("empty.txt");
        fs::write(&empty, []).unwrap();
        assert!(inspect_text_file(&empty).unwrap_err().contains("不能为空"));

        let invalid_utf8 = directory.path.join("invalid.txt");
        fs::write(&invalid_utf8, [0xff, 0xfe, 0xfd]).unwrap();
        assert!(inspect_text_file(&invalid_utf8)
            .unwrap_err()
            .contains("UTF-8"));

        let disguised_pdf = directory.path.join("disguised.txt");
        fs::write(&disguised_pdf, b"%PDF-1.7 fake").unwrap();
        assert!(inspect_text_file(&disguised_pdf)
            .unwrap_err()
            .contains("不匹配"));

        let oversized = directory.path.join("oversized.md");
        let oversized_file = fs::File::create(&oversized).unwrap();
        oversized_file.set_len(MAX_MEETING_FILE_BYTES + 1).unwrap();
        assert!(inspect_text_file(&oversized).unwrap_err().contains("10 MB"));
    }

    #[test]
    fn docx_inspection_extracts_paragraphs_and_preserves_parse_errors() {
        let directory = TempDirectory::new("docx-inspection");
        let valid = directory.path.join("valid.docx");
        write_docx(
            &valid,
            r#"<?xml version="1.0" encoding="UTF-8"?>
            <w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
              <w:body><w:p><w:r><w:t>第一段</w:t></w:r></w:p>
              <w:p><w:r><w:t>第二段</w:t></w:r></w:p></w:body>
            </w:document>"#,
        );
        let inspection = inspect_docx_file(&valid).unwrap();
        assert_eq!(inspection.source_type, "docx");
        assert_eq!(inspection.text, "第一段\n\n第二段");
        assert!(inspection.parse_error.is_none());

        let invalid = directory.path.join("invalid.docx");
        fs::write(&invalid, b"not-a-zip").unwrap();
        let failed = inspect_docx_file(&invalid).unwrap();
        assert!(failed.text.is_empty());
        assert!(failed.parse_error.unwrap().contains("ZIP"));
        assert_eq!(failed.content_hash.len(), 64);

        let disguised_zip = directory.path.join("disguised.docx");
        let file = fs::File::create(&disguised_zip).unwrap();
        let mut archive = zip::ZipWriter::new(file);
        archive
            .start_file(
                "word/document.xml",
                zip::write::SimpleFileOptions::default(),
            )
            .unwrap();
        archive
            .write_all(b"<document>not wordprocessingml</document>")
            .unwrap();
        archive.finish().unwrap();
        assert!(inspect_docx_file(&disguised_zip)
            .unwrap()
            .parse_error
            .unwrap()
            .contains("Content_Types"));
    }

    #[test]
    fn failed_docx_is_kept_and_can_be_retried_from_managed_copy() {
        tauri::async_runtime::block_on(async {
            let database = TempDatabase::new("docx-retry");
            let source_directory = TempDirectory::new("docx-retry-source");
            let attachments = TempDirectory::new("docx-retry-attachments");
            let source = source_directory.path.join("meeting.docx");
            fs::write(&source, b"not-a-zip").unwrap();
            let inspection = inspect_docx_file(&source).unwrap();
            let mut document = file_meeting_document(&inspection, 1);
            document.meeting.status = "failed".into();
            document.source.parse_status = "failed".into();
            document.source.parse_error = inspection.parse_error.clone();
            document.source.parsed_text.clear();
            document.paragraphs.clear();

            let mut connection = create_test_connection(&database.path).await;
            for migration in MIGRATION_SPECS {
                apply_migration(&mut connection, migration.sql)
                    .await
                    .unwrap();
            }
            sqlx::query(
                "INSERT INTO projects
                 (id, name, goal, status, start_date, end_date, progress, created_at, updated_at)
                 VALUES ('project-1', '项目', '', 'active', '2026-07-13', '2026-07-20', 0, '2026-07-13', '2026-07-13')",
            )
            .execute(&mut connection)
            .await
            .unwrap();
            let managed =
                copy_and_insert_file_meeting(&mut connection, &source, &attachments.path, document)
                    .await
                    .unwrap();
            assert!(managed.exists());
            let status: String = sqlx::query_scalar(
                "SELECT parse_status FROM meeting_sources WHERE id = 'source-file-1'",
            )
            .fetch_one(&mut connection)
            .await
            .unwrap();
            assert_eq!(status, "failed");

            write_docx(
                &managed,
                r#"<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:r><w:t>修复后的正文</w:t></w:r></w:p></w:body></w:document>"#,
            );
            retry_docx_in_connection(&mut connection, "meeting-file-1", "2026-07-13T13:00:00Z")
                .await
                .unwrap();
            let parsed: String = sqlx::query_scalar(
                "SELECT parse_status FROM meeting_sources WHERE id = 'source-file-1'",
            )
            .fetch_one(&mut connection)
            .await
            .unwrap();
            let paragraph_count: i64 = sqlx::query_scalar(
                "SELECT COUNT(*) FROM meeting_paragraphs WHERE source_id = 'source-file-1'",
            )
            .fetch_one(&mut connection)
            .await
            .unwrap();
            assert_eq!(parsed, "parsed");
            assert_eq!(paragraph_count, 1);
            connection.close().await.unwrap();
        });
    }

    #[test]
    fn managed_file_is_removed_when_database_write_fails() {
        tauri::async_runtime::block_on(async {
            let database = TempDatabase::new("file-write-rollback");
            let source_directory = TempDirectory::new("file-write-source");
            let attachments = TempDirectory::new("file-write-attachments");
            let source = source_directory.path.join("meeting.txt");
            fs::write(&source, "需要回滚的会议原文").unwrap();
            let inspection = inspect_text_file(&source).unwrap();

            let mut connection = create_test_connection(&database.path).await;
            for migration in MIGRATION_SPECS {
                apply_migration(&mut connection, migration.sql)
                    .await
                    .unwrap();
            }
            sqlx::query(
                "INSERT INTO projects
                 (id, name, goal, status, start_date, end_date, progress, created_at, updated_at)
                 VALUES ('project-1', '项目', '', 'active', '2026-07-13', '2026-07-20', 0, '2026-07-13', '2026-07-13')",
            )
            .execute(&mut connection)
            .await
            .unwrap();

            let result = copy_and_insert_file_meeting(
                &mut connection,
                &source,
                &attachments.path,
                file_meeting_document(&inspection, 0),
            )
            .await;
            assert!(result.is_err());
            assert!(!attachments.path.join("meeting-file-1").exists());
            let meeting_count: i64 =
                sqlx::query_scalar("SELECT COUNT(*) FROM meetings WHERE id = 'meeting-file-1'")
                    .fetch_one(&mut connection)
                    .await
                    .unwrap();
            assert_eq!(meeting_count, 0);
            connection.close().await.unwrap();
        });
    }

    #[test]
    fn managed_file_copy_and_database_write_succeed_together() {
        tauri::async_runtime::block_on(async {
            let database = TempDatabase::new("file-write-success");
            let source_directory = TempDirectory::new("file-success-source");
            let attachments = TempDirectory::new("file-success-attachments");
            let source = source_directory.path.join("meeting.md");
            fs::write(&source, "# 决策\n\n采用受管附件").unwrap();
            let inspection = inspect_text_file(&source).unwrap();
            let mut connection = create_test_connection(&database.path).await;
            for migration in MIGRATION_SPECS {
                apply_migration(&mut connection, migration.sql)
                    .await
                    .unwrap();
            }
            sqlx::query(
                "INSERT INTO projects
                 (id, name, goal, status, start_date, end_date, progress, created_at, updated_at)
                 VALUES ('project-1', '项目', '', 'active', '2026-07-13', '2026-07-20', 0, '2026-07-13', '2026-07-13')",
            )
            .execute(&mut connection)
            .await
            .unwrap();

            let managed_path = copy_and_insert_file_meeting(
                &mut connection,
                &source,
                &attachments.path,
                file_meeting_document(&inspection, 1),
            )
            .await
            .unwrap();
            assert!(managed_path.exists());
            let stored_path: String = sqlx::query_scalar(
                "SELECT file_path FROM meeting_sources WHERE id = 'source-file-1'",
            )
            .fetch_one(&mut connection)
            .await
            .unwrap();
            assert_eq!(stored_path, managed_path.to_string_lossy());

            let deletion =
                delete_meeting_and_cleanup(&mut connection, "meeting-file-1", &attachments.path)
                    .await
                    .unwrap();
            assert!(deletion.deleted);
            assert_eq!(deletion.attachments_removed, 1);
            assert!(deletion.cleanup_warnings.is_empty());
            assert!(!managed_path.exists());
            let remaining: i64 =
                sqlx::query_scalar("SELECT COUNT(*) FROM meetings WHERE id = 'meeting-file-1'")
                    .fetch_one(&mut connection)
                    .await
                    .unwrap();
            assert_eq!(remaining, 0);
            connection.close().await.unwrap();
        });
    }

    #[test]
    fn meeting_deletion_never_removes_non_managed_files() {
        tauri::async_runtime::block_on(async {
            let database = TempDatabase::new("delete-unmanaged");
            let source_directory = TempDirectory::new("delete-unmanaged-source");
            let attachments = TempDirectory::new("delete-unmanaged-attachments");
            let source = source_directory.path.join("meeting.txt");
            fs::write(&source, "用户自己的原始文件").unwrap();
            let inspection = inspect_text_file(&source).unwrap();
            let mut connection = create_test_connection(&database.path).await;
            for migration in MIGRATION_SPECS {
                apply_migration(&mut connection, migration.sql)
                    .await
                    .unwrap();
            }
            sqlx::query(
                "INSERT INTO projects
                 (id, name, goal, status, start_date, end_date, progress, created_at, updated_at)
                 VALUES ('project-1', '项目', '', 'active', '2026-07-13', '2026-07-20', 0, '2026-07-13', '2026-07-13')",
            )
            .execute(&mut connection)
            .await
            .unwrap();
            let mut document = file_meeting_document(&inspection, 1);
            document.source.file_path = Some(source.to_string_lossy().to_string());
            insert_meeting_document(&mut connection, document)
                .await
                .unwrap();

            let deletion =
                delete_meeting_and_cleanup(&mut connection, "meeting-file-1", &attachments.path)
                    .await
                    .unwrap();
            assert!(deletion.deleted);
            assert_eq!(deletion.attachments_removed, 0);
            assert_eq!(deletion.cleanup_warnings.len(), 1);
            assert!(source.exists());
            connection.close().await.unwrap();
        });
    }
}
