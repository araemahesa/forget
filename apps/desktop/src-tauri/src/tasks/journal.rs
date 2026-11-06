use crate::ai::{self, AiProviderProfile, ChatMessage};
use crate::artifacts::sha256_hex;
use crate::storage::{now_string, Storage, StorageError};
use rusqlite::{params, Connection, OptionalExtension};
use serde_json::{json, Value};

fn invalid(message: &str) -> StorageError {
    StorageError::InvalidInput(message.into())
}

// Keep the existing table names so old creative versions retain their foreign keys.
pub(crate) fn begin(
    connection: &Connection,
    id: &str,
    snapshot: &Value,
) -> Result<(), StorageError> {
    let serialized = serde_json::to_string(snapshot)?;
    connection.execute(
        "INSERT INTO creative_task (id,request_json,request_hash,status,created_at,updated_at)
         VALUES (?1,?2,?3,'queued',?4,?4)",
        params![
            id,
            serialized,
            sha256_hex(serialized.as_bytes()),
            now_string()
        ],
    )?;
    event(connection, id)
}

pub(crate) fn event(connection: &Connection, id: &str) -> Result<(), StorageError> {
    connection.execute(
        "INSERT INTO creative_event SELECT id,
         (SELECT COALESCE(MAX(sequence),0)+1 FROM creative_event WHERE task_id=?1),
         status,updated_at FROM creative_task WHERE id=?1",
        [id],
    )?;
    Ok(())
}

pub(crate) fn stage(
    connection: &Connection,
    id: &str,
    next: &str,
    error: Option<&str>,
) -> Result<(), StorageError> {
    let (current, kind): (String, String) = connection.query_row(
        "SELECT status,json_extract(request_json,'$.kind') FROM creative_task WHERE id=?1",
        [id],
        |r| Ok((r.get(0)?, r.get(1)?)),
    )?;
    // Routing can select another account before any output. It re-enters the
    // same provider phase without creating a second journal transition.
    if current == "streaming" && next == "streaming" && error.is_none() {
        return Ok(());
    }
    let allowed = matches!(
        (current.as_str(), next),
        ("queued", "planning")
            | ("planning", "validating" | "tool_running" | "streaming")
            | ("tool_running", "planning" | "validating" | "streaming")
            | ("streaming", "tool_running" | "validating")
            | (
                "queued"
                    | "planning"
                    | "validating"
                    | "streaming"
                    | "reading_context"
                    | "tool_running",
                "failed" | "cancelled" | "interrupted"
            )
    ) || kind == "chat"
        && matches!(
            (current.as_str(), next),
            ("planning", "streaming" | "reading_context")
                | ("reading_context", "streaming")
                | ("streaming", "tool_running" | "validating")
                | ("tool_running" | "validating", "streaming")
                | ("streaming", "completed")
                | ("failed" | "cancelled" | "interrupted", "planning")
        );
    if !allowed || error.is_some_and(|s| s.len() > 4096) {
        return Err(invalid("Transisi task tidak sah."));
    }
    connection.execute(
        "UPDATE creative_task SET status=?2,error=?3,updated_at=?4 WHERE id=?1",
        params![id, next, error, now_string()],
    )?;
    event(connection, id)
}

impl Storage {
    pub fn record_tool_receipt(
        &self,
        task: &str,
        receipt: &crate::tools::ToolReceipt,
    ) -> Result<crate::tools::ToolReceipt, StorageError> {
        let transaction = self.connection.unchecked_transaction()?;
        let context_id: Option<String> = transaction.query_row(
            "SELECT json_extract(request_json,'$.contextSnapshotId') FROM creative_task WHERE id=?1 AND status='tool_running'",
            [task], |r| r.get(0),
        )?;
        if context_id.as_deref() != Some(&receipt.snapshot_id) || !receipt.read_only {
            return Err(invalid("Receipt tool di luar scope task."));
        }
        let prior: Option<(String, String)> = transaction.query_row(
            "SELECT request_hash,receipt_json FROM tool_receipt WHERE task_id=?1 AND call_id=?2",
            params![task, receipt.call_id], |r| Ok((r.get(0)?,r.get(1)?)),
        ).optional()?;
        if let Some((hash, encoded)) = prior {
            if hash != receipt.request_hash {
                return Err(invalid("ID tool call sudah dipakai dengan input berbeda."));
            }
            return Ok(serde_json::from_str(&encoded)?);
        }
        transaction.execute(
            "INSERT INTO tool_receipt SELECT ?1,COALESCE(MAX(sequence),0)+1,?2,?3,?4 FROM tool_receipt WHERE task_id=?1",
            params![task,receipt.call_id,receipt.request_hash,serde_json::to_string(receipt)?],
        )?;
        transaction.commit()?;
        Ok(receipt.clone())
    }

