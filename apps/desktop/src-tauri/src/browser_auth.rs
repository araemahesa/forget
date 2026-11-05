//! Native Sign in with ChatGPT. Tokens never cross the webview boundary.
use base64::{
    engine::general_purpose::{STANDARD, URL_SAFE_NO_PAD},
    Engine,
};
use jsonwebtoken::{decode, decode_header, jwk::JwkSet, Algorithm, DecodingKey, Validation};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use std::{
    collections::HashMap,
    io::{Read, Write},
    net::TcpListener,
    sync::{
        atomic::{AtomicBool, Ordering},
        Arc, Mutex, OnceLock,
    },
    time::{Duration, Instant, SystemTime, UNIX_EPOCH},
};

const ISSUER: &str = "https://auth.openai.com";
const RESOURCE: &str = "https://api.openai.com/v1";
const SCOPES: &str =
    "openid profile email offline_access resource.invoke chatgpt.tokens.use.direct";
type Logins = Mutex<HashMap<String, Arc<AtomicBool>>>;
static LOGINS: OnceLock<Logins> = OnceLock::new();
static REFRESH: Mutex<()> = Mutex::new(());

pub fn cancel(id: &str) {
    if let Ok(logins) = LOGINS.get_or_init(Default::default).lock() {
        if let Some(cancelled) = logins.get(id) {
            cancelled.store(true, Ordering::SeqCst);
        }
    }
}

pub(crate) fn random() -> Result<String, String> {
    let mut bytes = [0; 32];
    std::fs::File::open("/dev/urandom")
        .and_then(|mut file| file.read_exact(&mut bytes))
        .map_err(|_| "Tidak dapat membuat sesi login aman.".to_string())?;
    Ok(URL_SAFE_NO_PAD.encode(bytes))
}
fn valid_host_id(id: &str) -> bool {
    if let Some(uuid) = id.strip_prefix("urn:uuid:") {
        return uuid.len() == 36
            && uuid.bytes().enumerate().all(|(i, c)| {
                if [8, 13, 18, 23].contains(&i) {
                    c == b'-'
                } else {
                    c.is_ascii_hexdigit()
                }
            });
    }
    id.starts_with("urn:ietf:params:oauth:jwk-thumbprint:") || id.starts_with("did:key:")
}
fn new_host_id() -> Result<String, String> {
    let mut bytes = URL_SAFE_NO_PAD
        .decode(random()?)
        .map_err(|_| "ID perangkat tidak dapat dibuat.")?;
    bytes[6] = (bytes[6] & 0x0f) | 0x40;
    bytes[8] = (bytes[8] & 0x3f) | 0x80;
    let hex: String = bytes[..16].iter().map(|b| format!("{b:02x}")).collect();
    Ok(format!(
        "urn:uuid:{}-{}-{}-{}-{}",
        &hex[..8],
        &hex[8..12],
        &hex[12..16],
        &hex[16..20],
        &hex[20..]
    ))
}
fn now() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs()
}
pub(crate) fn client() -> Result<reqwest::blocking::Client, String> {
    reqwest::blocking::Client::builder()
        .timeout(Duration::from_secs(20))
        .redirect(reqwest::redirect::Policy::none())
        .build()
        .map_err(|_| "Layanan login tidak tersedia.".into())
}
pub(crate) fn response(response: reqwest::blocking::Response) -> Result<Value, String> {
    let status = response.status();
    let mut bytes = Vec::new();
    response
        .take(2 * 1024 * 1024)
        .read_to_end(&mut bytes)
        .map_err(|_| "Respons login tidak dapat dibaca.".to_string())?;
    if !status.is_success() {
        return Err(format!(
            "Provider menolak autentikasi (HTTP {}). Coba hubungkan ulang.",
            status.as_u16()
        ));
    }
    serde_json::from_slice(&bytes).map_err(|_| "Respons provider tidak sah.".into())
}
fn discovery(client: &reqwest::blocking::Client) -> Result<Value, String> {
    let config = response(
        client
            .get(format!("{ISSUER}/.well-known/openid-configuration"))
            .send()
            .map_err(|_| "Tidak dapat menghubungi OpenAI.".to_string())?,
    )?;
    if config["issuer"].as_str() != Some(ISSUER) {
        return Err("Issuer login tidak sah.".into());
    }
    for field in ["authorization_endpoint", "token_endpoint", "jwks_uri"] {
        let url = config[field]
            .as_str()
            .and_then(|u| url::Url::parse(u).ok())
            .ok_or("Konfigurasi login tidak sah.")?;
        if url.origin().ascii_serialization() != ISSUER {
            return Err("Endpoint login tidak sah.".into());
        }
    }
    Ok(config)
}

