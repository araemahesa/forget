pub(crate) mod explorer;
pub(crate) mod luau_checks;

use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::collections::HashMap;
use std::io::{BufRead, BufReader, Read, Write};
use std::path::PathBuf;
use std::process::{Child, ChildStdin, Command, Stdio};
use std::sync::mpsc::{self, Receiver};
use std::sync::LazyLock;
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};

const MAX_MESSAGE: u64 = 1024 * 1024;
const READ_TOOLS: &[&str] = &["get_studio_state", "search_game_tree", "inspect_instance", "script_read"];
const NO_PLACE_ERROR: &str = "Belum ada place terbuka pada sesi Studio ini.";
static SESSION_LOCK: Mutex<()> = Mutex::new(());
static AGENT_PENDING: std::sync::atomic::AtomicUsize = std::sync::atomic::AtomicUsize::new(0);
struct AgentPriority;
impl AgentPriority { fn enter() -> Self { AGENT_PENDING.fetch_add(1, std::sync::atomic::Ordering::SeqCst); Self } }
impl Drop for AgentPriority { fn drop(&mut self) { AGENT_PENDING.fetch_sub(1, std::sync::atomic::Ordering::SeqCst); } }

static ACTIVE_CHILD: Mutex<Option<Arc<Mutex<Child>>>> = Mutex::new(None);
static STOPPING: std::sync::atomic::AtomicBool = std::sync::atomic::AtomicBool::new(false);

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct StudioReport {
    executable: String,
    protocol_version: String,
    server_name: String,
    checked_at: String,
    pub studios: Vec<StudioInstance>,
    read_tools: Vec<String>,
    availability: String,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct StudioInstance {
    #[serde(alias = "studio_id", alias = "studioId", alias = "id")]
    pub studio_id: String,
    #[serde(
        default,
        alias = "place_name",
        alias = "placeName",
        deserialize_with = "studio_name"
    )]
    pub name: String,
    #[serde(default, alias = "place_id")]
    pub place_id: Option<Value>,
    #[serde(default, skip_deserializing)]
    pub target: Option<TargetStamp>,
    #[serde(default, skip_deserializing)]
    pub verification_error: Option<String>,
}

fn studio_name<'de, D: serde::Deserializer<'de>>(deserializer: D) -> Result<String, D::Error> {
    // Official listing includes {id, name:null} for a running Studio with no place.
    Ok(Option::<String>::deserialize(deserializer)?.unwrap_or_default())
}

// Epoch is local evidence continuity, never a revision claimed to come from Roblox.
#[derive(Debug, Clone, Deserialize, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct TargetStamp {
    pub studio_id: String,
    pub name: String,
    pub place_id: Option<Value>,
    pub mode: String,
    pub epoch: u64,
}
struct Observations {
    next: u64,
    targets: HashMap<String, TargetStamp>,
}
static OBSERVATIONS: LazyLock<Mutex<Observations>> = LazyLock::new(|| {
    // Keep persisted snapshots from a previous process outside this process's epoch.
    let boot = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as u64;
    Mutex::new(Observations {
        next: boot * 1024,
        targets: HashMap::new(),
    })
});
fn observe(target: &StudioInstance, mode: String) -> Result<TargetStamp, String> {
    let mut state = OBSERVATIONS.lock().map_err(|_| "State Studio rusak.")?;
    let mut stamp = TargetStamp {
        studio_id: target.studio_id.clone(),
        name: target.name.clone(),
        place_id: target.place_id.clone(),
        mode,
        epoch: 0,
    };
    if let Some(previous) = state.targets.get(&target.studio_id) {
        stamp.epoch = previous.epoch;
        if &stamp == previous {
            return Ok(stamp);
        }
    }
    state.next += 1;
    stamp.epoch = state.next;
    state
        .targets
        .insert(target.studio_id.clone(), stamp.clone());
    Ok(stamp)
}
fn invalidate() {
    if let Ok(mut state) = OBSERVATIONS.lock() {
        state.targets.clear();
    }
}
pub fn current(stamp: &TargetStamp) -> Result<(), String> {
    if OBSERVATIONS
        .lock()
        .map_err(|_| "State Studio rusak.")?
        .targets
        .get(&stamp.studio_id)
        != Some(stamp)
    {
        return Err(
            "Identitas/koneksi map berubah. Tugas dihentikan; kirim ulang pada map aktif.".into(),
        );
    }
    Ok(())
}
fn state_mode(value: &Value) -> Option<String> {
    // Studio 0.745 returns a documented text report, not a JSON object.
    if let Some(text) = value.as_str() {
        let mode = text
            .lines()
            .find_map(|line| line.strip_prefix("- Current Studio Mode: "))?;
        return match mode.trim() {
            "Edit" => Some("Edit".into()),
            "Play" | "Playtest" => Some("Play".into()),
            _ => None,
        };
    }
    for key in ["play_state", "playState", "state", "mode"] {
        if let Some(text) = value[key].as_str() {
            let mode = match text.to_ascii_lowercase().as_str() {
                "edit" | "stopped" | "not_running" => "Edit",
                "play" | "playing" | "running" | "paused" | "run" => "Play",
                _ => continue,
            };
            return Some(mode.into());
        }
    }
    None
}

fn state_result(result: &Value) -> Result<Value, String> {
    if result["isError"].as_bool() == Some(true) {
        if result["content"].as_array().is_some_and(|items| {
            items.iter().any(|item| {
                item["type"] == "text"
                    && item["text"]
                        .as_str()
                        .is_some_and(|text| text.trim() == "Place is not open")
            })
        }) {
            return Err(NO_PLACE_ERROR.into());
        }
        return Err("Studio gagal memverifikasi mode map.".into());
    }
    if let Ok(value) = text_result(result) {
        return Ok(value);
    }
    result["content"]
        .as_array()
        .and_then(|items| {
            items.iter().find_map(|item| {
                (item["type"] == "text")
                    .then(|| item["text"].as_str().map(|s| Value::String(s.into())))
                    .flatten()
            })
        })
        .ok_or("Respons mode Studio belum didukung.".into())
}

static CLIENT: Mutex<Option<Session>> = Mutex::new(None);
struct SessionLease(Option<Session>);
impl std::ops::Deref for SessionLease {
    type Target = Session;
    fn deref(&self) -> &Session {
        self.0.as_ref().unwrap()
    }
}
impl std::ops::DerefMut for SessionLease {
    fn deref_mut(&mut self) -> &mut Session {
        self.0.as_mut().unwrap()
    }
}
impl Drop for SessionLease {
    fn drop(&mut self) {
        if let Some(session) = self.0.take() {
            if !session.failed && !STOPPING.load(std::sync::atomic::Ordering::SeqCst) {
                if let Ok(mut client) = CLIENT.lock() {
                    *client = Some(session);
                    return;
                }
            }
            invalidate();
        }
    }
}

struct Session {
    executable: PathBuf,
    child: Arc<Mutex<Child>>,
    stdin: Option<ChildStdin>,
    incoming: Receiver<Result<Value, String>>,
    reader: Option<std::thread::JoinHandle<()>>,
    deadline: Instant,
    next_id: u64,
    initialized: Option<Value>,
    failed: bool,
}

fn read_message(reader: &mut impl BufRead) -> Result<Option<Value>, String> {
    let mut line = Vec::new();
    reader
        .take(MAX_MESSAGE + 1)
        .read_until(b'\n', &mut line)
        .map_err(|_| "Transport Studio terputus.".to_string())?;
    if line.is_empty() {
        return Ok(None);
    }
    if line.len() as u64 > MAX_MESSAGE || !line.ends_with(b"\n") {
        return Err("Pesan MCP terlalu besar atau tidak lengkap.".into());
    }
    let value: Value =
        serde_json::from_slice(&line).map_err(|_| "Pesan MCP bukan JSON UTF-8 yang sah.")?;
    if value.get("jsonrpc").and_then(Value::as_str) != Some("2.0") || !value.is_object() {
        return Err("Versi pesan MCP tidak didukung.".into());
    }
    Ok(Some(value))
}

