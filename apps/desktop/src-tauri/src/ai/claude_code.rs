//! One model turn through the official Claude Code CLI (`claude -p`) in the account's private
//! profile. Claude Code's own tools, MCP servers, skills and settings are disabled: it acts only
//! as the model. ForgeKit tools keep running in ForgeKit's loop (budgets, receipts, undo recording);
//! the model requests them with a tagged JSON block that is parsed here into ordinary tool calls.
use super::{protocol::Turn, StreamLease};
use crate::tools::{ToolCall, ToolDefinition};
use serde_json::{json, Value};
use std::{
    fs,
    io::{BufRead, BufReader, Read, Write},
    path::PathBuf,
    process::Stdio,
    sync::{atomic::{AtomicBool, Ordering}, Arc},
    time::{Duration, Instant},
};

pub(crate) const TOOL_OPEN: &str = "<forgekit_tool_call>";
pub(crate) const TOOL_CLOSE: &str = "</forgekit_tool_call>";
const MAX_STREAM_BYTES: usize = 32 * 1024 * 1024;
const MAX_LINE_BYTES: usize = 8 * 1024 * 1024;
const MAX_OUTPUT_BYTES: usize = 2 * 1024 * 1024;

fn system_prompt(messages: &[Value], tools: &[ToolDefinition]) -> String {
    let mut system = messages.iter().filter(|m| m["role"] == "system").filter_map(|m| m["content"].as_str())
        .collect::<Vec<_>>().join("\n");
    if system.trim().is_empty() { system = "Kamu adalah model AI di dalam ForgeKit Studio.".into(); }
    if !tools.is_empty() {
        let list = tools.iter().map(|t| json!({"name":t.wire_name,"description":t.description,"input_schema":t.input_schema})).collect::<Vec<_>>();
        system.push_str(&format!("\n\n## Tools ForgeKit\nTool berikut dijalankan oleh ForgeKit, bukan olehmu; hasilnya dikirim kembali pada giliran berikutnya sebagai <tool_result>. Untuk memanggil tool, tulis penjelasan singkat bila perlu, lalu akhiri jawaban dengan satu atau beberapa blok persis seperti ini, masing-masing berisi satu objek JSON:\n{TOOL_OPEN}{{\"name\":\"nama_tool\",\"input\":{{}}}}{TOOL_CLOSE}\nAturan: `input` wajib objek JSON yang sesuai input_schema; jangan menulis apa pun setelah blok tool call; jangan mengarang hasil tool; bila tool tidak diperlukan, jawab biasa tanpa blok.\nDaftar tool (JSON):\n{}", Value::from(list)));
    }
    system
}

fn text_of(content: &Value) -> String {
    match content {
        Value::String(s) => s.clone(),
        Value::Array(blocks) => blocks.iter().filter_map(|b| b["text"].as_str()).collect::<Vec<_>>().join("\n"),
        other => other.to_string(),
    }
}
fn push_text(blocks: &mut Vec<Value>, text: &str) {
    if let Some(last) = blocks.last_mut().filter(|b| b["type"] == "text") {
        let joined = format!("{}{text}", last["text"].as_str().unwrap_or(""));
        last["text"] = json!(joined);
    } else if !text.is_empty() {
        blocks.push(json!({"type":"text","text":text}));
    }
}
fn push_block(blocks: &mut Vec<Value>, block: &Value, role: &str) {
    match block["type"].as_str() {
        Some("text") => push_text(blocks, block["text"].as_str().unwrap_or("")),
        Some("image") => blocks.push(block.clone()),
        Some("tool_use") => push_text(blocks, &format!("{TOOL_OPEN}{}{TOOL_CLOSE}", json!({"name":block["name"],"input":block["input"]}))),
        Some("tool_result") => push_text(blocks, &format!("<tool_result tool_use_id={}>\n{}\n</tool_result>",
            block["tool_use_id"], text_of(&block["content"]))),
        Some("thinking" | "redacted_thinking") => {}
        _ if role == "assistant" => push_text(blocks, &text_of(block)),
        _ => push_text(blocks, &block.to_string()),
    }
}
/// Claude Code takes one user message per turn, so earlier turns become a tagged transcript.
fn user_content(messages: &[Value]) -> Vec<Value> {
    let turns: Vec<&Value> = messages.iter().filter(|m| m["role"] != "system").collect();
    let mut blocks = vec![];
    if let [only] = turns.as_slice() {
        if only["role"] == "user" {
            match &only["content"] {
                Value::Array(items) => items.iter().for_each(|b| push_block(&mut blocks, b, "user")),
                other => push_text(&mut blocks, &text_of(other)),
            }
            return blocks;
        }
    }
    push_text(&mut blocks, "Riwayat percakapan ForgeKit berikut adalah konteks. Tulis HANYA giliran assistant berikutnya; jangan mengulang riwayat atau tag peran.\n");
    for turn in turns {
        let role = if turn["role"] == "assistant" { "assistant" } else { "user" };
        push_text(&mut blocks, &format!("\n<{role}>\n"));
        match &turn["content"] {
            Value::Array(items) => items.iter().for_each(|b| push_block(&mut blocks, b, role)),
            other => push_text(&mut blocks, &text_of(other)),
        }
        push_text(&mut blocks, &format!("\n</{role}>\n"));
    }
    push_text(&mut blocks, "\nTulis giliran assistant berikutnya sekarang.");
    blocks
}