    pub fn begin_agent_tool(
        &self,
        task: &str,
        studio: &str,
        call: &crate::tools::ToolCall,
    ) -> Result<Option<Value>, StorageError> {
        let hash = sha256_hex(format!("{studio}:{}", serde_json::to_string(call)?).as_bytes());
        let tx = self.connection.unchecked_transaction()?;
        let status: String = tx.query_row(
            "SELECT status FROM creative_task WHERE id=?1",
            [task],
            |r| r.get(0),
        )?;
        if status != "tool_running" {
            return Err(invalid("Task tool tidak aktif."));
        }
        let target: Option<String> = tx.query_row(
            "SELECT json_extract(request_json,'$.studioId') FROM creative_task WHERE id=?1",
            [task],
            |r| r.get(0),
        )?;
        if target.as_deref() != Some(studio) {
            return Err(invalid("Target operasi berbeda dari target tugas."));
        }
        let prior: Option<(String, String)> = tx.query_row("SELECT request_hash,receipt_json FROM tool_receipt WHERE task_id=?1 AND call_id=?2", params![task,call.id], |r| Ok((r.get(0)?,r.get(1)?))).optional()?;
        if let Some((stored, encoded)) = prior {
            let receipt: Value = serde_json::from_str(&encoded)?;
            let receipt_status = receipt.get("status").and_then(Value::as_str).unwrap_or("");
            if receipt_status == "completed" {
                if stored != hash {
                    return Err(invalid("ID operasi dipakai dengan input berbeda."));
                }
                return Ok(Some(receipt["output"].clone()));
            } else if receipt_status == "not_executed" {
                let new_receipt = json!({
                    "kind": "studio",
                    "callId": call.id,
                    "name": call.name,
                    "studioId": studio,
                    "readOnly": !crate::studio::is_write(&call.name),
                    "status": "running",
                    "startedAt": now_string()
                });
                tx.execute(
                    "UPDATE tool_receipt SET request_hash=?3, receipt_json=?4 WHERE task_id=?1 AND call_id=?2",
                    params![task, call.id, hash, new_receipt.to_string()],
                )?;
                tx.commit()?;
                return Ok(None);
            } else {
                return Err(invalid(
                    "[UNKNOWN_RESULT] Operasi sudah dimulai dan hasil belum pasti; tidak diulang.",
                ));
            }
        }
        let receipt = json!({"kind":"studio","callId":call.id,"name":call.name,"studioId":studio,"readOnly":!crate::studio::is_write(&call.name),"status":"running","startedAt":now_string()});
        tx.execute("INSERT INTO tool_receipt SELECT ?1,COALESCE(MAX(sequence),0)+1,?2,?3,?4 FROM tool_receipt WHERE task_id=?1",params![task,call.id,hash,receipt.to_string()])?;
        tx.commit()?;
        Ok(None)
    }
    pub fn finish_agent_tool(
        &self,
        task: &str,
        call: &str,
        result: &Result<Value, String>,
    ) -> Result<(), StorageError> {
        self.finish_agent_tool_with_status(task, call, result, false)
    }

    pub fn finish_agent_tool_with_status(
        &self,
        task: &str,
        call: &str,
        result: &Result<Value, String>,
        not_executed: bool,
    ) -> Result<(), StorageError> {
        let encoded: String = self.connection.query_row(
            "SELECT receipt_json FROM tool_receipt WHERE task_id=?1 AND call_id=?2",
            params![task, call],
            |r| r.get(0),
        )?;
        let mut receipt: Value = serde_json::from_str(&encoded)?;
        if receipt["status"] != "running" {
            return Err(invalid("Operasi tool sudah diselesaikan."));
        }
        receipt["completedAt"] = json!(now_string());
        match result {
            Ok(value) => {
                receipt["status"] = json!(if value["isError"] == true {
                    "tool_error"
                } else {
                    "completed"
                });
                receipt["output"] = value.clone();
            }
            Err(error) => {
                receipt["status"] = json!(if not_executed { "not_executed" } else { "unknown" });
                receipt["error"] = json!(error);
            }
        }
        self.connection.execute(
            "UPDATE tool_receipt SET receipt_json=?3 WHERE task_id=?1 AND call_id=?2",
            params![task, call, receipt.to_string()],
        )?;
        Ok(())
    }

    pub(crate) fn tool_receipts(&self, id: &str) -> Result<Vec<Value>, StorageError> {
        let encoded = self
            .connection
            .prepare("SELECT receipt_json FROM tool_receipt WHERE task_id=?1 ORDER BY sequence")?
            .query_map([id], |r| r.get::<_, String>(0))?
            .collect::<Result<Vec<_>, _>>()?;
        encoded
            .iter()
            .map(|value| serde_json::from_str(value).map_err(Into::into))
            .collect()
    }