impl Session {
    fn start(executable: &PathBuf) -> Result<Self, String> {
        let mut active = ACTIVE_CHILD
            .lock()
            .map_err(|_| "Kunci proses Studio rusak.")?;
        if STOPPING.load(std::sync::atomic::Ordering::SeqCst) {
            return Err("Aplikasi sedang ditutup.".into());
        }
        let mut command = Command::new(executable);
        command
            .env_clear()
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            // Server diagnostics can contain place data; do not forward them to app logs.
            .stderr(Stdio::null());
        #[cfg(not(target_os = "windows"))]
        command.env("PATH", "/usr/bin:/bin");
        #[cfg(target_os = "windows")]
        if let Some(system) = std::env::var_os("SystemRoot") {
            command.env("PATH", PathBuf::from(system).join("System32"));
        }
        for key in [
            "HOME",
            "TMPDIR",
            "SystemRoot",
            "LOCALAPPDATA",
            "TEMP",
            "USERPROFILE",
        ] {
            if let Some(value) = std::env::var_os(key) {
                command.env(key, value);
            }
        }
        #[cfg(not(target_os = "windows"))]
        if let Some(directory) = executable.parent() {
            command.current_dir(directory);
        }
        #[cfg(target_os = "windows")]
        command.current_dir(
            PathBuf::from(std::env::var_os("LOCALAPPDATA").ok_or("LOCALAPPDATA tidak tersedia.")?)
                .join("Roblox"),
        );
        let mut child = command
            .spawn()
            .map_err(|_| "StudioMCP gagal dijalankan. Periksa instalasi Roblox Studio.")?;
        let stdin = child.stdin.take();
        let stdout = child.stdout.take().expect("piped stdout");
        let child = Arc::new(Mutex::new(child));
        *active = Some(child.clone());
        drop(active);
        let (sender, incoming) = mpsc::sync_channel(4);
        let reader = std::thread::spawn(move || {
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
        Ok(Self {
            executable: executable.clone(),
            child,
            stdin,
            incoming,
            reader: Some(reader),
            deadline: Instant::now() + Duration::from_secs(20),
            next_id: 0,
            initialized: None,
            failed: false,
        })
    }

    fn send(&mut self, message: Value) -> Result<(), String> {
        let stdin = self.stdin.as_mut().ok_or("Sesi MCP sudah ditutup.")?;
        let mut bytes = serde_json::to_vec(&message).map_err(|_| "Pesan MCP tidak sah.")?;
        bytes.push(b'\n');
        stdin
            .write_all(&bytes)
            .and_then(|_| stdin.flush())
            .map_err(|_| "StudioMCP menutup transport.".into())
    }

    fn request(&mut self, method: &str, params: Value) -> Result<Value, String> {
        let result = self.request_inner(method, params);
        if result.is_err() {
            self.failed = true;
        }
        result
    }
    fn request_inner(&mut self, method: &str, params: Value) -> Result<Value, String> {
        self.next_id += 1;
        let id = self.next_id;
        self.send(json!({"jsonrpc":"2.0","id":id,"method":method,"params":params}))?;
        loop {
            let remaining = self
                .deadline
                .checked_duration_since(Instant::now())
                .ok_or("Pemeriksaan Studio melewati batas 20 detik. Buka place dan aktifkan MCP di Assistant Studio.")?;
            let message = match self.incoming.recv_timeout(remaining) {
                Ok(message) => message?,
                Err(mpsc::RecvTimeoutError::Timeout) => {
                    let _ = self.send(json!({"jsonrpc":"2.0","method":"notifications/cancelled",
                        "params":{"requestId":id,"reason":"Client timeout"}}));
                    return Err("Pemeriksaan Studio melewati batas 20 detik. Buka place dan aktifkan MCP di Assistant Studio.".into());
                }
                Err(_) => {
                    return Err(
                        "StudioMCP terputus. Buka kembali Studio dan ulangi pemeriksaan.".into(),
                    )
                }
            };
            if let Some(method) = message.get("method").and_then(Value::as_str) {
                if let Some(request_id) = message.get("id") {
                    let response = if method == "ping" {
                        json!({"jsonrpc":"2.0","id":request_id,"result":{}})
                    } else {
                        json!({"jsonrpc":"2.0","id":request_id,"error":{"code":-32601,"message":"Client capability unavailable"}})
                    };
                    self.send(response)?;
                }
                continue;
            }
            if message.get("id").and_then(Value::as_u64) != Some(id) {
                return Err("ID respons MCP tidak cocok dengan permintaan.".into());
            }
            if message.get("error").is_some() {
                return Err("Studio menolak permintaan MCP. Periksa target dan izin server di Assistant Studio.".into());
            }
            return message
                .get("result")
                .cloned()
                .ok_or_else(|| "Respons MCP tidak memiliki hasil.".into());
        }
    }
}

impl Drop for Session {
    fn drop(&mut self) {
        self.stdin.take();
        // Close the bounded receiver before joining, so a noisy server cannot block cleanup.
        let (_, empty) = mpsc::channel();
        drop(std::mem::replace(&mut self.incoming, empty));
        if let Ok(mut child) = self.child.lock() {
            let deadline = Instant::now() + Duration::from_millis(100);
            while Instant::now() < deadline {
                if matches!(child.try_wait(), Ok(Some(_))) {
                    break;
                }
                std::thread::sleep(Duration::from_millis(5));
            }
            let _ = child.kill();
            let _ = child.wait();
        }
        if let Ok(mut active) = ACTIVE_CHILD.lock() {
            active.take();
        }
        if let Some(reader) = self.reader.take() {
            let _ = reader.join();
        }
    }
}

pub fn shutdown() {
    STOPPING.store(true, std::sync::atomic::Ordering::SeqCst);
    if let Ok(mut client) = CLIENT.lock() {
        client.take();
    }
    let child = ACTIVE_CHILD
        .lock()
        .ok()
        .and_then(|mut active| active.take());
    if let Some(child) = child {
        if let Ok(mut process) = child.lock() {
            let _ = process.kill();
            let _ = process.wait();
        }
    }
}

fn wait_bounded(
    command: &mut Command,
    timeout: Duration,
) -> Result<std::process::ExitStatus, String> {
    let mut child = command
        .spawn()
        .map_err(|_| "Pemeriksaan instalasi Studio gagal dijalankan.")?;
    let deadline = Instant::now() + timeout;
    loop {
        match child.try_wait() {
            Ok(Some(status)) => return Ok(status),
            Ok(None) if Instant::now() < deadline => std::thread::sleep(Duration::from_millis(10)),
            _ => {
                let _ = child.kill();
                let _ = child.wait();
                return Err("Pemeriksaan instalasi Studio melewati batas waktu.".into());
            }
        }
    }
}

#[cfg(target_os = "macos")]
fn executable() -> Result<PathBuf, String> {
    // Only installed Studio paths; webview input cannot select arbitrary executables.
    let mut applications = vec![PathBuf::from("/Applications")];
    if let Some(home) = std::env::var_os("HOME") {
        applications.push(PathBuf::from(home).join("Applications"));
    }
    let executable = applications
        .iter()
        .map(|root| root.join("RobloxStudio.app/Contents/MacOS/StudioMCP"))
        .find(|file| file.is_file())
        .ok_or_else(|| {
            "StudioMCP tidak ditemukan. Pasang Roblox Studio di folder Applications.".to_string()
        })?;
    #[cfg(target_os = "macos")]
    {
        let valid = wait_bounded(Command::new("/usr/bin/codesign")
            .args(["--verify", "--strict",
                "-R=anchor apple generic and identifier \"StudioMCP\" and certificate leaf[subject.OU] = \"2CFABCH843\""])
            .arg(&executable)
            .env_clear()
            .stdout(Stdio::null())
            .stderr(Stdio::null()), Duration::from_secs(3))?;
        if !valid.success() {
            return Err("Tanda tangan StudioMCP bukan instalasi Roblox yang didukung.".into());
        }
    }
    Ok(executable)
}

#[cfg(target_os = "windows")]
fn executable() -> Result<PathBuf, String> {
    // Read the official launcher as data. Never execute mutable batch commands.
    // Only a literal installed StudioMCP.exe reference is supported; unknown launchers fail closed.
    let local =
        PathBuf::from(std::env::var_os("LOCALAPPDATA").ok_or("LOCALAPPDATA tidak tersedia.")?);
    let root = local
        .join("Roblox")
        .canonicalize()
        .map_err(|_| "Instalasi Roblox belum ditemukan.")?;
    let launcher = root.join("mcp.bat");
    let canonical = launcher
        .canonicalize()
        .map_err(|_| "mcp.bat resmi belum tersedia. Perbarui Roblox Studio.")?;
    if !canonical.starts_with(&root)
        || std::fs::metadata(&canonical)
            .map_err(|_| "Launcher tidak dapat diperiksa.")?
            .len()
            > 32768
    {
        return Err("Asal launcher Studio tidak sah.".into());
    }
    let batch =
        std::fs::read_to_string(canonical).map_err(|_| "Format launcher Studio belum didukung.")?;
    let executable = batch.split('"').skip(1).step_by(2).find_map(|candidate| {
        let candidate = candidate.replace("%LOCALAPPDATA%", &local.to_string_lossy()).replace("%~dp0", &format!("{}\\", root.display()));
        let path = PathBuf::from(candidate).canonicalize().ok()?;
        (path.starts_with(root.join("Versions")) && path.file_name()?.to_str()? == "StudioMCP.exe").then_some(path)
    }).ok_or("Versi launcher Windows belum dapat diverifikasi. Koneksi Windows belum terverifikasi; adapter perlu diperbarui.")?;
    let system = PathBuf::from(std::env::var_os("SystemRoot").ok_or("SystemRoot tidak tersedia.")?);
    let valid = wait_bounded(Command::new(system.join("System32/WindowsPowerShell/v1.0/powershell.exe"))
        .args(["-NoProfile", "-NonInteractive", "-Command", "$s=Get-AuthenticodeSignature -LiteralPath $env:FORGEKIT_STUDIO_VERIFY; if ($s.Status -eq 'Valid' -and $s.SignerCertificate.Subject -match '(^|, )O=Roblox Corporation(,|$)') {exit 0}; exit 1"])
        .env_clear().env("SystemRoot", &system).env("FORGEKIT_STUDIO_VERIFY", &executable)
        .stdout(Stdio::null()).stderr(Stdio::null()), Duration::from_secs(5))?;
    if !valid.success() {
        return Err("Signature StudioMCP Windows bukan Roblox yang terverifikasi.".into());
    }
    Ok(executable)
}
#[cfg(not(any(target_os = "windows", target_os = "macos")))]
fn executable() -> Result<PathBuf, String> {
    Err("Koneksi Studio belum didukung pada OS ini. Gunakan macOS atau Windows yang didukung Roblox Studio.".into())
}

fn text_result(result: &Value) -> Result<Value, String> {
    if result.get("isError").and_then(Value::as_bool) == Some(true) {
        return Err("Tool Studio gagal. Periksa place, target, dan status MCP lalu ulangi.".into());
    }
    if let Some(structured) = result.get("structuredContent") {
        return Ok(structured.clone());
    }
    let text = result
        .get("content")
        .and_then(Value::as_array)
        .and_then(|items| {
            items.iter().find_map(|item| {
                (item.get("type")?.as_str()? == "text")
                    .then(|| item.get("text")?.as_str())
                    .flatten()
            })
        })
        .ok_or("Tool Studio tidak mengembalikan konten teks.")?;
    serde_json::from_str(text)
        .map_err(|_| "Daftar instance Studio bukan JSON yang didukung.".into())
}

fn discover() -> Result<(SessionLease, StudioReport, Vec<Value>), String> {
    let existing = CLIENT
        .lock()
        .map_err(|_| "Kunci klien Studio rusak.")?
        .take();
    let mut session = SessionLease(Some(match existing {
        Some(session) => session,
        // A retained child already ran a verified executable. Re-resolving and
        // codesigning it for each RPC adds latency without verifying that child.
        // Every new process still passes the full OS signature/path checks.
        None => Session::start(&executable()?)?,
    }));
    session.deadline = Instant::now() + Duration::from_secs(20);
    let initialized = if let Some(value) = &session.initialized {
        value.clone()
    } else {
        session.request(
            "initialize",
            json!({
                "protocolVersion":"2025-06-18","capabilities":{},
                "clientInfo":{"name":"ForgeKit Studio","version":env!("CARGO_PKG_VERSION")}
            }),
        )?
    };
    let protocol = initialized.get("protocolVersion").and_then(Value::as_str);
    if !matches!(protocol, Some("2025-06-18" | "2025-03-26" | "2024-11-05"))
        || !initialized["capabilities"]["tools"].is_object()
    {
        return Err("Versi protokol atau kapabilitas tools Studio tidak didukung.".into());
    }
    if session.initialized.is_none() {
        session.send(json!({"jsonrpc":"2.0","method":"notifications/initialized"}))?;
        session.initialized = Some(initialized.clone());
    }
    // The installed proxy exposes this discovery call even when tools/list is empty.
    let listing = session.request(
        "tools/call",
        json!({"name":"list_roblox_studios","arguments":{}}),
    )?;
    let decoded = text_result(&listing)?;
    let studios: Vec<StudioInstance> = serde_json::from_value(decoded["studios"].clone())
        .map_err(|_| "Format daftar instance Studio belum didukung.")?;
    let unique: std::collections::HashSet<_> = studios.iter().map(|s| &s.studio_id).collect();
    if studios.len() > 64
        || unique.len() != studios.len()
        || studios.iter().any(|studio| {
            !valid_id(&studio.studio_id)
                || studio.name.len() > 512
                || studio.name.chars().any(char::is_control)
                || studio
                    .place_id
                    .as_ref()
                    .is_some_and(|id| !(id.is_null() || id.is_string() || id.is_u64()))
        })
    {
        return Err("Daftar target Studio tidak sah.".into());
    }
    let mut tools = Vec::new();
    let mut cursor = None;
    for page in 0..if studios.is_empty() { 0 } else { 8 } {
        let params = cursor
            .as_ref()
            .map_or(json!({}), |value| json!({"cursor":value}));
        let result = session.request("tools/list", params)?;
        let entries = result["tools"]
            .as_array()
            .ok_or("Daftar tools MCP tidak sah.")?;
        if entries.len() + tools.len() > 256 {
            return Err("Jumlah tools MCP melampaui batas 256.".into());
        }
        tools.extend(entries.iter().cloned());
        cursor = result
            .get("nextCursor")
            .and_then(Value::as_str)
            .map(str::to_owned);
        if cursor.is_none() {
            break;
        }
        if page == 7 {
            return Err("Pagination tools MCP melampaui batas.".into());
        }
    }
    let report = StudioReport {
        availability: "mcp_ready".into(),
        executable: session.executable.to_string_lossy().into_owned(),
        protocol_version: protocol.unwrap().into(),
        server_name: initialized["serverInfo"]["name"]
            .as_str()
            .unwrap_or("StudioMCP")
            .into(),
        checked_at: SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .map_err(|_| "Jam sistem tidak sah.")?
            .as_millis()
            .to_string(),
        studios,
        read_tools: READ_TOOLS
            .iter()
            .filter(|name| tools.iter().any(|tool| tool["name"] == **name))
            .map(|name| (*name).into())
            .collect(),
    };
    Ok((session, report, tools))
}

fn valid_id(id: &str) -> bool {
    !id.is_empty() && id.len() <= 256 && !id.chars().any(char::is_control)
}

fn verify(
    session: &mut Session,
    tools: &[Value],
    target: &StudioInstance,
) -> Result<TargetStamp, String> {
    let entry = tools
        .iter()
        .find(|tool| tool["name"] == "get_studio_state")
        .ok_or("Tool verifikasi map belum tersedia.")?;
    if entry["inputSchema"]["properties"]
        .get("studio_id")
        .is_none()
    {
        return Err("Schema verifikasi tidak memiliki studio_id.".into());
    }
    let state = state_result(&session.request(
        "tools/call",
        json!({"name":"get_studio_state","arguments":{"studio_id":target.studio_id}}),
    )?)?;
    let mode = state_mode(&state)
        .ok_or("Mode map dari Studio belum dapat diverifikasi; adapter perlu diperbarui.")?;
    observe(target, mode)
}

fn verify_after(session: &mut Session, tools: &[Value], stamp: &TargetStamp) -> Result<(), String> {
    let listing = text_result(&session.request(
        "tools/call",
        json!({"name":"list_roblox_studios","arguments":{}}),
    )?)?;
    let studios: Vec<StudioInstance> = serde_json::from_value(listing["studios"].clone())
        .map_err(|_| "Identitas map tidak dapat diperiksa ulang.")?;
    let target = studios
        .iter()
        .find(|s| s.studio_id == stamp.studio_id)
        .ok_or_else(|| {
            if let Ok(mut observations) = OBSERVATIONS.lock() {
                observations.targets.remove(&stamp.studio_id);
            }
            "Map ditutup selama pembacaan.".to_string()
        })?;
    if verify(session, tools, target)? != *stamp {
        return Err("Map/mode berubah selama pembacaan; hasil dibuang.".into());
    }
    current(stamp)
}

pub fn probe() -> Result<StudioReport, String> {
    #[cfg(target_os = "macos")]
    if Command::new("/usr/bin/pgrep")
        .args(["-x", "RobloxStudio"])
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .status()
        .is_ok_and(|s| s.code() == Some(1))
    {
        invalidate();
        if let Ok(mut client) = CLIENT.lock() {
            client.take();
        }
        return Ok(StudioReport {
            availability: if executable().is_ok() {
                "not_running"
            } else {
                "not_installed"
            }
            .into(),
            executable: String::new(),
            protocol_version: String::new(),
            server_name: "StudioMCP".into(),
            checked_at: crate::storage::now_string(),
            studios: vec![],
            read_tools: vec![],
        });
    }
    let _guard = SESSION_LOCK
        .try_lock()
        .map_err(|_| "Koneksi Studio sedang dipakai; observasi menunggu pemeriksaan berikutnya.")?;
    let result = (|| {
        let (mut session, mut report, tools) = discover()?;
        // The listing is bounded to 64 targets and all requests share one deadline.
        for target in report.studios.iter_mut() {
            match verify(&mut session, &tools, target) {
                Ok(stamp) => target.target = Some(stamp),
                Err(error) => {
                    if session.failed {
                        return Err(error);
                    }
                    target.verification_error = Some(error);
                    OBSERVATIONS
                        .lock()
                        .map_err(|_| "State rusak.")?
                        .targets
                        .remove(&target.studio_id);
                }
            }
        }
        // A process/instance without a place is not an ambiguous map candidate.
        // Only this explicit live server response permits removing it; other
        // verification errors remain visible and never become connected targets.
        report
            .studios
            .retain(|target| target.verification_error.as_deref() != Some(NO_PLACE_ERROR));
        OBSERVATIONS
            .lock()
            .map_err(|_| "State rusak.")?
            .targets
            .retain(|id, _| report.studios.iter().any(|s| &s.studio_id == id));
        report.checked_at = crate::storage::now_string();
        Ok(report)
    })();
    if result.is_err() {
        invalidate();
    }
    result
}

pub fn read(studio_id: &str, tool: &str) -> Result<Value, String> {
    read_target(studio_id, tool, "game", 2).map(|(_, value)| value)
}

pub fn read_target(
    studio_id: &str,
    tool: &str,
    path: &str,
    depth: u8,
) -> Result<(StudioInstance, Value), String> {
    if !valid_id(studio_id) || !READ_TOOLS.contains(&tool) {
        return Err("Target atau tool baca Studio tidak sah.".into());
    }
    if path.is_empty()
        || path.len() > 512
        || path.chars().any(char::is_control)
    {
        return Err("Scope hierarki harus berisi path yang sah.".into());
    }
    if tool == "search_game_tree" && !(1..=4).contains(&depth) {
        return Err("Depth search_game_tree harus 1-4.".into());
    }
    let _guard = SESSION_LOCK
        .try_lock()
        .map_err(|_| "Pemeriksaan Studio lain masih berjalan.")?;
    let (mut session, report, tools) = discover()?;
    let mut target = report
        .studios
        .iter()
        .find(|studio| studio.studio_id == studio_id)
        .cloned()
        .ok_or("Target Studio sudah tidak tersedia. Periksa ulang daftar instance.")?;
    let stamp = verify(&mut session, &tools, &target)?;
    target.target = Some(stamp.clone());
    let schema = tools
        .iter()
        .find(|entry| entry["name"] == tool)
        .ok_or("Tool baca belum tersedia pada Studio ini.")?;
    let properties = &schema["inputSchema"]["properties"];
    if properties.get("studio_id").is_none() {
        return Err("Tool tidak mendukung target studio_id eksplisit.".into());
    }
    let mut arguments = json!({"studio_id":studio_id});
    if tool == "search_game_tree" {
        if properties.get("path").is_none()
            || properties.get("depth").is_none() && properties.get("max_depth").is_none()
        {
            return Err("Tool hierarki belum menyediakan batas path/depth yang didukung.".into());
        }
        if stamp.mode != "Edit" {
            return Err(
                "Mode Play aktif. Konteks Edit dibatalkan; kembali ke Edit untuk membaca map."
                    .into(),
            );
        }
        // The installed schema uses paths relative to the DataModel and requires Edit explicitly.
        if path != "game" {
            arguments["path"] = json!(path.strip_prefix("game.").unwrap_or(path));
        }
        if properties.get("datamodel_type").is_some() {
            arguments["datamodel_type"] = json!("Edit");
        }
        if properties.get("head_limit").is_some() {
            arguments["head_limit"] = json!(300);
        }
        if properties.get("depth").is_some() {
            arguments["depth"] = json!(depth);
        }
        if properties.get("max_depth").is_some() {
            arguments["max_depth"] = json!(depth);
        }
    } else if tool == "inspect_instance" {
        arguments["path"] = json!(path.strip_prefix("game.").unwrap_or(path));
    } else if tool == "script_read" {
        arguments["target_file"] = json!(if path.starts_with("game.") {
            path.to_string()
        } else {
            format!("game.{path}")
        });
        if properties.get("should_read_entire_file").is_some() {
            arguments["should_read_entire_file"] = json!(true);
        }
    }
    if let Some(required) = schema["inputSchema"]["required"].as_array() {
        for field in required {
            let name = field.as_str().ok_or("Schema tool baca tidak sah.")?;
            if arguments.get(name).is_none() {
                return Err(format!(
                    "Tool membutuhkan field tambahan: {name}. Adapter perlu diperbarui."
                ));
            }
        }
    }
    let result = session.request("tools/call", json!({"name":tool,"arguments":arguments}))?;
    if result.get("isError").and_then(Value::as_bool) == Some(true) {
        return Err("Pembacaan Studio gagal. Target mungkin ditutup atau playtest berubah.".into());
    }
    verify_after(&mut session, &tools, &stamp)?;
    let parsed = parse_tool_output(&result);
    Ok((target, parsed))
}

fn parse_tool_output(result: &Value) -> Value {
    if let Some(structured) = result.get("structuredContent") {
        return structured.clone();
    }
    if let Some(items) = result.get("content").and_then(Value::as_array) {
        for item in items {
            if item.get("type").and_then(Value::as_str) == Some("text") {
                if let Some(text) = item.get("text").and_then(Value::as_str) {
                    if let Ok(val) = serde_json::from_str::<Value>(text) {
                        return val;
                    }
                    if let Some((_, body)) = text.split_once("(results truncated)\n\n") {
                        if let Ok(val) = serde_json::from_str::<Value>(body) {
                            return val;
                        }
                    }
                }
            }
        }
    }
    result.clone()
}

// Only map-scoped tools are exposed. Provider output cannot choose a process or another Studio.
const AGENT_READ: &[&str] = &[
    "get_studio_state",
    "search_game_tree",
    "inspect_instance",
    "script_read",
    "script_search",
    "script_grep",
    "skill",
];
const AGENT_WRITE: &[&str] = &["execute_luau", "multi_edit"];
/// Writes that cannot carry an in-Studio identity guard stay unavailable to the agent.
/// `multi_edit` edits script text directly, so the map cannot be re-checked at apply time.
const UNGUARDED_WRITE: &[&str] = &["multi_edit"];
pub fn is_write(name: &str) -> bool {
    AGENT_WRITE.contains(&name.strip_prefix("forgekit_studio_").unwrap_or(name))
}
fn agent_schema(entry: &Value, writable: bool) -> Option<crate::tools::ToolDefinition> {
    let name = entry["name"].as_str()?;
    if UNGUARDED_WRITE.contains(&name)
        || (!AGENT_READ.contains(&name) && !(writable && AGENT_WRITE.contains(&name)))
    {
        return None;
    }
    let mut schema = entry["inputSchema"].clone();
    schema["properties"].as_object_mut()?.remove("studio_id")?;
    if let Some(required) = schema["required"].as_array_mut() {
        required.retain(|value| value != "studio_id");
    }
    if is_write(name) {
        if let Some(props) = schema["properties"].as_object_mut() {
            props.remove("datamodel_type");
        }
        if let Some(required) = schema["required"].as_array_mut() {
            required.retain(|value| value != "datamodel_type");
        }
    } else if let Some(props) = schema["properties"].as_object_mut() {
        if let Some(dmt) = props.get_mut("datamodel_type") {
            dmt["enum"] = json!(["Edit"]);
        }
    }
    // Backend owns the permanent-write datamodel, just as it owns studio_id.
    if is_write(name) {
        schema["properties"].as_object_mut()?.remove("datamodel_type");
        if let Some(required) = schema["required"].as_array_mut() {
            required.retain(|value| value != "datamodel_type");
        }
    }
    schema["additionalProperties"] = json!(false);
    Some(crate::tools::ToolDefinition {
        name: name.into(),
        wire_name: format!("forgekit_studio_{name}"),
        description: format!(
            "{} Target Studio dikunci ForgeKit. {}",
            entry["description"].as_str().unwrap_or(name),
            if is_write(name) {
                "Operasi mengubah map dalam satu recording undo milik ForgeKit (rollback otomatis bila error); jangan membuat recording sendiri. Baca keadaan awal dan verifikasi hasil."
            } else {
                "Pembacaan live pada map tujuan."
            }
        ),
        input_schema: schema,
        strict: false,
    })
}
pub fn agent_catalog(
    stamp: &TargetStamp,
    writable: bool,
) -> Result<Vec<crate::tools::ToolDefinition>, String> {
    current(stamp)?;
    let _guard = SESSION_LOCK
        .try_lock()
        .map_err(|_| "Koneksi Studio sedang dipakai.")?;
    let (mut session, report, tools) = discover()?;
    let target = report
        .studios
        .iter()
        .find(|s| s.studio_id == stamp.studio_id)
        .ok_or("Map tujuan sudah ditutup.")?;
    if verify(&mut session, &tools, target)? != *stamp {
        return Err("Identitas map tugas berubah.".into());
    }
    // The protocol has no document revision, so writes are only exposed as execute_luau,
    // which agent_call wraps in an identity guard evaluated inside Studio at run time.
    Ok(tools
        .iter()
        .filter_map(|entry| agent_schema(entry, writable))
        .collect())
}
pub fn freeze(
    studio_id: &str,
    snapshot: Option<&crate::context::ContextSnapshot>,
) -> Result<TargetStamp, String> {
    let expected = snapshot.and_then(|s| s.target.as_ref()).ok_or(
        "Konteks map terverifikasi diperlukan. Tunggu pembacaan map selesai lalu kirim ulang.",
    )?;
    if expected.studio_id != studio_id {
        return Err("Snapshot dan target berbeda.".into());
    }
    current(expected)?;
    crate::context::validate_age(snapshot.unwrap())?;
    Ok(expected.clone())
}
pub fn validate_snapshot(snapshot: &crate::context::ContextSnapshot) -> Result<(), String> {
    crate::context::validate_age(snapshot)?;
    current(
        snapshot
            .target
            .as_ref()
            .ok_or("Snapshot lama belum memiliki identitas live. Baca map ulang.")?,
    )
}

fn agent_arguments(entry: &Value, studio_id: &str, input: &str) -> Result<Value, String> {
    if input.len() > 65536 {
        return Err("Input tool melebihi 64 KiB.".into());
    }
    let mut args: Value = serde_json::from_str(input).map_err(|_| "Argumen tool bukan JSON.")?;
    let fields = args.as_object_mut().ok_or("Argumen tool harus objek.")?;
    let properties = entry["inputSchema"]["properties"]
        .as_object()
        .ok_or("Schema tool belum didukung.")?;
    if fields.contains_key("studio_id") || fields.keys().any(|key| !properties.contains_key(key)) {
        return Err("Tool mencoba mengubah target atau memakai field di luar schema.".into());
    }
    fields.insert("studio_id".into(), json!(studio_id));
    if properties.contains_key("datamodel_type") {
        if let Some(value) = fields.get("datamodel_type") {
            let supplied = value.as_str().ok_or("datamodel_type harus bernilai Edit.")?;
            if supplied != "Edit" {
                if is_write(entry["name"].as_str().unwrap_or("")) {
                    return Err("Perubahan otomatis hanya diizinkan pada Edit map tujuan.".into());
                } else {
                    return Err(format!("Mode Studio saat ini Edit. Nilai {supplied} tidak diizinkan pada mode ini."));
                }
            }
        }
        fields.insert("datamodel_type".into(), json!("Edit"));
    }
    if let Some(required) = entry["inputSchema"]["required"].as_array() {
        for name in required {
            if fields
                .get(name.as_str().ok_or("Schema tidak sah.")?)
                .is_none()
            {
                return Err(format!("Field wajib tidak ada: {name}"));
            }
        }
    }
    Ok(args)
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum AgentCallError {
    NotExecuted(String),
    Unknown(String),
}

impl std::fmt::Display for AgentCallError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::NotExecuted(msg) | Self::Unknown(msg) => write!(f, "{msg}"),
        }
    }
}

