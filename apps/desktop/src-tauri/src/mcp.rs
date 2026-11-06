//! Minimal MCP client for user-configured connectors (stdio, newline-delimited JSON-RPC).
//!
//! A connector is started only for the duration of one chat request and killed afterwards.
//! Tools are exposed to the provider as `mcp_r<n>_<tool>` (read-only per the server's
//! `readOnlyHint`) or `mcp_w<n>_<tool>` (everything else); write tools get the supervisor's
//! duplicate-intent and unknown-outcome protection.

use crate::connectors::McpConnectorConfig;
use crate::tools::{ToolCall, ToolDefinition};
use serde_json::{json, Value};
use std::collections::HashMap;
use std::io::{BufRead, BufReader, Read, Write};
use std::path::{Path, PathBuf};
use std::process::{Child, ChildStdin, Command, Stdio};
use std::sync::mpsc::{self, Receiver, RecvTimeoutError};
use std::time::{Duration, Instant};

const MAX_MESSAGE: u64 = 4 * 1024 * 1024;
const MAX_RESULT_BYTES: usize = 64 * 1024;
const MAX_TOOLS: usize = 64;
const PROTOCOL_VERSION: &str = "2025-06-18";
const START_TIMEOUT: Duration = Duration::from_secs(20);
const CALL_TIMEOUT: Duration = Duration::from_secs(90);

pub fn is_write(wire_name: &str) -> bool {
    wire_name.starts_with("mcp_w")
}
pub fn handles(call: &ToolCall) -> bool {
    call.name.starts_with("mcp_r") || call.name.starts_with("mcp_w")
}

/// macOS GUI apps get a minimal PATH; add the usual tool locations so `npx`, `uvx`, etc. resolve.
fn search_path() -> String {
    let home = std::env::var("HOME").unwrap_or_default();
    let mut dirs: Vec<String> = vec![
        "/opt/homebrew/bin".into(),
        "/usr/local/bin".into(),
        format!("{home}/.local/bin"),
        format!("{home}/.cargo/bin"),
        format!("{home}/.bun/bin"),
        format!("{home}/.volta/bin"),
        "/usr/bin".into(),
        "/bin".into(),
    ];
    if let Ok(existing) = std::env::var("PATH") {
        for dir in existing.split(':') {
            if !dir.is_empty() && !dirs.iter().any(|d| d == dir) {
                dirs.push(dir.into());
            }
        }
    }
    dirs.join(":")
}

fn resolve(command: &str, path: &str) -> Result<PathBuf, String> {
    let candidate = Path::new(command);
    if candidate.is_absolute() {
        return candidate
            .is_file()
            .then(|| candidate.to_path_buf())
            .ok_or_else(|| format!("Perintah MCP tidak ditemukan: {command}"));
    }
    if command.contains('/') {
        return Err("Gunakan nama perintah (mis. npx) atau path absolut.".into());
    }
    path.split(':')
        .map(|dir| Path::new(dir).join(command))
        .find(|p| p.is_file())
        .ok_or_else(|| format!("Perintah MCP \"{command}\" tidak ditemukan di PATH."))
}

fn read_message(reader: &mut impl BufRead) -> Result<Option<Value>, String> {
    loop {
        let mut line = Vec::new();
        reader
            .take(MAX_MESSAGE + 1)
            .read_until(b'\n', &mut line)
            .map_err(|_| "Transport MCP terputus.".to_string())?;
        if line.is_empty() {
            return Ok(None);
        }
        if line.len() as u64 > MAX_MESSAGE {
            return Err("Pesan MCP terlalu besar.".into());
        }
        let text = String::from_utf8_lossy(&line);
        let trimmed = text.trim();
        if trimmed.is_empty() {
            continue;
        }
        // Some servers print banners to stdout; skip lines that are not JSON-RPC.
        match serde_json::from_str::<Value>(trimmed) {
            Ok(value) if value.get("jsonrpc").and_then(Value::as_str) == Some("2.0") => {
                return Ok(Some(value))
            }
            _ => continue,
        }
    }
}

pub struct Client {
    child: Child,
    stdin: Option<ChildStdin>,
    incoming: Receiver<Result<Value, String>>,
    next_id: u64,
}