#[derive(Serialize, Deserialize)]
struct Credential {
    forgekit_oauth: bool,
    client_id: String,
    access_token: String,
    refresh_token: Option<String>,
    expires_at: u64,
    scopes: String,
}

fn credential(
    data: &Value,
    client_id: &str,
    previous: Option<&Credential>,
) -> Result<Credential, String> {
    let access_token = data["access_token"]
        .as_str()
        .filter(|s| !s.is_empty())
        .ok_or("Token akses tidak tersedia.")?;
    let expires = data["expires_in"]
        .as_u64()
        .filter(|n| *n > 0)
        .ok_or("Masa berlaku token tidak sah.")?;
    if !data["token_type"]
        .as_str()
        .is_some_and(|t| t.eq_ignore_ascii_case("bearer"))
    {
        return Err("Jenis token tidak sah.".into());
    }
    let scopes = data["scope"]
        .as_str()
        .or_else(|| previous.map(|p| p.scopes.as_str()))
        .ok_or("Provider belum memberikan izin akses AI.")?;
    if !scopes
        .split_whitespace()
        .any(|s| s == "chatgpt.tokens.use.direct")
    {
        return Err("Login berhasil, tetapi izin penggunaan AI belum diberikan. Hubungkan ulang dan izinkan akses ChatGPT.".into());
    }
    let refresh_token = data["refresh_token"]
        .as_str()
        .map(str::to_owned)
        .or_else(|| previous.and_then(|p| p.refresh_token.clone()));
    if scopes.split_whitespace().any(|s| s == "offline_access") && refresh_token.is_none() {
        return Err("Refresh token tidak tersedia.".into());
    }
    Ok(Credential {
        forgekit_oauth: true,
        client_id: client_id.into(),
        access_token: access_token.into(),
        refresh_token,
        expires_at: now().saturating_add(expires),
        scopes: scopes.into(),
    })
}

/// API keys pass through unchanged. OAuth bundles refresh inside the native process.
pub fn access_token(key_ref: &str, raw: String) -> Result<String, String> {
    if !raw.trim_start().starts_with('{') {
        return Ok(raw);
    }
    let _guard = REFRESH
        .lock()
        .map_err(|_| "Credential sedang dipakai.".to_string())?;
    let current = crate::ai::optional_keychain_secret(key_ref)?.unwrap_or(raw);
    let stored: Credential = serde_json::from_str(&current)
        .map_err(|_| "Credential tidak sah. Hubungkan ulang.".to_string())?;
    if !stored.forgekit_oauth {
        return Err("Credential tidak dikenal.".into());
    }
    if stored.expires_at > now() + 60 {
        return Ok(stored.access_token);
    }
    let client = client()?;
    let config = discovery(&client)?;
    let refresh_token = stored
        .refresh_token
        .as_deref()
        .ok_or("Sesi login berakhir. Hubungkan ulang.")?;
    let data = response(
        client
            .post(config["token_endpoint"].as_str().unwrap())
            .form(&[
                ("grant_type", "refresh_token"),
                ("client_id", stored.client_id.as_str()),
                ("refresh_token", refresh_token),
                ("resource", RESOURCE),
            ])
            .send()
            .map_err(|_| "Sesi belum dapat diperbarui. Coba lagi.".to_string())?,
    )?;
    let updated = credential(&data, &stored.client_id, Some(&stored))?;
    crate::ai::set_keychain_secret(
        key_ref,
        &serde_json::to_string(&updated).map_err(|_| "Credential tidak dapat disimpan.")?,
    )?;
    Ok(updated.access_token)
}

