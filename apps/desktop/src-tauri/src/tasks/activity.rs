//! Public task events contain state only. Provider candidates and receipts stay in the journal.
use crate::supervisor::Checkpoint;
use serde::Serialize;
use serde_json::Value;

#[derive(Debug, Serialize)]
#[serde(
    tag = "type",
    rename_all = "snake_case",
    rename_all_fields = "camelCase"
)]
pub enum State {
    Progress {
        stage: &'static str,
    },
    Candidate {
        stage: &'static str,
    },
    Final {
        stored: bool,
    },
    NeedsAction {
        action: &'static str,
        message: &'static str,
    },
    Error {
        category: String,
        message: &'static str,
    },
}
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Activity {
    task_id: String,
    revision: u64,
    #[serde(flatten)]
    state: State,
}
pub fn activity(task: &Value, cp: Option<&Checkpoint>) -> Activity {
    let status = task["status"].as_str().unwrap_or("");
    let terminal = matches!(
        status,
        "completed" | "preview_ready" | "failed" | "cancelled" | "interrupted"
    );
    let state = if status == "completed" || status == "preview_ready" {
        State::Final { stored: true }
    } else if cp.is_some_and(|cp| cp.recovery()["canResumeEdit"] == true) && terminal {
        State::NeedsAction {
            action: "stop_play",
            message: "Menunggu mode Edit",
        }
    } else if matches!(status, "failed" | "cancelled" | "interrupted") {
        let category = cp
            .and_then(|cp| cp.error_category.as_deref())
            .unwrap_or(status);
        let message = match category {
            "cancelled" => "Tugas dibatalkan. Hasil yang sudah tersimpan tetap tersedia.",
            "interrupted" => "Tugas terputus. Tinjau hasil dan pilihan pemulihan.",
            "target_conflict" => {
                "Map atau koneksi berubah. Kembali ke target semula sebelum melanjutkan."
            }
            "unknown_result" => "Efek perubahan belum pasti. Periksa hasil sebelum melanjutkan.",
            "authentication" => "Akun perlu disambungkan kembali melalui Pengaturan.",
            _ => "Tugas belum selesai. Buka rincian dan pilih tindakan pemulihan.",
        };
        State::Error {
            category: category.into(),
            message,
        }
    } else if cp.is_some_and(|cp| cp.final_text.is_some()) {
        State::Candidate {
            stage: if cp.is_some_and(|cp| cp.validation == "passed") {
                "saving"
            } else {
                "validating"
            },
        }
    } else {
        let phase = cp.map(|cp| cp.phase.as_str()).unwrap_or("");
        State::Progress {
            stage: if phase == "repairing"
                || cp.is_some_and(|cp| cp.repairs > 0 && cp.validation == "failed")
            {
                "repairing"
            } else if matches!(
                phase,
                "verification" | "verifying" | "read_back_continuation"
            ) {
                "validating"
            } else if matches!(phase, "provider_request" | "tool_execution" | "finalizing") {
                "streaming"
            } else {
                match status {
                    "queued" | "planning" => "planning",
                    "reading_context" => "reading_context",
                    "streaming" | "tool_running" => "streaming",
                    "validating" => "validating",
                    _ => "unknown",
                }
            },
        }
    };
    Activity {
        task_id: task["id"].as_str().unwrap_or_default().into(),
        revision: task["events"]
            .as_array()
            .and_then(|events| events.last())
            .and_then(|event| event["sequence"].as_u64())
            .unwrap_or(0)
            + cp.map_or(0, |cp| cp.revision),
        state,
    }
}
#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;
    #[test]
    fn only_committed_task_can_emit_final_and_public_event_contains_no_provider_text() {
        let mut task = json!({"id":"task", "status":"streaming", "events":[{"sequence":2}], "candidate":"secret tool JSON"});
        let event = serde_json::to_value(activity(&task, None)).unwrap();
        assert_eq!(event["type"], "progress");
        assert!(!event.to_string().contains("secret"));
        task["status"] = json!("completed");
        let event = serde_json::to_value(activity(&task, None)).unwrap();
        assert_eq!(event["type"], "final");
        assert_eq!(event["revision"], 2);
        for status in ["cancelled", "failed", "interrupted"] {
            task["status"] = json!(status);
            assert_eq!(
                serde_json::to_value(activity(&task, None)).unwrap()["type"],
                "error"
            );
        }
    }
}