impl Client {
    pub fn start(config: &McpConnectorConfig) -> Result<Self, String> {
        let path = search_path();
        let executable = resolve(config.command.trim(), &path)?;
        let mut command = Command::new(&executable);
        command
            .args(&config.args)
            .env("PATH", &path)
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            // Server diagnostics may include private data; never forward them.
            .stderr(Stdio::null());
        if let Ok(home) = std::env::var("HOME") {
            command.current_dir(home);
        }
        let mut child = command
            .spawn()
            .map_err(|e| format!("Server MCP \"{}\" gagal dijalankan: {e}", config.name))?;
        let stdin = child.stdin.take();
        let stdout = child.stdout.take().ok_or("Stdout MCP tidak tersedia.")?;
        let (sender, incoming) = mpsc::sync_channel(16);
        std::thread::spawn(move || {
            let mut reader = BufReader::new(stdout);
            loop {
                match read_message(&mut reader) {
                    Ok(Some(message)) => {
                        if sender.send(Ok(message)).is_err() {
                            break;
                        }
                    }
                    Ok(None) => break,
                    Err(error) => {
                        let _ = sender.send(Err(error));
                        break;
                    }
                }
            }
        });
        let mut client = Self { child, stdin, incoming, next_id: 0 };
        client.request(
            "initialize",
            json!({
                "protocolVersion": PROTOCOL_VERSION,
                "capabilities": {},
                "clientInfo": {"name": "ForgeKit Studio", "version": env!("CARGO_PKG_VERSION")}
            }),
            START_TIMEOUT,
            &|| false,
        )?;
        client.notify("notifications/initialized", json!({}))?;
        Ok(client)
    }

    fn write(&mut self, message: &Value) -> Result<(), String> {
        let stdin = self.stdin.as_mut().ok_or("Sesi MCP sudah ditutup.")?;
        let mut bytes = serde_json::to_vec(message).map_err(|_| "Pesan MCP tidak sah.")?;
        bytes.push(b'\n');
        stdin
            .write_all(&bytes)
            .and_then(|_| stdin.flush())
            .map_err(|_| "Server MCP berhenti menerima pesan.".to_string())
    }

    fn notify(&mut self, method: &str, params: Value) -> Result<(), String> {
        self.write(&json!({"jsonrpc": "2.0", "method": method, "params": params}))
    }

    fn request(
        &mut self,
        method: &str,
        params: Value,
        timeout: Duration,
        cancelled: &dyn Fn() -> bool,
    ) -> Result<Value, String> {
        self.next_id += 1;
        let id = self.next_id;
        self.write(&json!({"jsonrpc": "2.0", "id": id, "method": method, "params": params}))?;
        let deadline = Instant::now() + timeout;
        loop {
            if cancelled() {
                let _ = self.notify(
                    "notifications/cancelled",
                    json!({"requestId": id, "reason": "Dibatalkan pengguna"}),
                );
                return Err("[CANCELLED] Panggilan MCP dibatalkan.".into());
            }
            let remaining = deadline.saturating_duration_since(Instant::now());
            if remaining.is_zero() {
                return Err(format!("[TIMEOUT] Server MCP tidak menjawab {method}."));
            }
            let message = match self.incoming.recv_timeout(remaining.min(Duration::from_millis(200))) {
                Ok(message) => message?,
                Err(RecvTimeoutError::Timeout) => continue,
                Err(RecvTimeoutError::Disconnected) => {
                    return Err("Server MCP berhenti sebelum menjawab.".into())
                }
            };
            // Server-initiated request: answer ping, refuse everything else (no sampling/roots).
            if let (Some(server_id), Some(server_method)) =
                (message.get("id"), message.get("method").and_then(Value::as_str))
            {
                let reply = if server_method == "ping" {
                    json!({"jsonrpc": "2.0", "id": server_id, "result": {}})
                } else {
                    json!({"jsonrpc": "2.0", "id": server_id,
                        "error": {"code": -32601, "message": "Tidak didukung oleh ForgeKit."}})
                };
                self.write(&reply)?;
                continue;
            }
            if message.get("id").and_then(Value::as_u64) != Some(id) {
                continue; // notification or stale response
            }
            if let Some(error) = message.get("error") {
                let text = error["message"].as_str().unwrap_or("Server MCP mengembalikan error.");
                return Err(format!("MCP {method}: {text}"));
            }
            return Ok(message.get("result").cloned().unwrap_or(Value::Null));
        }
    }

    pub fn list_tools(&mut self) -> Result<Vec<Value>, String> {
        let mut tools = Vec::new();
        let mut cursor: Option<String> = None;
        for _ in 0..10 {
            let params = match &cursor {
                Some(c) => json!({"cursor": c}),
                None => json!({}),
            };
            let result = self.request("tools/list", params, START_TIMEOUT, &|| false)?;
            if let Some(items) = result["tools"].as_array() {
                tools.extend(items.iter().cloned());
            }
            cursor = result["nextCursor"].as_str().map(str::to_owned);
            if cursor.is_none() || tools.len() >= MAX_TOOLS {
                break;
            }
        }
        tools.truncate(MAX_TOOLS);
        Ok(tools)
    }