impl AgentCallError {
    pub fn is_not_executed(&self) -> bool {
        matches!(self, Self::NotExecuted(_))
    }
    pub fn message(&self) -> &str {
        match self {
            Self::NotExecuted(s) | Self::Unknown(s) => s,
        }
    }
}

pub fn agent_call(
    stamp: &TargetStamp,
    call: &crate::tools::ToolCall,
    writable: bool,
) -> Result<Value, AgentCallError> {
    let _priority = AgentPriority::enter();
    current(stamp).map_err(AgentCallError::NotExecuted)?;
    let studio_id = &stamp.studio_id;
    let name = call
        .name
        .strip_prefix("forgekit_studio_")
        .ok_or_else(|| AgentCallError::NotExecuted("Tool Studio tidak terdaftar.".into()))?;
    if !valid_id(studio_id)
        || UNGUARDED_WRITE.contains(&name)
        || (!AGENT_READ.contains(&name) && !(writable && AGENT_WRITE.contains(&name)))
    {
        return Err(AgentCallError::NotExecuted("Tool atau target di luar izin tugas.".into()));
    }
    if is_write(name) && stamp.mode == "Play" {
        return Err(AgentCallError::NotExecuted(
            "Menunggu mode Edit. Perubahan permanen memerlukan mode Edit (hentikan Play).".into(),
        ));
    }
    let _guard = SESSION_LOCK
        .try_lock()
        .map_err(|_| AgentCallError::NotExecuted("Koneksi Studio sedang dipakai.".into()))?;
    let (mut session, report, tools) = discover().map_err(AgentCallError::NotExecuted)?;
    let target = report
        .studios
        .iter()
        .find(|s| &s.studio_id == studio_id)
        .ok_or_else(|| AgentCallError::NotExecuted("Target Studio sudah tidak tersedia; operasi tidak dialihkan ke map lain.".into()))?;
    if verify(&mut session, &tools, target).map_err(AgentCallError::NotExecuted)? != *stamp {
        return Err(AgentCallError::NotExecuted("Map/mode tugas berubah. Operasi dihentikan.".into()));
    }
    let entry = tools
        .iter()
        .find(|entry| entry["name"] == name)
        .ok_or_else(|| AgentCallError::NotExecuted("Tool tidak lagi tersedia.".into()))?;
    if agent_schema(entry, writable).is_none() {
        return Err(AgentCallError::NotExecuted("Tool tidak mendukung target eksplisit.".into()));
    }
    let mut arguments = agent_arguments(entry, studio_id, &call.arguments).map_err(AgentCallError::NotExecuted)?;
    if is_write(name) {
        // Probe the document identity right now, then make the write itself re-check it
        // inside Studio before touching anything. A switched map aborts with no change.
        session.deadline = Instant::now() + Duration::from_secs(20);
        let identity = probe_identity(&mut session, entry, studio_id).map_err(AgentCallError::NotExecuted)?;
        let code = arguments["code"]
            .as_str()
            .ok_or_else(|| AgentCallError::NotExecuted("execute_luau memerlukan field code.".into()))?;
        arguments["code"] = json!(guarded_luau(code, &identity).map_err(AgentCallError::NotExecuted)?);
        // discover()'s 20s budget covers reads; a write may build or load content for longer.
        // Losing the response mid-write would leave the outcome unknown, so match insert_blender.
        session.deadline = Instant::now() + WRITE_TIMEOUT;
    }
    let result = session
        .request("tools/call", json!({"name":name,"arguments":arguments}))
        .map_err(AgentCallError::Unknown)?;
    session.deadline = Instant::now() + Duration::from_secs(20);
    verify_after(&mut session, &tools, stamp).map_err(AgentCallError::Unknown)?;
    // isError is returned to the model as evidence, never converted to a success claim.
    Ok(crate::agent::bounded_result(result))
}

