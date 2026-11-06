pub(crate) mod protocol;

use crate::artifacts::sha256_hex;
use crate::ai::protocol::{StreamDecoder, Turn};
use crate::storage::{next_id, now_string, StorageError};
use crate::tools::{ToolCall, ToolDefinition, ToolReceipt};
use rusqlite::{params, Connection};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::collections::HashMap;
use std::io::{BufRead, BufReader, Read, Write};
use std::process::{Child, Command, Stdio};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::time::Instant;

struct StreamControl {
    child: Mutex<Option<Child>>,
    cancelled: AtomicBool,
}
static ACTIVE_STREAMS: Mutex<Option<HashMap<String, Arc<StreamControl>>>> = Mutex::new(None);
static STOPPING: AtomicBool = AtomicBool::new(false);

pub struct StreamLease {
    id: String,
    control: Arc<StreamControl>,
    _ownership: std::fs::File,
}
impl StreamLease {
    pub fn is_cancelled(&self) -> bool {
        self.control.cancelled.load(Ordering::SeqCst)
    }
}
pub fn begin_stream(id: &str) -> Result<StreamLease, String> {
    let mut active = ACTIVE_STREAMS
        .lock()
        .map_err(|_| "State stream tidak tersedia.")?;
    if STOPPING.load(Ordering::SeqCst) {
        return Err("Aplikasi sedang ditutup.".into());
    }
    let map = active.get_or_insert_with(HashMap::new);
    if map.contains_key(id) {
        return Err("Tugas pada percakapan ini masih berjalan.".into());
    }
    let lock_dir = std::env::temp_dir().join("forgekit-ai-ownership");
    std::fs::create_dir_all(&lock_dir).map_err(|_| "Lease tugas tidak dapat disiapkan.")?;
    let ownership = std::fs::OpenOptions::new()
        .read(true)
        .write(true)
        .create(true)
        .truncate(false)
        .open(lock_dir.join(sha256_hex(id.as_bytes())))
        .map_err(|_| "Lease tugas tidak tersedia.")?;
    ownership
        .try_lock()
        .map_err(|_| "Tugas ini sedang berjalan di window/proses lain.")?;
    let control = Arc::new(StreamControl {
        child: Mutex::new(None),
        cancelled: AtomicBool::new(false),
    });
    map.insert(id.into(), control.clone());
    Ok(StreamLease {
        id: id.into(),
        control,
        _ownership: ownership,
    })
}
impl Drop for StreamLease {
    fn drop(&mut self) {
        if let Ok(mut child) = self.control.child.lock() {
            if let Some(mut process) = child.take() {
                let _ = process.kill();
                let _ = process.wait();
            }
        }
        if let Ok(mut active) = ACTIVE_STREAMS.lock() {
            if let Some(map) = active.as_mut() {
                map.remove(&self.id);
            }
        }
        // Release explicitly: a child process spawned concurrently can briefly hold an
        // inherited duplicate of this descriptor, which would keep the flock alive after close.
        let _ = self._ownership.unlock();
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AiProviderProfile {
    pub id: String,
    pub name: String,
    pub provider_type: String,
    pub base_url: String,
    pub model: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub reasoning_effort: Option<String>,
    pub key_reference: String,
    pub is_default: bool,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ChatThread {
    pub id: String,
    pub title: String,
    pub provider_id: Option<String>,
    pub model: String,
    pub system_prompt: Option<String>,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ChatMessage {
    pub id: String,
    pub thread_id: String,
    pub sequence: i64,
    pub role: String,
    pub content: String,
    pub tool_calls: Option<Value>,
    pub tool_results: Option<Value>,
    pub token_usage: Option<Value>,
    pub created_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProviderTestResult {
    pub ok: bool,
    pub latency_ms: u64,
    pub message: String,
    pub model_count: Option<usize>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ConnectionProfile {
    pub id: String,
    pub provider_id: String,
    pub connection_mode: String,
    pub credential_owner: String,
    pub router_instance_id: Option<String>,
    pub upstream_connection_ref: Option<String>,
    pub auth_method: String,
    pub label: String,
    pub identity: Option<Value>,
    pub registration_ref: Option<String>,
    pub credential_ref: Option<String>,
    pub access_state: String,
    pub enabled: bool,
    pub fallback_eligible: String,
    pub fallback_disabled_reason: Option<String>,
    pub priority: i64,
    pub quota_bucket_refs: Vec<String>,
    pub base_url: String,
    pub model: String,
    pub is_default: bool,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct FallbackPolicy {
    pub id: String,
    pub enabled: bool,
    pub ordered_profile_ids: Vec<String>,
    pub allowed_provider_ids: Vec<String>,
    pub allow_cross_provider: bool,
    pub allow_model_change: bool,
    pub routing_owner: String,
    pub max_attempts: i64,
    pub max_elapsed_ms: i64,
    pub budget_policy_id: Option<String>,
    pub data_policy_id: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct RouterConnection {
    pub id: String,
    pub kind: String,
    pub base_url: String,
    pub dashboard_url: Option<String>,
    pub inference_credential_ref: String,
    pub management_credential_ref: Option<String>,
    pub detected_version: Option<String>,
    pub management_access: String,
    pub routing_owner: String,
    pub last_verified_at: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TaskAttempt {
    pub id: String,
    pub task_id: String,
    pub profile_id: String,
    pub provider_id: String,
    pub model_id: String,
    pub checkpoint_id: String,
    pub status: String,
    pub started_at: String,
    pub completed_at: Option<String>,
    pub provider_request_id: Option<String>,
    pub provider_job_id: Option<String>,
    pub error: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProviderConnectSession {
    pub session_id: String,
    pub provider_id: String,
    pub mode: String,
    pub auth_url: String,
    pub status: String,
    pub expires_at: String,
    pub message: Option<String>,
}

pub fn validate_profile(profile: &AiProviderProfile) -> Result<(), String> {
    for (label, value, limit) in [
        ("ID", &profile.id, 256),
        ("Nama", &profile.name, 100),
        ("Model", &profile.model, 200),
        ("Referensi kunci", &profile.key_reference, 256),
    ] {
        if value.trim().is_empty() || value.len() > limit || value.chars().any(char::is_control) {
            return Err(format!("{label} provider tidak sah."));
        }
    }
    let url = url::Url::parse(&profile.base_url).map_err(|_| "Endpoint provider tidak sah.")?;
    if !url.username().is_empty()
        || url.password().is_some()
        || url.query().is_some()
        || url.fragment().is_some()
    {
        return Err("Endpoint tidak boleh berisi credential, query, atau fragment.".into());
    }
    let local = matches!(
        url.host_str(),
        Some("localhost" | "127.0.0.1" | "[::1]" | "::1")
    );
    if url.scheme() != "https" && !(url.scheme() == "http" && local) {
        return Err("Endpoint wajib HTTPS; HTTP hanya untuk loopback lokal.".into());
    }
    match profile.provider_type.as_str() {
        "openai"
if ((url.host_str() == Some("api.openai.com")
                && url.path().trim_end_matches('/') == "/v1")
                || (url.host_str() == Some("chatgpt.com") && url.path().trim_end_matches('/') == "/backend-api/codex"))
                && url.port().is_none() => {}
        "openai" => return Err("Adapter OpenAI resmi memakai https://api.openai.com/v1.".into()),
        "anthropic"
            if url.host_str() == Some("api.anthropic.com")
                && url.path().trim_end_matches('/') == "/v1"
                && url.port().is_none() => {}
        "anthropic" => {
            return Err("Adapter Claude resmi memakai https://api.anthropic.com/v1.".into())
        }
        "local-llm" if local => {}
        "local-llm" => return Err("Adapter lokal memerlukan endpoint loopback.".into()),
        "gemini"
            if url.host_str() == Some("generativelanguage.googleapis.com")
                && url.path().trim_end_matches('/') == "/v1beta/openai"
                && url.port().is_none() => {}
        "gemini" => {
            return Err(
                "Gemini resmi memakai https://generativelanguage.googleapis.com/v1beta/openai."
                    .into(),
            )
        }
        "9router" | "openai-compatible" => {}
        _ => return Err("Adapter provider belum didukung.".into()),
    }
    Ok(())
}

pub fn get_keychain_secret(account: &str) -> Result<String, String> {
    let raw = optional_keychain_secret(account)?
        .ok_or_else(|| "Credential tidak ditemukan di Keychain.".to_string())?;
    if serde_json::from_str::<Value>(&raw)
        .ok()
        .is_some_and(|v| v["forgekit_google_oauth"] == true)
    {
        return crate::auth::google::access_token(account, &raw);
    }
    if serde_json::from_str::<Value>(&raw).ok().is_some_and(|v| v["forgekit_oauth"] == true || v["forgekit_session"] == true) {
        return Err("Metode login lama sudah dihapus. Hubungkan ChatGPT melalui Codex.".into());
    }
    Ok(raw)
}

#[cfg(target_os = "macos")]
static KEYCHAIN_ACCESS: Mutex<Option<HashMap<String, String>>> = Mutex::new(None);
// Serializes calls into the macOS Keychain (which may show an authorization dialog).
// KEYCHAIN_ACCESS is only held for brief cache reads/writes, never across an OS call,
// so concurrent tasks reading an already authorized secret never see a false "locked".
#[cfg(target_os = "macos")]
static KEYCHAIN_OS: Mutex<()> = Mutex::new(());

#[cfg(target_os = "macos")]
fn cached_keychain_secret(account: &str) -> Result<Option<String>, String> {
    let access = KEYCHAIN_ACCESS
        .lock()
        .map_err(|_| "[KEYCHAIN_LOCKED] Akses Keychain belum tersedia.")?;
    Ok(access.as_ref().and_then(|items| items.get(account)).cloned())
}

#[cfg(target_os = "macos")]
fn cache_keychain_secret(account: &str, secret: Option<&str>) -> Result<(), String> {
    let mut access = KEYCHAIN_ACCESS
        .lock()
        .map_err(|_| "[KEYCHAIN_LOCKED] Akses Keychain belum tersedia.")?;
    let items = access.get_or_insert_with(HashMap::new);
    match secret {
        Some(secret) => {
            items.insert(account.into(), secret.into());
        }
        None => {
            items.remove(account);
        }
    }
    Ok(())
}

// Only an explicit connection test may request macOS authorization interactively.
pub(crate) fn authorize_keychain_access(account: &str) -> Result<(), String> {
    if account.is_empty() {
        return Ok(());
    }
    #[cfg(target_os = "macos")]
    {
        if cached_keychain_secret(account)?.is_some() {
            return Ok(());
        }
        let _os = KEYCHAIN_OS
            .lock()
            .map_err(|_| "[KEYCHAIN_LOCKED] Akses Keychain belum tersedia.")?;
        // Another caller may have authorized this account while we waited.
        if cached_keychain_secret(account)?.is_some() {
            return Ok(());
        }
        let bytes = security_framework::passwords::get_generic_password("dev.forgekit.studio", account)
            .map_err(|_| "[KEYCHAIN_LOCKED] Keychain terkunci atau izin belum diberikan. Izinkan akses pada dialog macOS.".to_string())?;
        let secret =
            String::from_utf8(bytes).map_err(|_| "Credential akun tidak sah.".to_string())?;
        // macOS Allow grants one read. Reuse that authorized read for this app session.
        cache_keychain_secret(account, Some(&secret))
    }
    #[cfg(not(target_os = "macos"))]
    {
        Ok(())
    }
}

pub(crate) fn optional_keychain_secret(account: &str) -> Result<Option<String>, String> {
    #[cfg(target_os = "macos")]
    {
        if let Some(secret) = cached_keychain_secret(account)? {
            return Ok(Some(secret));
        }
        // Background refresh/inference must not wait for an OS authorization dialog
        // that another (interactive) caller is currently showing.
        let _os = KEYCHAIN_OS
            .try_lock()
            .map_err(|_| "[KEYCHAIN_LOCKED] Akses akun sedang menunggu izin macOS.")?;
        if let Some(secret) = cached_keychain_secret(account)? {
            return Ok(Some(secret));
        }
        let _interaction = security_framework::os::macos::keychain::SecKeychain::disable_user_interaction()
            .map_err(|_| "[KEYCHAIN_LOCKED] Keychain belum dapat dibaca. Sambungkan kembali akun melalui Pengaturan.")?;
        match security_framework::passwords::get_generic_password("dev.forgekit.studio", account) {
            Ok(value) => {
                let secret = String::from_utf8(value).map_err(|_| "Kunci API tidak sah.")?;
                cache_keychain_secret(account, Some(&secret))?;
                Ok(Some(secret))
            },
            Err(error) if error.code() == -25300 => Ok(None),
            Err(_) => Err("[KEYCHAIN_LOCKED] Akses Keychain ditolak atau terkunci. Buka Pengaturan, pilih Uji koneksi dan setujui izin macOS.".into()),
        }
    }
    #[cfg(not(target_os = "macos"))]
    {
        let _ = account;
        Ok(None)
    }
}

pub fn set_keychain_secret(account: &str, secret: &str) -> Result<(), String> {
    if secret.is_empty() || secret.len() > 16384 || secret.chars().any(char::is_control) {
        return Err("Kunci API kosong atau tidak sah.".into());
    }
    #[cfg(target_os = "macos")]
    {
        let _os = KEYCHAIN_OS
            .lock()
            .map_err(|_| "[KEYCHAIN_LOCKED] Akses Keychain belum tersedia.")?;
        security_framework::passwords::set_generic_password(
            "dev.forgekit.studio",
            account,
            secret.as_bytes(),
        )
        .map_err(|_| "Kunci gagal disimpan di Keychain.".to_string())?;
        // A credential just saved by this foreground action is authorized for this session.
        cache_keychain_secret(account, Some(secret))
    }
    #[cfg(not(target_os = "macos"))]
    {
        let _ = (account, secret);
        Err("Penyimpanan credential OS belum didukung pada platform ini.".into())
    }
}

pub fn delete_keychain_secret(account: &str) -> Result<(), String> {
    #[cfg(target_os = "macos")]
    {
        let _os = KEYCHAIN_OS
            .lock()
            .map_err(|_| "[KEYCHAIN_LOCKED] Akses Keychain belum tersedia.")?;
        match security_framework::passwords::delete_generic_password(
            "dev.forgekit.studio",
            account,
        ) {
            Ok(()) => {}
            Err(error) if error.code() == -25300 => {}
            Err(_) => return Err("Kunci tidak dapat dilepas dari Keychain.".into()),
        }
        cache_keychain_secret(account, None)
    }
    #[cfg(not(target_os = "macos"))]
    {
        let _ = account;
        Err("Penyimpanan credential OS belum didukung pada platform ini.".into())
    }
}

pub fn test_ai_provider(profile: &AiProviderProfile) -> Result<ProviderTestResult, String> {
    validate_profile(profile)?;
    let lease = begin_stream(&next_id("provider-test"))?;
    let start = Instant::now();
    let result = execute_ai_stream_limited(
        profile,
        &lease,
        &[json!({"role":"user","content":"Reply OK."})],
        30,
        32,
        |_| Ok(()),
    );
    Ok(ProviderTestResult {
        ok: result.is_ok(),
        latency_ms: start.elapsed().as_millis() as u64,
        message: result
            .map(|_| "Satu respons teks streaming selesai. Tools dan media belum diuji.".into())
            .unwrap_or_else(|error| error),
        model_count: None,
    })
}

pub fn cancel_ai_stream(thread_id: &str) {
    let control = ACTIVE_STREAMS
        .lock()
        .ok()
        .and_then(|active| active.as_ref().and_then(|map| map.get(thread_id).cloned()));
    if let Some(control) = control {
        control.cancelled.store(true, Ordering::SeqCst);
        if let Ok(mut child) = control.child.lock() {
            if let Some(process) = child.as_mut() {
                let _ = process.kill();
                let _ = process.wait();
            }
        }
    }
}

pub fn shutdown() {
    STOPPING.store(true, Ordering::SeqCst);
    let ids = ACTIVE_STREAMS
        .lock()
        .ok()
        .and_then(|active| {
            active
                .as_ref()
                .map(|map| map.keys().cloned().collect::<Vec<_>>())
        })
        .unwrap_or_default();
    for id in ids {
        cancel_ai_stream(&id);
    }
}

fn request(profile: &AiProviderProfile, messages: &[Value]) -> Result<(String, Value), String> {
    validate_profile(profile)?;
    let messages = crate::references::for_adapter(messages, &profile.provider_type);
    let base = profile.base_url.trim_end_matches('/');
    let mut payload = match profile.provider_type.as_str() {
        "openai" => (
            format!("{base}/responses"),
            json!({"model":profile.model,"input":messages,"stream":true,"max_output_tokens":4096,"store":false}),
        ),
        "anthropic" => {
            let system = messages
                .iter()
                .filter(|m| m["role"] == "system")
                .filter_map(|m| m["content"].as_str())
                .collect::<Vec<_>>()
                .join("\n");
            let turns: Vec<_> = messages
                .iter()
                .filter(|m| m["role"] != "system")
                .cloned()
                .collect();
            (
                format!("{base}/messages"),
                json!({"model":profile.model,"messages":turns,"system":system,"stream":true,"max_tokens":4096}),
            )
        }
        _ => (
            format!("{base}/chat/completions"),
            json!({"model":profile.model,"messages":messages,"stream":true,"max_tokens":4096}),
        ),
    };
    if let Some(effort) = &profile.reasoning_effort {
        if !crate::model_catalog::valid_effort(effort) {
            return Err("Tingkat penalaran tidak sah.".into());
        }
        match profile.provider_type.as_str() {
            "openai" => payload.1["reasoning"] = json!({"effort":effort}),
            "anthropic" => payload.1["output_config"] = json!({"effort":effort}),
            _ => payload.1["reasoning_effort"] = json!(effort),
        }
    }
    if crate::auth::codex::is_codex(profile) {
        payload.1["input"] = json!(messages
            .iter()
            .filter(|m| m["role"] != "system")
            .cloned()
            .collect::<Vec<_>>());
        payload.1["instructions"] = json!(messages
            .iter()
            .filter(|m| m["role"] == "system")
            .filter_map(|m| m["content"].as_str())
            .collect::<Vec<_>>()
            .join("\n"));
        payload
            .1
            .as_object_mut()
            .unwrap()
            .remove("max_output_tokens");
    }
    Ok(payload)
}

pub(crate) fn curl_quote(value: &str) -> String {
    format!(
        "\"{}\"",
        value
            .replace('\\', "\\\\")
            .replace('\"', "\\\"")
            .replace('\n', "\\n")
            .replace('\r', "\\r")
    )
}

pub fn execute_chat_tools<F, G>(
    profile: &AiProviderProfile,
    lease: &StreamLease,
    messages: &[Value],
    tools_enabled: bool,
    mut on_chunk: F,
    mut execute_tool: G,
) -> Result<String, String>
where
    F: FnMut(&str) -> Result<(), String>,
    G: FnMut(&ToolCall) -> Result<ToolReceipt, String>,
{
    execute_chat_tools_limited(
        profile,
        lease,
        messages,
        tools_enabled,
        120,
        &mut on_chunk,
        &mut execute_tool,
    )
}

pub fn execute_chat_tools_limited<F, G>(
    profile: &AiProviderProfile,
    lease: &StreamLease,
    messages: &[Value],
    tools_enabled: bool,
    duration_seconds: u64,
    on_chunk: F,
    mut execute_tool: G,
) -> Result<String, String>
where
    F: FnMut(&str) -> Result<(), String>,
    G: FnMut(&ToolCall) -> Result<ToolReceipt, String>,
{
    let definitions = if tools_enabled { crate::tools::definitions() } else { vec![] };
    execute_agent_limited(profile, lease, messages, &definitions, duration_seconds, 8192, on_chunk, |call| {
        serde_json::to_value(execute_tool(call)?).map_err(|_| "Receipt tool tidak sah.".into())
    })
}

pub fn execute_agent_limited<F, G>(
    profile: &AiProviderProfile, lease: &StreamLease, messages: &[Value], tools: &[ToolDefinition],
    duration_seconds: u64, max_tokens: u64, mut on_chunk: F, mut execute_tool: G,
) -> Result<String, String>
where F: FnMut(&str) -> Result<(), String>, G: FnMut(&ToolCall) -> Result<Value, String>,
{
    if tools.is_empty() {
        return execute_ai_stream_limited(
            profile,
            lease,
            messages,
            duration_seconds.min(120),
            max_tokens,
            on_chunk,
        );
    }

    let start = Instant::now();
    let mut history = messages.to_vec();
    let mut content = String::new();
    let mut seen = HashMap::<String, (ToolCall, Value)>::new();
    let mut calls = 0;
    for _ in 0..crate::tools::MAX_ROUNDS {
        let remaining = duration_seconds
            .min(120)
            .saturating_sub(start.elapsed().as_secs());
        if remaining == 0 || lease.is_cancelled() {
            return Err("Task dibatalkan atau melewati anggaran 120 detik.".into());
        }
        let turn = execute_turn(
            profile,
            lease,
            &history,
            tools,
            remaining,
            max_tokens,
            &mut on_chunk,
        )
        .map_err(|error| {
            if calls > 0 || !content.is_empty() {
                format!("[UNKNOWN_RESULT] Checkpoint tool/output sudah terlewati. {error}")
            } else {
                error
            }
        })?;
        content.push_str(&turn.text);
        if turn.calls.is_empty() {
            return Ok(turn.text);
        }
        if !turn.text.is_empty() {
            on_chunk("\n\n")?;
            content.push_str("\n\n");
        }
        let mut outputs = Vec::new();
        for call in &turn.calls {
            calls += 1;
            if calls > crate::tools::MAX_CALLS
                || start.elapsed().as_secs() >= duration_seconds.min(120)
                || lease.is_cancelled()
            {
                return Err(
                    "Batas tool loop tercapai atau task dibatalkan. Receipt parsial tersimpan."
                        .into(),
                );
            }
            let output = if let Some((prior, output)) = seen.get(&call.id) {
                if prior != call {
                    return Err("ID tool call digunakan ulang dengan input berbeda.".into());
                }
                output.clone()
            } else {
                if !tools.iter().any(|tool| tool.wire_name == call.name) { return Err("Provider meminta tool yang tidak terdaftar.".into()); }
                let output = execute_tool(call).map_err(|error| format!("[UNKNOWN_RESULT] Tool sudah dimulai. {error}"))?;
                seen.insert(call.id.clone(), (call.clone(), output.clone()));
                output
            };
            outputs.push(output);
        }
        turn.append_results(&profile.provider_type, &mut history, &outputs);
    }
    Err(
        "Batas lima putaran provider tercapai. Receipt parsial tersimpan; respons belum selesai."
            .into(),
    )
}

pub fn execute_recipe_checkpoint<G,H,V>(profile:&AiProviderProfile,lease:&StreamLease,tools:&[ToolDefinition],max_tokens:u64,
    state:&mut crate::supervisor::Checkpoint,mut execute_tool:G,mut persist:H,validate:V)->Result<Value,String>
where G:FnMut(&ToolCall)->Result<Value,String>,H:FnMut(&crate::supervisor::Checkpoint)->Result<(),String>,V:Fn(&str)->Result<Value,String>{
    loop {
        let raw=execute_agent_checkpoint(profile,lease,tools,max_tokens,state,|_|Ok(()),&mut execute_tool,&mut persist)?;
        state.phase="verification".into();
        match validate(&raw){
            Ok(value)=>{
                if lease.is_cancelled(){return Err("[CANCELLED] Hasil dibatalkan sebelum diterapkan.".into())}
                state.validation="passed".into();state.candidate_hash=Some(sha256_hex(value.to_string().as_bytes()));persist(state)?;return Ok(value)
            },
            Err(error)=>{
                state.validation="failed".into();state.error_category=Some("validation".into());
                state.candidate_hash=Some(sha256_hex(raw.as_bytes()));
                if state.repairs>=2 || state.turns>=state.budget.turns || crate::routing::now_ms()>=state.deadline_ms {
                    state.phase="awaiting_continuation".into();persist(state)?;return Err(error)
                }
                state.history.push(json!({"role":"assistant","content":raw}));
                state.history.push(json!({"role":"user","content":json!({"operation":"repair","diagnostic":error,"instruction":"Perbaiki kandidat sesuai schema dan permintaan asli. Pertahankan bagian sah. Balas hanya satu JSON final. Tidak ada tools atau perubahan map."}).to_string()}));
                state.final_text=None;state.final_only=true;state.repairs+=1;state.phase="repairing".into();persist(state)?;
            }
        }
    }
}

pub fn execute_ai_stream<F>(
    profile: &AiProviderProfile,
    lease: &StreamLease,
    messages: &[Value],
    mut on_chunk: F,
) -> Result<String, String>
where
    F: FnMut(&str) -> Result<(), String>,
{
    execute_ai_stream_limited(profile, lease, messages, 120, 4096, &mut on_chunk)
}

pub fn execute_ai_stream_limited<F>(
    profile: &AiProviderProfile,
    lease: &StreamLease,
    messages: &[Value],
    duration_seconds: u64,
    output_tokens: u64,
    mut on_chunk: F,
) -> Result<String, String>
where
    F: FnMut(&str) -> Result<(), String>,
{
    execute_turn(
        profile,
        lease,
        messages,
        &[],
        duration_seconds,
        output_tokens,
        &mut on_chunk,
    )
    .map(|turn| turn.text)
}

fn execute_turn<F>(
    profile: &AiProviderProfile,
    lease: &StreamLease,
    messages: &[Value],
    tools: &[ToolDefinition],
    duration_seconds: u64,
    output_tokens: u64,
    mut on_chunk: F,
) -> Result<Turn, String>
where
    F: FnMut(&str) -> Result<(), String>,
{
    if !(1..=600).contains(&duration_seconds) || !(16..=32768).contains(&output_tokens) {
        return Err("Batas request tidak sah.".into());
    }
    let (url, mut payload) = request(profile, messages)?;
    if !crate::auth::codex::is_codex(profile) {
        payload[if profile.provider_type == "openai" { "max_output_tokens" } else { "max_tokens" }] = json!(output_tokens);
    }
    if !tools.is_empty() {
        payload["tools"] = json!(crate::ai::protocol::tool_payload(
            &profile.provider_type,
            tools
        ));
        if profile.provider_type != "anthropic" {
            payload["parallel_tool_calls"] = json!(false);
        }
    }
    let key = if crate::auth::codex::is_codex(profile) {
        crate::auth::codex::access_token(&profile.key_reference)?
    } else if matches!(profile.provider_type.as_str(), "local-llm" | "9router") {
        optional_keychain_secret(&profile.key_reference)?.unwrap_or_default()
    } else {
        get_keychain_secret(&profile.key_reference)?
    };
    let body = serde_json::to_string(&payload).map_err(|_| "Payload AI tidak sah.")?;
    // Supervisor enforces 256 KiB of text separately from 8 MiB of validated images.
    if body.len() > 10 * 1024 * 1024 {
        return Err("Konteks teks atau gambar melebihi batas; kurangi riwayat/referensi.".into());
    }
    if lease.control.cancelled.load(Ordering::SeqCst) {
        return Err("Permintaan dibatalkan.".into());
    }
    // Sensitive headers and project content travel through stdin, never process arguments.
    let mut config = format!(
        "url = {}\nrequest = \"POST\"\nheader = \"Content-Type: application/json\"\ndata = {}\n",
        curl_quote(&url),
        curl_quote(&body)
    );
    if !key.is_empty() {
        let header = if profile.provider_type == "anthropic" {
            format!("x-api-key: {key}")
        } else {
            format!("Authorization: Bearer {key}")
        };
        config.push_str(&format!("header = {}\n", curl_quote(&header)));
    }
    if crate::auth::codex::is_codex(profile) {
        config.push_str(&format!("header = {}\n", curl_quote(&format!("ChatGPT-Account-Id: {}", crate::auth::codex::account_id(&profile.key_reference)?))));
    }
    if profile.provider_type == "gemini" {
        if let Some(project) = crate::auth::google::quota_project(&profile.key_reference)? {
            config.push_str(&format!(
                "header = {}\n",
                curl_quote(&format!("x-goog-user-project: {project}"))
            ));
        }
    }
    if profile.provider_type == "anthropic" {
        config.push_str("header = \"anthropic-version: 2023-06-01\"\n");
    }
    let mut child = Command::new("/usr/bin/curl")
        .args([
            "-q",
            "--silent",
            "--no-buffer",
            "--connect-timeout",
            "10",
            "--max-time",
            &duration_seconds.to_string(),
            "--dump-header",
            "-",
            "--max-redirs",
            "0",
            "--proto",
            "=http,https",
            "--write-out",
            "\nforgekit-http-status:%{http_code}\n",
            "--config",
            "-",
        ])
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::null())
        .spawn()
        .map_err(|_| "Transport AI gagal dimulai.")?;
    let stdout = child
        .stdout
        .take()
        .ok_or("Transport AI tidak memiliki output.")?;
    let mut stdin = child
        .stdin
        .take()
        .ok_or("Transport AI tidak memiliki input.")?;
    {
        let mut slot = lease
            .control
            .child
            .lock()
            .map_err(|_| "State stream tidak tersedia.")?;
        *slot = Some(child);
    }
    if lease.control.cancelled.load(Ordering::SeqCst) {
        cancel_ai_stream(&lease.id);
        return Err("Permintaan dibatalkan.".into());
    }
    stdin
        .write_all(config.as_bytes())
        .map_err(|_| "Transport AI menutup input.")?;
    drop(stdin);
    let mut reader = BufReader::new(stdout);
    let mut accumulated = String::new();
    let mut data = String::new();
    let mut decoder = StreamDecoder::new(!tools.is_empty());
    // SSE repeats metadata per token and includes the final response again.
    const MAX_STREAM_BYTES: usize = 32 * 1024 * 1024;
    const MAX_EVENT_BYTES: usize = 4 * 1024 * 1024;
    const MAX_OUTPUT_BYTES: usize = 2 * 1024 * 1024;
    let mut total = 0;
    let mut status = 0;
    let mut retry_after_ms = 60_000_u64;
    let mut error_body = String::new();
    let mut in_headers = false;
    let mut quota_headers = std::collections::HashMap::new();
    loop {
        let mut line = String::new();
        let read = reader
            .by_ref()
            .take(MAX_EVENT_BYTES as u64 + 1)
            .read_line(&mut line)
            .map_err(|_| "Stream AI terputus.")?;
        if read == 0 {
            break;
        }
        total += read;
        if read > MAX_EVENT_BYTES || total > MAX_STREAM_BYTES {
            return Err("[OUTPUT_LIMIT] Stream AI melampaui batas transport (32 MiB total, 4 MiB per event).".into());
        }
        let line = line.trim_end_matches(['\r', '\n']);
        if line.starts_with("HTTP/") {
            status = line
                .split_whitespace()
                .nth(1)
                .and_then(|v| v.parse().ok())
                .unwrap_or(0);
            in_headers = true;
            quota_headers.clear();
            continue;
        }
        if let Some(code) = line.strip_prefix("forgekit-http-status:") {
            status = code.parse::<u16>().unwrap_or(0);
            continue;
        }
        if let Some(value) = line.to_ascii_lowercase().strip_prefix("retry-after:") {
            retry_after_ms = value
                .trim()
                .parse::<u64>()
                .unwrap_or(60)
                .saturating_mul(1000)
                .clamp(1000, 86_400_000);
        }
        if in_headers {
            if line.is_empty() {
                in_headers = false;
                crate::provider_usage::observe_api_headers(profile, &quota_headers);
            } else if let Some((name, value)) = line.split_once(':') {
                let name = name.to_ascii_lowercase();
                if name.starts_with("x-ratelimit-") && name.len() < 80 && value.len() < 100 {
                    quota_headers.insert(name, value.trim().to_owned());
                }
            }
            continue;
        }
        if status >= 300 && error_body.len() < 65536 {
            error_body.push_str(line);
            error_body.push('\n');
            continue;
        }
        if line.is_empty() && !data.is_empty() {
            crate::provider_usage::observe_event(profile, data.trim_end_matches('\n'));
            if let Some(chunk) =
                decoder.event(&profile.provider_type, data.trim_end_matches('\n')).map_err(|error| {
                    if !accumulated.is_empty() { format!("[UNKNOWN_RESULT] Respons parsial diterima. {error}") } else { error }
                })?
            {
                if accumulated.len().saturating_add(chunk.len()) > MAX_OUTPUT_BYTES {
                    return Err("[OUTPUT_LIMIT] Teks respons AI melampaui batas 2 MiB.".into());
                }
                accumulated.push_str(&chunk);
                on_chunk(&chunk)?;
            }
            data.clear();
        } else if let Some(value) = line.strip_prefix("data:") {
            if data.len().saturating_add(value.len()) + 1 > MAX_EVENT_BYTES {
                return Err("[OUTPUT_LIMIT] Event AI melampaui batas 4 MiB.".into());
            }
            data.push_str(value.strip_prefix(' ').unwrap_or(value));
            data.push('\n');
        }
    }
    if lease.control.cancelled.load(Ordering::SeqCst) {
        return Err("Permintaan dibatalkan.".into());
    }
    let transport_status = lease
        .control
        .child
        .lock()
        .map_err(|_| "State stream tidak tersedia.")?
        .as_mut()
        .ok_or("Stream sudah ditutup.")?
        .wait()
        .map_err(|_| "Status transport tidak tersedia.")?;
    if transport_status.code() == Some(28) {
        return Err("[REQUEST_TIMEOUT] Batas waktu request provider tercapai. Respons belum lengkap; request tidak dikirim ulang.".into());
    }
    if !transport_status.success() || !(200..300).contains(&status) {
        if !accumulated.is_empty() {
            return Err(
                "[UNKNOWN_RESULT] Respons parsial diterima; retry otomatis dihentikan.".into(),
            );
        }
        let error: Value = serde_json::from_str(&error_body).unwrap_or(Value::Null);
        let code = error["error"]["code"]
            .as_str()
            .or_else(|| error["error"]["type"].as_str())
            .unwrap_or("");
        return Err(match (status, code) {
            (_, "insufficient_quota" | "billing_hard_limit_reached" | "billing_not_active") => "[BILLING] Batas billing/budget provider tercapai; fallback dihentikan.".into(),
            (_, "safety" | "content_filter" | "permission_denied") => "[SAFETY] Permintaan ditolak; tidak mencoba akun lain.".into(),
            (401, _) if profile.provider_type == "9router" => "[AUTH] Credential gateway 9router ditolak. Periksa kunci inference router; status login upstream belum diketahui.".into(),
            (401, _) => "[AUTH] Credential dicabut atau tidak sah. Hubungkan ulang.".into(),
            (403, _) => "[SAFETY] Akses provider atau model ditolak.".into(),
            (429, _) => format!("[RATE_LIMIT retry_after_ms={retry_after_ms}] Batas penggunaan provider tercapai. Waktu pemulihan belum tersedia."),
            (400 | 404 | 413 | 422, _) => "[VALIDATION] Model, konteks, atau endpoint tidak tersedia/sesuai.".into(),
            (300..=399, _) => "[VALIDATION] Redirect endpoint ditolak.".into(),
            (502..=504, _) => "[OUTAGE] Gateway provider mengalami gangguan.".into(),
            _ => "[UNKNOWN_RESULT] Transport terputus atau timeout. Hasil belum diketahui; request tidak dikirim ulang.".into(),
        });
    }
    decoder.finish(accumulated)
}

// Database helper functions
pub fn list_profiles(conn: &Connection) -> Result<Vec<AiProviderProfile>, StorageError> {
    let mut stmt = conn.prepare(
        "SELECT id, name, provider_type, base_url, model, key_reference, is_default, created_at, updated_at FROM ai_provider_profile ORDER BY is_default DESC, name ASC"
    )?;
    let profiles = stmt
        .query_map([], |row| {
            Ok(AiProviderProfile {
                id: row.get(0)?,
                name: row.get(1)?,
                provider_type: row.get(2)?,
                base_url: row.get(3)?,
                model: row.get(4)?,
                reasoning_effort: None,
                key_reference: row.get(5)?,
                is_default: row.get::<_, i64>(6)? != 0,
                created_at: row.get(7)?,
                updated_at: row.get(8)?,
            })
        })?
        .collect::<Result<Vec<_>, _>>()?;
    Ok(profiles)
}

pub fn save_profile(conn: &Connection, profile: &AiProviderProfile) -> Result<(), StorageError> {
    validate_profile(profile).map_err(StorageError::InvalidInput)?;
    let transaction = conn.unchecked_transaction()?;
    let conn = &transaction;
    let now = now_string();
    if profile.is_default {
        conn.execute("UPDATE ai_provider_profile SET is_default = 0", [])?;
    }
    conn.execute(
        "INSERT INTO ai_provider_profile (id, name, provider_type, base_url, model, key_reference, is_default, created_at, updated_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)
         ON CONFLICT(id) DO UPDATE SET
            name = excluded.name,
            provider_type = excluded.provider_type,
            base_url = excluded.base_url,
            model = excluded.model,
            key_reference = excluded.key_reference,
            is_default = excluded.is_default,
            updated_at = excluded.updated_at",
        params![
            profile.id,
            profile.name,
            profile.provider_type,
            profile.base_url,
            profile.model,
            profile.key_reference,
            if profile.is_default { 1 } else { 0 },
            profile.created_at,
            now
        ],
    )?;
    transaction.commit()?;
    Ok(())
}

pub fn delete_profile(conn: &Connection, id: &str) -> Result<(), StorageError> {
    conn.execute("DELETE FROM ai_provider_profile WHERE id = ?1", [id])?;
    Ok(())
}

pub fn list_threads(conn: &Connection) -> Result<Vec<ChatThread>, StorageError> {
    let mut stmt = conn.prepare(
        "SELECT id, title, provider_id, model, system_prompt, created_at, updated_at FROM chat_thread ORDER BY updated_at DESC"
    )?;
    let threads = stmt
        .query_map([], |row| {
            Ok(ChatThread {
                id: row.get(0)?,
                title: row.get(1)?,
                provider_id: row.get(2)?,
                model: row.get(3)?,
                system_prompt: row.get(4)?,
                created_at: row.get(5)?,
                updated_at: row.get(6)?,
            })
        })?
        .collect::<Result<Vec<_>, _>>()?;
    Ok(threads)
}

pub fn create_thread(
    conn: &Connection,
    title: &str,
    provider_id: Option<&str>,
    model: &str,
    system_prompt: Option<&str>,
) -> Result<ChatThread, StorageError> {
    let id = next_id("thread");
    let now = now_string();
    conn.execute(
        "INSERT INTO chat_thread (id, title, provider_id, model, system_prompt, created_at, updated_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
        params![id, title, provider_id, model, system_prompt, now, now],
    )?;
    Ok(ChatThread {
        id,
        title: title.to_string(),
        provider_id: provider_id.map(str::to_string),
        model: model.to_string(),
        system_prompt: system_prompt.map(str::to_string),
        created_at: now.clone(),
        updated_at: now,
    })
}

pub fn rename_thread(conn: &Connection, id: &str, title: &str) -> Result<(), StorageError> {
    conn.execute(
        "UPDATE chat_thread SET title = ?2, updated_at = ?3 WHERE id = ?1",
        params![id, title, now_string()],
    )?;
    Ok(())
}

pub fn delete_thread(conn: &Connection, id: &str) -> Result<(), StorageError> {
    let tx = conn.unchecked_transaction()?;
    let requests = tx
        .prepare("SELECT request_id FROM chat_turn WHERE thread_id=?1")?
        .query_map([id], |r| r.get::<_, String>(0))?
        .collect::<Result<Vec<_>, _>>()?;
    tx.execute("DELETE FROM chat_turn WHERE thread_id=?1", [id])?;
    for request in requests {
        tx.execute("DELETE FROM ai_checkpoint WHERE task_id=?1", [&request])?;
        tx.execute("DELETE FROM creative_event WHERE task_id=?1", [&request])?;
        tx.execute("DELETE FROM creative_task WHERE id=?1", [&request])?;
    }
    tx.execute("DELETE FROM chat_thread WHERE id = ?1", [id])?;
    tx.commit()?;
    Ok(())
}

pub fn list_messages(conn: &Connection, thread_id: &str) -> Result<Vec<ChatMessage>, StorageError> {
    let mut stmt = conn.prepare(
        "SELECT id, thread_id, sequence, role, content, tool_calls_json, tool_results_json, token_usage_json, created_at
         FROM chat_message WHERE thread_id = ?1 ORDER BY sequence ASC"
    )?;
    let messages = stmt
        .query_map([thread_id], |row| {
            let tool_calls: Option<String> = row.get(5)?;
            let tool_results: Option<String> = row.get(6)?;
            let token_usage: Option<String> = row.get(7)?;
            Ok(ChatMessage {
                id: row.get(0)?,
                thread_id: row.get(1)?,
                sequence: row.get(2)?,
                role: row.get(3)?,
                content: row.get(4)?,
                tool_calls: tool_calls.and_then(|s| serde_json::from_str(&s).ok()),
                tool_results: tool_results.and_then(|s| serde_json::from_str(&s).ok()),
                token_usage: token_usage.and_then(|s| serde_json::from_str(&s).ok()),
                created_at: row.get(8)?,
            })
        })?
        .collect::<Result<Vec<_>, _>>()?;
    Ok(messages)
}

pub fn add_message(
    conn: &Connection,
    thread_id: &str,
    role: &str,
    content: &str,
    tool_calls: Option<&Value>,
    tool_results: Option<&Value>,
    token_usage: Option<&Value>,
) -> Result<ChatMessage, StorageError> {
    let id = next_id("msg");
    let now = now_string();
    let sequence: i64 = conn.query_row(
        "SELECT COALESCE(MAX(sequence), 0) + 1 FROM chat_message WHERE thread_id = ?1",
        [thread_id],
        |row| row.get(0),
    )?;
    conn.execute(
        "INSERT INTO chat_message (id, thread_id, sequence, role, content, tool_calls_json, tool_results_json, token_usage_json, created_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)",
        params![
            id,
            thread_id,
            sequence,
            role,
            content,
            tool_calls.map(|v| v.to_string()),
            tool_results.map(|v| v.to_string()),
            token_usage.map(|v| v.to_string()),
            now
        ],
    )?;
    conn.execute(
        "UPDATE chat_thread SET updated_at = ?2 WHERE id = ?1",
        params![thread_id, now],
    )?;
    Ok(ChatMessage {
        id,
        thread_id: thread_id.to_string(),
        sequence,
        role: role.to_string(),
        content: content.to_string(),
        tool_calls: tool_calls.cloned(),
        tool_results: tool_results.cloned(),
        token_usage: token_usage.cloned(),
        created_at: now,
    })
}

pub fn validate_connection_profile(profile: &ConnectionProfile) -> Result<(), String> {
    for (label, value, limit) in [
        ("ID", &profile.id, 128),
        ("Label", &profile.label, 100),
        ("Model", &profile.model, 200),
    ] {
        if value.trim().is_empty() || value.len() > limit || value.chars().any(char::is_control) {
            return Err(format!("{label} profil koneksi tidak sah."));
        }
    }
    if !profile
        .id
        .chars()
        .all(|c| c.is_ascii_alphanumeric() || "-_".contains(c))
        || !matches!(
            profile.access_state.as_str(),
            "pending" | "ready" | "identity_only" | "reauth_required" | "revoked"
        )
        || !matches!(
            profile.fallback_eligible.as_str(),
            "supported" | "unsupported" | "unknown"
        )
        || !(0..=1000).contains(&profile.priority)
        || profile.quota_bucket_refs.is_empty()
        || profile.quota_bucket_refs.len() > 16
        || profile
            .quota_bucket_refs
            .iter()
            .any(|b| b.is_empty() || b.len() > 256 || b.chars().any(char::is_control))
        || !matches!(
            (
                profile.connection_mode.as_str(),
                profile.credential_owner.as_str(),
                profile.auth_method.as_str()
            ),
            (
                "direct",
                "forgekit",
"api_key" | "local_runtime" | "oauth_browser" | "codex_oauth"
            ) | ("router", "router", "router_dashboard")
        )
    {
        return Err("Metadata, scope credential, atau metode autentikasi tidak didukung.".into());
    }
    if (profile.auth_method == "codex_oauth") != (profile.base_url.trim_end_matches('/') == crate::auth::codex::BASE_URL)
        || (profile.auth_method == "codex_oauth" && profile.provider_id != "openai") {
        return Err("Login Codex harus memakai endpoint dan profil Codex milik ForgeKit.".into());
    }
    if profile.auth_method == "oauth_browser" && profile.provider_id != "google-gemini"
    {
        return Err("ChatGPT memakai login Codex. OAuth browser langsung hanya tersedia untuk Google.".into());
    }
    crate::connections::validate_url(&profile.base_url)?;
    if profile.connection_mode == "direct" {
        crate::connections::legacy(profile, None)?;
    }
    Ok(())
}

pub fn list_connection_profiles(conn: &Connection) -> Result<Vec<ConnectionProfile>, StorageError> {
    let mut stmt = conn.prepare(
        "SELECT id, provider_id, connection_mode, credential_owner, router_instance_id,
                upstream_connection_ref, auth_method, label, identity_json, registration_ref,
                credential_ref, access_state, enabled, fallback_eligible, fallback_disabled_reason,
                priority, quota_bucket_refs_json, base_url, model, is_default, created_at, updated_at
         FROM connection_profile ORDER BY priority ASC, is_default DESC, label ASC"
    )?;
    let profiles = stmt
        .query_map([], |row| {
            let identity_json: Option<String> = row.get(8)?;
            let quota_json: String = row.get(16)?;
            Ok(ConnectionProfile {
                id: row.get(0)?,
                provider_id: row.get(1)?,
                connection_mode: row.get(2)?,
                credential_owner: row.get(3)?,
                router_instance_id: row.get(4)?,
                upstream_connection_ref: row.get(5)?,
                auth_method: row.get(6)?,
                label: row.get(7)?,
                identity: identity_json.and_then(|s| serde_json::from_str(&s).ok()),
                registration_ref: row.get(9)?,
                credential_ref: row.get(10)?,
                access_state: row.get(11)?,
                enabled: row.get::<_, i64>(12)? != 0,
                fallback_eligible: row.get(13)?,
                fallback_disabled_reason: row.get(14)?,
                priority: row.get(15)?,
                quota_bucket_refs: serde_json::from_str(&quota_json).unwrap_or_default(),
                base_url: row.get(17)?,
                model: row.get(18)?,
                is_default: row.get::<_, i64>(19)? != 0,
                created_at: row.get(20)?,
                updated_at: row.get(21)?,
            })
        })?
        .collect::<Result<Vec<_>, _>>()?;
    Ok(profiles)
}

pub fn save_connection_profile(
    conn: &Connection,
    profile: &ConnectionProfile,
) -> Result<(), StorageError> {
    validate_connection_profile(profile).map_err(StorageError::InvalidInput)?;
    let router = get_router_connection(conn)?;
    let legacy =
        crate::connections::legacy(profile, Some(&router)).map_err(StorageError::InvalidInput)?;
    let existing = list_connection_profiles(conn)?;
    if let Some(old) = existing.iter().find(|old| old.id == profile.id) {
        crate::connections::validate_destination(old, profile)
            .map_err(StorageError::InvalidInput)?;
    }
    if existing.iter().any(|other| {
        other.id != profile.id
            && profile.credential_ref.is_some()
            && other.credential_ref == profile.credential_ref
    }) || existing
        .iter()
        .any(|other| other.id == profile.id && other.credential_ref != profile.credential_ref)
    {
        return Err(StorageError::InvalidInput(
            "Referensi credential unik dan tidak boleh diganti antar koneksi.".into(),
        ));
    }
    let transaction = conn.unchecked_transaction()?;
    let conn_tx = &transaction;
    let now = now_string();
    if profile.is_default {
        conn_tx.execute("UPDATE connection_profile SET is_default = 0", [])?;
    }
    let identity_str = profile.identity.as_ref().map(|v| v.to_string());
    let quota_str =
        serde_json::to_string(&profile.quota_bucket_refs).unwrap_or_else(|_| "[]".into());
    conn_tx.execute(
        "INSERT INTO connection_profile (
            id, provider_id, connection_mode, credential_owner, router_instance_id,
            upstream_connection_ref, auth_method, label, identity_json, registration_ref,
            credential_ref, access_state, enabled, fallback_eligible, fallback_disabled_reason,
            priority, quota_bucket_refs_json, base_url, model, is_default, created_at, updated_at
        ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15, ?16, ?17, ?18, ?19, ?20, ?21, ?22)
        ON CONFLICT(id) DO UPDATE SET
            provider_id = excluded.provider_id,
            connection_mode = excluded.connection_mode,
            credential_owner = excluded.credential_owner,
            router_instance_id = excluded.router_instance_id,
            upstream_connection_ref = excluded.upstream_connection_ref,
            auth_method = excluded.auth_method,
            label = excluded.label,
            identity_json = excluded.identity_json,
            registration_ref = excluded.registration_ref,
            credential_ref = excluded.credential_ref,
            access_state = excluded.access_state,
            enabled = excluded.enabled,
            fallback_eligible = excluded.fallback_eligible,
            fallback_disabled_reason = excluded.fallback_disabled_reason,
            priority = excluded.priority,
            quota_bucket_refs_json = excluded.quota_bucket_refs_json,
            base_url = excluded.base_url,
            model = excluded.model,
            is_default = excluded.is_default,
            updated_at = excluded.updated_at",
        params![
            profile.id,
            profile.provider_id,
            profile.connection_mode,
            profile.credential_owner,
            profile.router_instance_id,
            profile.upstream_connection_ref,
            profile.auth_method,
            profile.label,
            identity_str,
            profile.registration_ref,
            profile.credential_ref,
            profile.access_state,
            if profile.enabled { 1 } else { 0 },
            profile.fallback_eligible,
            profile.fallback_disabled_reason,
            profile.priority,
            quota_str,
            profile.base_url,
            profile.model,
            if profile.is_default { 1 } else { 0 },
            profile.created_at,
            now
        ],
    )?;

    if profile.is_default {
        conn_tx.execute("UPDATE ai_provider_profile SET is_default = 0", [])?;
    }
    conn_tx.execute(
        "INSERT INTO ai_provider_profile (id, name, provider_type, base_url, model, key_reference, is_default, created_at, updated_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)
         ON CONFLICT(id) DO UPDATE SET
            name = excluded.name,
            provider_type = excluded.provider_type,
            base_url = excluded.base_url,
            model = excluded.model,
            key_reference = excluded.key_reference,
            is_default = excluded.is_default,
            updated_at = excluded.updated_at",
        params![
            profile.id,
            profile.label,
            legacy.provider_type,
            legacy.base_url,
            profile.model,
            legacy.key_reference,
            if profile.is_default { 1 } else { 0 },
            profile.created_at,
            now
        ],
    )?;

    transaction.commit()?;
    Ok(())
}

pub fn delete_connection_profile(conn: &Connection, id: &str) -> Result<(), StorageError> {
    let tx = conn.unchecked_transaction()?;
    tx.execute("DELETE FROM connection_profile WHERE id = ?1", [id])?;
    tx.execute("DELETE FROM ai_provider_profile WHERE id = ?1", [id])?;
    tx.execute("UPDATE fallback_policy SET ordered_profile_ids_json=(SELECT json_group_array(value) FROM json_each(ordered_profile_ids_json) WHERE value != ?1)",[id])?;
    tx.commit()?;
    Ok(())
}

pub fn set_primary_connection_profile(conn: &Connection, id: &str) -> Result<(), StorageError> {
    let tx = conn.unchecked_transaction()?;
    tx.execute("UPDATE connection_profile SET is_default = 0", [])?;
    tx.execute("UPDATE ai_provider_profile SET is_default = 0", [])?;
    let affected = tx.execute(
        "UPDATE connection_profile SET is_default = 1 WHERE id = ?1",
        [id],
    )?;
    if affected == 0 {
        return Err(StorageError::NotFound(
            "Profil koneksi tidak ditemukan.".into(),
        ));
    }
    tx.execute(
        "UPDATE ai_provider_profile SET is_default = 1 WHERE id = ?1",
        [id],
    )?;
    tx.commit()?;
    Ok(())
}

pub fn get_fallback_policy(conn: &Connection) -> Result<FallbackPolicy, StorageError> {
    let mut stmt = conn.prepare(
        "SELECT id, enabled, ordered_profile_ids_json, allowed_provider_ids_json,
                allow_cross_provider, allow_model_change, routing_owner, max_attempts,
                max_elapsed_ms, budget_policy_id, data_policy_id
         FROM fallback_policy LIMIT 1",
    )?;
    let result = stmt.query_row([], |row| {
        let ordered_json: String = row.get(2)?;
        let allowed_json: String = row.get(3)?;
        Ok(FallbackPolicy {
            id: row.get(0)?,
            enabled: row.get::<_, i64>(1)? != 0,
            ordered_profile_ids: serde_json::from_str(&ordered_json).unwrap_or_default(),
            allowed_provider_ids: serde_json::from_str(&allowed_json).unwrap_or_default(),
            allow_cross_provider: row.get::<_, i64>(4)? != 0,
            allow_model_change: row.get::<_, i64>(5)? != 0,
            routing_owner: row.get(6)?,
            max_attempts: row.get(7)?,
            max_elapsed_ms: row.get(8)?,
            budget_policy_id: row.get(9)?,
            data_policy_id: row.get(10)?,
        })
    });
    match result {
        Ok(policy) => Ok(policy),
        Err(rusqlite::Error::QueryReturnedNoRows) => Ok(FallbackPolicy {
            id: "default-fallback-policy".into(),
            enabled: false,
            ordered_profile_ids: vec![],
            allowed_provider_ids: vec![
                "openai".into(),
                "claude".into(),
                "antigravity-9router".into(),
                "google-gemini".into(),
                "openai-compatible".into(),
            ],
            allow_cross_provider: false,
            allow_model_change: false,
            routing_owner: "forgekit".into(),
            max_attempts: 2,
            max_elapsed_ms: 60000,
            budget_policy_id: None,
            data_policy_id: None,
        }),
        Err(e) => Err(StorageError::Sqlite(e)),
    }
}

pub fn save_fallback_policy(
    conn: &Connection,
    policy: &FallbackPolicy,
) -> Result<(), StorageError> {
    if policy.id != "default-fallback-policy"
        || policy.routing_owner != "forgekit"
        || !(1..=5).contains(&policy.max_attempts)
        || !(1000..=120000).contains(&policy.max_elapsed_ms)
        || policy.ordered_profile_ids.len() > 100
        || policy.allowed_provider_ids.len() > 100
        || policy.budget_policy_id.is_some()
        || policy.data_policy_id.is_some()
    {
        return Err(StorageError::InvalidInput(
            "Kebijakan fallback tidak didukung atau melewati batas build ini.".into(),
        ));
    }
    let profiles = list_connection_profiles(conn)?;
    let mut unique = std::collections::HashSet::new();
    if policy.ordered_profile_ids.iter().any(|id| {
        !unique.insert(id)
            || !profiles
                .iter()
                .any(|p| &p.id == id && p.connection_mode == "direct")
    }) {
        return Err(StorageError::InvalidInput(
            "Cadangan harus koneksi langsung tersimpan dan tidak boleh duplikat.".into(),
        ));
    }
    let ordered_str =
        serde_json::to_string(&policy.ordered_profile_ids).unwrap_or_else(|_| "[]".into());
    let allowed_str =
        serde_json::to_string(&policy.allowed_provider_ids).unwrap_or_else(|_| "[]".into());
    conn.execute(
        "INSERT INTO fallback_policy (
            id, enabled, ordered_profile_ids_json, allowed_provider_ids_json,
            allow_cross_provider, allow_model_change, routing_owner, max_attempts,
            max_elapsed_ms, budget_policy_id, data_policy_id
        ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11)
        ON CONFLICT(id) DO UPDATE SET
            enabled = excluded.enabled,
            ordered_profile_ids_json = excluded.ordered_profile_ids_json,
            allowed_provider_ids_json = excluded.allowed_provider_ids_json,
            allow_cross_provider = excluded.allow_cross_provider,
            allow_model_change = excluded.allow_model_change,
            routing_owner = excluded.routing_owner,
            max_attempts = excluded.max_attempts,
            max_elapsed_ms = excluded.max_elapsed_ms,
            budget_policy_id = excluded.budget_policy_id,
            data_policy_id = excluded.data_policy_id",
        params![
            policy.id,
            if policy.enabled { 1 } else { 0 },
            ordered_str,
            allowed_str,
            if policy.allow_cross_provider { 1 } else { 0 },
            if policy.allow_model_change { 1 } else { 0 },
            policy.routing_owner,
            policy.max_attempts,
            policy.max_elapsed_ms,
            policy.budget_policy_id,
            policy.data_policy_id,
        ],
    )?;
    Ok(())
}

pub fn get_router_connection(conn: &Connection) -> Result<RouterConnection, StorageError> {
    let mut stmt = conn.prepare(
        "SELECT id, kind, base_url, dashboard_url, inference_credential_ref,
                management_credential_ref, detected_version, management_access,
                routing_owner, last_verified_at
         FROM router_connection LIMIT 1",
    )?;
    let result = stmt.query_row([], |row| {
        Ok(RouterConnection {
            id: row.get(0)?,
            kind: row.get(1)?,
            base_url: row.get(2)?,
            dashboard_url: row.get(3)?,
            inference_credential_ref: row.get(4)?,
            management_credential_ref: row.get(5)?,
            detected_version: row.get(6)?,
            management_access: row.get(7)?,
            routing_owner: row.get(8)?,
            last_verified_at: row.get(9)?,
        })
    });
    match result {
        Ok(router) => Ok(router),
        Err(rusqlite::Error::QueryReturnedNoRows) => Ok(RouterConnection {
            id: "default-9router".into(),
            kind: "9router".into(),
            base_url: "http://127.0.0.1:20128".into(),
            dashboard_url: Some("http://127.0.0.1:20128".into()),
            inference_credential_ref: "9router-inference-key".into(),
            management_credential_ref: None,
            detected_version: None,
            management_access: "unknown".into(),
            routing_owner: "router".into(),
            last_verified_at: None,
        }),
        Err(e) => Err(StorageError::Sqlite(e)),
    }
}

pub fn save_router_connection(
    conn: &Connection,
    router: &RouterConnection,
) -> Result<(), StorageError> {
    crate::connections::validate_router(router).map_err(StorageError::InvalidInput)?;
    conn.execute(
        "INSERT INTO router_connection (
            id, kind, base_url, dashboard_url, inference_credential_ref,
            management_credential_ref, detected_version, management_access,
            routing_owner, last_verified_at
        ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10)
        ON CONFLICT(id) DO UPDATE SET
            kind = excluded.kind,
            base_url = excluded.base_url,
            dashboard_url = excluded.dashboard_url,
            inference_credential_ref = excluded.inference_credential_ref,
            management_credential_ref = excluded.management_credential_ref,
            detected_version = excluded.detected_version,
            management_access = excluded.management_access,
            routing_owner = excluded.routing_owner,
            last_verified_at = excluded.last_verified_at",
        params![
            router.id,
            router.kind,
            router.base_url,
            router.dashboard_url,
            router.inference_credential_ref,
            router.management_credential_ref,
            router.detected_version,
            router.management_access,
            router.routing_owner,
            router.last_verified_at,
        ],
    )?;
    Ok(())
}

pub fn record_task_attempt(conn: &Connection, attempt: &TaskAttempt) -> Result<(), StorageError> {
    conn.execute(
        "INSERT INTO task_attempt (
            id, task_id, profile_id, provider_id, model_id, checkpoint_id,
            status, started_at, completed_at, provider_request_id, provider_job_id, error
        ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12)
        ON CONFLICT(id) DO UPDATE SET
            status = excluded.status,
            completed_at = excluded.completed_at,
            error = excluded.error",
        params![
            attempt.id,
            attempt.task_id,
            attempt.profile_id,
            attempt.provider_id,
            attempt.model_id,
            attempt.checkpoint_id,
            attempt.status,
            attempt.started_at,
            attempt.completed_at,
            attempt.provider_request_id,
            attempt.provider_job_id,
            attempt.error,
        ],
    )?;
    Ok(())
}

pub fn test_router_connection(router: &RouterConnection) -> Result<ProviderTestResult, String> {
    let start = Instant::now();
    let result = crate::connections::probe_router(router);
    Ok(ProviderTestResult {
        ok: result.is_ok(),
        latency_ms: start.elapsed().as_millis() as u64,
        model_count: result.as_ref().ok().map(|r| r.models.len()),
        message: result.map(|r| r.message.to_string()).unwrap_or_else(|e| e),
    })
}

pub fn create_connect_session(
    provider_id: &str,
    router_base_url: Option<&str>,
) -> Result<ProviderConnectSession, String> {
    if provider_id != "antigravity-9router" {
        let (url, message) = match provider_id {
            "claude" => ("https://platform.claude.com/settings/keys", "Claude Console resmi dibuka. Aplikasi pihak ketiga seperti ForgeKit memakai API resmi Claude; login website saja belum memberikan akses AI. Hubungkan kunci melalui tombol Koneksi API."),
            "google-gemini" => ("https://aistudio.google.com/", "Google AI Studio dibuka. OAuth Google memerlukan registrasi client ForgeKit dan project Google Cloud. Login website belum menyambungkan AI; koneksi API tersedia di pengaturan lanjutan."),
            _ => return Err("Provider browser tidak didukung.".into()),
        };
        return Ok(ProviderConnectSession {
            session_id: next_id("portal"),
            provider_id: provider_id.into(),
            mode: "direct".into(),
            auth_url: url.into(),
            status: "setup_required".into(),
            expires_at: String::new(),
            message: Some(message.into()),
        });
    }
    let base = router_base_url.ok_or("Kaitkan gateway 9router terlebih dahulu.")?;
    crate::connections::validate_url(base)?;
    let root = base.trim_end_matches('/').trim_end_matches("/v1");
    Ok(ProviderConnectSession {
        session_id: next_id("dashboard"), provider_id: provider_id.into(), mode: "router".into(),
        auth_url: format!("{root}/dashboard/providers/antigravity"), status: "awaiting_verification".into(),
        expires_at: String::new(),
        message: Some("Kelola Add Connection di 9router lalu kembali dan periksa akses model. Login upstream belum teramati. Antigravity deprecated: RISK_NOTICE.".into()),
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[cfg(target_os = "macos")]
    #[test]
    fn cached_secret_is_readable_while_another_task_uses_the_keychain() {
        let account = next_id("concurrent-fixture");
        cache_keychain_secret(&account, Some("concurrent-fixture-secret")).unwrap();
        // Simulate another task holding the cache briefly, then an OS call in progress.
        let cache = KEYCHAIN_ACCESS.lock().unwrap();
        let reader = {
            let account = account.clone();
            std::thread::spawn(move || optional_keychain_secret(&account))
        };
        std::thread::sleep(std::time::Duration::from_millis(50));
        drop(cache);
        assert_eq!(reader.join().unwrap().unwrap().as_deref(), Some("concurrent-fixture-secret"));
        let os = KEYCHAIN_OS.lock().unwrap();
        assert_eq!(optional_keychain_secret(&account).unwrap().as_deref(), Some("concurrent-fixture-secret"));
        drop(os);
        cache_keychain_secret(&account, None).unwrap();
    }

    #[cfg(target_os = "macos")]
    #[test]
    fn authorized_keychain_reads_remain_scoped_to_the_selected_account() {
        let first = next_id("authorized-fixture-a");
        let second = next_id("authorized-fixture-b");
        {
            let mut access = KEYCHAIN_ACCESS.lock().unwrap();
            let items = access.get_or_insert_with(HashMap::new);
            items.insert(first.clone(), "first-fixture-secret".into());
            items.insert(second.clone(), "second-fixture-secret".into());
        }
        assert_eq!(optional_keychain_secret(&first).unwrap().as_deref(), Some("first-fixture-secret"));
        assert_eq!(optional_keychain_secret(&second).unwrap().as_deref(), Some("second-fixture-secret"));
        let mut access = KEYCHAIN_ACCESS.lock().unwrap();
        let items = access.as_mut().unwrap();
        items.remove(&first);
        items.remove(&second);
    }

    fn profile(adapter: &str, endpoint: &str) -> AiProviderProfile {
        let key_reference = next_id("transport-fixture");
        #[cfg(target_os = "macos")]
        KEYCHAIN_ACCESS.lock().unwrap().get_or_insert_with(HashMap::new).insert(key_reference.clone(), "fixture-secret".into());
        AiProviderProfile {
            id: "test".into(),
            name: "Test".into(),
            provider_type: adapter.into(),
            base_url: endpoint.into(),
            model: "fixture-model".into(),
            reasoning_effort: None,
            key_reference,
            is_default: false,
            created_at: now_string(),
            updated_at: now_string(),
        }
    }

    #[test]
    fn reasoning_selection_reaches_each_protocol() {
        for (adapter, base) in [
            ("openai", "https://api.openai.com/v1"),
            ("anthropic", "https://api.anthropic.com/v1"),
            (
                "gemini",
                "https://generativelanguage.googleapis.com/v1beta/openai",
            ),
        ] {
            let mut p = profile(adapter, base);
            p.model = "chosen-model".into();
            p.reasoning_effort = Some("high".into());
            let (_, body) = request(&p, &[json!({"role":"user","content":"Hello"})]).unwrap();
            assert_eq!(body["model"], "chosen-model");
            match adapter {
                "openai" => assert_eq!(body["reasoning"]["effort"], "high"),
                "anthropic" => assert_eq!(body["output_config"]["effort"], "high"),
                _ => assert_eq!(body["reasoning_effort"], "high"),
            }
            p.reasoning_effort = None;
            let (_, body) = request(&p, &[]).unwrap();
            assert!(
                body.get("reasoning").is_none()
                    && body.get("output_config").is_none()
                    && body.get("reasoning_effort").is_none()
            );
        }
    }

    #[test]
    fn protocols_have_distinct_requests_and_secure_endpoints() {
        let messages = [
            json!({"role":"system","content":"Rules"}),
            json!({"role":"user","content":"Hello"}),
        ];
        let (url, payload) =
            request(&profile("openai", "https://api.openai.com/v1"), &messages).unwrap();
        assert!(url.ends_with("/responses"));
        assert_eq!(payload["input"], json!(messages));
        assert_eq!(payload["store"], false);
        let (codex_url, codex_payload) = request(&profile("openai", crate::auth::codex::BASE_URL), &messages).unwrap();
        assert_eq!(codex_url, "https://chatgpt.com/backend-api/codex/responses");
        assert_eq!(codex_payload["instructions"], "Rules");
        assert_eq!(codex_payload["input"], json!([messages[1]]));
        assert!(codex_payload.get("max_output_tokens").is_none());
        assert_eq!(codex_payload["stream"], true);
        let (url, payload) = request(
            &profile("anthropic", "https://api.anthropic.com/v1"),
            &messages,
        )
        .unwrap();
        assert!(url.ends_with("/messages"));
        assert_eq!(payload["system"], "Rules");
        assert_eq!(payload["messages"].as_array().unwrap().len(), 1);
        assert!(request(&profile("openai", "https://other.example/v1"), &messages).is_err());
        for endpoint in [
            "http://remote.example/v1",
            "https://key@host.example/v1",
            "https://host.example?key=secret",
            "file:///tmp/key",
        ] {
            assert!(validate_profile(&profile("openai-compatible", endpoint)).is_err());
        }
        assert!(validate_profile(&profile("local-llm", "http://127.0.0.1:1234/v1")).is_ok());
        assert!(validate_profile(&profile("local-llm", "https://remote.example/v1")).is_err());
    }

    #[test]
    fn stream_completion_requires_native_terminal_events() {
        let mut openai = StreamDecoder::default();
        assert_eq!(
            openai
                .event(
                    "openai",
                    r#"{"type":"response.output_text.delta","delta":"OK"}"#
                )
                .unwrap(),
            Some("OK".into())
        );
        assert!(!openai.completed);
        openai
            .event(
                "openai",
                r#"{"type":"response.completed","response":{"status":"completed"}}"#,
            )
            .unwrap();
        assert!(openai.completed);
        assert!(openai
            .event("openai", r#"{"type":"response.incomplete"}"#)
            .is_err());
        let mut claude = StreamDecoder::default();
        claude
            .event("anthropic", r#"{"type":"message_stop"}"#)
            .unwrap();
        assert!(!claude.completed);
        assert!(claude
            .event(
                "anthropic",
                r#"{"type":"message_delta","delta":{"stop_reason":"tool_use"}}"#
            )
            .is_err());
        claude
            .event(
                "anthropic",
                r#"{"type":"message_delta","delta":{"stop_reason":"end_turn"}}"#,
            )
            .unwrap();
        claude
            .event("anthropic", r#"{"type":"message_stop"}"#)
            .unwrap();
        assert!(claude.completed);
        let mut compatible = StreamDecoder::default();
        assert!(compatible.event("local-llm", "[DONE]").is_err());
        assert!(compatible
            .event("local-llm", r#"{"choices":[{"finish_reason":"length"}]}"#)
            .is_err());
        compatible
            .event("local-llm", r#"{"choices":[{"finish_reason":"stop"}]}"#)
            .unwrap();
        compatible.event("local-llm", "[DONE]").unwrap();
        assert!(compatible.completed);
    }

    #[test]
    fn stream_lease_blocks_overlap_and_cancellation_survives_before_spawn() {
        let id = next_id("lease-test");
        let lease = begin_stream(&id).unwrap();
        assert!(begin_stream(&id).is_err());
        cancel_ai_stream(&id);
        assert!(lease.control.cancelled.load(Ordering::SeqCst));
        drop(lease);
        assert!(begin_stream(&id).is_ok());
    }

    #[test]
    fn stream_lease_blocks_across_processes_and_releases() {
        if let Ok(id) = std::env::var("FORGEKIT_LEASE_TEST_ID") {
            let blocked = std::env::var("FORGEKIT_LEASE_EXPECT_BLOCKED").unwrap() == "yes";
            assert_eq!(begin_stream(&id).is_err(), blocked);
            return;
        }
        let id = next_id("cross-process-lease");
        let lease = begin_stream(&id).unwrap();
        let check = |blocked| {
            let result = std::process::Command::new(std::env::current_exe().unwrap())
                .args(["--exact", "ai::tests::stream_lease_blocks_across_processes_and_releases"])
                .env("FORGEKIT_LEASE_TEST_ID", &id)
                .env("FORGEKIT_LEASE_EXPECT_BLOCKED", if blocked {"yes"} else {"no"})
                .output().unwrap();
            assert!(result.status.success(), "{}", String::from_utf8_lossy(&result.stdout));
        };
        check(true);
        drop(lease);
        check(false);
    }
    #[test]
    fn curl_transport_round_trip_and_truncated_stream() {
        use std::net::TcpListener;
        use std::thread;
        for (complete, large) in [(true, false), (false, false), (true, true)] {
            let listener = TcpListener::bind("127.0.0.1:0").unwrap();
            let endpoint = format!("http://{}/v1", listener.local_addr().unwrap());
            // Bounded accept: if the client fails before connecting, the test must report
            // the client error instead of blocking forever in accept()/join().
            listener.set_nonblocking(true).unwrap();
            let server = thread::spawn(move || {
                let deadline = std::time::Instant::now() + std::time::Duration::from_secs(20);
                let socket = loop {
                    match listener.accept() {
                        Ok((socket, _)) => break socket,
                        Err(error) if error.kind() == std::io::ErrorKind::WouldBlock => {
                            assert!(std::time::Instant::now() < deadline, "client never connected");
                            thread::sleep(std::time::Duration::from_millis(10));
                        }
                        Err(error) => panic!("accept failed: {error}"),
                    }
                };
                socket.set_nonblocking(false).unwrap();
                socket
                    .set_read_timeout(Some(std::time::Duration::from_secs(5)))
                    .unwrap();
                let mut reader = BufReader::new(socket);
                let mut first = String::new();
                reader.read_line(&mut first).unwrap();
                assert!(first.starts_with("POST /v1/chat/completions "));
                let mut length = 0;
                loop {
                    let mut header = String::new();
                    reader.read_line(&mut header).unwrap();
                    if header == "\r\n" {
                        break;
                    }
                    if header.to_ascii_lowercase().starts_with("content-length:") {
                        length = header.split(':').nth(1).unwrap().trim().parse().unwrap();
                    }
                }
                let mut body = vec![0; length];
                reader.read_exact(&mut body).unwrap();
                let payload: Value = serde_json::from_slice(&body).unwrap();
                assert_eq!(payload["messages"][0]["content"], "fixture input");
                let mut response =
                    "data: {\"choices\":[{\"delta\":{\"content\":\"OK\"}}]}\n\n".to_string();
                if large {
                    // Real SSE overhead can exceed 2 MiB with a small valid output.
                    let metadata = "x".repeat(200);
                    let delta = format!("data: {{\"choices\":[{{\"delta\":{{\"content\":\"x\"}}}}],\"metadata\":\"{metadata}\"}}\n\n");
                    for _ in 0..10000 { response.push_str(&delta); }
                    assert!(response.len() > 2 * 1024 * 1024);
                }
                if complete {
                    response.push_str(
                        "data: {\"choices\":[{\"finish_reason\":\"stop\"}]}\n\ndata: [DONE]\n\n",
                    );
                }
                write!(reader.get_mut(), "HTTP/1.1 200 OK\r\nContent-Type: text/event-stream\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{}", response.len(), response).unwrap();
            });
            let lease = begin_stream(&next_id("transport-test")).unwrap();
            let result = execute_ai_stream(
                &profile("local-llm", &endpoint),
                &lease,
                &[json!({"role":"user","content":"fixture input"})],
                |_| Ok(()),
            );
            if server.join().is_err() {
                panic!("fixture server failed (complete={complete}, large={large}); client result: {result:?}");
            }
            if complete {
                assert_eq!(result.unwrap(), if large { format!("OK{}", "x".repeat(10000)) } else { "OK".into() });
            } else {
                assert!(result.unwrap_err().contains("sebelum respons"));
            }
        }
    }

    #[test]
    fn reference_png_larger_than_old_text_cap_reaches_selected_provider() {
        use base64::Engine;
        use std::net::TcpListener;
        let mut pixels = vec![0u8; 512 * 512 * 3];
        let mut seed = 1u32;
        for pixel in &mut pixels {
            seed ^= seed << 13;
            seed ^= seed >> 17;
            seed ^= seed << 5;
            *pixel = seed as u8;
        }
        let mut png = vec![];
        {
            let mut encoder = png::Encoder::new(&mut png, 512, 512);
            encoder.set_color(png::ColorType::Rgb);
            let mut writer = encoder.write_header().unwrap();
            writer.write_image_data(&pixels).unwrap();
        }
        let image = crate::references::ReferenceImage {
            name: "large-reference.png".into(),
            data_url: format!("data:image/png;base64,{}", base64::engine::general_purpose::STANDARD.encode(&png)),
            ..Default::default()
        };
        let mut message = json!({"role":"user","content":"Buat sabit dari gambar"});
        crate::references::attach(&mut message, &[image]).unwrap();
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        let endpoint = format!("http://{}/v1", listener.local_addr().unwrap());
        let server = std::thread::spawn(move || {
            let (socket, _) = listener.accept().unwrap();
            socket.set_read_timeout(Some(std::time::Duration::from_secs(5))).unwrap();
            let mut reader = BufReader::new(socket);
            let mut length = 0usize;
            loop {
                let mut line = String::new();
                reader.read_line(&mut line).unwrap();
                if line == "\r\n" { break; }
                if let Some(value) = line.to_ascii_lowercase().strip_prefix("content-length:") {
                    length = value.trim().parse().unwrap();
                }
            }
            assert!(length > 256 * 1024);
            let mut body = vec![0; length];
            reader.read_exact(&mut body).unwrap();
            let payload: Value = serde_json::from_slice(&body).unwrap();
            assert!(payload["messages"][0]["content"].as_array().unwrap().iter().any(|block| block["image_url"]["url"].as_str().is_some_and(|url| url.starts_with("data:image/png;base64,"))));
            let response = "data: {\"choices\":[{\"delta\":{\"content\":\"OK\"},\"finish_reason\":\"stop\"}]}\n\ndata: [DONE]\n\n";
            write!(reader.get_mut(),"HTTP/1.1 200 OK\r\nContent-Type: text/event-stream\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{response}",response.len()).unwrap();
        });
        let lease = begin_stream(&next_id("large-reference-transport")).unwrap();
        let result = execute_ai_stream(&profile("openai-compatible", &endpoint), &lease, &[message], |_| Ok(()));
        server.join().unwrap();
        assert_eq!(result.unwrap(), "OK");
    }

    #[test]
    fn http_errors_preserve_retry_after_without_rotating_billing_or_safety() {
        use std::net::TcpListener;
        for (status, body, prefix) in [
            (
                "429 Too Many Requests",
                "{\n \"error\": {\n \"code\": \"insufficient_quota\"\n }\n}",
                "[BILLING]",
            ),
            (
                "429 Too Many Requests",
                r#"{"error":{"code":"rate_limit_exceeded"}}"#,
                "[RATE_LIMIT retry_after_ms=7000]",
            ),
            (
                "403 Forbidden",
                r#"{"error":{"code":"permission_denied"}}"#,
                "[SAFETY]",
            ),
            (
                "503 Service Unavailable",
                r#"{"error":{"code":"overloaded"}}"#,
                "[OUTAGE]",
            ),
            (
                "401 Unauthorized",
                "fixture-secret-must-not-be-echoed",
                "[AUTH]",
            ),
        ] {
            let listener = TcpListener::bind("127.0.0.1:0").unwrap();
            let endpoint = format!("http://{}/v1", listener.local_addr().unwrap());
            let server = std::thread::spawn(move || {
                let (socket, _) = listener.accept().unwrap();
                socket
                    .set_read_timeout(Some(std::time::Duration::from_secs(5)))
                    .unwrap();
                let mut reader = BufReader::new(socket);
                let mut length = 0;
                loop {
                    let mut line = String::new();
                    assert!(reader.read_line(&mut line).unwrap() > 0);
                    if line == "\r\n" {
                        break;
                    }
                    if let Some(value) = line.to_ascii_lowercase().strip_prefix("content-length:") {
                        length = value.trim().parse().unwrap();
                    }
                }
                reader.read_exact(&mut vec![0; length]).unwrap();
                write!(reader.get_mut(), "HTTP/1.1 {status}\r\nRetry-After: 7\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{body}", body.len()).unwrap();
            });
            let lease = begin_stream(&next_id("http-error-test")).unwrap();
            let error = execute_ai_stream_limited(
                &profile("local-llm", &endpoint),
                &lease,
                &[json!({"role":"user","content":"fixture"})],
                10,
                32,
                |_| Ok(()),
            )
            .unwrap_err();
            server.join().unwrap();
            assert!(error.starts_with(prefix), "{error}");
            assert!(!error.contains("fixture-secret"));
        }
    }

    #[test]
    fn tool_loop_transport_enforces_budget_replay_and_cancellation() {
        use crate::context::ContextSnapshot;
        use std::net::TcpListener;
        for scenario in ["complete", "replay", "budget", "cancel"] {
            let count = match scenario {
                "complete" => 2,
                "replay" => 3,
                "budget" => crate::tools::MAX_ROUNDS,
                _ => 1,
            };
            let listener = TcpListener::bind("127.0.0.1:0").unwrap();
            let endpoint = format!("http://{}/v1", listener.local_addr().unwrap());
            listener.set_nonblocking(true).unwrap();
            let server = std::thread::spawn(move || {
                for round in 0..count {
                    let started = Instant::now();
                    let socket = loop {
                        match listener.accept() {
                            Ok((socket, _)) => break socket,
                            Err(error)
                                if error.kind() == std::io::ErrorKind::WouldBlock
                                    && started.elapsed().as_secs() < 10 =>
                            {
                                std::thread::sleep(std::time::Duration::from_millis(10));
                            }
                            Err(error) => panic!("Mock transport: {error}"),
                        }
                    };
                    socket.set_nonblocking(false).unwrap();
                    socket
                        .set_read_timeout(Some(std::time::Duration::from_secs(5)))
                        .unwrap();
                    let mut reader = BufReader::new(socket);
                    let mut length = 0;
                    loop {
                        let mut line = String::new();
                        assert!(reader.read_line(&mut line).unwrap() > 0);
                        if line == "\r\n" {
                            break;
                        }
                        if let Some(value) =
                            line.to_ascii_lowercase().strip_prefix("content-length:")
                        {
                            length = value.trim().parse().unwrap();
                        }
                    }
                    let mut body = vec![0; length];
                    reader.read_exact(&mut body).unwrap();
                    let payload: Value = serde_json::from_slice(&body).unwrap();
                    assert_eq!(
                        payload["tools"][0]["function"]["name"],
                        "forgekit_map_search"
                    );
                    assert_eq!(payload["max_tokens"], 8192);
                    if round > 0 {
                        let turns = payload["messages"].as_array().unwrap();
                        assert_eq!(turns.last().unwrap()["role"], "tool");
                        let receipt: Value = serde_json::from_str(
                            turns.last().unwrap()["content"].as_str().unwrap(),
                        )
                        .unwrap();
                        assert_eq!(receipt["snapshotId"], "snapshot");
                        assert_eq!(receipt["matches"][0]["reference"], "node/0");
                    }
                    let terminal = matches!(scenario, "complete" | "replay") && round + 1 == count;
                    let event = if terminal {
                        json!({"choices":[{"delta":{"content":"Gate ditemukan."},"finish_reason":"stop"}]})
                    } else {
                        json!({"choices":[{"delta":{"content":"Memeriksa map.","tool_calls":[{
                            "index":0,"id":if scenario == "replay" { "call".to_string() } else { format!("call-{round}") },
                            "function":{"name":"forgekit_map_search","arguments":json!({"snapshotId":"snapshot","query":"Gate","className":null,"limit":10}).to_string()}
                        }]},"finish_reason":"tool_calls"}]})
                    };
                    let response = format!("data: {event}\n\ndata: [DONE]\n\n");
                    write!(reader.get_mut(),"HTTP/1.1 200 OK\r\nContent-Type: text/event-stream\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{response}",response.len()).unwrap();
                }
            });
            let snapshot: ContextSnapshot = serde_json::from_value(json!({
                "id":"snapshot","studioId":"studio","displayName":"Fixture","scope":"game",
                "depth":1,"observedAt":now_string(),"loadedNodes":1,"truncated":false,
                "nodes":[{"name":"Gate","className":"Model","children":[]}],
                "contentHash":"a".repeat(64),"skillHash":"b".repeat(64),
            }))
            .unwrap();
            let lease = begin_stream(&next_id("tool-transport")).unwrap();
            let mut calls = 0;
            let mut text = String::new();
            let result = execute_chat_tools(
                &profile("local-llm", &endpoint),
                &lease,
                &[json!({"role":"user","content":"Cari Gate."})],
                true,
                |chunk| {
                    text.push_str(chunk);
                    Ok(())
                },
                |call| {
                    calls += 1;
                    let receipt = crate::tools::execute(&snapshot, call)?;
                    if scenario == "cancel" {
                        cancel_ai_stream(&lease.id);
                    }
                    Ok(receipt)
                },
            );
            server.join().unwrap();
            if matches!(scenario, "complete" | "replay") {
                assert_eq!(result.unwrap(), "Gate ditemukan.");
                assert!(text.starts_with("Memeriksa map.\n\n"));
                assert!(text.ends_with("Gate ditemukan."));
                assert_eq!(calls, 1);
            } else {
                assert!(result.is_err());
                assert_eq!(
                    calls,
                    if scenario == "budget" {
                        crate::tools::MAX_ROUNDS
                    } else {
                        1
                    }
                );
            }
        }
    }

    #[test]
    fn test_thread_and_messages_lifecycle() {
        let storage = crate::storage::Storage::open(":memory:").unwrap();
        let conn = storage.connection;

        let thread = create_thread(
            &conn,
            "Uji Percakapan",
            None,
            "gpt-4o",
            Some("Kamu adalah asisten."),
        )
        .unwrap();
        assert_eq!(thread.title, "Uji Percakapan");
        assert_eq!(thread.model, "gpt-4o");

        let msg1 = add_message(&conn, &thread.id, "user", "Halo dunia", None, None, None).unwrap();
        assert_eq!(msg1.sequence, 1);
        assert_eq!(msg1.content, "Halo dunia");

        let msg2 = add_message(
            &conn,
            &thread.id,
            "assistant",
            "Halo! Ada yang bisa dibantu?",
            None,
            None,
            None,
        )
        .unwrap();
        assert_eq!(msg2.sequence, 2);

        let list = list_messages(&conn, &thread.id).unwrap();
        assert_eq!(list.len(), 2);
        assert_eq!(list[0].role, "user");
        assert_eq!(list[1].role, "assistant");

        rename_thread(&conn, &thread.id, "Judul Baru").unwrap();
        let threads = list_threads(&conn).unwrap();
        assert_eq!(threads[0].title, "Judul Baru");

        delete_thread(&conn, &thread.id).unwrap();
        assert_eq!(list_threads(&conn).unwrap().len(), 0);
        assert_eq!(list_messages(&conn, &thread.id).unwrap().len(), 0);
    }

    #[test]
    fn test_ai_profiles_crud() {
        let conn = Connection::open_in_memory().unwrap();
        conn.execute_batch(include_str!("../../migrations/0007_ai_chat.sql"))
            .unwrap();

        let profile = AiProviderProfile {
            id: "prof-1".into(),
            name: "OpenAI".into(),
            provider_type: "openai-compatible".into(),
            base_url: "https://api.openai.com/v1".into(),
            model: "gpt-4o".into(),
            reasoning_effort: None,
            key_reference: "openai-main".into(),
            is_default: true,
            created_at: now_string(),
            updated_at: now_string(),
        };

        save_profile(&conn, &profile).unwrap();
        let profiles = list_profiles(&conn).unwrap();
        assert_eq!(profiles.len(), 1);
        assert_eq!(profiles[0].name, "OpenAI");
        assert!(profiles[0].is_default);

        delete_profile(&conn, "prof-1").unwrap();
        assert_eq!(list_profiles(&conn).unwrap().len(), 0);
    }

    #[test]
    fn test_connection_profiles_and_fallback_lifecycle() {
        let conn = Connection::open_in_memory().unwrap();
        conn.execute_batch(include_str!("../../migrations/0007_ai_chat.sql"))
            .unwrap();
        conn.execute_batch(include_str!("../../migrations/0008_creative_tasks.sql"))
            .unwrap();
        conn.execute_batch(include_str!("../../migrations/0011_tool_receipts.sql"))
            .unwrap();
        conn.execute_batch(include_str!(
            "../../migrations/0012_multi_account_and_router.sql"
        ))
        .unwrap();

        let profile_a = ConnectionProfile {
            id: "acc-1".into(),
            provider_id: "openai".into(),
            connection_mode: "direct".into(),
            credential_owner: "forgekit".into(),
            router_instance_id: None,
            upstream_connection_ref: None,
            auth_method: "api_key".into(),
            label: "Akun Utama OpenAI".into(),
            identity: None,
            registration_ref: None,
            credential_ref: Some("key-1".into()),
            access_state: "ready".into(),
            enabled: true,
            fallback_eligible: "supported".into(),
            fallback_disabled_reason: None,
            priority: 0,
            quota_bucket_refs: vec!["bucket-a".into()],
            base_url: "https://api.openai.com/v1".into(),
            model: "gpt-4o".into(),
            is_default: true,
            created_at: now_string(),
            updated_at: now_string(),
        };

        let profile_b = ConnectionProfile {
            id: "acc-2".into(),
            provider_id: "antigravity-9router".into(),
            connection_mode: "router".into(),
            credential_owner: "router".into(),
            router_instance_id: Some("default-9router".into()),
            upstream_connection_ref: None,
            auth_method: "router_dashboard".into(),
            label: "Antigravity via 9router".into(),
            identity: None,
            registration_ref: None,
            credential_ref: None,
            access_state: "ready".into(),
            enabled: true,
            fallback_eligible: "supported".into(),
            fallback_disabled_reason: None,
            priority: 1,
            quota_bucket_refs: vec!["bucket-b".into()],
            base_url: "http://127.0.0.1:20128/v1".into(),
            model: "ag/fixture-model".into(),
            is_default: false,
            created_at: now_string(),
            updated_at: now_string(),
        };

        save_connection_profile(&conn, &profile_a).unwrap();
        save_connection_profile(&conn, &profile_b).unwrap();
        let mut moved = profile_a.clone();
        moved.provider_id = "openai-compatible".into();
        moved.base_url = "https://custom.example/v1".into();
        assert!(save_connection_profile(&conn, &moved).is_err());
        moved.id = "custom-connection".into();
        moved.credential_ref = Some("custom-key".into());
        moved.is_default = false;
        save_connection_profile(&conn, &moved).unwrap();
        moved.base_url = "https://another.example/v1".into();
        assert!(save_connection_profile(&conn, &moved).is_err());
        delete_connection_profile(&conn, &moved.id).unwrap();

        let list = list_connection_profiles(&conn).unwrap();
        assert_eq!(list.len(), 2);
        assert_eq!(list[0].id, "acc-1");
        assert!(list[0].is_default);

        // Switch primary profile
        set_primary_connection_profile(&conn, "acc-2").unwrap();
        let updated = list_connection_profiles(&conn).unwrap();
        let acc2 = updated.iter().find(|p| p.id == "acc-2").unwrap();
        let acc1 = updated.iter().find(|p| p.id == "acc-1").unwrap();
        assert!(acc2.is_default);
        assert!(!acc1.is_default);

        // Fallback policy test
        let mut policy = get_fallback_policy(&conn).unwrap();
        assert_eq!(policy.routing_owner, "forgekit");
        policy.ordered_profile_ids = vec!["acc-1".into()];
        policy.allow_cross_provider = true;
        save_fallback_policy(&conn, &policy).unwrap();
        let saved_policy = get_fallback_policy(&conn).unwrap();
        assert!(saved_policy.allow_cross_provider);
        assert_eq!(saved_policy.ordered_profile_ids.len(), 1);

        // Router connection test
        let router = get_router_connection(&conn).unwrap();
        assert_eq!(router.kind, "9router");
        assert_eq!(router.routing_owner, "router");

        // Connect session generation
        let session =
            create_connect_session("antigravity-9router", Some("http://127.0.0.1:20128")).unwrap();
        assert_eq!(session.mode, "router");
        assert!(session.message.unwrap().contains("deprecated"));

        delete_connection_profile(&conn, "acc-1").unwrap();
        assert_eq!(list_connection_profiles(&conn).unwrap().len(), 1);
    }
}

pub fn execute_agent_checkpoint<F, G, H>(
    profile: &AiProviderProfile,
    lease: &StreamLease,
    tools: &[ToolDefinition],
    max_tokens: u64,
    state: &mut crate::supervisor::Checkpoint,
    mut on_chunk: F,
    execute_tool: G,
    mut persist: H,
) -> Result<String, String>
where
    F: FnMut(&str) -> Result<(), String>,
    G: FnMut(&ToolCall) -> Result<Value, String>,
    H: FnMut(&crate::supervisor::Checkpoint) -> Result<(), String>,
{
    validate_profile(profile)?;
    if state.fingerprint != crate::supervisor::fingerprint(profile) {
        return Err(
            "[TARGET_CONFLICT] Identitas akun/model berubah; checkpoint tidak dijalankan.".into(),
        );
    }
    if !tools.is_empty() {
        crate::model_catalog::require_tools(profile)?;
    }
    crate::supervisor::run(
        state,
        tools,
        max_tokens,
        |history, definitions, seconds, tokens| {
            let turn = execute_turn(
                profile,
                lease,
                history,
                definitions,
                seconds,
                tokens,
                &mut on_chunk,
            )?;
            if !turn.calls.is_empty() {
                on_chunk("\n\n")?;
            }
            Ok(turn)
        },
        execute_tool,
        &mut persist,
        || lease.is_cancelled(),
    )
}

pub(crate) fn authorize_provider_access(profile: &AiProviderProfile) -> Result<(), String> {
    if crate::auth::codex::is_codex(profile) {
        // Managed Codex sessions use their own private profile, not an API-key store.
        crate::auth::codex::account_id(&profile.key_reference).map(|_| ())
    } else {
        authorize_keychain_access(&profile.key_reference)
    }
}