    pub fn call_tool(
        &mut self,
        name: &str,
        arguments: Value,
        cancelled: &dyn Fn() -> bool,
    ) -> Result<Value, String> {
        self.request("tools/call", json!({"name": name, "arguments": arguments}), CALL_TIMEOUT, cancelled)
    }
}

impl Drop for Client {
    fn drop(&mut self) {
        self.stdin.take();
        let _ = self.child.kill();
        let _ = self.child.wait();
    }
}

fn read_only(tool: &Value) -> bool {
    tool["annotations"]["readOnlyHint"].as_bool() == Some(true)
}

fn sanitize(name: &str) -> String {
    name.chars()
        .map(|c| if c.is_ascii_alphanumeric() || c == '_' || c == '-' { c } else { '_' })
        .collect()
}

/// Tool info for the settings UI; starts the server, lists its tools, then stops it.
pub fn discover(config: &McpConnectorConfig) -> Result<Vec<crate::connectors::McpToolInfo>, String> {
    let mut client = Client::start(config)?;
    Ok(client
        .list_tools()?
        .iter()
        .filter_map(|tool| {
            Some(crate::connectors::McpToolInfo {
                name: tool["name"].as_str()?.to_owned(),
                description: tool["description"].as_str().unwrap_or("").chars().take(500).collect(),
                category: config.name.clone(),
                is_write: !read_only(tool),
            })
        })
        .collect())
}

/// Connectors started for one chat request. Dropping it stops every server.
#[derive(Default)]
pub struct Toolset {
    clients: Vec<Client>,
    routes: HashMap<String, (usize, String)>,
    pub definitions: Vec<ToolDefinition>,
    pub warnings: Vec<String>,
}

impl Toolset {
    /// `writable=false` (ask/plan mode) exposes only tools the server marks read-only.
    pub fn start(configs: &[McpConnectorConfig], writable: bool) -> Self {
        let mut set = Toolset::default();
        for config in configs.iter().filter(|c| c.is_enabled) {
            let started = Client::start(config).and_then(|mut client| {
                let tools = client.list_tools()?;
                Ok((client, tools))
            });
            let (client, tools) = match started {
                Ok(value) => value,
                Err(error) => {
                    set.warnings.push(format!("{}: {error}", config.name));
                    continue;
                }
            };
            let index = set.clients.len();
            for tool in &tools {
                let Some(name) = tool["name"].as_str() else { continue };
                if !config.allowed_tools.is_empty() && !config.allowed_tools.iter().any(|t| t == name) {
                    continue;
                }
                let reads = read_only(tool);
                if !writable && !reads {
                    continue;
                }
                let prefix = format!("mcp_{}{}_", if reads { 'r' } else { 'w' }, index);
                let mut wire: String = format!("{prefix}{}", sanitize(name)).chars().take(64).collect();
                let mut n = 2;
                while set.routes.contains_key(&wire) {
                    let suffix = format!("_{n}");
                    wire = format!("{}{suffix}", wire.chars().take(64 - suffix.len()).collect::<String>());
                    n += 1;
                }
                let schema = if tool["inputSchema"].is_object() {
                    tool["inputSchema"].clone()
                } else {
                    json!({"type": "object", "properties": {}})
                };
                let description = format!(
                    "[MCP · {}{}] {}",
                    config.name,
                    if reads { "" } else { " · dapat mengubah data" },
                    tool["description"].as_str().unwrap_or(name)
                );
                set.definitions.push(ToolDefinition {
                    name: name.to_owned(),
                    wire_name: wire.clone(),
                    description: description.chars().take(1024).collect(),
                    input_schema: schema,
                    strict: false,
                });
                set.routes.insert(wire, (index, name.to_owned()));
            }
            set.clients.push(client);
        }
        set
    }

    pub fn call(&mut self, call: &ToolCall, cancelled: &dyn Fn() -> bool) -> Result<Value, String> {
        let (index, name) = self
            .routes
            .get(&call.name)
            .cloned()
            .ok_or("[TOOL_NOT_DISPATCHED] Tool MCP tidak terdaftar.")?;
        let arguments: Value = if call.arguments.trim().is_empty() {
            json!({})
        } else {
            serde_json::from_str(&call.arguments)
                .map_err(|_| "[TOOL_NOT_DISPATCHED] Argumen tool MCP bukan JSON.")?
        };
        let result = self.clients[index].call_tool(&name, arguments, cancelled)?;
        Ok(summarize(&result))
    }
}