#[derive(Debug, Clone, PartialEq, Eq)]
struct DocumentIdentity {
    document_id: String,
    place_id: String,
}

const WRITE_TIMEOUT: Duration = Duration::from_secs(120);
const IDENTITY_PROBE: &str = "local run = game:GetService('RunService')\nreturn game:GetService('HttpService'):JSONEncode({running = run:IsRunning(), documentId = game:GetDebugId(32) .. ':' .. workspace:GetDebugId(32), placeId = tostring(game.PlaceId)})";

fn probe_identity(session: &mut Session, entry: &Value, studio_id: &str) -> Result<DocumentIdentity, String> {
    let input = json!({"code": IDENTITY_PROBE}).to_string();
    let arguments = agent_arguments(entry, studio_id, &input)?;
    let result = session.request("tools/call", json!({"name":"execute_luau","arguments":arguments}))?;
    let value = text_result(&result).map_err(|_| "Identitas map tidak dapat dibaca; penulisan tidak dijalankan.".to_string())?;
    identity_from(&value)
}

fn identity_from(value: &Value) -> Result<DocumentIdentity, String> {
    if value["running"] != false {
        return Err("[NEEDS_EDIT][TOOL_NOT_DISPATCHED] Hentikan Play di Studio sebelum perubahan.".into());
    }
    let document_id = value["documentId"].as_str().unwrap_or("");
    let place_id = value["placeId"].as_str().unwrap_or("");
    let safe = |text: &str, extra: &str| !text.is_empty() && text.len() <= 256
        && text.chars().all(|c| c.is_ascii_alphanumeric() || extra.contains(c));
    if !safe(document_id, "{}-:_") || !safe(place_id, "") {
        return Err("Identitas map tidak sah; penulisan tidak dijalankan.".into());
    }
    Ok(DocumentIdentity { document_id: document_id.into(), place_id: place_id.into() })
}