fn callback(request: &str, port: u16, state: &str) -> Option<Result<(String, String), String>> {
    let mut lines = request.lines();
    let mut first = lines.next()?.split_whitespace();
    if first.next()? != "GET" {
        return None;
    }
    let path = first.next()?;
    let host = format!("127.0.0.1:{port}");
    if !lines.any(|line| {
        line.split_once(':')
            .is_some_and(|(name, value)| name.eq_ignore_ascii_case("host") && value.trim() == host)
    }) {
        return None;
    }
    let url = url::Url::parse(&format!("http://{host}{path}")).ok()?;
    if url.path() != "/auth/callback" || !path.starts_with('/') || path.starts_with("//") {
        return None;
    }
    let params: Vec<_> = url.query_pairs().collect();
    let values = |key: &str| {
        params
            .iter()
            .filter(|(k, _)| k == key)
            .map(|(_, v)| v.to_string())
            .collect::<Vec<_>>()
    };
    if values("state") != [state] {
        return None;
    }
    if !values("error").is_empty() {
        return Some(Err("Login dibatalkan atau izin ditolak.".into()));
    }
    let codes = values("code");
    let clients = values("client_id");
    if codes.len() != 1
        || codes[0].is_empty()
        || clients.len() != 1
        || clients[0] == "dynamic_agent_client"
        || clients[0].is_empty()
        || clients[0].len() > 200
        || !clients[0]
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || "-_".contains(c))
    {
        return Some(Err(
            "Registrasi aplikasi belum selesai. Coba hubungkan ulang.".into(),
        ));
    }
    Some(Ok((codes[0].clone(), clients[0].clone())))
}

pub(crate) fn with_login<T>(
    id: &str,
    operation: impl FnOnce(&AtomicBool) -> Result<T, String>,
) -> Result<T, String> {
    let cancelled = Arc::new(AtomicBool::new(false));
    {
        let mut logins = LOGINS
            .get_or_init(Default::default)
            .lock()
            .map_err(|_| "Layanan login sibuk.")?;
        if !logins.is_empty() {
            return Err("Selesaikan atau batalkan login yang sedang berjalan.".into());
        }
        logins.insert(id.into(), cancelled.clone());
    }
    let result = operation(&cancelled);
    if let Ok(mut logins) = LOGINS.get_or_init(Default::default).lock() {
        logins.remove(id);
    }
    result
}

pub(crate) fn code_callback(
    request: &str,
    port: u16,
    state: &str,
    issuer: Option<&str>,
) -> Option<Result<String, String>> {
    let mut lines = request.lines();
    let mut first = lines.next()?.split_whitespace();
    if first.next()? != "GET" {
        return None;
    }
    let path = first.next()?;
    let host = format!("127.0.0.1:{port}");
    if !lines.any(|line| {
        line.split_once(':')
            .is_some_and(|(k, v)| k.eq_ignore_ascii_case("host") && v.trim() == host)
    }) {
        return None;
    }
    if !path.starts_with('/') || path.starts_with("//") {
        return None;
    }
    let url = url::Url::parse(&format!("http://{host}{path}")).ok()?;
    if url.path() != "/auth/callback" {
        return None;
    }
    let pairs: Vec<_> = url.query_pairs().collect();
    let values = |key: &str| {
        pairs
            .iter()
            .filter(|(k, _)| k == key)
            .map(|(_, v)| v.as_ref())
            .collect::<Vec<_>>()
    };
    if values("state") != [state] {
        return None;
    }
    if let Some(issuer) = issuer {
        if values("iss") != [issuer] {
            return Some(Err("Issuer login tidak sah.".into()));
        }
    }
    if !values("error").is_empty() {
        return Some(Err("Login dibatalkan atau izin ditolak.".into()));
    }
    let codes = values("code");
    if codes.len() != 1 || codes[0].is_empty() || codes[0].len() > 4096 {
        return Some(Err("Kode login tidak sah.".into()));
    }
    Some(Ok(codes[0].to_owned()))
}

pub fn sign_in(id: &str) -> Result<crate::ai::ConnectionProfile, String> {
    with_login(id, |cancelled| authorize(id, cancelled))
}