/// Streams prose to the user but holds back anything that may start a tool-call block.
struct Visible { text: String, emitted: usize, stopped: bool, tools: bool }
impl Visible {
    fn push(&mut self, chunk: &str) -> Option<String> {
        self.text.push_str(chunk);
        if self.stopped { return None; }
        let rest = &self.text[self.emitted..];
        let end = if !self.tools { self.text.len() } else if let Some(i) = rest.find(TOOL_OPEN) {
            self.stopped = true; self.emitted + i
        } else {
            let hold = (1..TOOL_OPEN.len()).rev().find(|k| rest.ends_with(&TOOL_OPEN[..*k])).unwrap_or(0);
            self.text.len() - hold
        };
        (end > self.emitted).then(|| { let out = self.text[self.emitted..end].to_string(); self.emitted = end; out })
    }
    fn flush(&mut self) -> Option<String> {
        if self.stopped || self.emitted >= self.text.len() { return None; }
        let out = self.text[self.emitted..].to_string(); self.emitted = self.text.len(); Some(out)
    }
}

fn call_id() -> Result<String, String> {
    Ok(format!("toolu_fk_{}", crate::auth::browser::random()?.chars().filter(char::is_ascii_alphanumeric).take(24).collect::<String>()))
}
/// Splits the reply into the prose shown to the user and the requested tool calls.
pub(crate) fn parse_reply(reply: &str, tools: bool) -> Result<(String, Vec<(String, Value)>), String> {
    let Some(first) = reply.find(TOOL_OPEN).filter(|_| tools) else { return Ok((reply.trim_end().into(), vec![])) };
    let mut calls = vec![];
    let mut rest = &reply[first..];
    while let Some(start) = rest.find(TOOL_OPEN) {
        let body = &rest[start + TOOL_OPEN.len()..];
        let end = body.find(TOOL_CLOSE).ok_or("[RESPONSE_INCOMPLETE] Tool call Claude tidak lengkap.")?;
        let raw = body[..end].trim().trim_start_matches("```json").trim_start_matches("```").trim_end_matches("```").trim();
        let value: Value = serde_json::from_str(raw).map_err(|_| "Tool call Claude bukan JSON yang sah.")?;
        let name = value["name"].as_str().filter(|n| !n.is_empty() && n.len() <= 128).ok_or("Tool call Claude tanpa nama.")?;
        let input = if value["input"].is_null() { json!({}) } else { value["input"].clone() };
        if !input.is_object() { return Err("Input tool call Claude harus objek JSON.".into()); }
        calls.push((name.to_owned(), input));
        if calls.len() > crate::tools::MAX_CALLS { return Err("Permintaan tool melampaui izin atau batas panggilan.".into()); }
        rest = &body[end + TOOL_CLOSE.len()..];
    }
    Ok((reply[..first].trim_end().into(), calls))
}

fn error_message(kind: &str, reset_at: Option<u64>, partial: bool) -> String {
    let now = crate::routing::now_ms() / 1000;
    let retry = reset_at.filter(|at| *at > now).map_or(60_000, |at| (at - now).saturating_mul(1000).clamp(1000, 86_400_000 * 7));
    match kind {
        "authentication_failed" | "oauth_org_not_allowed" => "[AUTH] Login Claude Code kedaluwarsa atau dicabut. Hubungkan ulang akun Claude di Pengaturan.".into(),
        "rate_limit" => format!("[RATE_LIMIT retry_after_ms={retry}] Batas penggunaan paket Claude tercapai."),
        "billing_error" => "[BILLING] Langganan atau billing Claude tidak aktif; fallback dihentikan.".into(),
        "invalid_request" => "[VALIDATION] Model atau konteks tidak diterima Claude Code.".into(),
        "server_error" => "[OUTAGE] Layanan Claude sedang gangguan.".into(),
        "max_tokens" => "[OUTPUT_LIMIT] Output Claude terpotong pada batas token.".into(),
        _ if partial => "[UNKNOWN_RESULT] Respons parsial diterima; retry otomatis dihentikan.".into(),
        _ => "[UNKNOWN_RESULT] Claude Code berhenti tanpa respons lengkap. Hasil belum diketahui; request tidak dikirim ulang.".into(),
    }
}