/// Wraps provider Luau so it only runs on the probed document, outside Play, inside one
/// ChangeHistory recording that commits on success and is cancelled (rolled back) on error.
/// If another plugin already holds a recording, the code runs inside that one instead.
fn guarded_luau(code: &str, identity: &DocumentIdentity) -> Result<String, String> {
    if code.trim().is_empty() || code.len() > 60_000 {
        return Err("Kode Luau kosong atau terlalu besar.".into());
    }
    Ok(format!(
        "local __fk_run = game:GetService('RunService')\n\
assert(not __fk_run:IsRunning(), 'ForgeKit: hentikan Play sebelum menulis.')\n\
assert(game:GetDebugId(32) .. ':' .. workspace:GetDebugId(32) == \"{document}\", 'ForgeKit: map berganti; penulisan dibatalkan tanpa perubahan.')\n\
assert(tostring(game.PlaceId) == \"{place}\", 'ForgeKit: place berubah; penulisan dibatalkan tanpa perubahan.')\n\
local __fk_history = game:GetService('ChangeHistoryService')\n\
local __fk_recording = __fk_history:TryBeginRecording('ForgeKit AI')\n\
local __fk_ok, __fk_result = pcall(function(...)\n{code}\nend)\n\
if __fk_recording then\n\
\t__fk_history:FinishRecording(__fk_recording, if __fk_ok then Enum.FinishRecordingOperation.Commit else Enum.FinishRecordingOperation.Cancel)\n\
end\n\
if not __fk_ok then error(__fk_result, 0) end\n\
return __fk_result\n",
        document = identity.document_id,
        place = identity.place_id,
    ))
}

