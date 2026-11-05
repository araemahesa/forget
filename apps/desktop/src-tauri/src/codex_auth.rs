//! Managed Codex login in ForgeKit-owned profiles. Never opens another app's auth store.
use crate::{ai, browser_auth, model_catalog::ProviderModel};
use serde_json::{json, Value};
use std::{
    collections::{HashMap, HashSet, VecDeque}, fs, io::{BufRead, BufReader, Read, Write},
    path::{Path, PathBuf}, process::{Child, ChildStdin, Command, Stdio},
    sync::{atomic::{AtomicBool, Ordering}, mpsc, Arc, LazyLock, Mutex},
    thread::JoinHandle, time::{Duration, Instant, SystemTime, UNIX_EPOCH},
};

pub const BASE_URL: &str = "https://chatgpt.com/backend-api/codex";
pub(crate) fn validate_login_method(method: Option<&str>) -> Result<(), String> {
    if method.is_none() || method == Some("codex") { return Ok(()); }
    Err("Metode login ChatGPT lama sudah dihapus. Gunakan login Codex.".into())
}
static LOCKS: LazyLock<Mutex<HashMap<String, Arc<Mutex<()>>>>> = LazyLock::new(|| Mutex::new(HashMap::new()));
static CHILDREN: LazyLock<Mutex<HashSet<u32>>> = LazyLock::new(|| Mutex::new(HashSet::new()));
static STOPPING: AtomicBool = AtomicBool::new(false);
pub fn shutdown() {
    STOPPING.store(true, Ordering::SeqCst);
    if let Ok(children) = CHILDREN.lock() {
        for pid in children.iter() { let _ = Command::new("/bin/kill").args(["-TERM", &pid.to_string()]).stderr(Stdio::null()).status(); }
    }
}
fn account_lock(id: &str) -> Result<Arc<Mutex<()>>, String> {
    Ok(LOCKS.lock().map_err(|_| "Profil Codex sedang sibuk.")?.entry(id.into()).or_default().clone())
}
fn valid_id(id: &str) -> bool {
    !id.is_empty() && id.len() <= 100 && id.bytes().all(|c| c.is_ascii_alphanumeric() || c == b'-')
}
fn home(id: &str) -> Result<PathBuf, String> {
    if !valid_id(id) { return Err("ID profil Codex tidak sah.".into()); }
    let user = std::env::var_os("HOME").ok_or("Direktori pengguna tidak tersedia.")?;
    #[cfg(target_os = "macos")]
    let root = PathBuf::from(user).join("Library/Application Support/dev.forgekit.studio/codex-accounts");
    #[cfg(not(target_os = "macos"))]
    let root = PathBuf::from(user).join(".local/share/dev.forgekit.studio/codex-accounts");
    Ok(root.join(id))
}
fn private_dir(path: &Path) -> Result<(), String> {
    fs::create_dir_all(path).map_err(|_| "Profil Codex tidak dapat dibuat.")?;
    if fs::symlink_metadata(path).map_err(|_| "Profil Codex tidak tersedia.")?.file_type().is_symlink() {
        return Err("Profil Codex tidak boleh berupa tautan.".into());
    }
    #[cfg(unix)] {
        use std::os::unix::fs::PermissionsExt;
        fs::set_permissions(path, fs::Permissions::from_mode(0o700)).map_err(|_| "Izin profil Codex gagal diatur.")?;
    }
    Ok(())
}
pub fn runtime() -> Result<PathBuf, String> {
    let mut paths = vec![PathBuf::from("/Applications/Codex.app/Contents/Resources/codex")];
    if let Some(user) = std::env::var_os("HOME") { paths.push(PathBuf::from(user).join(".local/bin/codex")); }
    if let Some(path) = std::env::var_os("PATH") { paths.extend(std::env::split_paths(&path).map(|p| p.join("codex"))); }
    for app in ["ChatGPT.app", "ChatGPT 2.app", "ChatGPT 3.app"] {
        paths.push(PathBuf::from("/Applications").join(app).join("Contents/Resources/codex-cli/CodexCLI.app/Contents/MacOS/codex"));
    }
    paths.into_iter().find(|p| p.is_file()).and_then(|p| p.canonicalize().ok())
        .ok_or_else(|| "Runtime Codex belum tersedia. Instal Codex CLI lalu buka kembali ForgeKit. Login aplikasi lain tidak akan diimpor.".into())
}

