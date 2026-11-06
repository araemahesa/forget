//! Shared browser-login plumbing (login registry, loopback callback, HTTP helpers)
//! used by the Codex and Google sign-in flows. Tokens never cross the webview boundary.
use base64::{
    engine::general_purpose::{STANDARD, URL_SAFE_NO_PAD},
    Engine,
};
use serde_json::Value;
use sha2::{Digest, Sha256};
use std::{
    collections::HashMap,
    io::{Read, Write},
    net::TcpListener,
    sync::{
        atomic::{AtomicBool, Ordering},
        Arc, Mutex, OnceLock,
    },
    time::{Duration, Instant},
};

type Logins = Mutex<HashMap<String, Arc<AtomicBool>>>;
static LOGINS: OnceLock<Logins> = OnceLock::new();

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

#[cfg(test)]
mod tests {
    use super::*;
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
}