/// Narrow trusted mesh import. General provider writes remain disabled. Every
/// yielding stage additionally checks the DataModel AND Workspace debug identity
/// inside Studio, which the older general-purpose write adapter cannot guarantee.
pub(crate) fn insert_blender(stamp:&TargetStamp,root:&std::path::Path,document:&Value,preview:&Value,version_id:&str)->Result<Value,String>{
    let _priority=AgentPriority::enter();
    current(stamp)?;
    if stamp.mode!="Edit" {return Err("Hentikan Play sebelum memasukkan model.".into());}
    let _guard=SESSION_LOCK.try_lock().map_err(|_|"Koneksi Studio sedang dipakai. Coba lagi setelah pembacaan selesai.")?;
    let (mut session,report,tools)=discover()?;
    let target=report.studios.iter().find(|s|s.studio_id==stamp.studio_id).ok_or("Map tujuan sudah ditutup.")?;
    if verify(&mut session,&tools,target)?!=*stamp {return Err("Map tujuan berubah; tidak ada impor.".into());}
    let entry=tools.iter().find(|t|t["name"]=="execute_luau").ok_or("Studio belum menyediakan impor mesh.")?;
    let deadline=Instant::now()+Duration::from_secs(600);
    crate::model3d::blender_insert::run(root,document,preview,version_id,|code|{
        if Instant::now()>=deadline {return Err("Impor melewati batas 10 menit; periksa receipt.".into());}
        current(stamp)?;
        let input=json!({"code":code}).to_string();
        let arguments=agent_arguments(entry,&stamp.studio_id,&input)?;
        session.deadline=(Instant::now()+Duration::from_secs(120)).min(deadline);
        let result=session.request("tools/call",json!({"name":"execute_luau","arguments":arguments}))?;
        // Do not retry an ambiguous write or upload after losing a response.
        if result["isError"] == true {
            let detail=result["content"].as_array().and_then(|blocks|blocks.iter().find_map(|b|b["text"].as_str())).unwrap_or("Periksa map dan izin Studio.");
            return Err(format!("Studio menolak impor: {}",detail.chars().take(800).collect::<String>()));
        }
        let value=text_result(&result)?;
        if value["ok"].is_null() {return Err("Receipt Studio tidak dapat dibaca; status operasi belum pasti.".into());}
        verify_after(&mut session,&tools,stamp)?;
        Ok(value)
    })
}

