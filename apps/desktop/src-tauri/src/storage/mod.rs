#[cfg(test)]
mod tests;

use crate::artifacts::{read_artifact, write_artifact};
use rusqlite::{params, Connection, OptionalExtension};
use serde::{Deserialize, Serialize};
use std::path::Path;
use std::sync::atomic::AtomicBool;
use std::sync::atomic::{AtomicU64, Ordering};
use std::time::{SystemTime, UNIX_EPOCH};
use std::{fmt, fs, io};

static ID_SEQUENCE: AtomicU64 = AtomicU64::new(0);

#[derive(Debug)]
pub enum StorageError {
    Sqlite(rusqlite::Error),
    Json(serde_json::Error),
    Io(io::Error),
    Cancelled,
    NotFound(String),
    InvalidInput(String),
    Conflict,
}

impl fmt::Display for StorageError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::Sqlite(error) => write!(formatter, "Kesalahan SQLite: {error}"),
            Self::Json(error) => write!(formatter, "Kesalahan JSON: {error}"),
            Self::Io(error) => write!(formatter, "Kesalahan artefak: {error}"),
            Self::Cancelled => formatter.write_str("Tugas dibatalkan"),
            Self::NotFound(id) => write!(formatter, "Data tidak ditemukan: {id}"),
            Self::InvalidInput(message) => formatter.write_str(message),
            Self::Conflict => formatter.write_str(
                "Draf telah berubah di jendela lain. Salin perubahan Anda sebelum memuat ulang aplikasi.",
            ),
        }
    }
}

impl std::error::Error for StorageError {}

impl From<io::Error> for StorageError {
    fn from(error: io::Error) -> Self {
        Self::Io(error)
    }
}

impl From<rusqlite::Error> for StorageError {
    fn from(error: rusqlite::Error) -> Self {
        Self::Sqlite(error)
    }
}

