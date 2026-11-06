pub(crate) mod http;

use crate::ai::{ConnectionProfile, RouterConnection};
// Read-only, account-scoped quota discovery. Credentials never enter the webview.
// ChatGPT limits use the documented Codex app-server RPC with external auth and
// an ephemeral credential store; the user's global Codex session is never used.
use crate::ai::{self, AiProviderProfile};
use base64::{engine::general_purpose::URL_SAFE_NO_PAD, Engine};
use serde::Serialize;
use serde_json::{json, Value};
use std::{
    collections::HashMap,
    io::{BufRead, BufReader, Read, Write},
    path::PathBuf,
    process::{Command, Stdio},
    sync::{mpsc, LazyLock, Mutex},
    time::{Duration, Instant, SystemTime, UNIX_EPOCH},
};

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct UsageWindow {
    pub id: String,
    pub label: String,
    pub scope: String,
    pub used_percent: f64,
    pub window_duration_mins: Option<u64>,
    pub resets_at: Option<u64>,
    pub remaining: Option<u64>,
    pub limit: Option<u64>,
    pub unit: Option<String>,
}
#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProviderUsage {
    pub profile_id: String,
    pub status: String,
    pub source: String,
    pub observed_at: Option<u64>,
    pub checked_at: u64,
    pub plan_type: Option<String>,
    pub windows: Vec<UsageWindow>,
    pub message: Option<String>,
}
fn now() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs()
}
fn unavailable(profile: &AiProviderProfile, message: &str) -> ProviderUsage {
    ProviderUsage {
        profile_id: profile.id.clone(),
        status: "unavailable".into(),
        source: "none".into(),
        observed_at: None,
        checked_at: now(),
        plan_type: None,
        windows: vec![],
        message: Some(message.into()),
    }
}
fn key(profile: &AiProviderProfile) -> String {
    // A Claude Code account is the same plan however its saved profile is edited.
    if crate::auth::claude::is_claude_code(profile) {
        return format!("claude-code|{}", profile.key_reference);
    }
    format!(
        "{}|{}|{}|{}|{}",
        profile.id,
        profile.provider_type,
        profile.base_url,
        profile.key_reference,
        profile.updated_at
    )
}
static HEADERS: LazyLock<Mutex<HashMap<String, ProviderUsage>>> =
    LazyLock::new(|| Mutex::new(HashMap::new()));

fn reset_at(duration: &str, observed_at: u64) -> Option<u64> {
    // OpenAI reset headers are durations such as `1m20s` or `250ms`.
    if duration.is_empty() || duration.len() > 80 {
        return None;
    }
    let mut rest = duration;
    let mut seconds = 0_f64;
    while !rest.is_empty() {
        let digits = rest
            .find(|c: char| !c.is_ascii_digit() && c != '.')
            .unwrap_or(rest.len());
        let amount = rest[..digits].parse::<f64>().ok()?;
        rest = &rest[digits..];
        let (unit, multiplier) = [
            ("ms", 0.001),
            ("s", 1.),
            ("m", 60.),
            ("h", 3600.),
            ("d", 86400.),
        ]
        .into_iter()
        .find(|(unit, _)| rest.starts_with(unit))?;
        seconds += amount * multiplier;
        rest = &rest[unit.len()..];
    }
    if !seconds.is_finite() || seconds < 0. || seconds > 366. * 86400. {
        return None;
    }
    observed_at.checked_add(seconds.ceil() as u64)
}