fn require_edit_state(state: &Value) -> Result<(), String> {
    if state["isError"] != true {
        if let Some(content) = state["content"].as_array() {
            for block in content {
                if let Some(text) = block["text"].as_str() {
                    for line in text.lines() {
                        if let Some((_, mode)) = line.split_once("Current Studio Mode:") {
                            return if mode.trim() == "Edit" { Ok(()) } else {
                                Err("[NEEDS_EDIT][TOOL_NOT_DISPATCHED] Menunggu mode Edit. Hentikan Play di Studio, lalu lanjutkan tugas.".into())
                            };
                        }
                    }
                }
            }
        }
    }
    Err("[TOOL_NOT_DISPATCHED] Mode Studio belum dapat diverifikasi. Periksa koneksi dan coba lanjutkan.".into())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Cursor;

    #[test]
    fn epochs_freeze_detectable_place_mode_and_reconnect_changes_and_fail_closed_writes() {
        let target = StudioInstance {
            studio_id: "fixture-identity-session".into(),
            name: "Nama sama".into(),
            place_id: None,
            target: None,
            verification_error: None,
        };
        let original = observe(&target, "Edit".into()).unwrap();
        assert_eq!(observe(&target, "Edit".into()).unwrap(), original);
        let playing = observe(&target, "Play".into()).unwrap();
        assert_ne!(playing.epoch, original.epoch);
        assert!(current(&original).is_err());
        let changed = StudioInstance {
            place_id: Some(json!(123)),
            ..target.clone()
        };
        let next = observe(&changed, "Edit".into()).unwrap();
        assert!(next.epoch > playing.epoch);
        OBSERVATIONS
            .lock()
            .unwrap()
            .targets
            .remove(&target.studio_id);
        assert!(current(&next).is_err());
        let reconnected = observe(&changed, "Edit".into()).unwrap();
        assert!(reconnected.epoch > next.epoch);
        // Same-name local document replacements without a server incarnation are
        // unobservable. Demonstrate the limitation and refuse writes before launch.
        assert_eq!(observe(&changed, "Edit".into()).unwrap(), reconnected);
        // Writes are refused before any Studio session when the task is read-only,
        // and multi_edit (no in-Studio guard possible) is never dispatched.
        let call = crate::tools::ToolCall {
            id: "fixture-write".into(),
            name: "forgekit_studio_execute_luau".into(),
            arguments: "{}".into(),
        };
        assert!(agent_call(&reconnected, &call, false).unwrap_err().is_not_executed());
        let edit = crate::tools::ToolCall { name: "forgekit_studio_multi_edit".into(), ..call };
        assert!(agent_call(&reconnected, &edit, true).unwrap_err().is_not_executed());
        assert!(freeze(&target.studio_id, None).is_err());
    }

    #[test]
    fn mode_and_structured_results_are_strict_and_remote_epochs_are_never_trusted() {
        assert_eq!(
            state_mode(&json!({"play_state":"Edit"})).as_deref(),
            Some("Edit")
        );
        assert_eq!(
            state_mode(&json!({"playState":"Playing"})).as_deref(),
            Some("Play")
        );
        assert!(state_mode(&json!({"state":"unknown"})).is_none());
        // Sanitized actual Studio 0.745 response; no fabricated JSON schema.
        let response = json!({"content":[{"type":"text","text":"- Current Studio Mode: Edit\n- Available DataModels: Edit\n- Focused DataModel in the viewport: Edit"}],"isError":false});
        assert_eq!(
            state_mode(&state_result(&response).unwrap()).as_deref(),
            Some("Edit")
        );
        assert!(state_result(&json!({"isError":true,"content":[{"type":"text","text":"- Current Studio Mode: Edit"}]})).is_err());
        assert_eq!(
            text_result(&json!({"structuredContent":{"studios":[]}})).unwrap(),
            json!({"studios":[]})
        );
        let target: StudioInstance = serde_json::from_value(
            json!({"studio_id":"fixture", "name":"Same", "target":{"epoch":7}}),
        )
        .unwrap();
        assert!(target.target.is_none());
    }

    #[test]
    fn permanent_writes_require_verified_edit_before_dispatch() {
        assert!(require_edit_state(&json!({"content":[{"type":"text","text":"- Current Studio Mode: Edit\n- Available DataModels: Edit"}]})).is_ok());
        for mode in ["Play", "Client", "Server"] {
            assert!(require_edit_state(&json!({"content":[{"type":"text","text":format!("- Current Studio Mode: {mode}")}]})).unwrap_err().contains("[NEEDS_EDIT][TOOL_NOT_DISPATCHED]"));
        }
        assert!(require_edit_state(&json!({"content":[]})).is_err());
        assert!(require_edit_state(&json!({"isError":true,"content":[{"text":"Current Studio Mode: Edit"}]})).is_err());
    }
    fn fixture_tool(name: &str) -> Value {
        json!({"name":name,"description":"Fixture","inputSchema":{"type":"object","properties":{"studio_id":{"type":"string"},"code":{"type":"string"},"datamodel_type":{"type":"string"}},"required":["studio_id","code","datamodel_type"]}})
    }

    #[test]
    fn agent_catalog_removes_target_and_only_exposes_available_scoped_tools() {
        let entry = fixture_tool("execute_luau");
        assert!(agent_schema(&entry, false).is_none());
        let tool = agent_schema(&entry, true).unwrap();
        assert_eq!(tool.wire_name, "forgekit_studio_execute_luau");
        assert!(tool.input_schema["properties"].get("datamodel_type").is_none());
        assert!(!tool.input_schema["required"].as_array().unwrap().contains(&json!("datamodel_type")));
        assert!(tool.input_schema["properties"].get("studio_id").is_none());
        assert!(!tool.input_schema["required"]
            .as_array()
            .unwrap()
            .contains(&json!("studio_id")));
        assert!(tool.input_schema["properties"].get("datamodel_type").is_none());
        assert!(!tool.input_schema["required"]
            .as_array()
            .unwrap()
            .contains(&json!("datamodel_type")));
        assert!(agent_schema(&fixture_tool("publish_place"), true).is_none());
        let mut unscoped = fixture_tool("inspect_instance");
        unscoped["inputSchema"]["properties"]
            .as_object_mut()
            .unwrap()
            .remove("studio_id");
        assert!(agent_schema(&unscoped, true).is_none());
    }

    #[test]
    fn agent_injects_locked_target_forces_edit_and_rejects_scope_override() {
        let entry = fixture_tool("execute_luau");
        let args = agent_arguments(&entry, "map-one", r#"{"code":"return 1"}"#).unwrap();
        assert_eq!(args["studio_id"], "map-one");
        assert_eq!(args["datamodel_type"], "Edit");
        for invalid in [
            r#"{"studio_id":"other","code":"return 1"}"#,
            r#"{"code":"return 1","datamodel_type":"Server"}"#,
            r#"{"code":"return 1","datamodel_type":"Client"}"#,
            r#"{"code":"return 1","datamodel_type":null}"#,
            r#"{"code":"return 1","datamodel_type":7}"#,
            r#"{"code":"return 1","unknown":1}"#,
            "[]",
            "{}",
        ] {
            assert!(
                agent_arguments(&entry, "map-one", invalid).is_err(),
                "{invalid}"
            );
        }
        assert!(agent_arguments(&entry, "map-one", &"x".repeat(65537)).is_err());
    }

    #[test]
    fn framing_rejects_invalid_oversized_and_unterminated_messages() {
        assert!(
            read_message(&mut Cursor::new(b"{\"jsonrpc\":\"2.0\",\"result\":{}}\n"))
                .unwrap()
                .is_some()
        );
        assert!(read_message(&mut Cursor::new(b"garbage\n")).is_err());
        assert!(read_message(&mut Cursor::new(b"{\"jsonrpc\":\"2.0\"}")).is_err());
        assert!(read_message(&mut Cursor::new(b"{}\n")).is_err());
        assert!(read_message(&mut Cursor::new(vec![b'x'; MAX_MESSAGE as usize + 1])).is_err());
        assert!(read_message(&mut Cursor::new(b"")).unwrap().is_none());
    }

    #[test]
    fn rejects_mutation_and_bad_targets_before_starting_process() {
        assert!(read("studio-1", "execute_luau").is_err());
        assert!(read("", "get_studio_state").is_err());
        assert!(read("studio\n1", "get_studio_state").is_err());
        assert!(!valid_id(&"s".repeat(257)));
    }

    #[test]
    fn decodes_empty_discovery_and_rejects_tool_errors() {
        let result = json!({"content":[{"type":"text","text":"{\"studios\":[]}"}],"isError":false});
        assert_eq!(text_result(&result).unwrap(), json!({"studios":[]}));
        assert!(text_result(&json!({"isError":true,"content":[]})).is_err());
        assert!(text_result(&json!({"content":[{"type":"text","text":"not json"}]})).is_err());
        // Actual 0.745 schema: an idle Studio can accompany a ready map.
        let idle: StudioInstance =
            serde_json::from_value(json!({"id":"idle-studio", "name":null})).unwrap();
        assert!(idle.name.is_empty());
        assert!(idle.place_id.is_none());
        assert_eq!(
            state_result(
                &json!({"isError":true,"content":[{"type":"text","text":"Place is not open"}]})
            )
            .unwrap_err(),
            NO_PLACE_ERROR
        );
        assert_ne!(
            state_result(
                &json!({"isError":true,"content":[{"type":"text","text":"Unrecognized error"}]})
            )
            .unwrap_err(),
            NO_PLACE_ERROR
        );
    }

    #[cfg(unix)]
    #[test]
    fn stdio_handles_server_ping_mismatch_timeout_and_reaps_child() {
        use std::os::unix::fs::PermissionsExt;
        let stamp = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        let directory = std::env::temp_dir().join(format!("forgekit-mcp-test-{stamp}"));
        std::fs::create_dir(&directory).unwrap();
        let executable = directory.join("server.py");
        std::fs::write(
            &executable,
            r#"#!/usr/bin/python3
import json, sys, time
for line in sys.stdin:
    request = json.loads(line)
    if request.get("method") == "notifications/cancelled":
        continue
    if request["method"] == "good":
        print(json.dumps({"jsonrpc":"2.0","id":"server-ping","method":"ping"}), flush=True)
        reply = json.loads(sys.stdin.readline())
        assert reply["id"] == "server-ping" and reply["result"] == {}
        print(json.dumps({"jsonrpc":"2.0","id":request["id"],"result":{"ok":True}}), flush=True)
    elif request["method"] == "bad":
        print(json.dumps({"jsonrpc":"2.0","id":999,"result":{}}), flush=True)
    else:
        time.sleep(3)
"#,
        )
        .unwrap();
        std::fs::set_permissions(&executable, std::fs::Permissions::from_mode(0o700)).unwrap();
        let mut session = Session::start(&executable).unwrap();
        assert_eq!(
            session.request("good", json!({})).unwrap(),
            json!({"ok":true})
        );
        // Fixture subprocess: retaining a healthy transport keeps its process and
        // request sequence, while a failed transport below is reaped.
        let child_id = session.child.lock().unwrap().id();
        drop(SessionLease(Some(session)));
        let mut session = CLIENT.lock().unwrap().take().unwrap();
        assert_eq!(session.child.lock().unwrap().id(), child_id);
        assert_eq!(session.executable, executable);
        assert_eq!(
            session.request("good", json!({})).unwrap(),
            json!({"ok":true})
        );
        assert_eq!(session.next_id, 2);
        assert!(session
            .request("bad", json!({}))
            .unwrap_err()
            .contains("ID respons"));
        let child = session.child.clone();
        drop(session);
        assert!(child.lock().unwrap().try_wait().unwrap().is_some());
        let mut session = Session::start(&executable).unwrap();
        session.deadline = Instant::now() + Duration::from_millis(150);
        let start = Instant::now();
        assert!(session
            .request("timeout", json!({}))
            .unwrap_err()
            .contains("20 detik"));
        let child = session.child.clone();
        drop(session);
        assert!(child.lock().unwrap().try_wait().unwrap().is_some());
        assert!(start.elapsed() < Duration::from_secs(2));
        std::fs::remove_dir_all(directory).unwrap();
    }
}

// Fixed, bundled read-only Explorer code only; never accepts provider/user Luau.
pub(crate) fn explorer_read(studio_id: &str, code: &str) -> Result<Value, String> {
    if !valid_id(studio_id) { return Err("Target Explorer tidak sah.".into()); }
    if AGENT_PENDING.load(std::sync::atomic::Ordering::SeqCst) > 0 { return Err("Studio sibuk; Explorer akan mencoba kembali.".into()); }
    let _guard = SESSION_LOCK.try_lock().map_err(|_| "Studio sibuk; Explorer akan mencoba kembali.")?;
    let (mut session, report, tools) = discover()?;
    if !report.studios.iter().any(|s| s.studio_id == studio_id) { return Err("Map Explorer sudah terputus.".into()); }
    if !tools.iter().any(|t| t["name"] == "execute_luau") { return Err("Adapter belum menyediakan pembacaan Explorer terstruktur.".into()); }
    let state = session.request("tools/call", json!({"name":"get_studio_state","arguments":{"studio_id":studio_id}}))?;
    require_edit_state(&state)?;
    session.request("tools/call", json!({"name":"execute_luau","arguments":{"studio_id":studio_id,"datamodel_type":"Edit","code":code}}))
}

// Persist the verified target, never an ordinal or a name-only identity.
pub(crate) fn map_epoch(studio_id: &str) -> Result<String, String> {
    let (target, _) = read_target(studio_id, "get_studio_state", "game", 2)?;
    serde_json::to_string(&target.target.ok_or("Target belum terverifikasi.")?).map_err(|e| e.to_string())
}
pub(crate) fn stop_play_for_resume(expected: &TargetStamp) -> Result<TargetStamp, String> {
    current(expected)?;
    let _priority = AgentPriority::enter();
    let _guard = SESSION_LOCK.try_lock().map_err(|_| "Studio sedang dipakai; coba kembali.")?;
    let (mut session, report, tools) = discover()?;
    let target = report.studios.iter().find(|s| s.studio_id == expected.studio_id).ok_or("Target semula terputus.")?;
    if verify(&mut session, &tools, target)? != *expected { return Err("Map/mode berubah; Play tidak dihentikan.".into()); }
    if expected.mode == "Edit" { return Ok(expected.clone()); }
    if expected.mode != "Play" || !tools.iter().any(|t| t["name"] == "start_stop_play") { return Err("Hentikan Play dari Studio lalu baca ulang target.".into()); }
    let result = session.request("tools/call", json!({"name":"start_stop_play","arguments":{"studio_id":expected.studio_id,"is_start":false}}))?;
    if result["isError"] == true { return Err("Play belum berhasil dihentikan; periksa Studio.".into()); }
    let observed = verify(&mut session, &tools, target)?;
    if observed.mode != "Edit" || observed.studio_id != expected.studio_id || observed.place_id != expected.place_id || observed.name != expected.name { return Err("Target Edit belum cocok dengan target tugas.".into()); }
    Ok(observed)
}

#[cfg(test)]
mod write_guard_tests {
    use super::*;

    fn identity() -> DocumentIdentity {
        identity_from(&json!({"running": false, "documentId": "{a1b2}:{c3d4}", "placeId": "12345"})).unwrap()
    }

    #[test]
    fn guarded_luau_checks_identity_and_wraps_one_undo_recording() {
        let code = guarded_luau("workspace.Part.Color = Color3.new(1, 0, 0)\nreturn 'ok'", &identity()).unwrap();
        let checks = code.find("map berganti").unwrap();
        let place = code.find("place berubah").unwrap();
        let body = code.find("workspace.Part.Color").unwrap();
        assert!(checks < body && place < body, "identity is verified before provider code runs");
        assert!(code.contains("== \"{a1b2}:{c3d4}\"") && code.contains("== \"12345\""));
        assert!(code.contains("TryBeginRecording") && code.contains("FinishRecordingOperation.Cancel"));
        assert!(code.contains("pcall(function(...)"));
        assert!(guarded_luau("  ", &identity()).is_err());
    }

    #[test]
    fn identity_probe_refuses_play_mode_and_unsafe_values() {
        assert!(identity_from(&json!({"running": true, "documentId": "{a}:{b}", "placeId": "1"})).unwrap_err().contains("NEEDS_EDIT"));
        assert!(identity_from(&json!({"running": false, "documentId": "\" .. os.exit() .. \"", "placeId": "1"})).is_err());
        assert!(identity_from(&json!({"running": false, "documentId": "{a}:{b}", "placeId": "1; drop"})).is_err());
        assert!(identity_from(&json!({"documentId": "{a}:{b}", "placeId": "1"})).is_err());
    }

    #[test]
    fn catalog_exposes_guarded_execute_luau_only_when_writable() {
        let entry = |name: &str| json!({"name": name, "description": "d", "inputSchema": {"type": "object",
            "properties": {"studio_id": {"type": "string"}, "code": {"type": "string"}, "datamodel_type": {"type": "string"}},
            "required": ["studio_id", "code"]}});
        assert!(agent_schema(&entry("execute_luau"), false).is_none());
        let tool = agent_schema(&entry("execute_luau"), true).unwrap();
        assert_eq!(tool.wire_name, "forgekit_studio_execute_luau");
        assert!(tool.input_schema["properties"].get("studio_id").is_none());
        assert!(tool.input_schema["properties"].get("datamodel_type").is_none());
        assert!(agent_schema(&entry("multi_edit"), true).is_none());
        assert!(is_write("forgekit_studio_multi_edit"), "multi_edit stays classified as a write");
    }
}