struct Session {
    child: Child, input: ChildStdin, rx: Option<mpsc::Receiver<Result<Value, String>>>,
    reader: Option<JoinHandle<()>>, notifications: VecDeque<Value>, next_id: u64,
}
impl Session {
    fn start(path: &Path) -> Result<Self, String> { Self::spawn(&runtime()?, path) }
    fn spawn(exe: &Path, path: &Path) -> Result<Self, String> {
        if STOPPING.load(Ordering::SeqCst) { return Err("ForgeKit sedang ditutup.".into()); }
        if !path.is_dir() || fs::symlink_metadata(path).map_err(|_| "Profil Codex tidak tersedia.")?.file_type().is_symlink() {
            return Err("Profil Codex tidak tersedia. Login melalui ForgeKit terlebih dahulu.".into());
        }
        let mut cmd = Command::new(exe);
        cmd.args(["app-server", "-c", "cli_auth_credentials_store=\"file\"", "-c", "analytics.enabled=false"])
            .env_clear().env("CODEX_HOME", path).env("PATH", "/usr/bin:/bin:/usr/local/bin:/opt/homebrew/bin")
            .current_dir(path).stdin(Stdio::piped()).stdout(Stdio::piped()).stderr(Stdio::null());
        for k in ["HOME", "TMPDIR", "LANG", "SSL_CERT_FILE", "SSL_CERT_DIR"] {
            if let Some(v) = std::env::var_os(k) { cmd.env(k, v); }
        }
        let mut child = cmd.spawn().map_err(|_| "Runtime Codex gagal dimulai.")?;
        if let Ok(mut children) = CHILDREN.lock() {
            if STOPPING.load(Ordering::SeqCst) { let _ = child.kill(); let _ = child.wait(); return Err("ForgeKit sedang ditutup.".into()); }
            children.insert(child.id());
        }
        let input = child.stdin.take().ok_or("Input Codex tidak tersedia.")?;
        let output = child.stdout.take().ok_or("Output Codex tidak tersedia.")?;
        let (tx, rx) = mpsc::sync_channel(16);
        let reader = std::thread::spawn(move || {
            let mut reader = BufReader::new(output);
            let mut total = 0;
            loop {
                let mut line = Vec::new();
                match reader.by_ref().take(1_048_577).read_until(b'\n', &mut line) {
                    Ok(0) | Err(_) => break,
                    Ok(n) => total += n,
                }
                if line.len() > 1_048_576 || total > 8_388_608 {
                    let _ = tx.send(Err("Respons Codex melampaui batas ukuran.".into())); break;
                }
                let value = serde_json::from_slice(&line).map_err(|_| "Respons Codex tidak sah.".into());
                if tx.send(value).is_err() { break; }
            }
        });
        let mut s = Self { child, input, rx: Some(rx), reader: Some(reader), notifications: VecDeque::new(), next_id: 0 };
        s.rpc("initialize", json!({"clientInfo":{"name":"forgekit","title":"ForgeKit Studio","version":env!("CARGO_PKG_VERSION")}}))?;
        s.send(json!({"method":"initialized"}))?;
        Ok(s)
    }
    fn send(&mut self, v: Value) -> Result<(), String> {
        writeln!(self.input, "{v}").and_then(|_| self.input.flush()).map_err(|_| "Koneksi Codex terputus.".into())
    }
    fn next(&mut self, deadline: Instant, cancelled: Option<&AtomicBool>) -> Result<Value, String> {
        loop {
            if cancelled.is_some_and(|v| v.load(Ordering::SeqCst)) { return Err("Login dibatalkan.".into()); }
            let left = deadline.checked_duration_since(Instant::now()).ok_or("Waktu tunggu Codex habis. Coba lagi.")?;
            match self.rx.as_ref().unwrap().recv_timeout(left.min(Duration::from_millis(100))) {
                Ok(v) => return v,
                Err(mpsc::RecvTimeoutError::Timeout) => continue,
                Err(_) => return Err("Runtime Codex berhenti sebelum selesai.".into()),
            }
        }
    }
    fn rpc(&mut self, method: &str, params: Value) -> Result<Value, String> {
        self.next_id += 1;
        let id = self.next_id;
        self.send(json!({"id":id,"method":method,"params":params}))?;
        let deadline = Instant::now() + Duration::from_secs(20);
        loop {
            let v = self.next(deadline, None)?;
            if v["id"].as_u64() == Some(id) && v.get("method").is_none() {
                // Never propagate an upstream error containing credentials or login URLs.
                return v.get("result").cloned().ok_or_else(|| format!("Codex menolak {method}. Periksa login atau versi runtime."));
            }
            if v.get("id").is_some() && v.get("method").is_some() {
                self.send(json!({"id":v["id"],"error":{"code":-32601,"message":"Unsupported client request"}}))?;
            } else if self.notifications.len() < 64 { self.notifications.push_back(v); }
        }
    }
    fn login(&mut self, cancelled: &AtomicBool) -> Result<Value, String> {
        let started = self.rpc("account/login/start", json!({"type":"chatgpt"}))?;
        let id = started["loginId"].as_str().ok_or("Codex tidak memberikan ID login.")?;
        let url = started["authUrl"].as_str().ok_or("URL login Codex tidak tersedia.")?;
        validate_login_url(url)?;
        if !Command::new("/usr/bin/open").arg(url).status().is_ok_and(|s| s.success()) {
            return Err("Browser login tidak dapat dibuka.".into());
        }
        let deadline = Instant::now() + Duration::from_secs(180);
        loop {
            let v = match self.notifications.pop_front() {
                Some(v) => v,
                None => match self.next(deadline, Some(cancelled)) {
                    Ok(v) => v,
                    Err(e) => { let _ = self.send(json!({"id":999,"method":"account/login/cancel","params":{"loginId":id}})); return Err(e); }
                },
            };
            if v["method"] == "account/login/completed" && v["params"]["loginId"].as_str() == Some(id) {
                if v["params"]["success"] != true { return Err("Login Codex dibatalkan atau ditolak.".into()); }
                return self.rpc("account/read", json!({"refreshToken":false}));
            }
        }
    }
}
impl Drop for Session {
    fn drop(&mut self) {
        let _ = self.child.kill(); let _ = self.child.wait(); self.rx.take();
        if let Ok(mut children) = CHILDREN.lock() { children.remove(&self.child.id()); }
        if let Some(reader) = self.reader.take() { let _ = reader.join(); }
    }
}
fn validate_login_url(value: &str) -> Result<(), String> {
    let u = url::Url::parse(value).map_err(|_| "URL login Codex tidak sah.")?;
    if u.scheme() != "https" || !matches!(u.host_str(), Some("auth.openai.com" | "chatgpt.com"))
        || !u.username().is_empty() || u.password().is_some() || u.port().is_some() {
        return Err("Tujuan login Codex tidak sah.".into());
    }
    Ok(())
}
fn saved_tokens(path: &Path) -> Result<Value, String> {
    // The managed directory and auth file must remain local, never redirected to another app.
    for directory in [Some(path), path.parent()].into_iter().flatten() {
        let meta = fs::symlink_metadata(directory).map_err(|_| "Profil Codex tidak tersedia. Hubungkan ulang.")?;
        if !meta.is_dir() || meta.file_type().is_symlink() {
            return Err("Profil Codex tidak boleh berupa tautan.".into());
        }
    }
    let file = path.join("auth.json");
    let meta = fs::symlink_metadata(&file).map_err(|_| "Login Codex belum tersimpan. Hubungkan ulang.")?;
    if !meta.is_file() || meta.len() > 65_536 { return Err("Berkas akun Codex tidak sah.".into()); }
    #[cfg(unix)] { use std::os::unix::fs::PermissionsExt; fs::set_permissions(&file, fs::Permissions::from_mode(0o600)).map_err(|_| "Izin akun Codex gagal diatur.")?; }
    let v: Value = serde_json::from_slice(&fs::read(file).map_err(|_| "Akun Codex tidak dapat dibaca.")?).map_err(|_| "Akun Codex tidak sah.")?;
    for field in ["access_token", "account_id"] {
        if v["tokens"][field].as_str().is_none_or(|s| s.is_empty() || s.len() > 16384 || s.chars().any(char::is_control)) {
            return Err("Token akun Codex tidak lengkap. Hubungkan ulang.".into());
        }
    }
    Ok(v)
}
fn profile_id(key_ref: &str) -> Result<String, String> {
    // Codex credentials live in the owned private profile; legacy Keychain markers are not credentials.
    key_ref.strip_prefix("codex-").filter(|v| valid_id(v))
        .map(str::to_owned).ok_or_else(|| "Referensi akun Codex tidak sah.".into())
}

