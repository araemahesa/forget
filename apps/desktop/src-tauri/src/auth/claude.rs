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
/// Aliases resolved by the installed CLI to the newest model of each family.
const MODELS: &[(&str, &str)] = &[
    ("opus", "Claude Opus · terbaru (Claude Code)"),
    ("sonnet", "Claude Sonnet · terbaru (Claude Code)"),
    ("haiku", "Claude Haiku · terbaru (Claude Code)"),
];
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
pub fn valid_model(model: &str) -> bool {
    MODELS.iter().any(|(id, _)| *id == model)
        || (model.starts_with("claude-") && model.len() <= 100
            && model.bytes().all(|c| c.is_ascii_alphanumeric() || b"-.[]".contains(&c)))
}
pub fn models() -> Vec<ProviderModel> {
    MODELS.iter().map(|(id, name)| ProviderModel {
        id: (*id).into(), display_name: (*name).into(),
        reasoning_efforts: EFFORTS.iter().map(|e| (*e).into()).collect(), default_reasoning_effort: None,
        tool_calling: "supported".into(),
    }).collect()
}

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
fn reader(mut source: impl Read + Send + 'static, sink: Arc<Mutex<String>>) -> JoinHandle<()> {
    std::thread::spawn(move || {
        let mut buffer = [0u8; 4096];
        while let Ok(n) = source.read(&mut buffer) {
            if n == 0 { break; }
            if let Ok(mut text) = sink.lock() {
                text.push_str(&String::from_utf8_lossy(&buffer[..n]));
                if text.len() > 16_384 {
                    let cut = text.len() - 8192;
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
/// Runs a short CLI command (status, logout) with a deadline; output is capped.
fn run(exe: &Path, home: &Path, args: &[&str]) -> Result<(ExitStatus, String), String> {
    if stopping() { return Err("ForgeKit sedang ditutup.".into()); }
    let mut child = command(exe, home).args(args).stdin(Stdio::null()).stdout(Stdio::piped()).stderr(Stdio::null())
        .spawn().map_err(|_| "Claude Code gagal dijalankan.")?;
    track(child.id(), true);
    let output = Arc::new(Mutex::new(String::new()));
    let out = reader(child.stdout.take().ok_or("Output Claude Code tidak tersedia.")?, output.clone());
    let deadline = Instant::now() + COMMAND_TIMEOUT;
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
            let stamp = SystemTime::now().duration_since(UNIX_EPOCH).unwrap_or_default().as_secs().to_string();
            serde_json::from_value(json!({
                "id":login_id,"providerId":"claude","connectionMode":"direct","credentialOwner":"forgekit","authMethod":"claude_code",
                "label":label,"identity":{"issuer":"https://claude.ai","subject":subject,"email":email},
                "registrationRef":"claude_code_managed","credentialRef":key_ref,"accessState":"pending","enabled":true,
                "fallbackEligible":"unknown","priority":0,"quotaBucketRefs":[format!("claude:{subject}")],
                "baseUrl":BASE_URL,"model":MODELS[0].0,"isDefault":false,"createdAt":stamp,"updatedAt":stamp
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
/// Plan name for the usage panel, read from the CLI (never from its credential store).
pub fn plan(key_ref: &str) -> Option<String> {
    let path = account_home(key_ref).ok()?;
    clean(&status(&runtime().ok()?, &path).ok()?["subscriptionType"], 40)
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
        assert!(models().iter().all(|m| valid_model(&m.id) && m.tool_calling == "supported"));
        assert!(valid_model("claude-sonnet-5-5") && valid_model("claude-opus-5-5[1m]"));
        for bad in ["", "gpt-5", "claude-a b", "claude-x;rm", "--dangerously-skip-permissions"] { assert!(!valid_model(bad)); }
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