pub(crate) fn wait_for_callback<T>(
    listener: TcpListener,
    cancelled: &AtomicBool,
    parse: impl Fn(&str, u16) -> Option<Result<T, String>>,
) -> Result<T, String> {
    listener
        .set_nonblocking(true)
        .map_err(|_| "Listener login tidak tersedia.")?;
    let port = listener
        .local_addr()
        .map_err(|_| "Port login tidak tersedia.")?
        .port();
    let deadline = Instant::now() + Duration::from_secs(180);
    loop {
        if cancelled.load(Ordering::SeqCst) {
            return Err("Login dibatalkan.".into());
        }
        if Instant::now() >= deadline {
            return Err("Waktu login habis. Tekan Connect untuk mencoba lagi.".into());
        }
        match listener.accept() {
            Ok((mut stream, _)) => {
                let _ = stream.set_read_timeout(Some(Duration::from_secs(2)));
                let _ = stream.set_write_timeout(Some(Duration::from_secs(2)));
                let mut bytes = Vec::new();
                let mut chunk = [0; 1024];
                while bytes.len() < 16384 {
                    match stream.read(&mut chunk) {
                        Ok(0) | Err(_) => break,
                        Ok(n) => bytes.extend_from_slice(&chunk[..n]),
                    }
                    if bytes.windows(4).any(|w| w == b"\r\n\r\n") {
                        break;
                    }
                }
                let result = parse(&String::from_utf8_lossy(&bytes), port);
                let (status, body) = if result.is_some() {
                    (
                        "200 OK",
                        "Kembali ke ForgeKit Studio. Aplikasi sedang memverifikasi koneksi Anda.",
                    )
                } else {
                    ("400 Bad Request", "Permintaan login tidak sah.")
                };
                let script = "history.replaceState(null, '', '/auth/complete'); try { window.close(); } catch(e) {} setTimeout(function() { document.body.innerHTML = '<p style=\"font-family:system-ui;color:#333;text-align:center;margin-top:80px\">Koneksi berhasil. Anda dapat menutup tab ini dan kembali ke ForgeKit Studio.</p>'; }, 300);";
                let hash = STANDARD.encode(Sha256::digest(script.as_bytes()));
                let body = format!("<!doctype html><html lang=\"id\"><meta charset=\"utf-8\"><title>ForgeKit Studio</title><style>body{{font-family:system-ui,sans-serif;background:#111;color:#eee;display:flex;align-items:center;justify-content:center;min-height:100vh;margin:0}}p{{text-align:center;font-size:16px;line-height:1.6}}</style><p>{body}</p><script>{script}</script></html>");
                let _ = write!(stream, "HTTP/1.1 {status}\r\nContent-Type: text/html; charset=utf-8\r\nCache-Control: no-store\r\nReferrer-Policy: no-referrer\r\nContent-Security-Policy: default-src 'none'; script-src 'sha256-{hash}'; style-src 'unsafe-inline'; frame-ancestors 'none'; base-uri 'none'\r\nConnection: close\r\nContent-Length: {}\r\n\r\n{body}", body.len());
                if let Some(result) = result {
                    return result;
                }
            }
            Err(e) if e.kind() == std::io::ErrorKind::WouldBlock => {
                std::thread::sleep(Duration::from_millis(80))
            }
            Err(_) => return Err("Listener login terhenti. Hubungkan ulang.".into()),
        }
    }
}

