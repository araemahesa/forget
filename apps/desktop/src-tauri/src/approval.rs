//! User approval for AI tool calls that change something (Studio writes, MCP tools).
//!
//! The executing task blocks in [`request`] while the UI shows the call; the user answers
//! through the `resolve_tool_approval` command. A rejection, cancellation or timeout is
//! reported as `[TOOL_NOT_DISPATCHED]`, so the supervisor records the call as not executed
//! instead of an unknown outcome.

use serde::Serialize;
use serde_json::{json, Value};
use std::collections::HashMap;
use std::sync::mpsc::{self, RecvTimeoutError, SyncSender};
use std::sync::Mutex;
use std::time::{Duration, Instant};

const TIMEOUT: Duration = Duration::from_secs(600);
const MAX_PREVIEW_BYTES: usize = 64 * 1024;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ApprovalRequest {
    pub task_id: String,
    pub call_id: String,
    pub tool: String,
    pub title: String,
    /// Luau source for Studio writes, pretty JSON arguments otherwise; truncated for display.
    pub preview: String,
    pub truncated: bool,
}

struct Pending {
    sequence: u64,
    request: ApprovalRequest,
    answer: SyncSender<bool>,
}
static SEQUENCE: std::sync::atomic::AtomicU64 = std::sync::atomic::AtomicU64::new(0);

static PENDING: Mutex<Option<HashMap<String, Pending>>> = Mutex::new(None);

fn key(task_id: &str, call_id: &str) -> String {
    format!("{task_id}\u{0}{call_id}")
}

fn preview(call: &crate::tools::ToolCall) -> (String, bool) {
    let parsed: Option<Value> = serde_json::from_str(&call.arguments).ok();
    let text = match parsed {
        Some(value) if call.name == "forgekit_studio_execute_luau" && value["code"].is_string() => {
            value["code"].as_str().unwrap_or_default().to_owned()
        }
        Some(value) => serde_json::to_string_pretty(&value).unwrap_or_else(|_| call.arguments.clone()),
        None => call.arguments.clone(),
    };
    if text.len() <= MAX_PREVIEW_BYTES {
        return (text, false);
    }
    let mut end = MAX_PREVIEW_BYTES;
    while !text.is_char_boundary(end) {
        end -= 1;
    }
    (text[..end].to_owned(), true)
}

/// Waiting requests in the order the AI raised them.
pub fn pending() -> Vec<ApprovalRequest> {
    let Ok(map) = PENDING.lock() else { return vec![] };
    let mut items: Vec<_> = map.as_ref().map(|m| m.values().map(|p| (p.sequence, p.request.clone())).collect()).unwrap_or_default();
    items.sort_by_key(|(sequence, _)| *sequence);
    items.into_iter().map(|(_, request)| request).collect()
}

/// Delivers the user's decision. Unknown or already-answered calls are an error.
pub fn resolve(task_id: &str, call_id: &str, approved: bool) -> Result<(), String> {
    let pending = PENDING
        .lock()
        .map_err(|_| "Antrian persetujuan rusak.")?
        .as_mut()
        .and_then(|map| map.remove(&key(task_id, call_id)))
        .ok_or("Permintaan persetujuan sudah tidak aktif.")?;
    pending
        .answer
        .try_send(approved)
        .map_err(|_| "Tugas sudah tidak menunggu persetujuan.".to_string())
}

