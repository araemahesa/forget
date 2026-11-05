use crate::storage::{next_id, now_string, Storage, StorageError};
use rusqlite::{params, Connection, OptionalExtension};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};

pub const ENGINE_VERSION: i64 = 1;

fn invalid(message: &str) -> StorageError {
    StorageError::InvalidInput(message.into())
}

pub fn validate_snapshot(kind: &str, spec: &Value) -> Result<(), StorageError> {
    let (texts, numbers, booleans): (&[&str], &[&str], &[&str]) = match kind {
        "icon" => (
            &[
                "name",
                "glyph",
                "shape",
                "style",
                "background",
                "primaryColor",
                "secondaryColor",
            ],
            &["strokeWidth", "padding", "size"],
            &[],
        ),
        "texture" => (
            &["name", "pattern", "baseColor", "accentColor"],
            &["roughness", "metalness", "scale", "seed", "resolution"],
            &[],
        ),
        "clothing" => (
            &[
                "name",
                "kind",
                "baseColor",
                "accentColor",
                "pattern",
                "neckStyle",
                "cuffColor",
            ],
            &[],
            &["shading", "pocket", "templateGuide"],
        ),
        "sfx" => (
            &["name", "category", "waveform"],
            &[
                "durationMs",
                "frequencyStart",
                "frequencyEnd",
                "noiseMix",
                "attackMs",
                "decayMs",
                "sustain",
                "releaseMs",
                "filterCutoff",
                "volume",
                "seed",
            ],
            &["loop"],
        ),
        _ => return Err(invalid("Jenis kreator tidak didukung")),
    };
    if spec["schemaVersion"] != 1
        || spec
            .as_object()
            .is_none_or(|object| object.len() != texts.len() + numbers.len() + booleans.len() + 1)
        || texts
            .iter()
            .any(|key| spec[key].as_str().is_none_or(|text| text.len() > 8192))
        || numbers.iter().any(|key| {
            spec[key]
                .as_f64()
                .is_none_or(|n| !n.is_finite() || n.abs() > 1_000_000.0)
        })
        || booleans.iter().any(|key| !spec[key].is_boolean())
    {
        return Err(invalid("Struktur draf tidak sah atau melampaui batas"));
    }
    // Unfinished text/colors/numbers remain drafts; builders validate before execution.
    Ok(())
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CreatorDraft {
    pub kind: String,
    pub spec: Value,
    pub baseline_version_id: Option<String>,
    pub engine_version: i64,
    pub revision: i64,
    pub updated_at: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkTask {
    pub id: String,
    pub kind: String,
    pub action: String,
    pub input: Value,
    pub engine_version: i64,
    pub status: String,
    pub stage: String,
    pub receipt: Option<Value>,
    pub error: Option<String>,
    pub created_at: String,
    pub updated_at: String,
    pub events: Vec<WorkEvent>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkEvent {
    pub sequence: i64,
    pub status: String,
    pub stage: String,
    pub receipt: Option<Value>,
    pub created_at: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LibraryEntry {
    pub id: String,
    pub kind: String,
    pub name: String,
    pub sequence: i64,
    pub created_at: String,
    pub deleted_at: Option<String>,
}

pub(crate) fn record_event(connection: &Connection, id: &str) -> Result<(), StorageError> {
    connection.execute(
        "INSERT INTO work_event SELECT id,
         (SELECT COALESCE(MAX(sequence), 0) + 1 FROM work_event WHERE task_id = ?1),
         status, stage, receipt_json, updated_at FROM work_task WHERE id = ?1",
        [id],
    )?;
    Ok(())
}

pub(crate) fn json_values_equal(a: &Value, b: &Value) -> bool {
    match (a, b) {
        (Value::Null, Value::Null) => true,
        (Value::Bool(a), Value::Bool(b)) => a == b,
        (Value::Number(a), Value::Number(b)) => {
            if a == b {
                true
            } else if let (Some(a_f), Some(b_f)) = (a.as_f64(), b.as_f64()) {
                (a_f - b_f).abs() < 1e-6
            } else {
                false
            }
        }
        (Value::String(a), Value::String(b)) => a == b,
        (Value::Array(a), Value::Array(b)) => {
            a.len() == b.len() && a.iter().zip(b.iter()).all(|(x, y)| json_values_equal(x, y))
        }
        (Value::Object(a), Value::Object(b)) => {
            a.len() == b.len()
                && a.iter()
                    .all(|(k, v)| b.get(k).is_some_and(|bv| json_values_equal(v, bv)))
        }
        _ => false,
    }
}

pub(crate) fn complete_save(
    connection: &Connection,
    id: Option<&str>,
    kind: &str,
    spec: &Value,
    version_id: &str,
) -> Result<(), StorageError> {
    let Some(id) = id else {
        return Ok(());
    };
    let input: String = connection.query_row(
        "SELECT input_json FROM work_task WHERE id = ?1 AND kind = ?2 AND action IN ('save', 'export') AND status = 'running'",
        params![id, kind], |row| row.get(0),
    ).optional()?.ok_or_else(|| invalid("Tugas penyimpanan tidak aktif atau dibatalkan"))?;
    let input_value: Value = serde_json::from_str(&input)?;
    if !json_values_equal(&input_value, spec) {
        return Err(invalid("Input tugas berbeda dengan dokumen"));
    }
    let receipt = json!({ "versionId": version_id });
    connection.execute(
        "UPDATE work_task SET status = CASE WHEN action = 'save' THEN 'succeeded' ELSE status END,
         stage = 'version_saved', receipt_json = ?2, updated_at = ?3 WHERE id = ?1",
        params![id, receipt.to_string(), now_string()],
    )?;
    record_event(connection, id)
}

impl Storage {
    fn version_exists(&self, kind: &str, id: &str) -> Result<bool, StorageError> {
        let query = match kind {
            "gfx" => "SELECT 1 FROM gfx_version WHERE id = ?1",
            "sfx" => "SELECT 1 FROM sfx_version WHERE id = ?1",
            "icon" | "texture" | "clothing" => {
                "SELECT 1 FROM image_version WHERE id = ?1 AND kind = ?2"
            }
            _ => return Err(invalid("Jenis koleksi tidak didukung")),
        };
        let mut statement = self.connection.prepare(query)?;
        let mut rows = if matches!(kind, "gfx" | "sfx") {
            statement.query([id])?
        } else {
            statement.query(params![id, kind])?
        };
        Ok(rows.next()?.is_some())
    }

    pub fn load_creator_draft(&self, kind: &str) -> Result<Option<CreatorDraft>, StorageError> {
        let draft = self.connection.query_row(
            "SELECT spec_json, baseline_version_id, engine_version, revision, updated_at FROM creator_draft WHERE kind = ?1",
            [kind], |row| Ok((row.get::<_, String>(0)?, row.get(1)?, row.get::<_, i64>(2)?, row.get(3)?, row.get(4)?)),
        ).optional()?;
        draft
            .map(
                |(spec, baseline_version_id, engine_version, revision, updated_at)| {
                    let spec = serde_json::from_str(&spec)?;
                    validate_snapshot(kind, &spec)?;
                    if engine_version != ENGINE_VERSION {
                        return Err(invalid(
                            "Versi engine draf tidak didukung. Draf asli dipertahankan.",
                        ));
                    }
                    Ok(CreatorDraft {
                        kind: kind.into(),
                        spec,
                        baseline_version_id,
                        engine_version,
                        revision,
                        updated_at,
                    })
                },
            )
            .transpose()
    }

    pub fn save_creator_draft(&self, draft: &CreatorDraft) -> Result<CreatorDraft, StorageError> {
        validate_snapshot(&draft.kind, &draft.spec)?;
        if draft.engine_version != ENGINE_VERSION || !(0..i64::MAX).contains(&draft.revision) {
            return Err(invalid("Revisi atau versi engine tidak didukung"));
        }
        if let Some(id) = &draft.baseline_version_id {
            if !self.version_exists(&draft.kind, id)? {
                return Err(StorageError::NotFound(id.clone()));
            }
        }
        let stamp = now_string();
        let changed = if draft.revision == 0 {
            self.connection.execute(
                "INSERT OR IGNORE INTO creator_draft VALUES (?1, ?2, ?3, ?4, 1, ?5)",
                params![
                    draft.kind,
                    draft.spec.to_string(),
                    draft.baseline_version_id,
                    draft.engine_version,
                    stamp
                ],
            )?
        } else {
            self.connection.execute(
                "UPDATE creator_draft SET spec_json = ?2, baseline_version_id = ?3, revision = revision + 1, updated_at = ?5
                 WHERE kind = ?1 AND revision = ?4 AND engine_version = 1",
                params![draft.kind, draft.spec.to_string(), draft.baseline_version_id, draft.revision, stamp],
            )?
        };
        if changed != 1 {
            return Err(StorageError::Conflict);
        }
        self.load_creator_draft(&draft.kind)?
            .ok_or_else(|| invalid("Draf gagal dibaca"))
    }

    pub fn create_work_task(
        &self,
        kind: &str,
        action: &str,
        input: &Value,
    ) -> Result<WorkTask, StorageError> {
        validate_snapshot(kind, input)?;
        if !matches!(action, "render" | "save" | "export" | "open") {
            return Err(invalid("Operasi tugas tidak didukung"));
        }
        let id = next_id("work");
        let transaction = self.connection.unchecked_transaction()?;
        transaction.execute(
            "INSERT INTO work_task VALUES (?1, ?2, ?3, ?4, 1, 'queued', 'queued', NULL, NULL, ?5, ?5)",
            params![id, kind, action, input.to_string(), now_string()],
        )?;
        record_event(&transaction, &id)?;
        transaction.commit()?;
        self.get_work_task(&id)
    }

    pub fn update_work_task(
        &self,
        id: &str,
        status: &str,
        stage: &str,
        receipt: Option<Value>,
        error: Option<String>,
    ) -> Result<WorkTask, StorageError> {
        if !matches!(
            stage,
            "queued"
                | "validating"
                | "rendering"
                | "rasterizing"
                | "saving"
                | "version_saved"
                | "exporting"
                | "opening"
                | "complete"
                | "stopped"
        ) || receipt
            .as_ref()
            .is_some_and(|r| r.to_string().len() > 8192 || !r.is_object())
            || error.as_ref().is_some_and(|text| text.len() > 4096)
        {
            return Err(invalid("Checkpoint melampaui batas"));
        }
        let transaction = self.connection.unchecked_transaction()?;
        let current = self.get_work_task(id)?;
        if current.events.len() >= 128 && status == "running" {
            return Err(invalid("Batas checkpoint tugas tercapai"));
        }
        let allowed = match current.status.as_str() {
            "queued" => matches!(status, "running" | "cancel_requested" | "failed"),
            "running" => matches!(
                status,
                "running" | "cancel_requested" | "failed" | "succeeded"
            ),
            "cancel_requested" => matches!(status, "cancel_requested" | "cancelled" | "failed"),
            _ => false,
        };
        if !allowed {
            return Err(invalid("Transisi tugas tidak sah"));
        }
        if status == "running" && current.status == "queued" {
            let active: i64 = transaction.query_row(
                "SELECT COUNT(*) FROM work_task WHERE kind = ?1 AND id != ?2 AND status IN ('running', 'cancel_requested')",
                params![current.kind, id], |row| row.get(0),
            )?;
            if active > 0 {
                return Err(invalid("Kreator masih menjalankan tugas lain"));
            }
        }
        if status == "succeeded" && current.action == "save" {
            return Err(invalid("Penyimpanan hanya selesai lewat transaksi versi"));
        }
        let receipt = receipt.or(current.receipt);
        transaction.execute(
            "UPDATE work_task SET status = ?2, stage = ?3, receipt_json = ?4, error = ?5, updated_at = ?6 WHERE id = ?1",
            params![id, status, stage, receipt.map(|r| r.to_string()), error, now_string()],
        )?;
        record_event(&transaction, id)?;
        transaction.commit()?;
        self.get_work_task(id)
    }

    pub fn get_work_task(&self, id: &str) -> Result<WorkTask, StorageError> {
        let mut task = self.connection.query_row(
            "SELECT kind, action, input_json, engine_version, status, stage, receipt_json, error, created_at, updated_at FROM work_task WHERE id = ?1",
            [id], |row| Ok(WorkTask { id: id.into(), kind: row.get(0)?, action: row.get(1)?, input: Value::Null,
                engine_version: row.get(3)?, status: row.get(4)?, stage: row.get(5)?, receipt: None, error: row.get(7)?,
                created_at: row.get(8)?, updated_at: row.get(9)?, events: Vec::new() })
                .map(|task| (task, row.get::<_, String>(2), row.get::<_, Option<String>>(6))),
        ).optional()?.ok_or_else(|| StorageError::NotFound(id.into()))?;
        task.0.input = serde_json::from_str(&task.1?)?;
        task.0.receipt = task.2?.map(|r| serde_json::from_str(&r)).transpose()?;
        let mut statement = self.connection.prepare("SELECT sequence, status, stage, receipt_json, created_at FROM work_event WHERE task_id = ?1 ORDER BY sequence")?;
        let rows = statement.query_map([id], |row| {
            Ok((
                row.get(0)?,
                row.get(1)?,
                row.get(2)?,
                row.get::<_, Option<String>>(3)?,
                row.get(4)?,
            ))
        })?;
        for row in rows {
            let (sequence, status, stage, receipt, created_at) = row?;
            task.0.events.push(WorkEvent {
                sequence,
                status,
                stage,
                receipt: receipt.map(|r| serde_json::from_str(&r)).transpose()?,
                created_at,
            });
        }
        Ok(task.0)
    }

    pub fn list_work_tasks(&self) -> Result<Vec<WorkTask>, StorageError> {
        let mut statement = self.connection.prepare(
            "SELECT id FROM work_task ORDER BY CAST(updated_at AS INTEGER) DESC, id DESC LIMIT 100",
        )?;
        let ids = statement
            .query_map([], |row| row.get::<_, String>(0))?
            .collect::<Result<Vec<_>, _>>()?;
        ids.iter().map(|id| self.get_work_task(id)).collect()
    }

    pub fn list_library(
        &self,
        query: &str,
        kind: &str,
        deleted: bool,
        offset: i64,
    ) -> Result<Vec<LibraryEntry>, StorageError> {
        if query.len() > 512
            || !(0..=1_000_000).contains(&offset)
            || !matches!(
                kind,
                "all" | "gfx" | "sfx" | "icon" | "texture" | "clothing"
            )
        {
            return Err(invalid("Filter koleksi tidak sah"));
        }
        let mut statement = self.connection.prepare(
            "WITH versions AS (
                SELECT id, 'gfx' AS kind, json_extract(spec_json, '$.title') AS name, sequence, created_at FROM gfx_version WHERE EXISTS (SELECT 1 FROM artifact WHERE version_id = gfx_version.id)
                UNION ALL SELECT id, 'sfx', json_extract(recipe_json, '$.name'), sequence, created_at FROM sfx_version
                UNION ALL SELECT id, kind, json_extract(spec_json, '$.name'), sequence, created_at FROM image_version
            ) SELECT v.id, v.kind, v.name, v.sequence, v.created_at, d.deleted_at FROM versions v
              LEFT JOIN library_visibility d ON d.kind = v.kind AND d.version_id = v.id
              WHERE (?1 = 'all' OR v.kind = ?1) AND instr(lower(v.name), lower(?2)) > 0
                AND ((?3 = 0 AND d.deleted_at IS NULL) OR (?3 = 1 AND d.deleted_at IS NOT NULL))
              ORDER BY CAST(v.created_at AS INTEGER) DESC, v.kind, v.id DESC LIMIT 50 OFFSET ?4",
        )?;
        let entries = statement
            .query_map(params![kind, query, deleted, offset], |row| {
                Ok(LibraryEntry {
                    id: row.get(0)?,
                    kind: row.get(1)?,
                    name: row.get(2)?,
                    sequence: row.get(3)?,
                    created_at: row.get(4)?,
                    deleted_at: row.get(5)?,
                })
            })?
            .collect::<Result<Vec<_>, _>>()?;
        Ok(entries)
    }

    pub fn set_library_deleted(
        &self,
        kind: &str,
        id: &str,
        deleted: bool,
    ) -> Result<(), StorageError> {
        if !self.version_exists(kind, id)? {
            return Err(StorageError::NotFound(id.into()));
        }
        if deleted {
            self.connection.execute("INSERT INTO library_visibility VALUES (?1, ?2, ?3) ON CONFLICT(kind, version_id) DO UPDATE SET deleted_at = excluded.deleted_at", params![kind, id, now_string()])?;
        } else {
            self.connection.execute(
                "DELETE FROM library_visibility WHERE kind = ?1 AND version_id = ?2",
                params![kind, id],
            )?;
        }
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn test_json_values_equal_numbers() {
        assert!(json_values_equal(&json!(2), &json!(2.0)));
        assert!(json_values_equal(&json!(2.0), &json!(2)));
        assert!(json_values_equal(&json!(140), &json!(140.0)));
        assert!(!json_values_equal(&json!(2), &json!(3)));
        assert!(!json_values_equal(&json!(2), &json!(2.5)));
    }

    #[test]
    fn test_json_values_equal_objects() {
        let a = json!({ "durationMs": 200, "nested": { "seed": 42 } });
        let b = json!({ "durationMs": 200.0, "nested": { "seed": 42.0 } });
        assert!(json_values_equal(&a, &b));
        let c = json!({ "durationMs": 201, "nested": { "seed": 42 } });
        assert!(!json_values_equal(&a, &c));
    }
}
