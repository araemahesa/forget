use crate::ai::{self, AiProviderProfile, ConnectionProfile, RouterConnection};
use rusqlite::{params, Connection};
use serde::Serialize;
use serde_json::Value;
use std::io::{Read, Write};
use std::process::{Command, Stdio};

pub fn validate_url(value: &str) -> Result<url::Url, String> {
    let url = url::Url::parse(value).map_err(|_| "URL koneksi tidak sah.")?;
    let local = matches!(url.host_str(), Some("localhost" | "127.0.0.1" | "[::1]"));
    if value.len() > 2048
        || url.host_str().is_none()
        || !url.username().is_empty()
        || url.password().is_some()
        || url.query().is_some()
        || url.fragment().is_some()
        || !(url.scheme() == "https" || url.scheme() == "http" && local)
    {
        return Err("URL wajib HTTPS atau HTTP loopback, tanpa credential/query/fragment.".into());
    }
    Ok(url)
}

pub fn validate_router(router: &RouterConnection) -> Result<(), String> {
    validate_url(&router.base_url)?;
    if let Some(url) = &router.dashboard_url {
        validate_url(url)?;
    }
    if router.id != "default-9router"
        || router.kind != "9router"
        || router.routing_owner != "router"
        || router.inference_credential_ref != "9router-inference-key"
        || router.management_credential_ref.is_some()
    {
        return Err("Build ini memakai satu gateway 9router dengan routing milik router; management credential dan account pinning belum tersedia.".into());
    }
    Ok(())
}

pub fn validate_destination(
    old: &ConnectionProfile,
    updated: &ConnectionProfile,
) -> Result<(), String> {
    if old.provider_id != updated.provider_id
        || old.connection_mode != updated.connection_mode
        || (old.connection_mode == "direct"
            && validate_url(&old.base_url)?.origin() != validate_url(&updated.base_url)?.origin())
    {
        return Err("Provider atau tujuan credential berubah. Tambah koneksi baru dengan credential tersendiri.".into());
    }
    Ok(())
}

pub fn validate_retained_credential(old_url: &str, new_url: &str) -> Result<(), String> {
    if validate_url(old_url)?.origin() != validate_url(new_url)?.origin() {
        return Err("Tujuan gateway berubah. Masukkan credential gateway tujuan; kunci lama tidak diteruskan ke server lain.".into());
    }
    Ok(())
}

pub fn inference_base(router: &RouterConnection) -> String {
    let base = router.base_url.trim_end_matches('/');
    if base.ends_with("/v1") {
        base.into()
    } else {
        format!("{base}/v1")
    }
}

pub fn legacy(
    profile: &ConnectionProfile,
    router: Option<&RouterConnection>,
) -> Result<AiProviderProfile, String> {
    let (adapter, base, key) = if profile.connection_mode == "router" {
        let router = router.ok_or("Gateway 9router belum dikaitkan.")?;
        validate_router(router)?;
        if profile.router_instance_id.as_deref() != Some(router.id.as_str())
            || profile.provider_id != "antigravity-9router"
            || !profile.model.starts_with("ag/")
            || profile.credential_ref.is_some()
        {
            return Err("Antigravity memerlukan route ag/ pada gateway; pemilihan akun upstream dikelola 9router.".into());
        }
        (
            "9router",
            inference_base(router),
            router.inference_credential_ref.clone(),
        )
    } else {
        let adapter = match profile.provider_id.as_str() {
            "openai" => "openai",
            "claude" | "anthropic" => "anthropic",
            "google-gemini" | "gemini" => "gemini",
            "openai-compatible" => "openai-compatible",
            "local-llm" => "local-llm",
            _ => return Err("Adapter koneksi belum tersedia.".into()),
        };
        (
            adapter,
            profile.base_url.clone(),
            profile
                .credential_ref
                .clone()
                .ok_or("Referensi credential hilang.")?,
        )
    };
    let legacy = AiProviderProfile {
        id: profile.id.clone(),
        name: profile.label.clone(),
        provider_type: adapter.into(),
        base_url: base,
        model: profile.model.clone(),
        reasoning_effort: None,
        key_reference: key,
        is_default: profile.is_default,
        created_at: profile.created_at.clone(),
        updated_at: profile.updated_at.clone(),
    };
    ai::validate_profile(&legacy)?;
    Ok(legacy)
}