impl From<serde_json::Error> for StorageError {
    fn from(error: serde_json::Error) -> Self {
        Self::Json(error)
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct GfxSpec {
    #[serde(rename = "schemaVersion")]
    pub schema_version: u8,
    pub title: String,
    pub subtitle: String,
    pub background: String,
    pub accent: String,
    pub layout: String,
    pub width: u32,
    pub height: u32,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct ValidationIssue {
    pub path: String,
    pub severity: String,
    pub message: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GfxVersion {
    pub id: String,
    pub item_id: String,
    pub sequence: i64,
    pub spec: GfxSpec,
    pub checks: Vec<ValidationIssue>,
    pub created_at: String,
    pub artifact: Option<GfxArtifact>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GfxArtifact {
    pub svg_relative_path: String,
    pub png_relative_path: String,
    pub sha256: String,
    pub byte_length: usize,
    pub png_sha256: String,
    pub png_byte_length: usize,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GfxTask {
    pub id: String,
    pub input_version_id: String,
    pub output_version_id: Option<String>,
    pub status: String,
    pub error: Option<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GfxTaskSummary {
    #[serde(flatten)]
    pub task: GfxTask,
    pub title: String,
    pub updated_at: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GfxDraft {
    pub spec: serde_json::Value,
    pub baseline_version_id: Option<String>,
    pub revision: i64,
    pub updated_at: String,
}

pub struct Storage {
    pub(crate) connection: Connection,
}

fn validate_spec(spec: &GfxSpec) -> Result<(), StorageError> {
    if spec.schema_version != 1 {
        return Err(StorageError::InvalidInput(
            "schemaVersion harus bernilai 1".to_owned(),
        ));
    }
    if !(1..=120).contains(&spec.title.encode_utf16().count()) {
        return Err(StorageError::InvalidInput(
            "Judul harus berisi 1–120 karakter".to_owned(),
        ));
    }
    if spec.subtitle.encode_utf16().count() > 240 {
        return Err(StorageError::InvalidInput(
            "Subjudul maksimal 240 karakter".to_owned(),
        ));
    }
    if spec
        .title
        .chars()
        .chain(spec.subtitle.chars())
        .any(|c| c <= '\u{1f}' || c == '\u{7f}' || !crate::gfx_assets::is_xml_char(c))
    {
        return Err(StorageError::InvalidInput(
            "Teks tidak boleh mengandung karakter kontrol atau karakter XML yang tidak sah"
                .to_owned(),
        ));
    }
    for (path, color) in [("Latar", &spec.background), ("Aksen", &spec.accent)] {
        if color.len() != 7
            || !color.starts_with('#')
            || !color[1..]
                .chars()
                .all(|character| character.is_ascii_hexdigit())
        {
            return Err(StorageError::InvalidInput(format!(
                "{path} harus berupa warna #RRGGBB"
            )));
        }
    }
    if !matches!(spec.layout.as_str(), "centered" | "split" | "stacked") {
        return Err(StorageError::InvalidInput(
            "Tata letak harus berupa centered, split, atau stacked".to_owned(),
        ));
    }
    if !(128..=4096).contains(&spec.width) || !(128..=4096).contains(&spec.height) {
        return Err(StorageError::InvalidInput(
            "Lebar dan tinggi harus antara 128 dan 4096".to_owned(),
        ));
    }
    Ok(())
}

fn validate_draft(spec: &serde_json::Value) -> Result<(), StorageError> {
    // Drafts retain unfinished fields; render validation remains stricter.
    if spec.as_object().is_none_or(|object| object.len() != 8)
        || spec["schemaVersion"] != 1
        || [
            ("title", 4096),
            ("subtitle", 8192),
            ("background", 128),
            ("accent", 128),
        ]
        .iter()
        .any(|(key, limit)| spec[key].as_str().is_none_or(|s| s.len() > *limit))
        || !matches!(
            spec["layout"].as_str(),
            Some("centered" | "split" | "stacked")
        )
        || ["width", "height"].iter().any(|key| {
            spec[key]
                .as_f64()
                .is_none_or(|n| !n.is_finite() || n.abs() > 1_000_000.0)
        })
    {
        return Err(StorageError::InvalidInput(
            "Draf melampaui batas penyimpanan".into(),
        ));
    }
    Ok(())
}

pub const SCHEMA_VERSION: i64 = 16;

/// Map snapshots are only usable for two minutes; a new row is stored whenever the map
/// changes. Keep the ones a task still references (its audit trail) and the last week.
const SNAPSHOT_RETENTION_MS: i64 = 7 * 24 * 60 * 60 * 1000;
fn prune_context_snapshots(connection: &Connection) -> Result<(), StorageError> {
    let cutoff = now_string().parse::<i64>().unwrap_or(0) - SNAPSHOT_RETENTION_MS;
    connection.execute(
        "DELETE FROM context_snapshot WHERE CAST(created_at AS INTEGER) < ?1 AND id NOT IN (
            SELECT json_extract(request_json, '$.contextSnapshotId') FROM creative_task
            WHERE json_extract(request_json, '$.contextSnapshotId') IS NOT NULL)",
        params![cutoff],
    )?;
    Ok(())
}

impl Storage {
    pub fn open(path: impl AsRef<Path>) -> Result<Self, StorageError> {
        let path = path.as_ref();
        let connection = Connection::open(path)?;
        connection.busy_timeout(std::time::Duration::from_secs(5))?;
        connection.pragma_update(None, "foreign_keys", "ON")?;
        connection.pragma_update(None, "synchronous", "FULL")?;
        let version: i64 = connection.pragma_query_value(None, "user_version", |row| row.get(0))?;
        if version > SCHEMA_VERSION {
            return Err(StorageError::InvalidInput(
                "Versi database lebih baru; gunakan versi aplikasi yang sesuai".into(),
            ));
        }
        if (1..SCHEMA_VERSION).contains(&version) && path != Path::new(":memory:") {
            let snapshot = path.with_file_name(format!(
                "forgekit-before-schema-{SCHEMA_VERSION}-{}.sqlite",
                next_id("migration")
            ));
            connection.execute("VACUUM INTO ?1", [snapshot.to_string_lossy().as_ref()])?;
            std::fs::File::open(&snapshot)?.sync_all()?;
        }
        connection.execute_batch(include_str!("../../migrations/0001_initial.sql"))?;
        if version < 1 {
            connection.execute_batch(include_str!("../../migrations/0002_task_inputs.sql"))?;
        }
        if version < 2 {
            connection.execute_batch(include_str!("../../migrations/0003_editor_draft.sql"))?;
        }
        if version < 3 {
            connection.execute_batch(include_str!("../../migrations/0004_sfx_versions.sql"))?;
        }
        if version < 4 {
            connection.execute_batch(include_str!("../../migrations/0005_image_versions.sql"))?;
        }
        if version < 5 {
            connection.execute_batch(include_str!("../../migrations/0006_creator_workspace.sql"))?;
        }
        if version < 6 {
            connection.execute_batch(include_str!("../../migrations/0007_ai_chat.sql"))?;
        }
        if version < 7 {
            connection.execute_batch(include_str!("../../migrations/0008_creative_tasks.sql"))?;
        }
        if version < 8 {
            connection.execute_batch(include_str!("../../migrations/0009_chat_turns.sql"))?;
        }
        if version < 9 {
            connection.execute_batch(include_str!("../../migrations/0010_context_snapshots.sql"))?;
        }
        if version < 10 {
            connection.execute_batch(include_str!("../../migrations/0011_tool_receipts.sql"))?;
        }
        if version < 11 {
            connection.execute_batch(include_str!(
                "../../migrations/0012_multi_account_and_router.sql"
            ))?;
        }
        if version < 12 {
            connection
                .execute_batch(include_str!("../../migrations/0013_verified_connections.sql"))?;
        }
        if version < 13 {
            connection.execute_batch(include_str!("../../migrations/0014_creative_domains.sql"))?;
        }
        if version < 14 {
            connection.execute_batch(include_str!(
                "../../migrations/0015_fallback_and_cooldown.sql"
            ))?;
        }
        if version < 15 {
            connection.execute_batch(include_str!("../../migrations/0016_connection_compatibility.sql"))?;
        }
        if version < 16 {
            // SQLite has no ADD COLUMN IF NOT EXISTS; a database that already has the
            // columns (e.g. its user_version was rolled back) only needs the version bump.
            let has_command = connection
                .prepare("SELECT 1 FROM pragma_table_info('mcp_connector_config') WHERE name='command'")?
                .exists([])?;
            if has_command {
                connection.execute_batch("UPDATE mcp_connector_config SET is_enabled=0 WHERE command=''; PRAGMA user_version=16;")?;
            } else {
                connection.execute_batch(include_str!("../../migrations/0017_mcp_connector_launch.sql"))?;
            }
        }
        let recovery = connection.unchecked_transaction()?;
        let stamp = now_string();
        let ids = recovery.prepare("UPDATE work_task SET status = 'interrupted', error = 'Aplikasi berhenti. Periksa receipt sebelum mengulang operasi.', updated_at = ?1 WHERE status IN ('queued', 'running', 'cancel_requested') RETURNING id")?
            .query_map(params![stamp], |row| row.get::<_, String>(0))?.collect::<Result<Vec<_>, _>>()?;
        for id in ids {
            crate::creator_workspace::record_event(&recovery, &id)?;
        }
        recovery.commit()?;
        let creative_ids = connection
            .prepare(
                "SELECT id FROM creative_task WHERE status IN ('queued','planning','validating','streaming','reading_context','tool_running')",
            )?
            .query_map([], |row| row.get::<_, String>(0))?
            .collect::<Result<Vec<_>, _>>()?;
        let storage = Self { connection };
        for id in creative_ids {
            storage.creative_stage(
                &id,
                "interrupted",
                Some("Aplikasi berhenti sebelum tugas selesai. Periksa receipt dan keadaan Studio sebelum melanjutkan perubahan yang belum pasti."),
            )?;
        }
        let connection = storage.connection;
        connection.execute("UPDATE task SET status = 'interrupted', error = 'Aplikasi berhenti sebelum tugas selesai', updated_at = ?1 WHERE status IN ('queued', 'running')", params![now_string()])?;
        // An attempt still "started" outlived its process; record it as interrupted.
        connection.execute("UPDATE task_attempt SET status = 'interrupted', completed_at = ?1, error = COALESCE(error, 'Aplikasi berhenti sebelum percobaan selesai.') WHERE status = 'started'", params![now_string()])?;
        prune_context_snapshots(&connection)?;
        Ok(Self { connection })
    }

    pub fn load_gfx_draft(&self) -> Result<Option<GfxDraft>, StorageError> {
        let row = self.connection.query_row(
            "SELECT spec_json, baseline_version_id, revision, updated_at FROM editor_draft WHERE item_id = 'default-gfx-item'",
            [],
            |row| Ok((row.get::<_, String>(0)?, row.get(1)?, row.get(2)?, row.get(3)?)),
        ).optional()?;
        row.map(|(spec, baseline_version_id, revision, updated_at)| {
            let spec = serde_json::from_str(&spec)?;
            validate_draft(&spec)?;
            Ok(GfxDraft {
                spec,
                baseline_version_id,
                revision,
                updated_at,
            })
        })
        .transpose()
    }

    pub fn save_gfx_draft(
        &self,
        spec: &serde_json::Value,
        baseline_version_id: Option<&str>,
        expected_revision: i64,
    ) -> Result<GfxDraft, StorageError> {
        validate_draft(spec)?;
        if !(0..i64::MAX).contains(&expected_revision) {
            return Err(StorageError::InvalidInput("Revisi draf tidak sah".into()));
        }
        if let Some(id) = baseline_version_id {
            let found = self
                .connection
                .query_row(
                    "SELECT 1 FROM gfx_version WHERE id = ?1 AND item_id = 'default-gfx-item'",
                    [id],
                    |_| Ok(()),
                )
                .optional()?
                .is_some();
            if !found {
                return Err(StorageError::NotFound(id.into()));
            }
        }
        let updated_at = now_string();
        let changed = if expected_revision == 0 {
            self.connection.execute(
                "INSERT OR IGNORE INTO editor_draft (item_id, revision, spec_json, baseline_version_id, updated_at)
                 VALUES ('default-gfx-item', 1, ?1, ?2, ?3)",
                params![serde_json::to_string(spec)?, baseline_version_id, updated_at],
            )?
        } else {
            self.connection.execute(
                "UPDATE editor_draft SET revision = revision + 1, spec_json = ?1,
                 baseline_version_id = ?2, updated_at = ?3
                 WHERE item_id = 'default-gfx-item' AND revision = ?4",
                params![
                    serde_json::to_string(spec)?,
                    baseline_version_id,
                    updated_at,
                    expected_revision
                ],
            )?
        };
        if changed != 1 {
            return Err(StorageError::Conflict);
        }
        Ok(GfxDraft {
            spec: spec.clone(),
            baseline_version_id: baseline_version_id.map(str::to_owned),
            revision: expected_revision + 1,
            updated_at,
        })
    }

    pub fn ensure_default_records(&self) -> Result<(), StorageError> {
        self.connection.execute(
            "INSERT OR IGNORE INTO workspace (id, root_path, created_at) VALUES (?1, ?2, ?3)",
            params!["default-workspace", "", now_string()],
        )?;
        self.connection.execute(
            "INSERT OR IGNORE INTO collection_item (id, workspace_id, kind, name, created_at) VALUES (?1, ?2, 'gfx', ?3, ?4)",
            params!["default-gfx-item", "default-workspace", "Kreator GFX", now_string()],
        )?;
        Ok(())
    }

    pub fn create_workspace(&self, id: &str, root_path: &str) -> Result<(), StorageError> {
        self.connection.execute(
            "INSERT INTO workspace (id, root_path, created_at) VALUES (?1, ?2, ?3)",
            params![id, root_path, now_string()],
        )?;
        Ok(())
    }

    pub fn create_collection_item(
        &self,
        id: &str,
        workspace_id: &str,
        name: &str,
    ) -> Result<(), StorageError> {
        self.connection.execute(
            "INSERT INTO collection_item (id, workspace_id, kind, name, created_at) VALUES (?1, ?2, 'gfx', ?3, ?4)",
            params![id, workspace_id, name, now_string()],
        )?;
        Ok(())
    }

    pub fn save_gfx_version(
        &self,
        item_id: &str,
        spec: &GfxSpec,
    ) -> Result<GfxVersion, StorageError> {
        validate_spec(spec)?;
        let checks: Vec<ValidationIssue> = Vec::new();
        let spec_json = serde_json::to_string(spec)?;
        let checks_json = serde_json::to_string(&checks)?;
        let sequence: i64 = self.connection.query_row(
            "SELECT COALESCE(MAX(sequence), 0) + 1 FROM gfx_version WHERE item_id = ?1",
            params![item_id],
            |row| row.get(0),
        )?;
        let id = next_id("gfx");
        let created_at = now_string();
        self.connection.execute(
            "INSERT INTO gfx_version (id, item_id, sequence, spec_json, checks_json, created_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
            params![id, item_id, sequence, spec_json, checks_json, created_at],
        )?;
        Ok(GfxVersion {
            id,
            item_id: item_id.to_owned(),
            sequence,
            spec: spec.clone(),
            checks,
            created_at,
            artifact: None,
        })
    }

    pub fn load_gfx_version(&self, id: &str) -> Result<GfxVersion, StorageError> {
        let engine: i64 = self
            .connection
            .query_row(
                "SELECT engine_version FROM gfx_version WHERE id = ?1",
                [id],
                |row| row.get(0),
            )
            .optional()?
            .ok_or_else(|| StorageError::NotFound(id.into()))?;
        if engine != crate::creator_workspace::ENGINE_VERSION {
            return Err(StorageError::InvalidInput(
                "Versi engine GFX tidak didukung. Artefak asli dipertahankan.".into(),
            ));
        }
        let row: Option<(String, i64, String, String, String, String)> = self
            .connection
            .query_row(
                "SELECT item_id, sequence, spec_json, checks_json, created_at, id FROM gfx_version WHERE id = ?1",
                params![id],
                |row| {
                    Ok((
                        row.get(0)?,
                        row.get(1)?,
                        row.get(2)?,
                        row.get(3)?,
                        row.get(4)?,
                        row.get(5)?,
                    ))
                },
            )
            .optional()?;
        let Some((item_id, sequence, spec_json, checks_json, created_at, stored_id)) = row else {
            return Err(StorageError::NotFound(id.to_owned()));
        };
        Ok(GfxVersion {
            id: stored_id,
            item_id,
            sequence,
            spec: serde_json::from_str(&spec_json)?,
            checks: serde_json::from_str(&checks_json)?,
            created_at,
            artifact: self.load_artifact(id)?,
        })
    }
    pub fn list_gfx_versions(&self) -> Result<Vec<GfxVersion>, StorageError> {
        let mut query = self.connection.prepare(
            "SELECT id FROM gfx_version WHERE item_id = 'default-gfx-item' ORDER BY sequence DESC",
        )?;
        let ids = query
            .query_map([], |row| row.get::<_, String>(0))?
            .collect::<Result<Vec<_>, _>>()?;
        ids.iter().map(|id| self.load_gfx_version(id)).collect()
    }

    fn load_artifact(&self, id: &str) -> Result<Option<GfxArtifact>, StorageError> {
        self.connection.query_row("SELECT s.relative_path, p.relative_path, s.sha256, s.byte_length, p.sha256, p.byte_length FROM artifact s JOIN artifact p ON s.version_id = p.version_id WHERE s.version_id = ?1 AND s.kind = 'svg' AND p.kind = 'png'", params![id], |row| Ok(GfxArtifact {
            svg_relative_path: row.get(0)?, png_relative_path: row.get(1)?, sha256: row.get(2)?, byte_length: row.get(3)?, png_sha256: row.get(4)?, png_byte_length: row.get(5)?,
        })).optional().map_err(StorageError::from)
    }

    pub fn load_verified_gfx_version(
        &self,
        id: &str,
        root: &Path,
    ) -> Result<GfxVersion, StorageError> {
        let version = self.load_gfx_version(id)?;
        let artifact = version.artifact.as_ref().ok_or_else(|| {
            StorageError::InvalidInput(
                "Versi lama tidak memiliki artefak; render dan simpan versi baru".into(),
            )
        })?;
        read_artifact(
            root,
            &artifact.svg_relative_path,
            &artifact.sha256,
            artifact.byte_length,
        )?;
        read_artifact(
            root,
            &artifact.png_relative_path,
            &artifact.png_sha256,
            artifact.png_byte_length,
        )?;
        validate_spec(&version.spec)?;
        Ok(version)
    }

    pub fn create_gfx_task(&self, spec: &GfxSpec) -> Result<GfxTask, StorageError> {
        validate_spec(spec)?;
        let transaction = self.connection.unchecked_transaction()?;
        let input_id = next_id("input");
        let id = next_id("task");
        transaction.execute(
            "INSERT INTO task_input (id, spec_json) VALUES (?1, ?2)",
            params![input_id, serde_json::to_string(spec)?],
        )?;
        transaction.execute("INSERT INTO task (id, input_version_id, status, created_at, updated_at) VALUES (?1, ?2, 'queued', ?3, ?3)", params![id, input_id, now_string()])?;
        transaction.commit()?;
        self.get_gfx_task(&id)
    }

    pub fn get_gfx_task(&self, id: &str) -> Result<GfxTask, StorageError> {
        self.connection.query_row("SELECT id, input_version_id, output_version_id, status, error FROM task WHERE id = ?1", params![id], |row| Ok(GfxTask { id: row.get(0)?, input_version_id: row.get(1)?, output_version_id: row.get(2)?, status: row.get(3)?, error: row.get(4)? })).optional()?.ok_or_else(|| StorageError::NotFound(id.into()))
    }

    pub fn list_gfx_tasks(&self) -> Result<Vec<GfxTaskSummary>, StorageError> {
        // ponytail: latest 100 local saves; add cursor pagination when history browsing grows.
        let mut statement = self.connection.prepare(
            "SELECT t.id, t.input_version_id, t.output_version_id, t.status, t.error,
                    i.spec_json, t.updated_at
             FROM task t JOIN task_input i ON i.id = t.input_version_id
             ORDER BY CAST(t.updated_at AS INTEGER) DESC, t.rowid DESC LIMIT 100",
        )?;
        let rows = statement.query_map([], |row| {
            Ok((
                GfxTask {
                    id: row.get(0)?,
                    input_version_id: row.get(1)?,
                    output_version_id: row.get(2)?,
                    status: row.get(3)?,
                    error: row.get(4)?,
                },
                row.get::<_, String>(5)?,
                row.get::<_, String>(6)?,
            ))
        })?;
        rows.map(|row| {
            let (task, input, updated_at) = row?;
            let spec: GfxSpec = serde_json::from_str(&input)?;
            Ok(GfxTaskSummary {
                task,
                title: spec.title,
                updated_at,
            })
        })
        .collect()
    }

    pub fn cancel_gfx_task(&self, id: &str) -> Result<GfxTask, StorageError> {
        self.connection.execute("UPDATE task SET status = 'cancelled', updated_at = ?2 WHERE id = ?1 AND status IN ('queued', 'running')", params![id, now_string()])?;
        self.get_gfx_task(id)
    }

    pub fn finish_gfx_task(
        &self,
        id: &str,
        svg: &str,
        png: &[u8],
        root: &Path,
        cancelled: &AtomicBool,
    ) -> Result<GfxVersion, StorageError> {
        let task = self.get_gfx_task(id)?;
        if task.status == "cancelled" || cancelled.load(Ordering::SeqCst) {
            self.cancel_gfx_task(id)?;
            return Err(StorageError::Cancelled);
        }
        if task.status != "queued" {
            return Err(StorageError::InvalidInput(
                "Hanya tugas dalam antrean yang dapat dijalankan".into(),
            ));
        }
        self.connection.execute("UPDATE task SET status = 'running', updated_at = ?2 WHERE id = ?1 AND status = 'queued'", params![id, now_string()])?;
        let mut written = Vec::new();
        let result = (|| {
            let spec_json: String = self.connection.query_row(
                "SELECT spec_json FROM task_input WHERE id = ?1",
                params![task.input_version_id],
                |row| row.get(0),
            )?;
            let spec: GfxSpec = serde_json::from_str(&spec_json)?;
            validate_spec(&spec)?;
            crate::gfx_assets::validate_assets(&spec, svg, png)?;
            let transaction = self.connection.unchecked_transaction()?;
            let version = self.save_gfx_version("default-gfx-item", &spec)?;
            for (kind, bytes) in [("svg", svg.as_bytes()), ("png", png)] {
                if cancelled.load(Ordering::SeqCst) {
                    return Err(StorageError::Cancelled);
                }
                let relative = format!("gfx/{}/graphic.{kind}", version.id);
                let artifact = write_artifact(root, &relative, bytes)?;
                written.push(relative);
                transaction.execute("INSERT INTO artifact (id, version_id, kind, relative_path, sha256, byte_length, created_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)", params![next_id("artifact"), version.id, kind, artifact.relative_path, artifact.sha256, artifact.byte_length, now_string()])?;
            }
            if cancelled.load(Ordering::SeqCst) {
                return Err(StorageError::Cancelled);
            }
            transaction.execute("UPDATE task SET status = 'succeeded', output_version_id = ?2, updated_at = ?3 WHERE id = ?1 AND status = 'running'", params![id, version.id, now_string()])?;
            // Resolve all fallible response reads before committing metadata and artifacts.
            let saved = self.load_gfx_version(&version.id)?;
            transaction.commit()?;
            Ok(saved)
        })();
        if let Err(ref error) = result {
            for relative in written {
                // Paths were generated here, never supplied by the webview.
                let _ = fs::remove_file(root.join(relative));
            }
            let status = if matches!(error, StorageError::Cancelled) {
                "cancelled"
            } else {
                "failed"
            };
            self.connection.execute("UPDATE task SET status = ?2, error = ?3, updated_at = ?4 WHERE id = ?1 AND status = 'running'", params![id, status, error.to_string(), now_string()])?;
        }
        result
    }

    pub fn export_gfx_artifact(
        &self,
        id: &str,
        kind: &str,
        root: &Path,
    ) -> Result<crate::artifacts::ArtifactResult, StorageError> {
        let version = self.load_verified_gfx_version(id, root)?;
        let artifact = version
            .artifact
            .ok_or_else(|| StorageError::NotFound(id.into()))?;
        let (path, hash, length) = match kind {
            "svg" => (
                artifact.svg_relative_path,
                artifact.sha256,
                artifact.byte_length,
            ),
            "png" => (
                artifact.png_relative_path,
                artifact.png_sha256,
                artifact.png_byte_length,
            ),
            _ => {
                return Err(StorageError::InvalidInput(
                    "Jenis ekspor harus svg atau png".into(),
                ))
            }
        };
        let bytes = read_artifact(root, &path, &hash, length)?;
        Ok(write_artifact(
            root,
            &format!("exports/{}-{}.{}", version.id, next_id("export"), kind),
            &bytes,
        )?)
    }

    pub fn orphan_artifacts(&self, root: &Path) -> Result<Vec<String>, StorageError> {
        let mut orphaned = Vec::new();
        for category in ["gfx", "images", "creative"] {
            let directory = root.join(category);
            if !directory.exists() {
                continue;
            }
            if fs::symlink_metadata(&directory)?.file_type().is_symlink() {
                return Err(StorageError::InvalidInput(
                    "Direktori artefak berupa tautan simbolis".into(),
                ));
            }
            for version in fs::read_dir(directory)? {
                let version = version?;
                if !version.file_type()?.is_dir() {
                    continue;
                }
                for entry in fs::read_dir(version.path())? {
                    let entry = entry?;
                    if !entry.file_type()?.is_file() {
                        continue;
                    }
                    let relative = format!(
                        "{category}/{}/{}",
                        version.file_name().to_string_lossy(),
                        entry.file_name().to_string_lossy()
                    );
                    let known: bool = self.connection.query_row(
                        "SELECT EXISTS(SELECT 1 FROM artifact WHERE relative_path = ?1 UNION ALL SELECT 1 FROM image_artifact WHERE relative_path = ?1 UNION ALL SELECT 1 FROM creative_version WHERE json_extract(artifact_json,'$.relativePath') = ?1)",
                        params![relative], |row| row.get(0),
                    )?;
                    if !known {
                        orphaned.push(relative);
                    }
                }
            }
        }
        orphaned.sort();
        Ok(orphaned)
    }

    pub fn list_ai_profiles(&self) -> Result<Vec<crate::ai::AiProviderProfile>, StorageError> {
        crate::ai::list_profiles(&self.connection)
    }

    pub fn save_ai_profile(
        &self,
        profile: &crate::ai::AiProviderProfile,
    ) -> Result<(), StorageError> {
        crate::ai::save_profile(&self.connection, profile)
    }

    pub fn delete_ai_profile(&self, id: &str) -> Result<(), StorageError> {
        crate::ai::delete_profile(&self.connection, id)
    }

    pub fn list_connection_profiles(
        &self,
    ) -> Result<Vec<crate::ai::ConnectionProfile>, StorageError> {
        crate::ai::list_connection_profiles(&self.connection)
    }

    pub fn save_connection_profile(
        &self,
        profile: &crate::ai::ConnectionProfile,
    ) -> Result<(), StorageError> {
        crate::ai::save_connection_profile(&self.connection, profile)
    }

    pub fn delete_connection_profile(&self, id: &str) -> Result<(), StorageError> {
        crate::ai::delete_connection_profile(&self.connection, id)
    }

    pub fn set_primary_connection_profile(&self, id: &str) -> Result<(), StorageError> {
        crate::ai::set_primary_connection_profile(&self.connection, id)
    }

    pub fn get_fallback_policy(&self) -> Result<crate::ai::FallbackPolicy, StorageError> {
        crate::ai::get_fallback_policy(&self.connection)
    }

    pub fn save_fallback_policy(
        &self,
        policy: &crate::ai::FallbackPolicy,
    ) -> Result<(), StorageError> {
        crate::ai::save_fallback_policy(&self.connection, policy)
    }

    pub fn get_router_connection(&self) -> Result<crate::ai::RouterConnection, StorageError> {
        crate::ai::get_router_connection(&self.connection)
    }

    pub fn save_router_connection(
        &self,
        router: &crate::ai::RouterConnection,
    ) -> Result<(), StorageError> {
        crate::ai::save_router_connection(&self.connection, router)
    }

    pub fn record_task_attempt(
        &self,
        attempt: &crate::ai::TaskAttempt,
    ) -> Result<(), StorageError> {
        crate::ai::record_task_attempt(&self.connection, attempt)
    }

    pub fn list_chat_threads(&self) -> Result<Vec<crate::ai::ChatThread>, StorageError> {
        crate::ai::list_threads(&self.connection)
    }

    pub fn create_chat_thread(
        &self,
        title: &str,
        provider_id: Option<&str>,
        model: &str,
        system_prompt: Option<&str>,
    ) -> Result<crate::ai::ChatThread, StorageError> {
        crate::ai::create_thread(&self.connection, title, provider_id, model, system_prompt)
    }

    pub fn rename_chat_thread(&self, id: &str, title: &str) -> Result<(), StorageError> {
        crate::ai::rename_thread(&self.connection, id, title)
    }

    pub fn delete_chat_thread(&self, id: &str) -> Result<(), StorageError> {
        crate::ai::delete_thread(&self.connection, id)
    }

    pub fn list_chat_messages(
        &self,
        thread_id: &str,
    ) -> Result<Vec<crate::ai::ChatMessage>, StorageError> {
        crate::ai::list_messages(&self.connection, thread_id)
    }

    pub fn add_chat_message(
        &self,
        thread_id: &str,
        role: &str,
        content: &str,
        tool_calls: Option<&serde_json::Value>,
        tool_results: Option<&serde_json::Value>,
        token_usage: Option<&serde_json::Value>,
    ) -> Result<crate::ai::ChatMessage, StorageError> {
        crate::ai::add_message(
            &self.connection,
            thread_id,
            role,
            content,
            tool_calls,
            tool_results,
            token_usage,
        )
    }

    pub fn list_mcp_connectors(
        &self,
    ) -> Result<Vec<crate::connectors::McpConnectorConfig>, StorageError> {
        crate::connectors::list_connectors(&self.connection)
    }

    pub fn save_mcp_connector(
        &self,
        config: &crate::connectors::McpConnectorConfig,
    ) -> Result<(), StorageError> {
        crate::connectors::save_connector(&self.connection, config)
    }

    pub fn toggle_mcp_connector(&self, id: &str, enabled: bool) -> Result<(), StorageError> {
        crate::connectors::toggle_connector(&self.connection, id, enabled)
    }

    pub fn delete_mcp_connector(&self, id: &str) -> Result<(), StorageError> {
        crate::connectors::delete_connector(&self.connection, id)
    }
}

pub(crate) fn next_id(prefix: &str) -> String {
    let sequence = ID_SEQUENCE.fetch_add(1, Ordering::Relaxed);
    format!("{prefix}-{}-{sequence}", now_string())
}

pub(crate) fn now_string() -> String {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_millis().to_string())
        .unwrap_or_else(|_| "0".to_owned())
}