pub fn is_codex(profile: &ai::AiProviderProfile) -> bool {
    profile.provider_type == "openai" && profile.base_url.trim_end_matches('/') == BASE_URL
}
fn with_account<T>(key_ref: &str, f: impl FnOnce(&mut Session, &Path) -> Result<T, String>) -> Result<T, String> {
    let id = profile_id(key_ref)?;
    let lock = account_lock(&id)?; let _guard = lock.lock().map_err(|_| "Akun Codex sedang sibuk.")?;
    let path = home(&id)?;
    // Refuse accidental unauthenticated sessions; never fall back to ~/.codex.
    saved_tokens(&path)?;
    let mut s = Session::start(&path)?;
    f(&mut s, &path)
}
pub fn access_token(key_ref: &str) -> Result<String, String> {
    with_account(key_ref, |s, path| {
        s.rpc("account/read", json!({"refreshToken":false}))?;
        let mut data = saved_tokens(path)?;
        if token_expires_soon(data["tokens"]["access_token"].as_str().unwrap()) {
            s.rpc("account/read", json!({"refreshToken":true}))?;
            data = saved_tokens(path)?;
        }
        Ok(data["tokens"]["access_token"].as_str().unwrap().into())
    })
}
fn token_expires_soon(token: &str) -> bool {
    use base64::Engine;
    let data = token.split('.').nth(1).and_then(|p| base64::engine::general_purpose::URL_SAFE_NO_PAD.decode(p).ok())
        .and_then(|p| serde_json::from_slice::<Value>(&p).ok());
    data.and_then(|v| v["exp"].as_u64()).is_none_or(|exp| exp <= now() + 120)
}
fn now() -> u64 { SystemTime::now().duration_since(UNIX_EPOCH).unwrap_or_default().as_secs() }
pub fn account_id(key_ref: &str) -> Result<String, String> {
    let id = profile_id(key_ref)?;
    Ok(saved_tokens(&home(&id)?)?["tokens"]["account_id"].as_str().unwrap().into())
}
pub fn limits(key_ref: &str) -> Result<Value, String> {
    with_account(key_ref, |s, _| {
        let account = s.rpc("account/read", json!({"refreshToken":false}))?;
        let mut limits = s.rpc("account/rateLimits/read", json!({}))?;
        limits["planType"] = account["account"]["planType"].clone();
        Ok(limits)
    })
}
fn model_rows(v: &Value) -> Result<Vec<ProviderModel>, String> {
    let mut result = vec![];
    for row in v["data"].as_array().filter(|v| v.len() <= 1000).ok_or("Katalog Codex tidak sah.")? {
        if row["hidden"] == true { continue; }
        let id = row["model"].as_str().or_else(|| row["id"].as_str()).filter(|v| !v.is_empty() && v.len() <= 200 && !v.chars().any(char::is_control)).ok_or("ID model Codex tidak sah.")?;
        let efforts: Vec<String> = row["supportedReasoningEfforts"].as_array().into_iter().flatten()
            .filter_map(|e| e["reasoningEffort"].as_str()).filter(|s| crate::model_catalog::valid_effort(s)).map(str::to_owned).collect();
        let default = row["defaultReasoningEffort"].as_str().filter(|v| efforts.iter().any(|e| e == v)).map(str::to_owned);
        result.push(ProviderModel { tool_calling: "supported".into(), id: id.into(), display_name: row["displayName"].as_str().filter(|s| s.len() <= 256 && !s.chars().any(char::is_control)).unwrap_or(id).into(), reasoning_efforts: efforts, default_reasoning_effort: default });
    }
    if result.is_empty() { return Err("Akun Codex belum memberikan model.".into()); }
    Ok(result)
}
fn list_models(s: &mut Session) -> Result<Vec<ProviderModel>, String> {
    let mut rows = vec![]; let mut cursor = Value::Null;
    for _ in 0..10 {
        let v = s.rpc("model/list", json!({"cursor":cursor,"limit":100,"includeHidden":false}))?;
        rows.extend(model_rows(&v)?);
        let next = v["nextCursor"].clone();
        if next.is_null() { return Ok(rows); }
        if next == cursor || next.as_str().is_none() { break; }
        cursor = next;
    }
    Err("Katalog Codex melampaui batas halaman.".into())
}
pub fn models(key_ref: &str) -> Result<Vec<ProviderModel>, String> { with_account(key_ref, |s, _| list_models(s)) }
pub fn sign_in(login_id: &str) -> Result<ai::ConnectionProfile, String> {
    browser_auth::with_login(login_id, |cancelled| {
        if !valid_id(login_id) { return Err("ID login Codex tidak sah.".into()); }
        let path = home(login_id)?;
        private_dir(path.parent().unwrap())?;
        fs::create_dir(&path).map_err(|_| "Profil login sudah ada; mulai login baru.")?;
        let key_ref = format!("codex-{login_id}");
        let result = (|| {
            private_dir(&path)?;
            let mut s = Session::start(&path)?;
            let identity = s.login(cancelled)?;
            if identity["account"]["type"] != "chatgpt" { return Err("Codex belum memverifikasi akun ChatGPT.".into()); }
            let tokens = saved_tokens(&path)?;
            let account_id = tokens["tokens"]["account_id"].as_str().unwrap();
            let catalog = list_models(&mut s)?;
            let email = identity["account"]["email"].as_str().filter(|e| !e.is_empty() && e.len() <= 200 && !e.chars().any(char::is_control));
            let label = format!("{} · Codex", email.unwrap_or("ChatGPT").chars().take(85).collect::<String>());
            serde_json::from_value(json!({
                "id":login_id,"providerId":"openai","connectionMode":"direct","credentialOwner":"forgekit","authMethod":"codex_oauth",
                "label":label,"identity":{"issuer":"https://auth.openai.com","subject":account_id,"email":email},
                "registrationRef":"codex_managed","credentialRef":key_ref,"accessState":"pending","enabled":true,
                "fallbackEligible":"unknown","priority":0,"quotaBucketRefs":[format!("chatgpt:{account_id}")],
                "baseUrl":BASE_URL,"model":catalog[0].id,"isDefault":false,"createdAt":now().to_string(),"updatedAt":now().to_string()
            })).map_err(|_| "Profil Codex gagal dibuat.".into())
        })();
        if result.is_err() { let _ = fs::remove_dir_all(&path); let _ = ai::delete_keychain_secret(&key_ref); }
        result
    })
}
pub fn disconnect(key_ref: &str) -> Result<(), String> {
    let id = profile_id(key_ref)?;
    let lock = account_lock(&id)?; let _guard = lock.lock().map_err(|_| "Akun Codex sedang sibuk.")?;
    let path = home(&id)?;
    if let Ok(mut s) = Session::start(&path) { let _ = s.rpc("account/logout", json!({})); }
    if path.exists() { fs::remove_dir_all(path).map_err(|_| "Profil Codex belum dapat dilepas.")?; }
    // Older releases stored a non-secret Keychain marker. It no longer grants access;
    // deleting the owned auth profile above revokes local access even if cleanup fails.
    let _ = ai::delete_keychain_secret(key_ref);
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test] fn managed_profile_reference_does_not_require_a_keychain_marker() {
        assert_eq!(profile_id("codex-fixture-owned-profile").unwrap(), "fixture-owned-profile");
        assert_eq!(profile_id("codex-0609bb16-fde2-4c50-a195-cf002ed8309e").unwrap(), "0609bb16-fde2-4c50-a195-cf002ed8309e");
        for value in ["codex-", "codex-../outside", "api-account", "codex-/tmp/a", "codex-a\nb"] {
            assert!(profile_id(value).is_err());
        }
    }
    #[cfg(unix)]
    #[test] fn managed_profile_still_requires_valid_tokens_and_rejects_links() {
        let root = std::env::temp_dir().join(crate::storage::next_id("forgekit-owned-profile-test"));
        let profile = root.join("own-profile");
        private_dir(&root).unwrap(); private_dir(&profile).unwrap();
        assert!(saved_tokens(&profile).is_err());
        fs::write(profile.join("auth.json"), br#"{"tokens":{"access_token":"fixture-token","account_id":"fixture-account"}}"#).unwrap();
        assert!(saved_tokens(&profile).is_ok());
        let link = root.join("linked-profile");
        std::os::unix::fs::symlink(&profile, &link).unwrap();
        assert!(saved_tokens(&link).is_err());
        fs::rename(profile.join("auth.json"), profile.join("fixture.json")).unwrap();
        std::os::unix::fs::symlink(profile.join("fixture.json"), profile.join("auth.json")).unwrap();
        assert!(saved_tokens(&profile).is_err());
        fs::remove_file(profile.join("auth.json")).unwrap();
        fs::write(profile.join("auth.json"), br#"{"tokens":{"access_token":"","account_id":"fixture-account"}}"#).unwrap();
        assert!(saved_tokens(&profile).is_err());
        fs::remove_dir_all(root).unwrap();
    }
    #[test] fn obsolete_login_methods_cannot_be_requested_by_old_clients() {
        assert!(validate_login_method(None).is_ok());
        assert!(validate_login_method(Some("codex")).is_ok());
        for method in ["oauth", "oauth_browser", "web_session", "cookie", ""] {
            assert!(validate_login_method(Some(method)).is_err());
        }
        let mut p: ai::ConnectionProfile = serde_json::from_value(json!({
            "id":"fixture","providerId":"openai","connectionMode":"direct","credentialOwner":"forgekit",
            "authMethod":"codex_oauth","label":"Fixture","credentialRef":"codex-fixture",
            "accessState":"pending","enabled":true,"fallbackEligible":"unknown","priority":0,
            "quotaBucketRefs":["chatgpt:fixture"],"baseUrl":BASE_URL,"model":"fixture-model",
            "isDefault":false,"createdAt":"1","updatedAt":"1"
        })).unwrap();
        assert!(ai::validate_connection_profile(&p).is_ok());
        p.base_url = "https://api.openai.com/v1".into();
        for method in ["oauth_browser", "web_session"] {
            p.auth_method = method.into(); assert!(ai::validate_connection_profile(&p).is_err());
        }
    }
    #[test] fn rejects_foreign_paths_and_login_destinations() {
        for id in ["", "../.codex", "/tmp/foreign", "a/b", "a\nb"] { assert!(home(id).is_err()); }
        assert!(home("own-profile").unwrap().to_string_lossy().contains("dev.forgekit.studio/codex-accounts/own-profile"));
        for url in ["http://auth.openai.com/x", "https://auth.openai.com.evil.test/x", "https://user@chatgpt.com/x", "file:///tmp/a"] { assert!(validate_login_url(url).is_err()); }
        assert!(validate_login_url("https://auth.openai.com/oauth/authorize?state=fixture").is_ok());
    }
    #[test] fn models_and_expiry_are_taken_from_runtime_not_hardcoded() {
        let rows = model_rows(&json!({"data":[{"id":"opaque","model":"actual-model","displayName":"Actual","defaultReasoningEffort":"high","supportedReasoningEfforts":[{"reasoningEffort":"high"},{"reasoningEffort":"invalid"}]},{"id":"hidden","hidden":true}]})).unwrap();
        assert_eq!(rows.len(),1); assert_eq!(rows[0].id,"actual-model"); assert_eq!(rows[0].reasoning_efforts,vec!["high"]);
        assert!(model_rows(&json!({"data":[{"model":"bad\nmodel"}]})).is_err());
        assert!(token_expires_soon("invalid"));
    }
    #[cfg(unix)]
    #[test] fn rpc_is_isolated_correlates_ids_bounds_errors_and_reaps_process() {
        use std::os::unix::fs::PermissionsExt;
        let root = std::env::temp_dir().join(crate::storage::next_id("forgekit-codex-test"));
        private_dir(&root).unwrap();
        let exe = root.join("fake-runtime");
        fs::write(&exe, r#"#!/usr/bin/python3
import json, os, sys
for line in sys.stdin:
 q=json.loads(line)
 if 'id' not in q: continue
 method=q['method']
 if method=='initialize':
  print(json.dumps({'method':'account/updated','params':{'authMode':None}}),flush=True)
  result={}
 elif method=='account/read': result={'home':os.environ.get('CODEX_HOME'),'cwd':os.getcwd(),'pid':os.getpid()}
 elif method=='denied':
  print(json.dumps({'id':q['id'],'error':{'message':'secret-must-not-leak'}}),flush=True)
  continue
 else: result={'rateLimits':{'primary':{'usedPercent':37,'windowDurationMins':300}}}
 print(json.dumps({'id':q['id'],'result':result}),flush=True)
"#).unwrap();
        fs::set_permissions(&exe, fs::Permissions::from_mode(0o700)).unwrap();
        let mut s = Session::spawn(&exe, &root).unwrap();
        let pid = s.child.id();
        let account = s.rpc("account/read", json!({})).unwrap();
        assert_eq!(account["home"], root.to_string_lossy().as_ref());
        assert_eq!(account["cwd"], root.canonicalize().unwrap().to_string_lossy().as_ref());
        assert_eq!(s.rpc("account/rateLimits/read", json!({})).unwrap()["rateLimits"]["primary"]["usedPercent"],37);
        let error = s.rpc("denied", json!({})).unwrap_err();
        assert!(!error.contains("secret-must-not-leak"));
        let cancelled = AtomicBool::new(true);
        assert!(s.next(Instant::now()+Duration::from_secs(2),Some(&cancelled)).unwrap_err().contains("dibatalkan"));
        drop(s);
        assert!(!Command::new("/bin/kill").args(["-0", &pid.to_string()]).stderr(Stdio::null()).status().unwrap().success());
        fs::remove_dir_all(root).unwrap();
    }
}