/// Keep text/structured content, replace binary blocks with a note, and cap the size.
fn summarize(result: &Value) -> Value {
    let mut text = String::new();
    for block in result["content"].as_array().into_iter().flatten() {
        match block["type"].as_str() {
            Some("text") => text.push_str(block["text"].as_str().unwrap_or("")),
            Some(kind) => text.push_str(&format!("[konten {kind} tidak diteruskan]")),
            None => {}
        }
        text.push('\n');
    }
    if text.trim().is_empty() {
        if let Some(structured) = result.get("structuredContent") {
            text = structured.to_string();
        }
    }
    let truncated = text.len() > MAX_RESULT_BYTES;
    if truncated {
        let mut end = MAX_RESULT_BYTES;
        while !text.is_char_boundary(end) {
            end -= 1;
        }
        text.truncate(end);
    }
    json!({
        "isError": result["isError"].as_bool().unwrap_or(false),
        "content": text.trim_end(),
        "truncated": truncated,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn fixture(script: &str) -> McpConnectorConfig {
        McpConnectorConfig {
            id: "fixture".into(),
            name: "Fixture".into(),
            transport: "stdio".into(),
            command: "/bin/sh".into(),
            args: vec!["-c".into(), script.into()],
            is_enabled: true,
            allowed_tools: vec![],
            created_at: "1".into(),
            updated_at: "1".into(),
        }
    }

    // A tiny shell MCP server: answers initialize, tools/list and tools/call by request id.
    const SERVER: &str = r#"
echo 'banner on stdout'
while IFS= read -r line; do
  id=$(printf '%s' "$line" | sed -n 's/.*"id":\([0-9]*\).*/\1/p')
  case "$line" in
    *'"initialize"'*) echo "{\"jsonrpc\":\"2.0\",\"id\":$id,\"result\":{\"protocolVersion\":\"2025-06-18\",\"capabilities\":{\"tools\":{}},\"serverInfo\":{\"name\":\"fx\",\"version\":\"1\"}}}";;
    *'"tools/list"'*) echo "{\"jsonrpc\":\"2.0\",\"id\":$id,\"result\":{\"tools\":[{\"name\":\"read.notes\",\"description\":\"Read\",\"inputSchema\":{\"type\":\"object\"},\"annotations\":{\"readOnlyHint\":true}},{\"name\":\"write_note\",\"inputSchema\":{\"type\":\"object\"}}]}}";;
    *'"tools/call"'*) echo "{\"jsonrpc\":\"2.0\",\"id\":$id,\"result\":{\"content\":[{\"type\":\"text\",\"text\":\"halo\"},{\"type\":\"image\",\"data\":\"AAAA\"}]}}";;
  esac
done
"#;

    #[test]
    fn exposes_tools_by_mode_and_routes_calls() {
        let read_only = Toolset::start(&[fixture(SERVER)], false);
        assert!(read_only.warnings.is_empty(), "{:?}", read_only.warnings);
        assert_eq!(read_only.definitions.iter().map(|d| d.wire_name.as_str()).collect::<Vec<_>>(), ["mcp_r0_read_notes"]);

        let mut set = Toolset::start(&[fixture(SERVER)], true);
        let wires: Vec<_> = set.definitions.iter().map(|d| d.wire_name.clone()).collect();
        assert_eq!(wires, ["mcp_r0_read_notes", "mcp_w0_write_note"]);
        assert!(is_write("mcp_w0_write_note") && !is_write("mcp_r0_read_notes"));
        let call = ToolCall { id: "1".into(), name: "mcp_w0_write_note".into(), arguments: "{\"text\":\"x\"}".into() };
        assert!(handles(&call));
        let output = set.call(&call, &|| false).unwrap();
        assert_eq!(output["content"], "halo\n[konten image tidak diteruskan]");
        assert_eq!(output["isError"], false);
    }

    #[test]
    fn allowed_tools_filter_and_broken_servers_only_warn() {
        let mut config = fixture(SERVER);
        config.allowed_tools = vec!["write_note".into()];
        let set = Toolset::start(&[config, fixture("exit 0")], true);
        assert_eq!(set.definitions.len(), 1);
        assert_eq!(set.definitions[0].name, "write_note");
        assert_eq!(set.warnings.len(), 1);
    }

    #[test]
    fn discover_reports_write_tools() {
        let tools = discover(&fixture(SERVER)).unwrap();
        assert_eq!(tools.iter().map(|t| (t.name.as_str(), t.is_write)).collect::<Vec<_>>(), [("read.notes", false), ("write_note", true)]);
    }

    #[test]
    fn rejects_relative_paths_and_missing_commands() {
        assert!(resolve("./server", "/usr/bin").is_err());
        assert!(resolve("forgekit-definitely-missing", "/usr/bin").is_err());
        assert!(resolve("sh", "/bin").is_ok());
    }
}
