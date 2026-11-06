//! Claude subscription login through the official Claude Code CLI, the same way Orca does it.
//! Every ForgeKit account is a private `CLAUDE_CONFIG_DIR`; sign-in runs `claude auth login
//! --claudeai` inside it and model turns run `claude -p` in the same profile (see
//! `ai::claude_code`). ForgeKit never reads, copies or sends the OAuth token: the CLI keeps it in
//! its own store, scoped to that profile. The user's global `~/.claude` login is never used.
use crate::{ai, auth::browser, model_catalog::ProviderModel};
use serde_json::{json, Value};
use std::{
    collections::{HashMap, HashSet},
    fs,
    io::{Read, Write},
    path::{Path, PathBuf},
    process::{Child, ChildStdin, Command, ExitStatus, Stdio},
    sync::{atomic::{AtomicBool, Ordering}, Arc, LazyLock, Mutex},
    thread::JoinHandle,
    time::{Duration, Instant, SystemTime, UNIX_EPOCH},
};

/// Marker endpoint for profiles served by Claude Code. Nothing is ever sent to it over HTTP.
pub const BASE_URL: &str = "https://claude.ai/claude-code";
const LOGIN_TIMEOUT: Duration = Duration::from_secs(600);
const COMMAND_TIMEOUT: Duration = Duration::from_secs(30);
/// Used only until the account's own catalog (`/model` in Claude Code) has been read.
const FALLBACK_MODELS: &[(&str, &str)] = &[("opus", "Claude Opus"), ("sonnet", "Claude Sonnet"), ("haiku", "Claude Haiku")];
/// Meta aliases that are not a model of their own.
const META_ALIASES: &[&str] = &["best", "default", "opusplan"];
/// Pinned model IDs Claude Code knows, newest first. Each is checked against the account with
/// `/model <id>` (no model request); IDs the account cannot use, or that Claude Code silently
/// maps to another model, are left out.
const PINNED_MODELS: &[&str] = &[
    "claude-opus-5-5", "claude-sonnet-5-5", "claude-haiku-5-5", "claude-fable-5-1",
    "claude-opus-5", "claude-sonnet-5", "claude-opus-4-8", "claude-opus-4-7", "claude-opus-4-6",
    "claude-sonnet-4-6", "claude-opus-4-5", "claude-sonnet-4-5", "claude-haiku-4-5",
    "claude-opus-4-1", "claude-opus-4-0", "claude-sonnet-4-0", "claude-3-7-sonnet-latest", "claude-3-5-haiku-latest",
];
const MODEL_CACHE: &str = "forgekit-models.json";
const MODEL_CACHE_SECONDS: u64 = 24 * 3600;
pub const EFFORTS: &[&str] = &["low", "medium", "high", "xhigh", "max"];

static LOCKS: LazyLock<Mutex<HashMap<String, Arc<Mutex<()>>>>> = LazyLock::new(|| Mutex::new(HashMap::new()));
static CHILDREN: LazyLock<Mutex<HashSet<u32>>> = LazyLock::new(|| Mutex::new(HashSet::new()));
static STOPPING: AtomicBool = AtomicBool::new(false);
#[derive(Default)]
struct LoginControl { code: Option<String>, link: Option<String> }
static LOGINS: LazyLock<Mutex<HashMap<String, LoginControl>>> = LazyLock::new(|| Mutex::new(HashMap::new()));

pub fn shutdown() {
    STOPPING.store(true, Ordering::SeqCst);
    if let Ok(children) = CHILDREN.lock() {
        for pid in children.iter() { let _ = Command::new("/bin/kill").args(["-TERM", &pid.to_string()]).stderr(Stdio::null()).status(); }
    }
}
pub(crate) fn stopping() -> bool { STOPPING.load(Ordering::SeqCst) }
pub(crate) fn track(pid: u32, running: bool) {
    if let Ok(mut children) = CHILDREN.lock() { if running { children.insert(pid); } else { children.remove(&pid); } }
}
fn account_lock(id: &str) -> Result<Arc<Mutex<()>>, String> {
    Ok(LOCKS.lock().map_err(|_| "Profil Claude sedang sibuk.")?.entry(id.into()).or_default().clone())
}
fn valid_id(id: &str) -> bool {
    !id.is_empty() && id.len() <= 100 && id.bytes().all(|c| c.is_ascii_alphanumeric() || c == b'-')
}
fn root() -> Result<PathBuf, String> {
    let user = std::env::var_os("HOME").ok_or("Direktori pengguna tidak tersedia.")?;
    #[cfg(target_os = "macos")]
    let root = PathBuf::from(user).join("Library/Application Support/dev.forgekit.studio/claude-accounts");
    #[cfg(not(target_os = "macos"))]
    let root = PathBuf::from(user).join(".local/share/dev.forgekit.studio/claude-accounts");
    Ok(root)
}
fn home(id: &str) -> Result<PathBuf, String> {
    if !valid_id(id) { return Err("ID profil Claude tidak sah.".into()); }
    Ok(root()?.join(id))
}
fn private_dir(path: &Path) -> Result<(), String> {
    fs::create_dir_all(path).map_err(|_| "Profil Claude tidak dapat dibuat.")?;
    if fs::symlink_metadata(path).map_err(|_| "Profil Claude tidak tersedia.")?.file_type().is_symlink() {
        return Err("Profil Claude tidak boleh berupa tautan.".into());
    }
    #[cfg(unix)] {
        use std::os::unix::fs::PermissionsExt;
        fs::set_permissions(path, fs::Permissions::from_mode(0o700)).map_err(|_| "Izin profil Claude gagal diatur.")?;
    }
    Ok(())
}
fn profile_id(key_ref: &str) -> Result<String, String> {
    key_ref.strip_prefix("claude-").filter(|v| valid_id(v)).map(str::to_owned)
        .ok_or_else(|| "Referensi akun Claude tidak sah.".into())
}
/// The saved profile directory for a connection; it must be ForgeKit's own, never a link.
pub(crate) fn account_home(key_ref: &str) -> Result<PathBuf, String> {
    let path = home(&profile_id(key_ref)?)?;
    for directory in [Some(path.as_path()), path.parent()].into_iter().flatten() {
        let meta = fs::symlink_metadata(directory).map_err(|_| "Profil Claude tidak tersedia. Hubungkan ulang akun Claude.")?;
        if !meta.is_dir() || meta.file_type().is_symlink() { return Err("Profil Claude tidak boleh berupa tautan.".into()); }
    }
    private_dir(&path.join("work"))?;
    Ok(path)
}