fn read_json(endpoint: &str, key: Option<&str>, anthropic: bool) -> Result<Value, String> {
    read_json_with_project(endpoint, key, anthropic, None)
}
pub(crate) fn read_json_with_project(
    endpoint: &str,
    key: Option<&str>,
    anthropic: bool,
    project: Option<&str>,
) -> Result<Value, String> {
    // Query parameters are built internally for pagination; validate the credential destination.
    let mut destination = url::Url::parse(endpoint).map_err(|_| "URL katalog tidak sah.")?;
    destination.set_query(None);
    validate_url(destination.as_str())?;
    let mut config = format!("url = {}\n", ai::curl_quote(endpoint));
    if let Some(project) = project {
        config.push_str(&format!(
            "header = {}\n",
            ai::curl_quote(&format!("x-goog-user-project: {project}"))
        ));
    }
    if let Some(key) = key.filter(|key| !key.is_empty()) {
        let header = if anthropic {
            format!("x-api-key: {key}")
        } else {
            format!("Authorization: Bearer {key}")
        };
        config.push_str(&format!("header = {}\n", ai::curl_quote(&header)));
    }
    if anthropic {
        config.push_str("header = \"anthropic-version: 2023-06-01\"\n");
    }
    let mut child = Command::new("/usr/bin/curl")
        .args([
            "-q",
            "--silent",
            "--connect-timeout",
            "5",
            "--max-time",
            "15",
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
        .map_err(|_| "Transport katalog gagal dimulai.")?;
    let result = (|| {
        child
            .stdin
            .take()
            .ok_or("Input transport tidak tersedia.")?
            .write_all(config.as_bytes())
            .map_err(|_| "Transport katalog menutup input.")?;
        let mut bytes = Vec::new();
        child
            .stdout
            .take()
            .ok_or("Output transport tidak tersedia.")?
            .take(1024 * 1024 + 1)
            .read_to_end(&mut bytes)
            .map_err(|_| "Katalog terputus.")?;
        Ok::<_, String>(bytes)
    })();
    let bytes = match result {
        Ok(bytes) => bytes,
        Err(error) => {
            let _ = child.kill();
            let _ = child.wait();
            return Err(error);
        }
    };
    if bytes.len() > 1024 * 1024 {
        let _ = child.kill();
        let _ = child.wait();
        return Err("Katalog melebihi 1 MiB.".into());
    }
    let status = child.wait().map_err(|_| "Status katalog tidak tersedia.")?;
    let text = String::from_utf8(bytes).map_err(|_| "Katalog bukan UTF-8.")?;
    let (body, code) = text
        .rsplit_once("\nforgekit-http-status:")
        .ok_or("Respons katalog tidak lengkap.")?;
    if !status.success() || code.trim() != "200" {
        return Err(match code.trim() {
            "401" | "403" => {
                "Credential gateway/katalog ditolak. Akun upstream belum dapat dinilai."
            }
            "404" => "API katalog tidak tersedia pada versi/URL ini.",
            _ => "Gateway/katalog tidak terhubung atau merespons error.",
        }
        .into());
    }
    serde_json::from_str(body).map_err(|_| "Katalog bukan JSON yang sesuai.".into())
}

pub(crate) fn model_ids(value: &Value) -> Result<Vec<String>, String> {
    // ChatGPT OAuth returns models/slug/visibility; Platform API returns data/id.
    let chatgpt = value.get("models").is_some();
    let data = value[if chatgpt { "models" } else { "data" }]
        .as_array()
        .ok_or("Format katalog berubah: data model tidak tersedia.")?;
    if data.len() > 10000 {
        return Err("Katalog terlalu besar.".into());
    }
    let mut ids = Vec::new();
    for model in data {
        if chatgpt && model["visibility"].as_str() != Some("list") {
            continue;
        }
        let id = model[if chatgpt { "slug" } else { "id" }]
            .as_str()
            .ok_or("Katalog memuat model tanpa ID.")?;
        if id.is_empty() || id.len() > 200 || id.chars().any(char::is_control) {
            return Err("ID model katalog tidak sah.".into());
        }
        ids.push(id.to_owned());
    }
    ids.sort();
    ids.dedup();
    Ok(ids)
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RouterProbe {
    pub models: Vec<String>,
    pub detected_version: Option<String>,
    pub management_access: &'static str,
    pub upstream_state: &'static str,
    pub message: &'static str,
}

pub fn probe_router(router: &RouterConnection) -> Result<RouterProbe, String> {
    validate_router(router)?;
    let key = ai::optional_keychain_secret(&router.inference_credential_ref)?;
    let base = inference_base(router);
    let models = model_ids(&read_json(
        &format!("{base}/models"),
        key.as_deref(),
        false,
    )?)?;
    let root = base.trim_end_matches("/v1");
    // No inference credential is sent to the separate dashboard/version API.
    let version = read_json(&format!("{root}/api/version"), None, false)
        .ok()
        .and_then(|v| v["currentVersion"].as_str().map(str::to_owned))
        .filter(|v| v.len() <= 64 && v.chars().all(|c| c.is_ascii_digit() || ".-".contains(c)));
    Ok(RouterProbe {
        models, detected_version: version, management_access: "unknown", upstream_state: "unknown",
        message: "Router terhubung. Katalog bukan bukti login atau inference. Akun upstream dikelola 9router; status login belum teramati.",
    })
}

pub fn models(profile: &AiProviderProfile) -> Result<Vec<String>, String> {
    ai::validate_profile(profile)?;
    if crate::auth::codex::is_codex(profile) {
        return crate::auth::codex::models(&profile.key_reference)
            .map(|rows| rows.into_iter().map(|row| row.id).collect());
    }
    let key = ai::optional_keychain_secret(&profile.key_reference)?
        .map(|_| ai::get_keychain_secret(&profile.key_reference))
        .transpose()?;
    let project = if profile.provider_type == "gemini" {
        crate::auth::google::quota_project(&profile.key_reference)?
    } else {
        None
    };
    model_ids(&read_json_with_project(
        &format!("{}/models", profile.base_url.trim_end_matches('/')),
        key.as_deref(),
        profile.provider_type == "anthropic",
        project.as_deref(),
    )?)
}

pub fn verify(
    conn: &Connection,
    profile: &ConnectionProfile,
    ok: bool,
) -> Result<(), crate::storage::StorageError> {
    let tx = conn.unchecked_transaction()?;
    tx.execute(
        "INSERT INTO connection_verification(profile_id,model,base_url,checked_at,text_streaming)
         VALUES(?1,?2,?3,?4,?5) ON CONFLICT(profile_id) DO UPDATE SET
         model=excluded.model,base_url=excluded.base_url,checked_at=excluded.checked_at,
         text_streaming=excluded.text_streaming,tools=0",
        params![
            profile.id,
            profile.model,
            profile.base_url,
            crate::storage::now_string(),
            ok
        ],
    )?;
    tx.execute("UPDATE connection_profile SET access_state=?2,fallback_eligible=?3 WHERE id=?1 AND model=?4 AND base_url=?5",
        params![profile.id, if ok { "ready" } else { "pending" },
            if ok && profile.connection_mode == "direct" { "supported" } else { "unknown" },
            profile.model, profile.base_url])?;
    tx.commit()?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn official_providers_cannot_be_converted_to_router_connections() {
        let router: RouterConnection = serde_json::from_value(serde_json::json!({
            "id":"default-9router", "kind":"9router", "baseUrl":"http://127.0.0.1:20128",
            "inferenceCredentialRef":"9router-inference-key", "managementAccess":"unknown", "routingOwner":"router"
        })).unwrap();
        let mut profile: ConnectionProfile = serde_json::from_value(serde_json::json!({
            "id":"fixture", "providerId":"antigravity-9router", "connectionMode":"router",
            "credentialOwner":"router", "routerInstanceId":"default-9router", "authMethod":"router",
            "label":"Fixture", "accessState":"pending", "enabled":true, "fallbackEligible":"unknown",
            "priority":0, "quotaBucketRefs":[], "baseUrl":"http://127.0.0.1:20128/v1",
            "model":"ag/fixture", "isDefault":false, "createdAt":"1", "updatedAt":"1"
        })).unwrap();
        assert!(legacy(&profile, Some(&router)).is_ok());
        for provider in ["openai", "claude", "google-gemini"] {
            profile.provider_id = provider.into();
            assert!(legacy(&profile, Some(&router)).is_err(), "{provider}");
        }
    }
    #[test]
    fn chatgpt_and_platform_catalogs_use_distinct_shapes() {
        assert_eq!(model_ids(&serde_json::json!({"models":[{"slug":"gpt-fixture","visibility":"list"},{"slug":"hidden","visibility":"hide"}]})).unwrap(), vec!["gpt-fixture"]);
        assert_eq!(
            model_ids(&serde_json::json!({"data":[{"id":"api-fixture"}]})).unwrap(),
            vec!["api-fixture"]
        );
        assert!(model_ids(&serde_json::json!({"models":[{"visibility":"list"}]})).is_err());
    }
    #[test]
    fn catalog_transport_rejects_html_redirects_and_denied_access() {
        use std::net::TcpListener;
        for (code, body) in [
            ("200 OK", "<html>Login</html>"),
            (
                "401 Unauthorized",
                r#"{"error":"fixture credential must not be echoed"}"#,
            ),
            ("302 Found", "{}"),
            ("200 OK", r#"{"data":[{"id":"ag/fixture"}]}"#),
        ] {
            let listener = TcpListener::bind("127.0.0.1:0").unwrap();
            let url = format!("http://{}/v1/models", listener.local_addr().unwrap());
            let server = std::thread::spawn(move || {
                let (mut socket, _) = listener.accept().unwrap();
                socket
                    .set_read_timeout(Some(std::time::Duration::from_secs(5)))
                    .unwrap();
                let mut request = [0; 4096];
                assert!(socket.read(&mut request).unwrap() > 0);
                write!(
                    socket,
                    "HTTP/1.1 {code}\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{body}",
                    body.len()
                )
                .unwrap();
            });
            let response = read_json(&url, None, false).and_then(|v| model_ids(&v));
            server.join().unwrap();
            if body.contains("ag/fixture") {
                assert_eq!(response.unwrap(), ["ag/fixture"]);
            } else {
                let error = response.unwrap_err();
                assert!(!error.contains("fixture credential"));
            }
        }
    }
    #[test]
    fn rejects_secret_urls_and_unproven_catalogs() {
        for value in [
            "http://remote.test",
            "https://user:pass@example.com",
            "https://x/?token=x",
            "file:///tmp/a",
        ] {
            assert!(validate_url(value).is_err(), "{value}");
        }
        assert!(validate_url("http://127.0.0.1:20128").is_ok());
        assert!(
            validate_retained_credential("https://router.test", "https://router.test/v1").is_ok()
        );
        assert!(validate_retained_credential("https://router.test", "https://other.test").is_err());
        assert!(
            validate_retained_credential("http://127.0.0.1:20128", "http://127.0.0.1:20129")
                .is_err()
        );
        assert!(model_ids(&serde_json::json!({"error":"denied"})).is_err());
        assert!(model_ids(&serde_json::json!({"data":[{"id":"bad\nid"}]})).is_err());
        assert_eq!(
            model_ids(&serde_json::json!({"data":[{"id":"ag/test"},{"id":"ag/test"}]})).unwrap(),
            ["ag/test"]
        );
    }
}