/// Only known numerical response headers are retained, never bodies/auth headers.
/// These are per-model API limits, not ChatGPT subscription windows.
pub fn observe_api_headers(profile: &AiProviderProfile, headers: &HashMap<String, String>) {
    observe_headers(profile, headers, &profile.model);
}
fn observe_headers(profile: &AiProviderProfile, headers: &HashMap<String, String>, scope: &str) {
    if profile.provider_type != "openai" || profile.key_reference.starts_with("oauth-") {
        return;
    }
    let mut windows = vec![];
    let observed_at = now();
    for unit in ["requests", "tokens"] {
        let number = |part: &str| {
            headers
                .get(&format!("x-ratelimit-{part}-{unit}"))
                .and_then(|v| v.parse::<u64>().ok())
        };
        if let (Some(limit), Some(remaining)) = (number("limit"), number("remaining")) {
            if limit == 0 || remaining > limit {
                continue;
            }
            windows.push(UsageWindow {
                id: format!("api-{unit}"),
                label: if unit == "requests" {
                    "Permintaan API"
                } else {
                    "Token API"
                }
                .into(),
                scope: scope.into(),
                used_percent: (limit - remaining) as f64 / limit as f64 * 100.,
                window_duration_mins: None,
                resets_at: headers
                    .get(&format!("x-ratelimit-reset-{unit}"))
                    .and_then(|value| reset_at(value, observed_at)),
                remaining: Some(remaining),
                limit: Some(limit),
                unit: Some(unit.into()),
            });
        }
    }
    if !windows.is_empty() {
        let usage = ProviderUsage { profile_id: profile.id.clone(), status: "available".into(), source: "api_headers".into(), observed_at: Some(observed_at), checked_at: observed_at, plan_type: None, windows,
            message: Some("Batas API dari respons terakhir untuk model ini; bukan kuota paket 5 jam/mingguan.".into()) };
        if let Ok(mut cache) = HEADERS.lock() {
            cache.insert(key(profile), usage);
        }
    }
}
fn parse_limits(profile: &AiProviderProfile, value: &Value) -> ProviderUsage {
    let mut usage = unavailable(
        profile,
        "Provider belum mengembalikan data limit untuk akun ini.",
    );
    let buckets: Vec<(&str, &Value)> = match value["rateLimitsByLimitId"]
        .as_object()
        .filter(|v| !v.is_empty())
    {
        Some(map) => map
            .iter()
            .take(24)
            .map(|(id, v)| (id.as_str(), v))
            .collect(),
        None => vec![("codex", &value["rateLimits"])],
    };
    for (id, bucket) in buckets {
        for part in ["primary", "secondary"] {
            let window = &bucket[part];
            let Some(percent) = window["usedPercent"]
                .as_f64()
                .filter(|v| v.is_finite() && *v >= 0.)
            else {
                continue;
            };
            let mins = window["windowDurationMins"].as_u64().filter(|v| *v > 0);
            let label = match mins {
                Some(300) => "5 jam".into(),
                Some(10080) => "Mingguan".into(),
                Some(m) if m % 1440 == 0 => format!("{} hari", m / 1440),
                Some(m) if m % 60 == 0 => format!("{} jam", m / 60),
                Some(m) => format!("{m} menit"),
                None => "Periode provider".into(),
            };
            usage.windows.push(UsageWindow {
                id: format!("{id}-{part}"),
                label,
                scope: bucket["limitName"]
                    .as_str()
                    .filter(|s| !s.is_empty())
                    .unwrap_or(id)
                    .chars()
                    .take(100)
                    .collect(),
                used_percent: percent,
                window_duration_mins: mins,
                resets_at: window["resetsAt"].as_u64().filter(|v| *v > 0),
                remaining: None,
                limit: None,
                unit: None,
            });
        }
        if usage.plan_type.is_none() {
            usage.plan_type = bucket["planType"]
                .as_str()
                .map(|v| v.chars().take(40).collect());
        }
    }
    if !usage.windows.is_empty() {
        usage.status = "available".into();
        usage.source = "codex".into();
        usage.observed_at = Some(now());
        usage.message = None;
    }
    usage
}
fn account_claim(token: &str) -> Option<String> {
    let body = URL_SAFE_NO_PAD.decode(token.split('.').nth(1)?).ok()?;
    let claims: Value = serde_json::from_slice(&body).ok()?;
    // This claim selects the workspace for the already authenticated token. It is
    // not accepted from IPC, and is never used as proof of identity on its own.
    claims["https://api.openai.com/auth"]["chatgpt_account_id"]
        .as_str()
        .filter(|s| !s.is_empty() && s.len() <= 256 && !s.chars().any(char::is_control))
        .map(str::to_owned)
}
fn runtime() -> Option<PathBuf> {
    let mut candidates = vec![PathBuf::from(
        "/Applications/Codex.app/Contents/Resources/codex",
    )];
    if let Some(home) = std::env::var_os("HOME") {
        candidates.push(PathBuf::from(home).join(".local/bin/codex"));
    }
    if let Some(path) = std::env::var_os("PATH") {
        candidates.extend(std::env::split_paths(&path).map(|p| p.join("codex")));
    }
    candidates.into_iter().find(|p| p.is_file())
}
fn send(stdin: &mut impl Write, value: Value) -> Result<(), String> {
    writeln!(stdin, "{value}")
        .and_then(|_| stdin.flush())
        .map_err(|_| "Layanan usage berhenti sebelum pembacaan selesai.".into())
}
fn reply(
    rx: &mpsc::Receiver<Value>,
    id: u64,
    deadline: Instant,
    stdin: &mut impl Write,
) -> Result<Value, String> {
    loop {
        let remaining = deadline
            .checked_duration_since(Instant::now())
            .ok_or("Pembacaan usage melewati batas waktu.")?;
        let value = rx
            .recv_timeout(remaining)
            .map_err(|_| "Layanan usage tidak memberikan respons. Coba perbarui.".to_string())?;
        if value["id"].as_u64() == Some(id) && value.get("method").is_none() {
            return value.get("result").cloned().ok_or_else(|| "Akses limit akun belum tersedia melalui layanan resmi. Coba hubungkan ulang akun.".into());
        }
        if value.get("method").is_some() && value.get("id").is_some() {
            // This read-only client cannot answer auth-refresh or execute tools.
            send(
                stdin,
                json!({"id":value["id"],"error":{"code":-32601,"message":"Read-only usage client"}}),
            )?;
        }
    }
}
fn read_codex(executable: PathBuf, token: String, account_id: String) -> Result<Value, String> {
    let mut child = Command::new(executable)
        .args([
            "app-server",
            "-c",
            "cli_auth_credentials_store=\"ephemeral\"",
            "-c",
            "chatgpt_base_url=\"https://chatgpt.com/backend-api\"",
            "-c",
            "analytics.enabled=false",
        ])
        .current_dir(std::env::temp_dir())
        .env_remove("OPENAI_API_KEY")
        .env_remove("CODEX_API_KEY")
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::null())
        .spawn()
        .map_err(|_| "Runtime Codex belum dapat dibuka untuk membaca usage.".to_string())?;
    let stdout = child.stdout.take().unwrap();
    let mut stdin = child.stdin.take().unwrap();
    let (tx, rx) = mpsc::sync_channel(32);
    let reader = std::thread::spawn(move || {
        for line in BufReader::new(stdout.take(1_048_577)).split(b'\n') {
            let Ok(line) = line else {
                break;
            };
            if let Ok(value) = serde_json::from_slice::<Value>(&line) {
                if tx.send(value).is_err() {
                    break;
                }
            }
        }
    });
    let result = (|| {
        let deadline = Instant::now() + Duration::from_secs(20);
        send(
            &mut stdin,
            json!({"id":1,"method":"initialize","params":{"clientInfo":{"name":"forgekit_usage","version":"0.1.0"},"capabilities":{"experimentalApi":true}}}),
        )?;
        reply(&rx, 1, deadline, &mut stdin)?;
        send(&mut stdin, json!({"method":"initialized"}))?;
        send(
            &mut stdin,
            json!({"id":2,"method":"account/login/start","params":{"type":"chatgptAuthTokens","accessToken":token,"chatgptAccountId":account_id}}),
        )?;
        reply(&rx, 2, deadline, &mut stdin)?;
        send(
            &mut stdin,
            json!({"id":3,"method":"account/rateLimits/read"}),
        )?;
        reply(&rx, 3, deadline, &mut stdin)
    })();
    drop(stdin);
    let _ = child.kill();
    let _ = child.wait();
    drop(rx);
    let _ = reader.join();
    result
}
/// Saved profiles only. No URLs, account IDs or bearer tokens are supplied by IPC.
pub fn read(profile: &AiProviderProfile) -> Result<ProviderUsage, String> {
    ai::validate_profile(profile)?;
    if crate::auth::codex::is_codex(profile) {
        let usage = match crate::auth::codex::limits(&profile.key_reference) {
            Ok(value) => {
                let mut usage = parse_limits(profile, &value);
                usage.plan_type = value["planType"].as_str().map(str::to_owned).or(usage.plan_type);
                usage
            },
            Err(message) => unavailable(profile, &message),
        };
        if usage.status == "available" {
            if let Ok(mut cache) = HEADERS.lock() { cache.insert(key(profile), usage.clone()); }
            return Ok(usage);
        }
        return Ok(cached_after_failure(profile, usage));
    }
    if crate::auth::claude::is_claude_code(profile) {
        return Ok(read_claude_code(profile));
    }
    if profile.provider_type != "openai" {
        return Ok(unavailable(
            profile,
            "Provider ini belum menyediakan pembacaan kuota akun melalui koneksi yang digunakan.",
        ));
    }
    let raw = ai::optional_keychain_secret(&profile.key_reference)?;
    let oauth = raw
        .as_ref()
        .and_then(|v| serde_json::from_str::<Value>(v).ok())
        .is_some_and(|v| v["forgekit_oauth"] == true);
    if !oauth {
        return Ok(HEADERS.lock().ok().and_then(|cache| cache.get(&key(profile)).cloned()).unwrap_or_else(|| unavailable(profile,
            "Koneksi API tidak menyediakan kuota paket 5 jam/mingguan. Limit API ditampilkan setelah provider mengirimkannya pada respons.")));
    }
    let token = ai::get_keychain_secret(&profile.key_reference)?;
    let Some(account_id) = account_claim(&token) else {
        return Ok(unavailable(
            profile,
            "Koneksi Sign in with ChatGPT ini belum menyediakan pembacaan limit 5 jam/mingguan. Periksa ChatGPT → Pengaturan → Usage.",
        ));
    };
    let Some(executable) = runtime() else {
        return Ok(unavailable(
            profile,
            "Runtime Codex resmi diperlukan untuk membaca limit ChatGPT pada perangkat ini.",
        ));
    };
    match read_codex(executable, token, account_id) {
        Ok(value) => Ok(parse_limits(profile, &value)),
        Err(message) => Ok(unavailable(profile, &message)),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    fn profile() -> AiProviderProfile {
        AiProviderProfile {
            id: "account-a".into(),
            name: "A".into(),
            provider_type: "openai".into(),
            base_url: "https://api.openai.com/v1".into(),
            model: "test".into(),
            reasoning_effort: None,
            key_reference: "key-a".into(),
            is_default: true,
            created_at: "1".into(),
            updated_at: "1".into(),
        }
    }
    #[test]
    fn uses_multi_bucket_actual_duration_and_nulls_without_fabricating_zero() {
        let data = json!({"rateLimits":{"primary":{"usedPercent":99}},"rateLimitsByLimitId":{"codex":{"planType":"plus","primary":{"usedPercent":32,"windowDurationMins":300,"resetsAt":1793200000},"secondary":{"usedPercent":null,"windowDurationMins":10080}},"other":{"primary":{"usedPercent":105,"windowDurationMins":15},"secondary":{"usedPercent":8,"windowDurationMins":10080}}}});
        let u = parse_limits(&profile(), &data);
        assert_eq!(u.windows.len(), 3);
        assert_eq!(u.windows[0].label, "5 jam");
        assert_eq!(u.windows[1].label, "15 menit");
        assert_eq!(u.windows[1].used_percent, 105.);
        assert_eq!(u.windows[2].label, "Mingguan");
        assert_eq!(u.plan_type.as_deref(), Some("plus"));
        assert!(parse_limits(&profile(), &json!({})).observed_at.is_none());
    }
    #[test]
    fn accepts_real_zero_and_legacy_payload_but_rejects_bad_values() {
        let u = parse_limits(
            &profile(),
            &json!({"rateLimits":{"primary":{"usedPercent":0,"windowDurationMins":300},"secondary":{"usedPercent":-2}}}),
        );
        assert_eq!(u.status, "available");
        assert_eq!(u.windows.len(), 1);
        assert_eq!(u.windows[0].used_percent, 0.);
    }
    #[test]
    fn api_headers_are_account_scoped_and_not_plan_windows() {
        let a = profile();
        let mut b = a.clone();
        b.id = "account-b".into();
        observe_api_headers(
            &a,
            &HashMap::from([
                ("x-ratelimit-limit-tokens".into(), "100".into()),
                ("x-ratelimit-remaining-tokens".into(), "25".into()),
            ]),
        );
        let cache = HEADERS.lock().unwrap();
        let u = cache.get(&key(&a)).unwrap();
        assert_eq!(u.windows[0].used_percent, 75.);
        assert!(u.windows[0].window_duration_mins.is_none());
        assert!(!cache.contains_key(&key(&b)));
    }
    #[test]
    fn metadata_limits_do_not_claim_to_be_selected_model_limits() {
        let mut p = profile();
        p.id = "metadata-scope".into();
        observe_headers(&p, &HashMap::from([
            ("x-ratelimit-limit-requests".into(), "100".into()),
            ("x-ratelimit-remaining-requests".into(), "90".into()),
        ]), "Metadata API /models");
        let usage = cached(&p).unwrap();
        assert_eq!(usage.windows[0].scope, "Metadata API /models");
        assert_ne!(usage.windows[0].scope, p.model);
    }
    #[test]
    fn failed_refresh_preserves_observation_time_and_reports_actual_failure() {
        let mut p = profile();
        p.id = "failed-refresh".into();
        let mut previous = parse_limits(&p, &json!({"rateLimits":{"primary":{"usedPercent":85}}}));
        previous.observed_at = Some(1000);
        HEADERS.lock().unwrap().insert(key(&p), previous);
        let usage = cached_after_failure(&p, http_failure(&p, 401, "Akses usage ditolak"));
        assert_eq!(usage.observed_at, Some(1000));
        assert_eq!(usage.windows[0].used_percent, 85.);
        assert!(usage.message.unwrap().contains("HTTP 401"));
        p.id = "no-previous-observation".into();
        let usage = cached_after_failure(&p, http_failure(&p, 403, "Akses usage ditolak"));
        assert_eq!(usage.status, "unavailable");
        assert!(usage.windows.is_empty());
        assert!(usage.message.unwrap().contains("HTTP 403"));
    }
    #[test]
    fn account_selection_requires_token_workspace_claim() {
        let token = format!(
            "a.{}.c",
            URL_SAFE_NO_PAD.encode(
                serde_json::to_vec(
                    &json!({"https://api.openai.com/auth":{"chatgpt_account_id":"workspace-a"}})
                )
                .unwrap()
            )
        );
        assert_eq!(account_claim(&token).as_deref(), Some("workspace-a"));
        assert!(account_claim("sk-secret").is_none());
        let siwc = format!(
            "a.{}.c",
            URL_SAFE_NO_PAD.encode(
                serde_json::to_vec(&json!({
                    "sub": "user-is-not-a-workspace", "https://api.openai.com/auth": {
                        "per_user_salt": "opaque", "encrypted_auth_metadata": "opaque"
                    }
                }))
                .unwrap()
            )
        );
        assert!(account_claim(&siwc).is_none());
    }
    #[test]
    fn reset_headers_require_a_valid_provider_duration() {
        assert_eq!(reset_at("1m20s", 1000), Some(1080));
        assert_eq!(reset_at("250ms", 1000), Some(1001));
        assert_eq!(reset_at("2h3m4s", 1000), Some(8384));
        for invalid in ["", "1234", "-1s", "NaNs", "unknown", "400d"] {
            assert!(reset_at(invalid, 1000).is_none());
        }
    }
}

pub fn read_connection(
    profile: &AiProviderProfile,
    connection: &ConnectionProfile,
    router: &RouterConnection,
) -> Result<ProviderUsage, String> {
    if profile.provider_type != "9router" {
        return read(profile);
    }
    let deadline = Instant::now() + Duration::from_secs(20);
    crate::connections::validate_router(router)?;
    let base = router
        .dashboard_url
        .as_deref()
        .unwrap_or(&router.base_url)
        .trim_end_matches('/')
        .trim_end_matches("/v1");
    // Inference keys do not grant dashboard access. Do not send them to a
    // management endpoint or borrow a browser's dashboard session.
    let accounts = match http::get(&format!("{base}/api/providers"), &[]) {
        Ok(r) if r.status == 200 => r.value,
        Ok(r) => return Ok(http_failure(profile, r.status, "9router belum memberi akses baca akun/usage melalui API dashboard; periksa akses dashboard 9router")),
        Err(message) => return Ok(unavailable(profile, &message)),
    };
    let selected = accounts["connections"]
        .as_array()
        .map(|items| {
            items
                .iter()
                .filter(|item| {
                    item["provider"] == "antigravity"
                        && item["isActive"] != false
                        && item["enabled"] != false
                        && connection
                            .upstream_connection_ref
                            .as_deref()
                            .is_none_or(|id| item["id"].as_str() == Some(id))
                })
                .take(64)
                .collect::<Vec<_>>()
        })
        .unwrap_or_default();
    if selected.is_empty() {
        return Ok(unavailable(
            profile,
            "Tidak ada akun Antigravity aktif yang dapat dibaca dari 9router.",
        ));
    }
    let mut merged = unavailable(profile, "9router belum mengembalikan kuota akun upstream.");
    let mut failed = 0;
    for (index, chunk) in selected.chunks(4).enumerate() {
        if Instant::now() >= deadline {
            failed += selected.len() - index * 4;
            break;
        }
        let results = std::thread::scope(|scope| {
            let jobs = chunk
                .iter()
                .map(|account| {
                    scope.spawn(|| {
                        let id = account["id"].as_str()?;
                        if id.is_empty()
                            || id.len() > 128
                            || !id
                                .chars()
                                .all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_')
                        {
                            return None;
                        }
                        let label = account["email"]
                            .as_str()
                            .or_else(|| account["name"].as_str())
                            .unwrap_or(id);
                        let response = http::get(&format!("{base}/api/usage/{id}"), &[]).ok()?;
                        (response.status == 200)
                            .then(|| parse_router(profile, &response.value, label))
                    })
                })
                .collect::<Vec<_>>();
            jobs.into_iter()
                .map(|job| job.join().ok().flatten())
                .collect::<Vec<_>>()
        });
        for usage in results {
            match usage {
                Some(mut u) if !u.windows.is_empty() => {
                    // A pool can contain different plans. Label each account;
                    // never present the first account's plan as the pool plan.
                    if let Some(plan) = &u.plan_type {
                        for window in &mut u.windows {
                            window.scope = format!("{} · {plan}", window.scope);
                        }
                    }
                    merged.windows.extend(u.windows);
                }
                _ => failed += 1,
            }
        }
    }
    merged.windows.truncate(48);
    merged = available(merged, "router_api");
    if merged.status == "available" {
        merged.message = Some(format!("Kuota akun upstream dibaca dari 9router. {failed} akun belum mengembalikan data. Maksimum 48 periode ditampilkan; rotasi akun tetap dikelola router."));
    }
    Ok(merged)
}

fn cached_after_failure(profile: &AiProviderProfile, failure: ProviderUsage) -> ProviderUsage {
    match cached(profile) {
        Some(mut usage) => {
            usage.message = Some(format!(
                "Menampilkan pembacaan terakhir; pembaruan terbaru gagal. {}",
                failure
                    .message
                    .as_deref()
                    .unwrap_or("Provider belum memberikan data terbaru.")
            ));
            usage
        }
        None => failure,
    }
}

pub fn observe_event(profile: &AiProviderProfile, payload: &str) {
    let Ok(event) = serde_json::from_str::<Value>(payload) else {
        return;
    };
    if event["type"] != "codex.rate_limits" {
        return;
    }
    let window = |part: &str| {
        let w = &event["rate_limits"][part];
        json!({"usedPercent":w["used_percent"],"windowDurationMins":w["window_minutes"],"resetsAt":w["reset_at"]})
    };
    let mut usage = parse_limits(
        profile,
        &json!({"rateLimits":{"planType":event["plan_type"],
        "limitName":event["metered_limit_name"],"primary":window("primary"),"secondary":window("secondary")}}),
    );
    if usage.status == "available" {
        usage.source = "api_headers".into();
        usage.message = Some("Limit dikirim provider pada respons tugas terakhir.".into());
        if let Ok(mut cache) = HEADERS.lock() {
            cache.insert(key(profile), usage);
        }
    }
}

/// Plan usage straight from Claude Code's `/usage` (no model request); reused for a minute so
/// several panels opening together do not start several CLI processes.
fn read_claude_code(profile: &AiProviderProfile) -> ProviderUsage {
    if let Some(usage) = HEADERS.lock().ok().and_then(|c| c.get(&key(profile)).cloned())
        .filter(|u| u.status == "available" && u.observed_at.is_some_and(|at| now().saturating_sub(at) < 60)) {
        return usage;
    }
    match crate::auth::claude::usage(&profile.key_reference) {
        Ok((windows, plan)) => {
            let mut usage = unavailable(profile, "");
            usage.windows = windows.into_iter().map(|w| UsageWindow {
                id: w.id, label: w.label, scope: w.scope, used_percent: w.used_percent,
                window_duration_mins: Some(w.window_minutes), resets_at: w.resets_at,
                remaining: None, limit: None, unit: None,
            }).collect();
            let mut usage = available(usage, "claude_code");
            usage.plan_type = plan;
            if let Ok(mut cache) = HEADERS.lock() { cache.insert(key(profile), usage.clone()); }
            usage
        }
        Err(message) => cached_after_failure(profile, unavailable(profile, &message)),
    }
}

/// Claude Code also reports the 5-hour and weekly windows (Anthropic's unified rate-limit headers,
/// utilization 0..1) on every turn; they refresh the matching windows read from `/usage`.
pub fn observe_claude_code(profile: &AiProviderProfile, info: &Value) {
    let mut usage = cached(profile).filter(|u| u.source == "claude_code").unwrap_or_else(|| unavailable(profile, ""));
    for (part, id, label, minutes) in [("five_hour", "claude:session", "5 jam", 300_u64), ("seven_day", "claude:week", "Mingguan", 10_080)] {
        let w = &info["unifiedWindows"][part];
        let Some(utilization) = w["utilization"].as_f64().filter(|v| v.is_finite() && *v >= 0.) else { continue };
        let rejected = w["status"] == "rejected" || (info["status"] == "rejected" && info["rateLimitType"] == part);
        let window = UsageWindow {
            id: id.into(), label: label.into(), scope: "claude".into(),
            used_percent: if rejected { 100. } else { (utilization * 100.).clamp(0., 100.) },
            window_duration_mins: Some(minutes),
            resets_at: w["resetsAt"].as_u64().filter(|v| *v > 0 && *v <= 8_640_000_000_000),
            remaining: None, limit: None, unit: None,
        };
        match usage.windows.iter_mut().find(|existing| existing.id == id) {
            Some(existing) => *existing = window,
            None => usage.windows.push(window),
        }
    }
    let plan = usage.plan_type.clone();
    let mut usage = available(usage, "claude_code");
    if usage.status == "available" {
        usage.plan_type = plan;
        if let Ok(mut cache) = HEADERS.lock() { cache.insert(key(profile), usage); }
    }
}

fn cached(profile: &AiProviderProfile) -> Option<ProviderUsage> {
    HEADERS
        .lock()
        .ok()?
        .get(&key(profile))
        .cloned()
        .map(|mut u| {
            u.checked_at = now();
            u
        })
}

fn http_failure(profile: &AiProviderProfile, status: u16, detail: &str) -> ProviderUsage {
    unavailable(profile, &format!("{detail} (HTTP {status})."))
}
fn available(mut usage: ProviderUsage, source: &str) -> ProviderUsage {
    if !usage.windows.is_empty() {
        usage.status = "available".into();
        usage.source = source.into();
        usage.observed_at = Some(now());
        usage.message = None;
    }
    usage
}

fn parse_router(profile: &AiProviderProfile, value: &Value, account: &str) -> ProviderUsage {
    let mut usage = unavailable(profile, "9router belum mengembalikan kuota akun upstream.");
    usage.plan_type = value["plan"].as_str().filter(|s| *s != "unknown").map(|s| s.chars().take(40).collect());
    if let Some(quotas) = value["quotas"].as_object() {
        for (id, quota) in quotas.iter().take(48) {
            if quota["unlimited"] == true { continue; }
            let total = quota["total"].as_f64().filter(|v| v.is_finite() && *v > 0.);
            let remaining = quota["remaining"].as_f64().filter(|v| v.is_finite() && *v >= 0.);
            let used = quota["remainingPercentage"].as_f64().filter(|v| v.is_finite() && (0. ..=100.).contains(v)).map(|v| 100. - v)
                .or_else(|| total.zip(remaining).filter(|(t,r)| r <= t).map(|(t,r)| 100. * (t-r) / t));
            if let Some(used_percent) = used {
                usage.windows.push(UsageWindow { id: format!("{account}:{id}"), label: id.chars().take(120).collect(), scope: account.chars().take(256).collect(), used_percent,
                    window_duration_mins: quota["windowDurationMins"].as_u64().filter(|v| *v > 0),
                    resets_at: quota["resetAt"].as_u64().filter(|v| *v > 0 && *v <= 8_640_000_000_000),
                    remaining: quota["remaining"].as_u64(), limit: quota["total"].as_u64().filter(|v| *v > 0), unit: None });
            }
        }
    }
    available(usage, "router_api")
}

/// Keep quota telemetry bounded; never retain arbitrary response headers.
pub fn is_quota_header(name: &str) -> bool {
    name.len() < 100 && (name.starts_with("x-ratelimit-")
        || name.starts_with("anthropic-ratelimit-")
        || name.starts_with("x-") && ["-used-percent", "-window-minutes", "-reset-at", "-limit-name"]
            .iter().any(|suffix| name.ends_with(suffix)))
}

/// Skip recently observed, exhausted capacity; unknown/stale limits are tested by inference.
pub fn blocked_until_ms(profile: &AiProviderProfile) -> u64 {
    cached(profile).map_or(0, |usage| exhausted_until(&usage, &profile.model, now()))
}
fn exhausted_until(usage: &ProviderUsage, model: &str, current: u64) -> u64 {
    if usage.status != "available" || usage.observed_at.is_none_or(|at| current.saturating_sub(at) > 90) { return 0; }
    usage.windows.iter().filter(|w| {
        (w.scope == model || (usage.source == "codex" && w.scope == "codex") || (usage.source == "claude_code" && w.scope == "claude"))
            && w.used_percent >= 100. && w.resets_at.is_some_and(|at| at > current)
    }).filter_map(|w| w.resets_at).max().unwrap_or(0).saturating_mul(1000)
}
#[cfg(test)]
mod exhaustion_tests {
    use super::*;
    #[test]
    fn exhausted_limits_are_fresh_model_scoped_and_reset_aware() {
        let mut usage = ProviderUsage { profile_id:"a".into(),status:"available".into(),source:"api_headers".into(),observed_at:Some(100),checked_at:100,plan_type:None,message:None,windows:vec![UsageWindow {id:"a".into(),label:"limit".into(),scope:"model-a".into(),used_percent:100.,window_duration_mins:None,resets_at:Some(500),remaining:Some(0),limit:Some(1),unit:None}] };
        assert_eq!(exhausted_until(&usage,"model-a",110),500000);
        assert_eq!(exhausted_until(&usage,"model-b",110),0);
        assert_eq!(exhausted_until(&usage,"model-a",200),0);
        usage.observed_at=Some(500);
        assert_eq!(exhausted_until(&usage,"model-a",500),0);
    }
}