/// Private system prompt file: content stays out of process arguments and is removed afterwards.
struct PromptFile(PathBuf);
impl PromptFile {
    fn write(dir: &std::path::Path, text: &str) -> Result<Self, String> {
        let path = dir.join(format!("{}.txt", crate::storage::next_id("system")));
        let mut options = fs::OpenOptions::new();
        options.write(true).create_new(true);
        #[cfg(unix)] { use std::os::unix::fs::OpenOptionsExt; options.mode(0o600); }
        options.open(&path).and_then(|mut f| f.write_all(text.as_bytes())).map_err(|_| "Instruksi AI tidak dapat disiapkan.")?;
        Ok(Self(path))
    }
}
impl Drop for PromptFile { fn drop(&mut self) { let _ = fs::remove_file(&self.0); } }

/// Visible text, result line, error kind, rate-limit reset and stop reason of one CLI run.
type Streamed = (Visible, Option<Value>, Option<String>, Option<u64>, Option<String>);

pub(super) fn execute_turn<F>(
    profile: &super::AiProviderProfile, lease: &StreamLease, messages: &[Value], tools: &[ToolDefinition],
    duration_seconds: u64, on_chunk: &mut F,
) -> Result<Turn, String>
where F: FnMut(&str) -> Result<(), String> {
    if !crate::auth::claude::valid_model(&profile.model) { return Err("[VALIDATION] Model Claude Code tidak sah.".into()); }
    let home = crate::auth::claude::account_home(&profile.key_reference)?;
    let exe = crate::auth::claude::runtime()?;
    let messages = crate::references::for_adapter(messages, "anthropic");
    let input = json!({"type":"user","message":{"role":"user","content":user_content(&messages)}}).to_string();
    if input.len() > 10 * 1024 * 1024 { return Err("Konteks teks atau gambar melebihi batas; kurangi riwayat/referensi.".into()); }
    let prompt = PromptFile::write(&home.join("work"), &system_prompt(&messages, tools))?;
    let mut cmd = crate::auth::claude::command(&exe, &home);
    cmd.args(["-p", "--input-format", "stream-json", "--output-format", "stream-json", "--verbose", "--include-partial-messages",
        "--model", &profile.model, "--system-prompt-file"]).arg(&prompt.0)
        // Only the model: no built-in tools, MCP servers, slash commands, customizations or saved sessions.
        .args(["--tools", "", "--strict-mcp-config", "--disable-slash-commands", "--no-session-persistence", "--safe-mode"]);
    if let Some(effort) = profile.reasoning_effort.as_deref() {
        if !crate::auth::claude::EFFORTS.contains(&effort) { return Err("Tingkat penalaran tidak didukung Claude Code.".into()); }
        cmd.args(["--effort", effort]);
    }
    if lease.is_cancelled() || crate::auth::claude::stopping() { return Err("Permintaan dibatalkan.".into()); }
    let mut child = cmd.stdin(Stdio::piped()).stdout(Stdio::piped()).stderr(Stdio::null()).spawn()
        .map_err(|_| "Claude Code gagal dijalankan.")?;
    let pid = child.id();
    crate::auth::claude::track(pid, true);
    let stdout = child.stdout.take().ok_or("Output Claude Code tidak tersedia.")?;
    let mut stdin = child.stdin.take().ok_or("Input Claude Code tidak tersedia.")?;
    *lease.control.child.lock().map_err(|_| "State stream tidak tersedia.")? = Some(child);
    if lease.is_cancelled() { super::cancel_ai_stream(&lease.id); crate::auth::claude::track(pid, false); return Err("Permintaan dibatalkan.".into()); }
    // The CLI has no request deadline of its own; a watchdog stops it at the task budget.
    let done = Arc::new(AtomicBool::new(false));
    let timed_out = Arc::new(AtomicBool::new(false));
    let watchdog = {
        let (done, timed_out, control) = (done.clone(), timed_out.clone(), lease.control.clone());
        let deadline = Instant::now() + Duration::from_secs(duration_seconds);
        std::thread::spawn(move || {
            while !done.load(Ordering::SeqCst) {
                if Instant::now() >= deadline {
                    timed_out.store(true, Ordering::SeqCst);
                    if let Ok(mut child) = control.child.lock() { if let Some(p) = child.as_mut() { let _ = p.kill(); } }
                    return;
                }
                std::thread::sleep(Duration::from_millis(100));
            }
        })
    };
    let outcome = (|| -> Result<Streamed, String> {
        writeln!(stdin, "{input}").and_then(|_| stdin.flush()).map_err(|_| "Claude Code menutup input.")?;
        drop(stdin);
        let mut reader = BufReader::new(stdout);
        let mut visible = Visible { text: String::new(), emitted: 0, stopped: false, tools: !tools.is_empty() };
        let (mut total, mut result, mut error_kind, mut reset_at, mut stop_reason) = (0, None::<Value>, None::<String>, None::<u64>, None::<String>);
        loop {
            let mut line = Vec::new();
            let read = reader.by_ref().take(MAX_LINE_BYTES as u64 + 1).read_until(b'\n', &mut line).map_err(|_| "Stream Claude Code terputus.")?;
            if read == 0 { break; }
            total += read;
            if read > MAX_LINE_BYTES || total > MAX_STREAM_BYTES {
                return Err("[OUTPUT_LIMIT] Stream Claude Code melampaui batas transport.".into());
            }
            let Ok(event) = serde_json::from_slice::<Value>(&line) else { continue };
            match event["type"].as_str() {
                Some("stream_event") => {
                    let e = &event["event"];
                    if e["type"] == "content_block_delta" && e["delta"]["type"] == "text_delta" {
                        let chunk = e["delta"]["text"].as_str().unwrap_or("");
                        if visible.text.len() + chunk.len() > MAX_OUTPUT_BYTES { return Err("[OUTPUT_LIMIT] Teks respons AI melampaui batas 2 MiB.".into()); }
                        if let Some(out) = visible.push(chunk) { on_chunk(&out)?; }
                    } else if e["type"] == "message_delta" {
                        stop_reason = e["delta"]["stop_reason"].as_str().map(str::to_owned).or(stop_reason);
                    }
                }
                Some("assistant") => if let Some(kind) = event["error"].as_str() { error_kind = Some(kind.into()); },
                Some("rate_limit_event") => {
                    let info = &event["rate_limit_info"];
                    crate::provider_usage::observe_claude_code(profile, info);
                    if info["status"] == "rejected" { reset_at = info["resetsAt"].as_u64(); }
                }
                Some("result") => result = Some(event),
                _ => {}
            }
        }
        Ok((visible, result, error_kind, reset_at, stop_reason))
    })();
    done.store(true, Ordering::SeqCst);
    let _ = watchdog.join();
    let exited = lease.control.child.lock().ok().and_then(|mut c| c.as_mut().map(|p| p.wait().is_ok()));
    crate::auth::claude::track(pid, false);
    drop(prompt);
    if lease.is_cancelled() { return Err("Permintaan dibatalkan.".into()); }
    if timed_out.load(Ordering::SeqCst) {
        return Err("[REQUEST_TIMEOUT] Batas waktu request provider tercapai. Respons belum lengkap; request tidak dikirim ulang.".into());
    }
    let (mut visible, result, error_kind, reset_at, stop_reason) = outcome?;
    let partial = !visible.text.is_empty();
    let result = result.filter(|_| exited == Some(true)).ok_or_else(|| error_message("", None, partial))?;
    if result["is_error"] != false || result["subtype"] != "success" {
        let kind = error_kind.or_else(|| reset_at.map(|_| "rate_limit".into())).unwrap_or_default();
        return Err(error_message(&kind, reset_at, partial));
    }
    if stop_reason.as_deref() == Some("max_tokens") || result["stop_reason"] == "max_tokens" {
        return Err(error_message("max_tokens", None, partial));
    }
    if visible.text.is_empty() {
        // Older CLIs without partial messages still report the final text.
        if let Some(out) = visible.push(result["result"].as_str().unwrap_or("")) { on_chunk(&out)?; }
    }
    if let Some(out) = visible.flush() { on_chunk(&out)?; }
    let (text, requested) = parse_reply(&visible.text, !tools.is_empty())?;
    if requested.is_empty() && text.trim().is_empty() {
        return Err("[RESPONSE_INCOMPLETE] Stream berhenti sebelum respons lengkap diterima.".into());
    }
    let mut native = vec![];
    if !text.is_empty() { native.push(json!({"type":"text","text":text})); }
    let mut calls = vec![];
    for (name, input) in requested {
        let id = call_id()?;
        native.push(json!({"type":"tool_use","id":id,"name":name,"input":input}));
        calls.push(ToolCall { id, name, arguments: input.to_string() });
    }
    Turn::assembled(text, calls, native)
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test] fn replies_split_into_prose_and_tool_calls() {
        let reply = format!("Saya cek dulu.\n{TOOL_OPEN}{{\"name\":\"map_search\",\"input\":{{\"q\":\"Door\"}}}}{TOOL_CLOSE}\n{TOOL_OPEN}```json\n{{\"name\":\"map_inspect\"}}\n```{TOOL_CLOSE}");
        let (text, calls) = parse_reply(&reply, true).unwrap();
        assert_eq!(text, "Saya cek dulu.");
        assert_eq!(calls, vec![("map_search".into(), json!({"q":"Door"})), ("map_inspect".into(), json!({}))]);
        assert_eq!(parse_reply(&reply, false).unwrap().1.len(), 0);
        assert!(parse_reply(&format!("{TOOL_OPEN}{{\"name\":\"x\""), true).is_err());
        assert!(parse_reply(&format!("{TOOL_OPEN}{{\"name\":\"x\",\"input\":[1]}}{TOOL_CLOSE}"), true).is_err());
        assert!(parse_reply(&format!("{TOOL_OPEN}not json{TOOL_CLOSE}"), true).is_err());
    }
    #[test] fn streaming_never_shows_a_tool_block() {
        let mut v = Visible { text: String::new(), emitted: 0, stopped: false, tools: true };
        let mut shown = String::new();
        for chunk in ["Halo ", "dunia <", "forgekit_tool", "_call>{\"name\":\"x\"}", "</forgekit_tool_call>"] {
            if let Some(out) = v.push(chunk) { shown.push_str(&out); }
        }
        if let Some(out) = v.flush() { shown.push_str(&out); }
        assert_eq!(shown, "Halo dunia ");
        let mut plain = Visible { text: String::new(), emitted: 0, stopped: false, tools: true };
        let mut shown = String::new();
        for chunk in ["a <b", "> c <"] { if let Some(out) = plain.push(chunk) { shown.push_str(&out); } }
        if let Some(out) = plain.flush() { shown.push_str(&out); }
        assert_eq!(shown, "a <b> c <");
    }
    #[test] fn history_becomes_one_user_message_with_images_and_tool_results() {
        let single = user_content(&[json!({"role":"system","content":"S"}), json!({"role":"user","content":"Halo"})]);
        assert_eq!(single, vec![json!({"type":"text","text":"Halo"})]);
        let image = json!({"type":"image","source":{"type":"base64","media_type":"image/png","data":"AAAA"}});
        let blocks = user_content(&[
            json!({"role":"user","content":[{"type":"text","text":"Lihat"}, image.clone()]}),
            json!({"role":"assistant","content":[{"type":"text","text":"Cek"},{"type":"tool_use","id":"t1","name":"map_search","input":{"q":"a"}}]}),
            json!({"role":"user","content":[{"type":"tool_result","tool_use_id":"t1","content":"{\"ok\":true}"}]}),
        ]);
        assert_eq!(blocks.iter().filter(|b| b["type"] == "image").count(), 1);
        let text = blocks.iter().filter_map(|b| b["text"].as_str()).collect::<String>();
        assert!(text.contains("<assistant>") && text.contains(TOOL_OPEN) && text.contains("<tool_result tool_use_id=\"t1\">"));
        let prompt = system_prompt(&[json!({"role":"system","content":"Aturan"})], &[ToolDefinition { name: "a".into(), wire_name: "map_search".into(), description: "d".into(), input_schema: json!({"type":"object"}), strict: false }]);
        assert!(prompt.starts_with("Aturan") && prompt.contains("map_search") && prompt.contains(TOOL_OPEN));
    }
    #[test] fn cli_errors_map_to_forgekit_categories() {
        assert!(error_message("authentication_failed", None, false).starts_with("[AUTH]"));
        assert!(error_message("rate_limit", Some(u64::MAX), false).starts_with("[RATE_LIMIT retry_after_ms="));
        assert!(error_message("billing_error", None, false).starts_with("[BILLING]"));
        assert!(error_message("", None, true).contains("parsial"));
    }
}