    pub fn begin_chat_turn(
        &self,
        id: &str,
        thread: &str,
        prompt: &str,
        provider: &AiProviderProfile,
        mode: &str,
        context_id: Option<&str>,
    ) -> Result<Option<ChatMessage>, StorageError> {
        self.begin_agent_turn(id, thread, prompt, provider, mode, context_id, None)
    }

    pub fn begin_agent_turn(
        &self,
        id: &str,
        thread: &str,
        prompt: &str,
        provider: &AiProviderProfile,
        mode: &str,
        context_id: Option<&str>,
        studio_id: Option<&str>,
    ) -> Result<Option<ChatMessage>, StorageError> {
        self.begin_artifact_turn(id, thread, prompt, provider, mode, context_id, studio_id, None)
    }

    pub fn begin_artifact_turn(
        &self, id: &str, thread: &str, prompt: &str, provider: &AiProviderProfile,
        mode: &str, context_id: Option<&str>, studio_id: Option<&str>,
        attachment: Option<(&str, &str)>,
    ) -> Result<Option<ChatMessage>, StorageError> {
        self.begin_reference_turn(id, thread, prompt, provider, mode, context_id, studio_id, attachment, &[])
    }
    pub fn begin_reference_turn(
        &self, id: &str, thread: &str, prompt: &str, provider: &AiProviderProfile,
        mode: &str, context_id: Option<&str>, studio_id: Option<&str>, attachment: Option<(&str, &str)>,
        images: &[crate::references::ReferenceImage],
    ) -> Result<Option<ChatMessage>, StorageError> {
        crate::references::validate(images).map_err(StorageError::InvalidInput)?;

        if id.is_empty()
            || id.len() > 128
            || id.chars().any(char::is_control)
            || prompt.trim().is_empty()
            || prompt.len() > 128000
            || !matches!(mode, "auto" | "ask" | "plan")
        {
            return Err(invalid("Input percakapan tidak sah."));
        }
        ai::validate_profile(provider).map_err(StorageError::InvalidInput)?;
        let mut snapshot = json!({
            "id":id, "kind":"chat", "origin":"ai", "threadId":thread, "prompt":prompt, "mode":mode,
            "provider":{"profileId":provider.id,"adapterId":provider.provider_type,
                "modelId":provider.model,"endpoint":provider.base_url},
        });
        if let Some(effort) = &provider.reasoning_effort {
            snapshot["provider"]["reasoningEffort"] = json!(effort);
        }
        if let Some(id) = context_id {
            if id.is_empty() || id.len() > 128 || id.chars().any(char::is_control) {
                return Err(invalid("ID snapshot tidak sah."));
            }
            snapshot["contextSnapshotId"] = json!(id);
        }
        if let Some(target) = studio_id {
            snapshot["studioId"] = json!(target);
        }
        if let Some((version, kind)) = attachment {
            snapshot["creativeVersionId"] = json!(version);
            snapshot["skills"] = json!(crate::agent::skill_snapshots(prompt, kind, true));
        }
        if !images.is_empty() { snapshot["referenceImages"] = json!(images); }
        let hash = sha256_hex(serde_json::to_string(&snapshot)?.as_bytes());
        let transaction = self.connection.unchecked_transaction()?;
        let prior: Option<(String, String)> = transaction
            .query_row(
                "SELECT request_hash,status FROM creative_task WHERE id=?1",
                [id],
                |r| Ok((r.get(0)?, r.get(1)?)),
            )
            .optional()?;
        if let Some((stored_hash, status)) = prior {
            if hash != stored_hash {
                return Err(invalid(
                    "ID permintaan sudah dipakai dengan input atau provider berbeda.",
                ));
            }
            if status == "completed" {
                let assistant: String = transaction.query_row(
                    "SELECT assistant_message_id FROM chat_turn WHERE request_id=?1",
                    [id],
                    |r| r.get(0),
                )?;
                return ai::list_messages(&transaction, thread)?
                    .into_iter()
                    .find(|m| m.id == assistant)
                    .map(Some)
                    .ok_or_else(|| invalid("Receipt percakapan tidak ditemukan."));
            }
            let writes: u32 = transaction.query_row("SELECT COUNT(*) FROM tool_receipt WHERE task_id=?1 AND json_extract(receipt_json,'$.kind')='studio' AND json_extract(receipt_json,'$.readOnly')=0", [id], |r| r.get(0))?;
            if writes > 0 {
                return Err(invalid("[UNKNOWN_RESULT] Tugas sudah memulai perubahan Studio. Periksa hasil map sebelum mengirim instruksi baru; perubahan tidak diputar ulang otomatis."));
            }
            let latest: Option<String> = transaction
                .query_row(
                    "SELECT id FROM chat_message WHERE thread_id=?1 ORDER BY sequence DESC LIMIT 1",
                    [thread],
                    |r| r.get(0),
                )
                .optional()?;
            let input: String = transaction.query_row(
                "SELECT user_message_id FROM chat_turn WHERE request_id=?1",
                [id],
                |r| r.get(0),
            )?;
            if latest.as_deref() != Some(input.as_str()) {
                return Err(invalid(
                    "Percakapan sudah berubah. Kirim pesan baru untuk melanjutkan.",
                ));
            }
            stage(&transaction, id, "planning", None)?;
        } else {
            // A thread remembered by an older window may be gone; say so instead of a raw SQLite error.
            let exists: bool = transaction.query_row("SELECT EXISTS(SELECT 1 FROM chat_thread WHERE id=?1)", [thread], |r| r.get(0))?;
            if !exists {
                return Err(invalid("Percakapan ini sudah tidak tersedia. Mulai percakapan baru lalu kirim ulang pesannya."));
            }
            let references = (!images.is_empty()).then(|| json!(images));
            let user = ai::add_message(&transaction, thread, "user", prompt, None, references.as_ref(), None)?;
            begin(&transaction, id, &snapshot)?;
            transaction.execute(
                "INSERT INTO chat_turn VALUES (?1,?2,?3,NULL)",
                params![id, thread, user.id],
            )?;
            stage(&transaction, id, "planning", None)?;
        }
        transaction.commit()?;
        Ok(None)
    }