/// Blocks until the user approves, rejects, the task is cancelled, or the request times out.
/// `notify` announces the request (and later its resolution) to the UI.
pub fn request(
    task_id: &str,
    call: &crate::tools::ToolCall,
    title: &str,
    cancelled: &dyn Fn() -> bool,
    notify: &dyn Fn(&str, Value),
) -> Result<(), String> {
    let (preview, truncated) = preview(call);
    let request = ApprovalRequest {
        task_id: task_id.into(),
        call_id: call.id.clone(),
        tool: call.name.clone(),
        title: title.into(),
        preview,
        truncated,
    };
    let (answer, decision) = mpsc::sync_channel(1);
    let id = key(task_id, &call.id);
    PENDING
        .lock()
        .map_err(|_| "[TOOL_NOT_DISPATCHED] Antrian persetujuan rusak.")?
        .get_or_insert_with(HashMap::new)
        .insert(id.clone(), Pending { sequence: SEQUENCE.fetch_add(1, std::sync::atomic::Ordering::Relaxed), request: request.clone(), answer });
    notify("forgekit:approval-request", json!(request));
    let deadline = Instant::now() + TIMEOUT;
    let outcome = loop {
        if cancelled() {
            break Err("[CANCELLED][TOOL_NOT_DISPATCHED] Tugas dihentikan sebelum perubahan disetujui.".to_string());
        }
        if Instant::now() >= deadline {
            break Err("[TOOL_NOT_DISPATCHED] Persetujuan tidak dijawab dalam 10 menit; perubahan tidak dijalankan.".to_string());
        }
        match decision.recv_timeout(Duration::from_millis(200)) {
            Ok(true) => break Ok(()),
            Ok(false) => break Err("[TOOL_NOT_DISPATCHED] Pengguna menolak perubahan ini; tidak ada yang dijalankan. Tanyakan pengguna sebelum mencoba pendekatan lain.".to_string()),
            Err(RecvTimeoutError::Timeout) => continue,
            Err(RecvTimeoutError::Disconnected) => break Err("[TOOL_NOT_DISPATCHED] Persetujuan dibatalkan.".to_string()),
        }
    };
    if let Ok(mut map) = PENDING.lock() {
        if let Some(map) = map.as_mut() {
            map.remove(&id);
        }
    }
    notify("forgekit:approval-resolved", json!({"taskId": task_id, "callId": call.id, "approved": outcome.is_ok()}));
    outcome
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::tools::ToolCall;
    use std::sync::{Arc, Mutex as StdMutex};

    fn call(id: &str) -> ToolCall {
        ToolCall { id: id.into(), name: "forgekit_studio_execute_luau".into(), arguments: r#"{"code":"workspace.Part:Destroy()"}"#.into() }
    }

    fn run(task: &'static str, id: &'static str, decide: Option<bool>, cancel: bool) -> (Result<(), String>, Vec<String>) {
        let events = Arc::new(StdMutex::new(Vec::new()));
        let seen = events.clone();
        let worker = std::thread::spawn(move || {
            request(task, &call(id), "Ubah map", &|| cancel, &move |name, _| seen.lock().unwrap().push(name.to_owned()))
        });
        if let Some(approved) = decide {
            let started = Instant::now();
            while pending().iter().all(|p| p.call_id != id) {
                assert!(started.elapsed() < Duration::from_secs(5));
                std::thread::sleep(Duration::from_millis(10));
            }
            let request = pending().into_iter().find(|p| p.call_id == id).unwrap();
            assert_eq!(request.preview, "workspace.Part:Destroy()", "Luau is shown as source, not JSON");
            resolve(task, id, approved).unwrap();
        }
        let result = worker.join().unwrap();
        let names = events.lock().unwrap().clone();
        (result, names)
    }

    #[test]
    fn approval_runs_and_rejection_is_not_dispatched() {
        let (approved, events) = run("task-a", "call-1", Some(true), false);
        assert!(approved.is_ok());
        assert_eq!(events, ["forgekit:approval-request", "forgekit:approval-resolved"]);
        let (rejected, _) = run("task-a", "call-2", Some(false), false);
        assert!(rejected.unwrap_err().contains("[TOOL_NOT_DISPATCHED]"));
        assert!(resolve("task-a", "call-2", true).is_err(), "an answered request cannot be answered again");
    }

    #[test]
    fn cancellation_releases_the_wait() {
        let (result, _) = run("task-b", "call-1", None, true);
        assert!(result.unwrap_err().contains("[CANCELLED][TOOL_NOT_DISPATCHED]"));
        assert!(pending().iter().all(|p| p.task_id != "task-b"));
    }
}