fn authorize(id: &str, cancelled: &AtomicBool) -> Result<crate::ai::ConnectionProfile, String> {
    let client = client()?;
    let config = discovery(&client)?;
    let state = random()?;
    let nonce = random()?;
    let verifier = random()?;
    let listener =
        TcpListener::bind("127.0.0.1:0").map_err(|_| "Listener login lokal tidak dapat dibuka.")?;
    listener
        .set_nonblocking(true)
        .map_err(|_| "Listener login tidak tersedia.")?;
    let port = listener
        .local_addr()
        .map_err(|_| "Port login tidak tersedia.")?
        .port();
    let redirect = format!("http://127.0.0.1:{port}/auth/callback");
    let host_id = match crate::ai::optional_keychain_secret("chatgpt-host-id")? {
        Some(id) if valid_host_id(&id) => id,
        _ => {
            // Migrate legacy base64 identifiers: OpenAI rejects them before login.
            let id = new_host_id()?;
            crate::ai::set_keychain_secret("chatgpt-host-id", &id)?;
            id
        }
    };
    let mut url = url::Url::parse(config["authorization_endpoint"].as_str().unwrap())
        .map_err(|_| "URL login tidak sah.")?;
    url.query_pairs_mut().extend_pairs([
        ("client_id", "dynamic_agent_client"),
        ("response_type", "code"),
        ("redirect_uri", &redirect),
        ("scope", SCOPES),
        ("resource", RESOURCE),
        ("state", &state),
        ("nonce", &nonce),
        ("code_challenge_method", "S256"),
        (
            "code_challenge",
            &URL_SAFE_NO_PAD.encode(Sha256::digest(verifier.as_bytes())),
        ),
        ("ext_agent_host_id", &host_id),
        ("agent_name_hint", "ForgeKit Studio"),
    ]);
    if cancelled.load(Ordering::SeqCst) {
        return Err("Login dibatalkan.".into());
    }
    if !std::process::Command::new("/usr/bin/open")
        .arg(url.as_str())
        .status()
        .is_ok_and(|s| s.success())
    {
        return Err("Browser sistem tidak dapat dibuka.".into());
    }
    let (code, client_id) = wait_for_callback(listener, cancelled, |request, port| {
        callback(request, port, &state)
    })?;
    let data = response(
        client
            .post(config["token_endpoint"].as_str().unwrap())
            .form(&[
                ("grant_type", "authorization_code"),
                ("client_id", &client_id),
                ("code", &code),
                ("code_verifier", &verifier),
                ("redirect_uri", &redirect),
                ("resource", RESOURCE),
            ])
            .send()
            .map_err(|_| "Kode login belum dapat ditukar. Hubungkan ulang.".to_string())?,
    )?;
    let id_token = data["id_token"]
        .as_str()
        .ok_or("Identitas login tidak tersedia.")?;
    let header = decode_header(id_token).map_err(|_| "Identitas login tidak sah.")?;
    let keys: JwkSet = serde_json::from_value(response(
        client
            .get(config["jwks_uri"].as_str().unwrap())
            .send()
            .map_err(|_| "Kunci identitas belum tersedia.")?,
    )?)
    .map_err(|_| "Kunci identitas tidak sah.")?;
    let jwk = keys
        .find(
            header
                .kid
                .as_deref()
                .ok_or("Kunci identitas tidak tersedia.")?,
        )
        .ok_or("Kunci identitas tidak ditemukan.")?;
    let key = DecodingKey::from_jwk(jwk).map_err(|_| "Kunci identitas tidak sah.")?;
    let mut validation = Validation::new(Algorithm::RS256);
    validation.set_issuer(&[ISSUER]);
    validation.set_audience(&[&client_id]);
    validation.set_required_spec_claims(&["iss", "aud", "exp", "iat", "sub"]);
    validation.leeway = 5;
    let claims = decode::<Value>(id_token, &key, &validation)
        .map_err(|_| "Verifikasi identitas login gagal.")?
        .claims;
    if claims["nonce"].as_str() != Some(&nonce)
        || claims["sub"].as_str().is_none_or(str::is_empty)
        || claims
            .get("azp")
            .is_some_and(|v| v.as_str() != Some(&client_id))
        || (claims["aud"].as_array().is_some_and(|a| a.len() > 1)
            && claims["azp"].as_str() != Some(&client_id))
    {
        return Err("Identitas tidak cocok dengan sesi login.".into());
    }
    let stored = credential(&data, &client_id, None)?;
    let models = response(
        client
            .get(format!("{RESOURCE}/models"))
            .bearer_auth(&stored.access_token)
            .send()
            .map_err(|_| "Katalog model belum dapat dibaca.")?,
    )?;
    let catalog = crate::connections::model_ids(&models)?;
    let mut ids: Vec<_> = catalog
        .iter()
        .map(String::as_str)
        .filter(|m| {
            m.starts_with("gpt-")
                && ![
                    "audio",
                    "realtime",
                    "image",
                    "transcribe",
                    "tts",
                    "instruct",
                    "search",
                ]
                .iter()
                .any(|s| m.contains(s))
        })
        .collect();
    ids.sort_unstable();
    let model = ids
        .last()
        .ok_or("Tidak ada model teks yang dapat digunakan. Periksa akses akun ChatGPT.")?;
    if cancelled.load(Ordering::SeqCst) {
        return Err("Login dibatalkan.".into());
    }
    let key_ref = format!("oauth-{id}");
    crate::ai::set_keychain_secret(
        &key_ref,
        &serde_json::to_string(&stored).map_err(|_| "Credential tidak dapat disimpan.")?,
    )?;
    serde_json::from_value(json!({
        "id": id, "providerId": "openai", "connectionMode": "direct", "credentialOwner": "forgekit", "authMethod": "oauth_browser",
        "label": claims["email"].as_str().or(claims["name"].as_str()).unwrap_or("ChatGPT"),
        "identity": {"issuer": ISSUER, "subject": claims["sub"], "email": claims["email"], "name": claims["name"]},
        "registrationRef": client_id, "credentialRef": key_ref, "accessState": "pending", "enabled": true,
        "fallbackEligible": "unknown", "priority": 0, "quotaBucketRefs": [format!("chatgpt:{}", claims["sub"].as_str().unwrap())],
        "baseUrl": RESOURCE, "model": model, "isDefault": false, "createdAt": now().to_string(), "updatedAt": now().to_string()
    })).map_err(|_| "Profil login tidak dapat disimpan.".into())
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn host_id_uses_supported_uuid_uri_and_rejects_legacy_base64() {
        assert!(!valid_host_id("legacy-random-base64-identifier"));
        assert!(!valid_host_id("urn:uuid:invalid"));
        let id = new_host_id().unwrap();
        assert!(valid_host_id(&id));
        assert_eq!(&id[23..24], "4");
        assert!(matches!(&id[28..29], "8" | "9" | "a" | "b"));
        assert_ne!(id, new_host_id().unwrap());
    }
    #[test]
    fn public_client_callbacks_bind_state_host_and_issuer() {
        let req = |query: &str| {
            format!("GET /auth/callback?{query} HTTP/1.1\r\nHost: 127.0.0.1:4242\r\n\r\n")
        };
        assert_eq!(
            code_callback(
                &req("state=expected&code=issued&iss=https%3A%2F%2Fdiscord.com"),
                4242,
                "expected",
                Some("https://discord.com")
            )
            .unwrap()
            .unwrap(),
            "issued"
        );
        assert!(code_callback(&req("state=wrong&code=x"), 4242, "expected", None).is_none());
        assert!(
            code_callback(&req("state=expected&code=x&code=y"), 4242, "expected", None)
                .unwrap()
                .is_err()
        );
        assert!(code_callback(
            &req("state=expected&code=x"),
            4242,
            "expected",
            Some("https://discord.com")
        )
        .unwrap()
        .is_err());
        assert!(code_callback(
            &req("state=expected&error=access_denied"),
            4242,
            "expected",
            None
        )
        .unwrap()
        .is_err());
        assert!(code_callback(&req("state=expected&code=x"), 9999, "expected", None).is_none());
    }
    #[test]
    fn rejects_unrelated_or_ambiguous_callbacks() {
        let request =
            |q: &str| format!("GET /auth/callback?{q} HTTP/1.1\r\nHost: 127.0.0.1:1234\r\n\r\n");
        assert!(callback(&request("state=wrong&code=x&client_id=c"), 1234, "expected").is_none());
        assert!(callback(
            &request("state=expected&state=expected&code=x&client_id=c"),
            1234,
            "expected"
        )
        .is_none());
        assert!(callback(
            &request("state=expected&code=x&code=y&client_id=c"),
            1234,
            "expected"
        )
        .unwrap()
        .is_err());
        assert_eq!(
            callback(
                &request("state=expected&code=x&client_id=issued"),
                1234,
                "expected"
            )
            .unwrap()
            .unwrap(),
            ("x".into(), "issued".into())
        );
        assert!(callback(
            &request("state=expected&error=access_denied"),
            1234,
            "expected"
        )
        .unwrap()
        .is_err());
    }
    #[test]
    fn identity_login_does_not_grant_inference() {
        assert!(credential(&json!({"access_token":"fixture", "expires_in":3600, "token_type":"Bearer", "scope":"openid profile"}), "client", None).is_err());
        assert!(credential(&json!({"access_token":"fixture", "expires_in":3600, "token_type":"Bearer", "scope":"chatgpt.tokens.use.direct"}), "client", None).is_ok());
    }
}