    pub fn complete_chat_turn(&self, id: &str, content: &str) -> Result<ChatMessage, StorageError> {
        if content.trim().is_empty() || content.len() > 1024 * 1024 {
            return Err(invalid("Respons percakapan kosong atau terlalu besar."));
        }
        let transaction = self.connection.unchecked_transaction()?;
        let (thread, input): (String, String) = transaction.query_row(
            "SELECT thread_id,user_message_id FROM chat_turn WHERE request_id=?1",
            [id],
            |r| Ok((r.get(0)?, r.get(1)?)),
        )?;
        let latest: String = transaction.query_row(
            "SELECT id FROM chat_message WHERE thread_id=?1 ORDER BY sequence DESC LIMIT 1",
            [&thread],
            |r| r.get(0),
        )?;
        if input != latest {
            return Err(invalid("Percakapan berubah sebelum respons disimpan."));
        }
        let context_id: Option<String> = transaction.query_row(
            "SELECT json_extract(request_json,'$.contextSnapshotId') FROM creative_task WHERE id=?1",
            [id], |r| r.get(0),
        )?;
        let mut tool_results = context_id.map(|snapshot| {
            json!([{
                "name":"map.get_tree", "snapshotId":snapshot, "readOnly":true,
            }])
        });
        let receipts = self.tool_receipts(id)?;
        if !receipts.is_empty() {
            tool_results
                .get_or_insert_with(|| json!([]))
                .as_array_mut()
                .expect("tool results array")
                .extend(receipts);
        }
        stage(&transaction, id, "completed", None)?;
        let response = ai::add_message(
            &transaction,
            &thread,
            "assistant",
            content,
            None,
            tool_results.as_ref(),
            None,
        )?;
        transaction.execute(
            "UPDATE chat_turn SET assistant_message_id=?2 WHERE request_id=?1",
            params![id, response.id],
        )?;
        transaction.commit()?;
        Ok(response)
    }