pub fn is_claude_code(profile: &ai::AiProviderProfile) -> bool {
    profile.provider_type == "anthropic" && profile.base_url.trim_end_matches('/') == BASE_URL
}
/// CLI aliases (`opus`, `sonnet[1m]`) or full model IDs; nothing that could read as a flag.
pub fn valid_model(model: &str) -> bool {
    let alias = model.strip_suffix("[1m]").unwrap_or(model);
    (!alias.is_empty() && alias.len() <= 40 && alias.bytes().all(|c| c.is_ascii_lowercase() || c.is_ascii_digit()) && !META_ALIASES.contains(&alias))
        || (model.starts_with("claude-") && model.len() <= 100
            && model.bytes().all(|c| c.is_ascii_alphanumeric() || b"-.[]".contains(&c)))
}
fn model_row(id: &str, name: &str) -> ProviderModel {
    ProviderModel {
        id: id.into(), display_name: name.into(),
        reasoning_efforts: EFFORTS.iter().map(|e| (*e).into()).collect(), default_reasoning_effort: None,
        tool_calling: "supported".into(),
    }
}
fn fallback_models() -> Vec<ProviderModel> { FALLBACK_MODELS.iter().map(|(id, name)| model_row(id, name)).collect() }

/// The installed official CLI. ForgeKit does not download or bundle it.
pub fn runtime() -> Result<PathBuf, String> {
    let mut paths = vec![];
    if let Some(user) = std::env::var_os("HOME") {
        let user = PathBuf::from(user);
        paths.push(user.join(".local/bin/claude"));
        paths.push(user.join(".claude/local/claude"));
    }
    paths.extend(["/opt/homebrew/bin/claude", "/usr/local/bin/claude"].map(PathBuf::from));
    if let Some(path) = std::env::var_os("PATH") { paths.extend(std::env::split_paths(&path).map(|p| p.join("claude"))); }
    paths.into_iter().find(|p| p.is_file()).and_then(|p| p.canonicalize().ok())
        .ok_or_else(|| "Claude Code belum terpasang. Instal Claude Code dari claude.com/claude-code, lalu buka kembali ForgeKit.".into())
}
/// A clean environment: no API key, base URL or proxy token from the user's shell can redirect
/// the profile, and the CLI only sees its own config directory.
pub(crate) fn command(exe: &Path, home: &Path) -> Command {
    let mut cmd = Command::new(exe);
    cmd.env_clear()
        .env("CLAUDE_CONFIG_DIR", home)
        .env("PATH", "/usr/bin:/bin:/usr/sbin:/sbin:/usr/local/bin:/opt/homebrew/bin")
        .env("DISABLE_AUTOUPDATER", "1")
        .current_dir(home.join("work"));
    for k in ["HOME", "USER", "LOGNAME", "TMPDIR", "LANG", "SSL_CERT_FILE", "SSL_CERT_DIR", "HTTPS_PROXY", "HTTP_PROXY", "NO_PROXY", "https_proxy", "http_proxy", "no_proxy"] {
        if let Some(v) = std::env::var_os(k) { cmd.env(k, v); }
    }
    cmd
}
fn reader(source: impl Read + Send + 'static, sink: Arc<Mutex<String>>) -> JoinHandle<()> { capped_reader(source, sink, 16_384) }
fn capped_reader(mut source: impl Read + Send + 'static, sink: Arc<Mutex<String>>, cap: usize) -> JoinHandle<()> {
    std::thread::spawn(move || {
        let mut buffer = [0u8; 4096];
        while let Ok(n) = source.read(&mut buffer) {
            if n == 0 { break; }
            if let Ok(mut text) = sink.lock() {
                text.push_str(&String::from_utf8_lossy(&buffer[..n]));
                if text.len() > cap {
                    let cut = text.len() - cap / 2;
                    let cut = (cut..text.len()).find(|i| text.is_char_boundary(*i)).unwrap_or(0);
                    text.drain(..cut);
                }
            }
        }
    })
}
fn reap(mut child: Child, readers: Vec<JoinHandle<()>>) -> Option<ExitStatus> {
    let pid = child.id();
    let _ = child.kill();
    let status = child.wait().ok();
    track(pid, false);
    for r in readers { let _ = r.join(); }
    status
}
/// Runs a short CLI command (status, logout, local slash commands) with a deadline; output is capped.
fn run(exe: &Path, home: &Path, args: &[&str]) -> Result<(ExitStatus, String), String> { run_input(exe, home, args, None, COMMAND_TIMEOUT) }
fn run_input(exe: &Path, home: &Path, args: &[&str], input: Option<&str>, timeout: Duration) -> Result<(ExitStatus, String), String> {
    if stopping() { return Err("ForgeKit sedang ditutup.".into()); }
    // UTC keeps reset times printed by `/usage` unambiguous.
    let mut child = command(exe, home).env("TZ", "UTC").args(args)
        .stdin(if input.is_some() { Stdio::piped() } else { Stdio::null() }).stdout(Stdio::piped()).stderr(Stdio::null())
        .spawn().map_err(|_| "Claude Code gagal dijalankan.")?;
    track(child.id(), true);
    let output = Arc::new(Mutex::new(String::new()));
    let out = capped_reader(child.stdout.take().ok_or("Output Claude Code tidak tersedia.")?, output.clone(), 512 * 1024);
    if let (Some(text), Some(mut stdin)) = (input, child.stdin.take()) {
        if stdin.write_all(text.as_bytes()).is_err() { reap(child, vec![out]); return Err("Input Claude Code tertutup.".into()); }
    }
    let deadline = Instant::now() + timeout;
    loop {
        match child.try_wait() {
            Ok(Some(_)) => break,
            Ok(None) if Instant::now() < deadline && !stopping() => std::thread::sleep(Duration::from_millis(50)),
            _ => { reap(child, vec![out]); return Err("Claude Code tidak merespons. Coba lagi.".into()); }
        }
    }
    let status = reap(child, vec![out]).ok_or("Status Claude Code tidak tersedia.")?;
    let text = output.lock().map_err(|_| "Output Claude Code tidak tersedia.")?.clone();
    Ok((status, text))
}
fn status(exe: &Path, home: &Path) -> Result<Value, String> {
    let (_, text) = run(exe, home, &["auth", "status", "--json"])?;
    serde_json::from_str(text.trim()).map_err(|_| "Status login Claude Code tidak dapat dibaca.".into())
}
/// A local Claude Code command (`/model`, `/usage`) in print mode. These read the account's own
/// catalog and plan usage without sending a model request.
fn slash(exe: &Path, home: &Path, command: &str, model: Option<&str>) -> Result<String, String> {
    let mut args = vec!["-p", command, "--output-format", "json", "--no-session-persistence", "--safe-mode"];
    if let Some(model) = model { args.extend(["--model", model]); }
    let (_, text) = run(exe, home, &args)?;
    let v: Value = serde_json::from_str(text.trim()).map_err(|_| "Respons Claude Code tidak dapat dibaca.")?;
    if v["is_error"] != false || v["subtype"] != "success" { return Err("Claude Code menolak perintah akun.".into()); }
    v["result"].as_str().map(str::to_owned).ok_or_else(|| "Respons Claude Code kosong.".into())
}
/// `Available: sonnet, opus, haiku, …, or a full model ID.` → model aliases for this account.
fn available_aliases(text: &str) -> Vec<String> {
    let Some(list) = text.split("Available:").nth(1) else { return vec![] };
    let list = list.split(", or ").next().unwrap_or(list);
    let mut seen = HashSet::new();
    list.split(',').map(|a| a.trim().trim_end_matches('.').to_owned())
        .filter(|a| valid_model(a) && !a.starts_with("claude-") && seen.insert(a.clone())).take(16).collect()
}
/// Several local commands in one Claude Code session (one start-up instead of one per command);
/// returns each command's reply in order.
fn session_commands(exe: &Path, home: &Path, commands: &[String]) -> Result<Vec<String>, String> {
    let input: String = commands.iter().map(|c| format!("{}\n", json!({"type":"user","message":{"role":"user","content":c}}))).collect();
    let (_, text) = run_input(exe, home, &["-p", "--input-format", "stream-json", "--output-format", "stream-json", "--verbose",
        "--no-session-persistence", "--safe-mode"], Some(&input), Duration::from_secs(90))?;
    let replies: Vec<String> = text.lines().filter_map(|l| serde_json::from_str::<Value>(l).ok())
        .filter(|v| v["type"] == "result").map(|v| v["result"].as_str().unwrap_or("").to_owned()).collect();
    if replies.len() != commands.len() { return Err("Claude Code tidak menjawab semua pemeriksaan model.".into()); }
    Ok(replies)
}
/// `Current model: `Opus 5.5 (default)`` or `Set model to `Opus 4.8` for this session only`
/// → `Claude Opus 4.8`; `Model 'x' not found` → None.
fn current_model_name(text: &str, alias: &str) -> Option<String> {
    let after = text.split("Current model:").nth(1).or_else(|| text.split("Set model to").nth(1))?;
    let name = after.split('`').nth(1)?.trim();
    let name = name.strip_suffix("(default)").unwrap_or(name).trim();
    if name.is_empty() || name.len() > 80 || name.chars().any(char::is_control) { return None; }
    let name = if name.to_ascii_lowercase().starts_with("claude") { name.to_owned() } else { format!("Claude {name}") };
    Some(if alias.ends_with("[1m]") { format!("{name} · konteks 1M") } else { name })
}
/// `claude-opus-4-8` → ("opus", "4.8"); `claude-3-7-sonnet-latest` → ("sonnet", "3.7").
fn pinned_family_version(id: &str) -> Option<(String, String)> {
    let parts: Vec<&str> = id.strip_prefix("claude-")?.trim_end_matches("-latest").split('-').collect();
    let (family, numbers): (&str, Vec<&str>) = match parts.iter().position(|p| p.chars().all(|c| c.is_ascii_alphabetic())) {
        Some(0) => (parts[0], parts[1..].to_vec()),
        Some(i) => (parts[i], parts[..i].to_vec()),
        None => return None,
    };
    let numbers: Vec<&str> = numbers.into_iter().filter(|n| n.len() <= 2 && n.chars().all(|c| c.is_ascii_digit())).collect();
    let version = match numbers.as_slice() { [major] | [major, "0"] => major.to_string(), [major, minor] => format!("{major}.{minor}"), _ => return None };
    Some((family.into(), version))
}
/// Orders aliases the way people pick them: newest Opus/Sonnet/Haiku/Fable first, 1M variants after.
fn alias_rank(alias: &str) -> (bool, usize) {
    let base = alias.strip_suffix("[1m]").unwrap_or(alias);
    (alias.ends_with("[1m]"), ["opus", "sonnet", "haiku", "fable"].iter().position(|f| *f == base).unwrap_or(9))
}
/// Every model the account can use, checked in one Claude Code session, cached in the profile.
fn probe_models(exe: &Path, home: &Path) -> Result<Vec<ProviderModel>, String> {
    let mut aliases = available_aliases(&slash(exe, home, "/model", None)?);
    if aliases.is_empty() { return Err("Claude Code belum memberikan daftar model akun.".into()); }
    aliases.sort_by_key(|a| alias_rank(a));
    let ids: Vec<String> = aliases.iter().cloned().chain(PINNED_MODELS.iter().map(|m| (*m).to_owned())).collect();
    let replies = session_commands(exe, home, &ids.iter().map(|id| format!("/model {id}")).collect::<Vec<_>>())?;
    let mut rows: Vec<ProviderModel> = vec![];
    for (id, reply) in ids.iter().zip(replies) {
        let Some(name) = current_model_name(&reply, id) else { continue };
        if id.starts_with("claude-") {
            // Claude Code may silently serve a retired ID with a newer model; list only true matches.
            let Some((family, version)) = pinned_family_version(id) else { continue };
            let shown = name.to_ascii_lowercase();
            if !shown.contains(&family) || !shown.split(|c: char| c.is_whitespace()).any(|w| w == version || w == format!("{version}.0")) { continue; }
        }
        if rows.iter().any(|r| r.display_name == name) { continue; }
        rows.push(model_row(id, &name));
    }
    if rows.is_empty() { return Err("Nama model akun Claude tidak dapat dibaca.".into()); }
    let stamp = SystemTime::now().duration_since(UNIX_EPOCH).unwrap_or_default().as_secs();
    let cache = json!({"checkedAt": stamp, "models": rows.iter().map(|m| json!({"id": m.id, "displayName": m.display_name})).collect::<Vec<_>>()});
    let _ = fs::write(home.join(MODEL_CACHE), cache.to_string());
    Ok(rows)
}
fn cached_models(home: &Path, max_age: Option<u64>) -> Option<Vec<ProviderModel>> {
    let file = home.join(MODEL_CACHE);
    fs::symlink_metadata(&file).ok().filter(|m| m.is_file() && m.len() <= 65_536)?;
    let v: Value = serde_json::from_slice(&fs::read(file).ok()?).ok()?;
    let now = SystemTime::now().duration_since(UNIX_EPOCH).unwrap_or_default().as_secs();
    if max_age.is_some_and(|age| now.saturating_sub(v["checkedAt"].as_u64().unwrap_or(0)) > age) { return None; }
    let rows: Vec<_> = v["models"].as_array()?.iter().filter_map(|m| {
        let id = m["id"].as_str().filter(|id| valid_model(id))?;
        let name = clean(&m["displayName"], 120)?;
        Some(model_row(id, &name))
    }).collect();
    (!rows.is_empty()).then_some(rows)
}
/// The account's models: cached for a day, re-read on refresh, last good list if Claude Code is unavailable.
/// One read runs per account at a time; callers that waited get the list the first one just read.
pub fn models(key_ref: &str, refresh: bool) -> Result<Vec<ProviderModel>, String> {
    let home = account_home(key_ref)?;
    if !refresh { if let Some(rows) = cached_models(&home, Some(MODEL_CACHE_SECONDS)) { return Ok(rows); } }
    let lock = account_lock(&profile_id(key_ref)?)?;
    let _reading = lock.lock().map_err(|_| "Akun Claude sedang sibuk.")?;
    if let Some(rows) = cached_models(&home, Some(if refresh { 60 } else { MODEL_CACHE_SECONDS })) { return Ok(rows); }
    match runtime().and_then(|exe| probe_models(&exe, &home)) {
        Ok(rows) => Ok(rows),
        Err(error) => cached_models(&home, None).ok_or(error).or_else(|_| Ok(fallback_models())),
    }
}

#[derive(Debug, Clone, PartialEq)]
pub struct PlanWindow { pub id: String, pub label: String, pub scope: String, pub used_percent: f64, pub resets_at: Option<u64>, pub window_minutes: u64 }
/// `Nov 6 at 3:30pm` (UTC, printed with TZ=UTC) → Unix seconds, choosing the year closest after `now`.
fn reset_time(text: &str, now: u64) -> Option<u64> {
    use chrono::{Datelike, NaiveDate};
    let mut parts = text.split_whitespace();
    let name = parts.next()?.to_ascii_lowercase();
    let month = ["jan","feb","mar","apr","may","jun","jul","aug","sep","oct","nov","dec"].iter()
        .position(|m| name.starts_with(m))? as u32 + 1;
    let day: u32 = parts.next()?.trim_end_matches(',').parse().ok()?;
    if parts.next()? != "at" { return None; }
    let clock = parts.next()?.to_ascii_lowercase();
    let (clock, pm) = if let Some(c) = clock.strip_suffix("pm") { (c.to_owned(), true) } else { (clock.strip_suffix("am")?.to_owned(), false) };
    let (hour, minute) = match clock.split_once(':') { Some((h, m)) => (h.parse::<u32>().ok()?, m.parse::<u32>().ok()?), None => (clock.parse::<u32>().ok()?, 0) };
    if !(1..=12).contains(&hour) { return None; }
    let hour = hour % 12 + if pm { 12 } else { 0 };
    let year = chrono::DateTime::from_timestamp(now as i64, 0)?.year();
    [year - 1, year, year + 1].into_iter().filter_map(|y| NaiveDate::from_ymd_opt(y, month, day)?.and_hms_opt(hour, minute, 0))
        .map(|t| t.and_utc().timestamp()).filter(|t| *t > 0).map(|t| t as u64)
        .filter(|t| *t + 86_400 >= now).min_by_key(|t| t.abs_diff(now))
}
fn plan_windows(text: &str, now: u64) -> Vec<PlanWindow> {
    text.lines().filter_map(|line| {
        let line = line.trim();
        let (id, label, scope, minutes, rest) = if let Some(rest) = line.strip_prefix("Current session:") {
            ("claude:session".to_owned(), "5 jam".to_owned(), "claude".to_owned(), 300, rest)
        } else {
            let rest = line.strip_prefix("Current week (")?;
            let (name, rest) = rest.split_once("):")?;
            if name.eq_ignore_ascii_case("all models") { ("claude:week".into(), "Mingguan".into(), "claude".into(), 10_080, rest) } else {
                let scope = name.to_ascii_lowercase();
                if scope.is_empty() || scope.len() > 40 || !scope.bytes().all(|c| c.is_ascii_alphanumeric() || b" -.".contains(&c)) { return None; }
                (format!("claude:week:{scope}"), format!("Mingguan · {name}"), scope, 10_080, rest)
            }
        };
        let used: f64 = rest.trim().split('%').next()?.trim().parse().ok().filter(|v: &f64| v.is_finite() && *v >= 0.)?;
        let resets_at = rest.split("resets").nth(1).and_then(|r| reset_time(r.split('(').next().unwrap_or(r).trim(), now));
        Some(PlanWindow { id, label, scope, used_percent: used.min(100.), resets_at, window_minutes: minutes })
    }).take(12).collect()
}
/// Plan usage (5-hour session, weekly, per-model weekly) and plan name, read from Claude Code's
/// own `/usage`; no model request is sent and ForgeKit never sees the credential.
pub fn usage(key_ref: &str) -> Result<(Vec<PlanWindow>, Option<String>), String> {
    let home = account_home(key_ref)?;
    let exe = runtime()?;
    // Never run beside a model-list read of the same account: both share Claude Code's config lock.
    let lock = account_lock(&profile_id(key_ref)?)?;
    let _reading = lock.lock().map_err(|_| "Akun Claude sedang sibuk.")?;
    let now = SystemTime::now().duration_since(UNIX_EPOCH).unwrap_or_default().as_secs();
    let windows = plan_windows(&slash(&exe, &home, "/usage", None)?, now);
    if windows.is_empty() { return Err("Claude Code belum memberikan usage paket untuk akun ini.".into()); }
    let plan = status(&exe, &home).ok().and_then(|s| clean(&s["subscriptionType"], 40));
    Ok((windows, plan))
}

fn clean(value: &Value, limit: usize) -> Option<String> {
    value.as_str().filter(|s| !s.is_empty() && s.len() <= limit && !s.chars().any(char::is_control)).map(str::to_owned)
}

/// The fallback URL Claude Code prints for pasting a code by hand (`code=true`), if any.
fn manual_link(output: &str) -> Option<String> {
    output.split_whitespace().filter(|w| w.starts_with("https://")).find_map(|w| {
        let url = url::Url::parse(w).ok()?;
        (url.scheme() == "https" && matches!(url.host_str(), Some("claude.com" | "claude.ai"))
            && url.port().is_none() && url.username().is_empty()
            && url.query_pairs().any(|(k, v)| k == "code" && v == "true")
            && url.query_pairs().any(|(k, _)| k == "redirect_uri")).then(|| url.to_string())
    })
}
fn denied(output: &str) -> bool {
    let lower = output.to_ascii_lowercase();
    ["access_denied", "authorization denied", "authorization was denied", "sign-in denied", "login denied"]
        .iter().any(|p| lower.contains(p))
}
fn login(exe: &Path, home: &Path, id: &str, cancelled: &AtomicBool) -> Result<(), String> {
    let mut child = command(exe, home).args(["auth", "login", "--claudeai"])
        .stdin(Stdio::piped()).stdout(Stdio::piped()).stderr(Stdio::piped())
        .spawn().map_err(|_| "Login Claude Code gagal dimulai.")?;
    track(child.id(), true);
    let output = Arc::new(Mutex::new(String::new()));
    let readers = vec![
        reader(child.stdout.take().ok_or("Output login Claude tidak tersedia.")?, output.clone()),
        reader(child.stderr.take().ok_or("Output login Claude tidak tersedia.")?, output.clone()),
    ];
    let mut input: Option<ChildStdin> = child.stdin.take();
    LOGINS.lock().map_err(|_| "Layanan login sibuk.")?.insert(id.into(), LoginControl::default());
    let deadline = Instant::now() + LOGIN_TIMEOUT;
    let mut code_sent = false;
    let outcome = loop {
        if cancelled.load(Ordering::SeqCst) || stopping() { break Err("Login Claude dibatalkan."); }
        match child.try_wait() {
            Ok(Some(status)) => break Ok(status),
            Ok(None) => {}
            Err(_) => break Err("Status login Claude tidak tersedia."),
        }
        let text = output.lock().map(|t| t.clone()).unwrap_or_default();
        if denied(&text) { break Err("Login Claude ditolak. Mulai login lagi."); }
        let code = LOGINS.lock().ok().and_then(|mut logins| logins.get_mut(id).and_then(|c| {
            if c.link.is_none() { c.link = manual_link(&text); }
            c.code.take()
        }));
        if let (Some(code), Some(stdin)) = (code, input.as_mut()) {
            // The CLI reads the pasted code from stdin; it is never logged or stored by ForgeKit.
            if writeln!(stdin, "{code}").and_then(|_| stdin.flush()).is_err() { break Err("Kode login tidak dapat dikirim ke Claude Code."); }
            code_sent = true;
        }
        if Instant::now() >= deadline { break Err("Login Claude terlalu lama. Mulai login lagi."); }
        std::thread::sleep(Duration::from_millis(150));
    };
    if let Ok(mut logins) = LOGINS.lock() { logins.remove(id); }
    drop(input.take());
    let status = reap(child, readers);
    match outcome {
        Ok(_) if status.is_some_and(|s| s.success()) => Ok(()),
        Ok(_) if code_sent => Err("Claude tidak menerima kode tersebut. Mulai login lagi.".into()),
        Ok(_) => Err("Login Claude Code tidak selesai. Coba lagi.".into()),
        Err(e) => Err(e.into()),
    }
}

/// Fallback for a browser that cannot reach the CLI's local callback: the user pastes the code.
pub fn submit_code(session_id: &str, code: &str) -> Result<(), String> {
    let code = code.trim();
    if code.is_empty() || code.len() > 1024 || code.chars().any(|c| c.is_whitespace() || c.is_control()) {
        return Err("Kode login Claude tidak sah.".into());
    }
    let mut logins = LOGINS.lock().map_err(|_| "Layanan login sibuk.")?;
    let control = logins.get_mut(session_id).ok_or("Tidak ada login Claude yang menunggu kode.")?;
    control.code = Some(code.into());
    Ok(())
}
/// Opens the CLI's manual sign-in page (which shows a code to paste back into ForgeKit).
pub fn open_manual_link(session_id: &str) -> Result<(), String> {
    let link = LOGINS.lock().map_err(|_| "Layanan login sibuk.")?
        .get(session_id).and_then(|c| c.link.clone())
        .ok_or("Tautan login manual belum tersedia. Tunggu beberapa detik lalu coba lagi.")?;
    if !Command::new("/usr/bin/open").arg(&link).status().is_ok_and(|s| s.success()) {
        return Err("Browser login tidak dapat dibuka.".into());
    }
    Ok(())
}

pub fn sign_in(login_id: &str) -> Result<ai::ConnectionProfile, String> {
    browser::with_login(login_id, |cancelled| {
        if !valid_id(login_id) { return Err("ID login Claude tidak sah.".into()); }
        let exe = runtime()?;
        let path = home(login_id)?;
        private_dir(path.parent().ok_or("Profil Claude tidak tersedia.")?)?;
        fs::create_dir(&path).map_err(|_| "Profil login sudah ada; mulai login baru.")?;
        let key_ref = format!("claude-{login_id}");
        let result = (|| {
            private_dir(&path)?;
            private_dir(&path.join("work"))?;
            login(&exe, &path, login_id, cancelled)?;
            let state = status(&exe, &path)?;
            if state["loggedIn"] != true || state["authMethod"] != "claude.ai" {
                return Err("Claude Code belum memverifikasi login langganan Claude.".into());
            }
            let email = clean(&state["email"], 200);
            let subject = clean(&state["orgId"], 200).or_else(|| email.clone()).ok_or("Identitas akun Claude tidak tersedia.")?;
            let label = format!("{} · Claude Code", email.as_deref().unwrap_or("Claude").chars().take(80).collect::<String>());
            // Read the account's real catalog now, so models are listed right after connecting.
            let catalog = probe_models(&exe, &path).unwrap_or_else(|_| fallback_models());
            let model = catalog.iter().find(|m| m.id == "opus").or(catalog.first()).map(|m| m.id.clone()).unwrap_or_else(|| "opus".into());
            let stamp = SystemTime::now().duration_since(UNIX_EPOCH).unwrap_or_default().as_secs().to_string();
            serde_json::from_value(json!({
                "id":login_id,"providerId":"claude","connectionMode":"direct","credentialOwner":"forgekit","authMethod":"claude_code",
                "label":label,"identity":{"issuer":"https://claude.ai","subject":subject,"email":email},
                "registrationRef":"claude_code_managed","credentialRef":key_ref,"accessState":"pending","enabled":true,
                "fallbackEligible":"unknown","priority":0,"quotaBucketRefs":[format!("claude:{subject}")],
                "baseUrl":BASE_URL,"model":model,"isDefault":false,"createdAt":stamp,"updatedAt":stamp
            })).map_err(|_| "Profil Claude gagal dibuat.".into())
        })();
        if result.is_err() {
            let _ = run(&exe, &path, &["auth", "logout"]);
            let _ = fs::remove_dir_all(&path);
        }
        result
    })
}
pub fn disconnect(key_ref: &str) -> Result<(), String> {
    let id = profile_id(key_ref)?;
    let lock = account_lock(&id)?; let _guard = lock.lock().map_err(|_| "Akun Claude sedang sibuk.")?;
    let path = home(&id)?;
    if path.is_dir() && !fs::symlink_metadata(&path).map_err(|_| "Profil Claude tidak tersedia.")?.file_type().is_symlink() {
        // Logout first: it removes the profile's credential from the CLI's own store.
        if let Ok(exe) = runtime() { let _ = run(&exe, &path, &["auth", "logout"]); }
        fs::remove_dir_all(&path).map_err(|_| "Profil Claude belum dapat dilepas.")?;
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test] fn references_and_paths_stay_inside_forgekit_profiles() {
        assert_eq!(profile_id("claude-0609bb16-fde2-4c50-a195-cf002ed8309e").unwrap(), "0609bb16-fde2-4c50-a195-cf002ed8309e");
        for value in ["claude-", "claude-../x", "codex-abc", "claude-/tmp/a", "claude-a\nb", "provider-x"] { assert!(profile_id(value).is_err()); }
        for id in ["", "../.claude", "/tmp/x", "a/b"] { assert!(home(id).is_err()); }
        assert!(home("own").unwrap().to_string_lossy().contains("dev.forgekit.studio/claude-accounts/own"));
        assert!(account_home("claude-missing-profile-for-test").is_err());
    }
    #[test] fn manual_link_only_accepts_official_code_pages() {
        let out = "Opening browser to sign in…\nIf the browser didn't open, visit: https://claude.com/cai/oauth/authorize?code=true&client_id=x&redirect_uri=https%3A%2F%2Fplatform.claude.com%2Foauth%2Fcode%2Fcallback&state=s\nPaste code here if prompted >";
        assert!(manual_link(out).unwrap().starts_with("https://claude.com/cai/oauth/authorize"));
        for bad in ["https://claude.com.evil.test/a?code=true&redirect_uri=x", "http://claude.com/a?code=true&redirect_uri=x",
            "https://claude.com/a?redirect_uri=x", "https://user@claude.ai/a?code=true&redirect_uri=x"] { assert!(manual_link(bad).is_none()); }
        assert!(denied("error=access_denied")); assert!(!denied("Opening browser"));
    }
    #[test] fn pasted_codes_need_a_waiting_login_and_are_validated() {
        assert!(submit_code("no-such-login", "abc#def").is_err());
        LOGINS.lock().unwrap().insert("waiting-login".into(), LoginControl::default());
        assert!(submit_code("waiting-login", "two words").is_err());
        assert!(submit_code("waiting-login", " abc#def ").is_ok());
        assert_eq!(LOGINS.lock().unwrap().remove("waiting-login").unwrap().code.as_deref(), Some("abc#def"));
    }
    #[test] fn saved_profiles_must_pair_the_login_method_with_the_claude_code_profile() {
        let mut p: ai::ConnectionProfile = serde_json::from_value(json!({
            "id":"fixture","providerId":"claude","connectionMode":"direct","credentialOwner":"forgekit",
            "authMethod":"claude_code","label":"Fixture · Claude Code","credentialRef":"claude-fixture",
            "accessState":"pending","enabled":true,"fallbackEligible":"unknown","priority":0,
            "quotaBucketRefs":["claude:fixture"],"baseUrl":BASE_URL,"model":"opus",
            "isDefault":false,"createdAt":"1","updatedAt":"1"
        })).unwrap();
        assert!(ai::validate_connection_profile(&p).is_ok());
        let legacy = crate::connections::legacy(&p, None).unwrap();
        assert!(is_claude_code(&legacy) && legacy.key_reference == "claude-fixture");
        p.auth_method = "api_key".into();
        assert!(ai::validate_connection_profile(&p).is_err());
        p.auth_method = "claude_code".into(); p.base_url = "https://api.anthropic.com/v1".into();
        assert!(ai::validate_connection_profile(&p).is_err());
        p.base_url = BASE_URL.into(); p.provider_id = "openai".into();
        assert!(ai::validate_connection_profile(&p).is_err());
    }
    #[test] fn models_are_cli_aliases_and_custom_ids_are_bounded() {
        assert!(fallback_models().iter().all(|m| valid_model(&m.id) && m.tool_calling == "supported"));
        assert!(valid_model("claude-sonnet-5-5") && valid_model("claude-opus-5-5[1m]") && valid_model("sonnet[1m]") && valid_model("fable"));
        for bad in ["", "gpt-5", "claude-a b", "claude-x;rm", "--dangerously-skip-permissions", "best", "default", "opusplan", "Opus"] { assert!(!valid_model(bad)); }
    }
    #[test] fn account_catalog_is_parsed_from_claude_code() {
        let text = "Current model: `Opus 5.5 (default)`\nUsage: /model <name>. Available: sonnet, opus, haiku, fable, best, sonnet[1m], opus[1m], opusplan, default, or a full model ID.";
        assert_eq!(available_aliases(text), ["sonnet", "opus", "haiku", "fable", "sonnet[1m]", "opus[1m]"]);
        assert_eq!(current_model_name(text, "opus").as_deref(), Some("Claude Opus 5.5"));
        assert_eq!(current_model_name("Current model: `Sonnet 5.5`", "sonnet[1m]").as_deref(), Some("Claude Sonnet 5.5 · konteks 1M"));
        assert!(available_aliases("no list").is_empty() && current_model_name("Current model: ``", "opus").is_none());
        assert_eq!(current_model_name("Set model to `Opus 4.8` for this session only", "claude-opus-4-8").as_deref(), Some("Claude Opus 4.8"));
        assert!(current_model_name("Model 'claude-opus-4-1' not found", "claude-opus-4-1").is_none());
        assert_eq!(pinned_family_version("claude-opus-4-8"), Some(("opus".into(), "4.8".into())));
        assert_eq!(pinned_family_version("claude-sonnet-4-0"), Some(("sonnet".into(), "4".into())));
        assert_eq!(pinned_family_version("claude-opus-5"), Some(("opus".into(), "5".into())));
        assert_eq!(pinned_family_version("claude-3-7-sonnet-latest"), Some(("sonnet".into(), "3.7".into())));
        let mut aliases = vec!["sonnet[1m]", "sonnet", "fable", "opus", "haiku", "opus[1m]"];
        aliases.sort_by_key(|a| alias_rank(a));
        assert_eq!(aliases, ["opus", "sonnet", "haiku", "fable", "opus[1m]", "sonnet[1m]"]);
    }
    #[test] fn plan_usage_is_parsed_from_claude_code() {
        let now = 1_793_970_000; // 6 Nov 2026, 13:40 UTC
        let text = "You are currently using your subscription to power your Claude Code usage\n\nCurrent session: 12% used · resets Nov 6 at 3:30pm (UTC)\nCurrent week (all models): 9.5% used · resets Nov 11 at 9am (UTC)\nCurrent week (Fable): 0% used · resets Nov 11 at 9am (UTC)\n\nLast 24h · 1239 requests";
        let w = plan_windows(text, now);
        assert_eq!(w.len(), 3);
        assert_eq!((w[0].id.as_str(), w[0].label.as_str(), w[0].scope.as_str(), w[0].used_percent, w[0].window_minutes), ("claude:session", "5 jam", "claude", 12., 300));
        assert_eq!(w[0].resets_at, Some(1_793_979_000));
        assert_eq!((w[1].label.as_str(), w[1].used_percent, w[1].resets_at), ("Mingguan", 9.5, Some(1_794_387_600)));
        assert_eq!((w[2].id.as_str(), w[2].label.as_str(), w[2].scope.as_str()), ("claude:week:fable", "Mingguan · Fable", "fable"));
        assert_eq!(reset_time("Jan 2 at 12am", 1_798_700_000), Some(1_798_848_000)); // year rollover: 2 Jan 2027 00:00 UTC
        assert!(plan_windows("Total cost: $0.0000", now).is_empty());
    }
    #[cfg(unix)]
    #[test] fn commands_run_with_a_clean_isolated_environment() {
        use std::os::unix::fs::PermissionsExt;
        let root = std::env::temp_dir().join(crate::storage::next_id("forgekit-claude-test"));
        private_dir(&root.join("work")).unwrap();
        let exe = root.join("fake-claude");
        fs::write(&exe, "#!/bin/sh\nprintf '{\"dir\":\"%s\",\"key\":\"%s\",\"cwd\":\"%s\",\"args\":\"%s\"}' \"$CLAUDE_CONFIG_DIR\" \"$ANTHROPIC_API_KEY\" \"$(pwd -P)\" \"$*\"\n").unwrap();
        fs::set_permissions(&exe, fs::Permissions::from_mode(0o700)).unwrap();
        let v = status(&exe, &root).unwrap();
        assert_eq!(v["dir"], root.to_string_lossy().as_ref());
        assert_eq!(v["key"], "");
        assert_eq!(v["cwd"], root.join("work").canonicalize().unwrap().to_string_lossy().as_ref());
        assert_eq!(v["args"], "auth status --json");
        fs::remove_dir_all(root).unwrap();
    }
}