    pub fn latest_chat_turn(&self, thread: &str) -> Result<Option<Value>, StorageError> {
        let id: Option<String> = self
            .connection
            .query_row(
                "SELECT request_id FROM chat_turn WHERE thread_id=?1 ORDER BY rowid DESC LIMIT 1",
                [thread],
                |r| r.get(0),
            )
            .optional()?;
        id.map(|id| {
            let mut task = self.get_creative_task(&id)?;
            task["toolResults"] = json!(self.tool_receipts(&id)?);
            Ok(task)
        })
        .transpose()
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::storage::next_id;

    #[test]
    fn creative_provider_phases_allow_generation_and_account_retry_but_not_terminal_reentry() {
        let path = std::env::temp_dir().join(format!("{}.sqlite", next_id("creative-phases")));
        let storage = Storage::open(&path).unwrap();
        for kind in ["model3d", "vfx", "interface"] {
            begin(&storage.connection, kind, &json!({"kind":kind})).unwrap();
            storage.creative_stage(kind, "planning", None).unwrap();
            storage.creative_stage(kind, "streaming", None).unwrap();
            storage.creative_stage(kind, "streaming", None).unwrap();
            storage.creative_stage(kind, "tool_running", None).unwrap();
            storage.creative_stage(kind, "streaming", None).unwrap();
            storage.creative_stage(kind, "validating", None).unwrap();
            assert!(storage.creative_stage(kind, "completed", None).is_err());
            storage.creative_stage(kind, "failed", Some("Fixture")).unwrap();
            assert!(storage.creative_stage(kind, "streaming", None).is_err());
        }
        drop(storage);
        let _ = std::fs::remove_file(path);
    }

    #[test]
    fn agent_operations_pin_target_cache_completed_calls_and_never_replay_unknown_writes() {
        let path = std::env::temp_dir().join(format!("{}.sqlite", next_id("agent-journal")));
        let provider = AiProviderProfile {
            id: "profile".into(),
            name: "Fixture".into(),
            provider_type: "local-llm".into(),
            base_url: "http://127.0.0.1:1234/v1".into(),
            model: "fixture".into(),
            reasoning_effort: None,
            key_reference: "none".into(),
            is_default: false,
            created_at: "1".into(),
            updated_at: "1".into(),
        };
        let storage = Storage::open(&path).unwrap();
        let thread = storage
            .create_chat_thread("Auto", None, "fixture", None)
            .unwrap();
        storage
            .begin_agent_turn(
                "auto",
                &thread.id,
                "Buat gerbang",
                &provider,
                "auto",
                None,
                Some("map-one"),
            )
            .unwrap();
        storage.creative_stage("auto", "streaming", None).unwrap();
        storage
            .creative_stage("auto", "tool_running", None)
            .unwrap();
        let call = crate::tools::ToolCall {
            id: "read-1".into(),
            name: "forgekit_studio_inspect_instance".into(),
            arguments: "{}".into(),
        };
        assert!(storage.begin_agent_tool("auto", "map-two", &call).is_err());
        assert!(storage
            .begin_agent_tool("auto", "map-one", &call)
            .unwrap()
            .is_none());
        assert!(storage.begin_agent_tool("auto", "map-one", &call).is_err());
        let output = json!({"content":[{"type":"text","text":"before"}]});
        storage
            .finish_agent_tool("auto", &call.id, &Ok(output.clone()))
            .unwrap();
        assert_eq!(
            storage.begin_agent_tool("auto", "map-one", &call).unwrap(),
            Some(output)
        );
        let write = crate::tools::ToolCall {
            id: "write-1".into(),
            name: "forgekit_studio_execute_luau".into(),
            arguments: "{}".into(),
        };
        storage.begin_agent_tool("auto", "map-one", &write).unwrap();
        drop(storage); // Simulated process exit after intent was persisted, before an acknowledgement.
        let storage = Storage::open(&path).unwrap();
        assert_eq!(
            storage.latest_chat_turn(&thread.id).unwrap().unwrap()["status"],
            "interrupted"
        );
        let failure = storage
            .begin_agent_turn(
                "auto",
                &thread.id,
                "Buat gerbang",
                &provider,
                "auto",
                None,
                Some("map-one"),
            )
            .unwrap_err()
            .to_string();
        assert!(failure.contains("UNKNOWN_RESULT"));
        assert_eq!(storage.tool_receipts("auto").unwrap().len(), 2);
        assert!(storage
            .begin_agent_turn(
                "auto",
                &thread.id,
                "Buat gerbang",
                &provider,
                "auto",
                None,
                Some("map-two")
            )
            .is_err());
        drop(storage);
        let _ = std::fs::remove_file(path);
    }

    #[test]
    fn not_executed_pre_dispatch_failure_allows_retry_without_locking() {
        let path = std::env::temp_dir().join(format!("{}.sqlite", next_id("not-exec")));
        let storage = Storage::open(&path).unwrap();
        let provider = AiProviderProfile {
            id: "profile".into(),
            name: "Fixture".into(),
            provider_type: "local-llm".into(),
            base_url: "http://127.0.0.1:1234/v1".into(),
            model: "fixture".into(),
            reasoning_effort: None,
            key_reference: "none".into(),
            is_default: false,
            created_at: "1".into(),
            updated_at: "1".into(),
        };
        let thread = storage.create_chat_thread("Retry Test", None, "fixture", None).unwrap();
        storage
            .begin_agent_turn("task-retry", &thread.id, "Uji retry", &provider, "auto", None, Some("map-1"))
            .unwrap();
        storage.creative_stage("task-retry", "streaming", None).unwrap();
        storage.creative_stage("task-retry", "tool_running", None).unwrap();

        let call = crate::tools::ToolCall {
            id: "call-1".into(),
            name: "forgekit_studio_search_game_tree".into(),
            arguments: r#"{"invalid":"args"}"#.into(),
        };

        // First attempt begins running
        assert!(storage.begin_agent_tool("task-retry", "map-1", &call).unwrap().is_none());

        // Fails with pre-dispatch validation error (not_executed = true)
        storage
            .finish_agent_tool_with_status("task-retry", &call.id, &Err("Argumen tool tidak sah".into()), true)
            .unwrap();

        let receipts = storage.tool_receipts("task-retry").unwrap();
        assert_eq!(receipts.len(), 1);
        assert_eq!(receipts[0]["status"], "not_executed");

        // Retrying with fixed arguments does NOT get locked by dedup
        let fixed_call = crate::tools::ToolCall {
            id: "call-1".into(),
            name: "forgekit_studio_search_game_tree".into(),
            arguments: r#"{"path":"Workspace"}"#.into(),
        };
        assert!(storage.begin_agent_tool("task-retry", "map-1", &fixed_call).unwrap().is_none());

        // Now complete it
        let output = json!({"content":[{"type":"text","text":"[]"}]});
        storage
            .finish_agent_tool("task-retry", &call.id, &Ok(output.clone()))
            .unwrap();

        assert_eq!(
            storage.begin_agent_tool("task-retry", "map-1", &fixed_call).unwrap(),
            Some(output)
        );

        drop(storage);
        let _ = std::fs::remove_file(path);
    }

    #[test]
    fn tool_receipts_survive_failure_restart_retry_and_thread_deletion() {
        let path = std::env::temp_dir().join(format!("{}.sqlite", next_id("tool-journal")));
        let storage = Storage::open(&path).unwrap();
        let provider = AiProviderProfile {
            id: "profile".into(),
            name: "Fixture".into(),
            provider_type: "local-llm".into(),
            base_url: "http://127.0.0.1:1234/v1".into(),
            model: "fixture".into(),
            reasoning_effort: None,
            key_reference: "none".into(),
            is_default: false,
            created_at: "1".into(),
            updated_at: "1".into(),
        };
        let thread = storage
            .create_chat_thread("Tools", None, "fixture", None)
            .unwrap();
        storage
            .begin_chat_turn(
                "tools",
                &thread.id,
                "Cari",
                &provider,
                "ask",
                Some("snapshot"),
            )
            .unwrap();
        storage.creative_stage("tools", "streaming", None).unwrap();
        storage
            .creative_stage("tools", "tool_running", None)
            .unwrap();
        let receipt = crate::tools::ToolReceipt {
            call_id: "call".into(),
            name: "map.search".into(),
            implementation_version: "1.0.0".into(),
            snapshot_id: "snapshot".into(),
            content_hash: "a".repeat(64),
            request_hash: "b".repeat(64),
            observed_at: now_string(),
            completed_at: now_string(),
            read_only: true,
            truncated: false,
            matches: vec![],
        };
        let mut invalid = receipt.clone();
        invalid.snapshot_id = "other".into();
        assert!(storage.record_tool_receipt("tools", &invalid).is_err());
        storage.record_tool_receipt("tools", &receipt).unwrap();
        storage.record_tool_receipt("tools", &receipt).unwrap();
        invalid = receipt.clone();
        invalid.request_hash = "c".repeat(64);
        assert!(storage.record_tool_receipt("tools", &invalid).is_err());
        drop(storage);
        let storage = Storage::open(&path).unwrap();
        let task = storage.latest_chat_turn(&thread.id).unwrap().unwrap();
        assert_eq!(task["status"], "interrupted");
        assert_eq!(task["toolResults"].as_array().unwrap().len(), 1);
        storage
            .begin_chat_turn(
                "tools",
                &thread.id,
                "Cari",
                &provider,
                "ask",
                Some("snapshot"),
            )
            .unwrap();
        storage.creative_stage("tools", "streaming", None).unwrap();
        let answer = storage.complete_chat_turn("tools", "Ditemukan.").unwrap();
        assert_eq!(answer.tool_results.unwrap().as_array().unwrap().len(), 2);
        storage.delete_chat_thread(&thread.id).unwrap();
        assert_eq!(
            storage
                .connection
                .query_row("SELECT COUNT(*) FROM tool_receipt", [], |r| r
                    .get::<_, i64>(0))
                .unwrap(),
            0
        );
    }

    #[test]
    fn chat_journal_retries_once_replays_receipts_and_recovers_restart() {
        let path = std::env::temp_dir().join(format!("{}.sqlite", next_id("chat-journal")));
        let profile = AiProviderProfile {
            id: "profile".into(),
            name: "Local".into(),
            provider_type: "local-llm".into(),
            base_url: "http://127.0.0.1:1234/v1".into(),
            model: "fixture".into(),
            reasoning_effort: None,
            key_reference: "none".into(),
            is_default: false,
            created_at: "1".into(),
            updated_at: "1".into(),
        };
        let storage = Storage::open(&path).unwrap();
        let thread = storage
            .create_chat_thread("Test", None, "fixture", None)
            .unwrap();
        let missing = storage
            .begin_chat_turn("orphan", "thread-from-a-wiped-database", "Halo", &profile, "ask", None)
            .unwrap_err().to_string();
        assert!(missing.contains("tidak tersedia") && !missing.contains("FOREIGN KEY"));
        assert!(storage
            .begin_chat_turn("request", &thread.id, "Halo", &profile, "ask", None)
            .unwrap()
            .is_none());
        storage
            .creative_stage("request", "streaming", None)
            .unwrap();
        storage
            .creative_stage("request", "failed", Some("Stream interrupted"))
            .unwrap();
        assert!(storage
            .begin_chat_turn("request", &thread.id, "Changed", &profile, "ask", None)
            .is_err());
        storage
            .begin_chat_turn("request", &thread.id, "Halo", &profile, "ask", None)
            .unwrap();
        assert_eq!(storage.list_chat_messages(&thread.id).unwrap().len(), 1);
        assert!(storage.complete_chat_turn("request", "Too early").is_err());
        storage
            .creative_stage("request", "streaming", None)
            .unwrap();
        let answer = storage.complete_chat_turn("request", "Jawaban").unwrap();
        let replay = storage
            .begin_chat_turn("request", &thread.id, "Halo", &profile, "ask", None)
            .unwrap()
            .unwrap();
        assert_eq!(answer.id, replay.id);
        assert_eq!(storage.list_chat_messages(&thread.id).unwrap().len(), 2);
        storage
            .begin_chat_turn(
                "with-context",
                &thread.id,
                "Map",
                &profile,
                "ask",
                Some("snapshot-one"),
            )
            .unwrap();
        storage
            .creative_stage("with-context", "reading_context", None)
            .unwrap();
        storage
            .creative_stage("with-context", "failed", Some("Retry"))
            .unwrap();
        assert!(storage
            .begin_chat_turn(
                "with-context",
                &thread.id,
                "Map",
                &profile,
                "ask",
                Some("snapshot-two")
            )
            .is_err());
        storage
            .begin_chat_turn(
                "with-context",
                &thread.id,
                "Map",
                &profile,
                "ask",
                Some("snapshot-one"),
            )
            .unwrap();
        storage
            .creative_stage("with-context", "reading_context", None)
            .unwrap();
        storage
            .creative_stage("with-context", "streaming", None)
            .unwrap();
        let contextual = storage
            .complete_chat_turn("with-context", "Hierarki")
            .unwrap();
        assert_eq!(
            contextual.tool_results.unwrap()[0]["snapshotId"],
            "snapshot-one"
        );
        storage
            .begin_chat_turn("interrupted", &thread.id, "Lanjut", &profile, "plan", None)
            .unwrap();
        storage
            .creative_stage("interrupted", "streaming", None)
            .unwrap();
        drop(storage);
        let storage = Storage::open(&path).unwrap();
        let recovered = storage.latest_chat_turn(&thread.id).unwrap().unwrap();
        assert_eq!(recovered["status"], "interrupted");
        storage
            .begin_chat_turn("interrupted", &thread.id, "Lanjut", &profile, "plan", None)
            .unwrap();
        assert_eq!(storage.list_chat_messages(&thread.id).unwrap().len(), 5);
        storage
            .creative_stage("interrupted", "cancelled", None)
            .unwrap();
        ai::add_message(
            &storage.connection,
            &thread.id,
            "user",
            "Pesan baru",
            None,
            None,
            None,
        )
        .unwrap();
        assert!(storage
            .begin_chat_turn("interrupted", &thread.id, "Lanjut", &profile, "plan", None)
            .is_err());
        storage.delete_chat_thread(&thread.id).unwrap();
        assert_eq!(storage.connection.query_row("SELECT COUNT(*) FROM creative_task WHERE json_extract(request_json,'$.kind')='chat'",[],|r|r.get::<_,i64>(0)).unwrap(),0);
    }
}

impl Storage {
pub fn ai_checkpoint(
        &self,
        id: &str,
    ) -> Result<Option<crate::supervisor::Checkpoint>, StorageError> {
        let encoded: Option<String> = self
            .connection
            .query_row(
                "SELECT checkpoint_json FROM ai_checkpoint WHERE task_id=?1",
                [id],
                |r| r.get(0),
            )
            .optional()?;
        encoded
            .map(|s| serde_json::from_str(&s).map_err(Into::into))
            .transpose()
    }
}

impl Storage {
pub fn resume_checkpoint_task(&self, id: &str, verify: bool) -> Result<(), StorageError> {
        let tx = self.connection.unchecked_transaction()?;
        let (status,kind,thread):(String,String,Option<String>)=tx.query_row("SELECT status,json_extract(request_json,'$.kind'),json_extract(request_json,'$.threadId') FROM creative_task WHERE id=?1",[id],|r|Ok((r.get(0)?,r.get(1)?,r.get(2)?)))?;
        let cp = self
            .ai_checkpoint(id)?
            .ok_or_else(|| invalid("Checkpoint tidak tersedia."))?;
        let completed_verify =
            verify && kind == "chat" && status == "completed" && cp.recovery()["canVerify"] == true;
        if !completed_verify
            && !matches!(
                status.as_str(),
                "failed" | "cancelled" | "interrupted" | "awaiting_continuation"
            )
        {
            return Err(invalid("Tugas masih aktif atau telah selesai."));
        }
        if kind == "chat" {
            let input: String = tx.query_row(
                "SELECT user_message_id FROM chat_turn WHERE request_id=?1",
                [id],
                |r| r.get(0),
            )?;
            let latest: String = tx.query_row(
                "SELECT id FROM chat_message WHERE thread_id=?1 ORDER BY sequence DESC LIMIT 1",
                [thread],
                |r| r.get(0),
            )?;
            let assistant: Option<String> = tx.query_row(
                "SELECT assistant_message_id FROM chat_turn WHERE request_id=?1",
                [id],
                |r| r.get(0),
            )?;
            if latest != input
                && !((completed_verify || cp.segment > 0)
                    && assistant.as_deref() == Some(latest.as_str()))
            {
                return Err(invalid("[TARGET_CONFLICT] Percakapan sudah berubah; finalisasi tidak ditambahkan ke percakapan baru."));
            }
        }
        tx.execute(
            "UPDATE creative_task SET status='planning',error=NULL,updated_at=?2 WHERE id=?1",
            params![id, now_string()],
        )?;
        event(&tx, id)?;
        tx.commit()?;
        Ok(())
    }
}

impl Storage {
pub fn finish_editor_ai_task(&self, id: &str, recipe: &Value) -> Result<(), StorageError> {
        let task = self.get_creative_task(id)?;
        if task["origin"] != "ai" || task["status"] != "planning" {
            return Err(invalid("Tugas editor tidak siap diselesaikan."));
        }
        let mut checked = recipe.clone();
        crate::editor_ai::validate_editor_recipe(task["kind"].as_str().unwrap_or(""), &mut checked)
            .map_err(StorageError::InvalidInput)?;
        let cp = self
            .ai_checkpoint(id)?
            .ok_or_else(|| invalid("Bukti provider tidak tersedia."))?;
        if cp.validation != "passed"
            || cp.final_text.is_none()
            || cp.candidate_hash.as_deref() != Some(&sha256_hex(recipe.to_string().as_bytes()))
        {
            return Err(invalid("Kandidat editor belum difinalisasi/diperiksa."));
        }
        let tx = self.connection.unchecked_transaction()?;
        tx.execute(
            "UPDATE creative_task SET status='completed',updated_at=?2 WHERE id=?1",
            params![id, now_string()],
        )?;
        event(&tx, id)?;
        tx.commit()?;
        Ok(())
    }
}

impl Storage {
pub fn create_editor_ai_task(
        &self,
        id: &str,
        kind: &str,
        prompt: &str,
        provider: &AiProviderProfile,
        parent: Option<&Value>,
    ) -> Result<(), StorageError> {
        ai::validate_profile(provider).map_err(StorageError::InvalidInput)?;
        let snapshot = json!({"id":id,"kind":kind,"prompt":prompt,"origin":"ai","parentHash":parent.map(|p|sha256_hex(p.to_string().as_bytes())),"provider":{"profileId":provider.id,"adapterId":provider.provider_type,"modelId":provider.model,"reasoningEffort":provider.reasoning_effort},"skills":crate::agent::skill_snapshots(prompt,kind,false)});
        let tx = self.connection.unchecked_transaction()?;
        begin(&tx, id, &snapshot)?;
        stage(&tx, id, "planning", None)?;
        tx.commit()?;
        Ok(())
    }
}

impl Storage {
pub fn persist_ai_checkpoint(
        &self,
        id: &str,
        state: &crate::supervisor::Checkpoint,
    ) -> Result<(), StorageError> {
        let encoded = serde_json::to_string(state)?;
        if encoded.len() > 10 * 1024 * 1024 {
            return Err(invalid(
                "Checkpoint terlalu besar; proses dihentikan tanpa memotong protokol.",
            ));
        }
        self.connection.execute("INSERT INTO ai_checkpoint VALUES(?1,json_set(?2,'$.revision',1),?3) ON CONFLICT(task_id) DO UPDATE SET checkpoint_json=json_set(excluded.checkpoint_json,'$.revision',COALESCE(json_extract(ai_checkpoint.checkpoint_json,'$.revision'),0)+1),updated_at=excluded.updated_at",params![id,encoded,now_string()])?;
        Ok(())
    }
}
