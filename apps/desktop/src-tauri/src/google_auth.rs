//! Direct Google OAuth for a ForgeKit-owned registered Desktop client.
use crate::{ai, browser_auth as auth};
use base64::{engine::general_purpose::URL_SAFE_NO_PAD, Engine};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use std::{
    net::TcpListener,
    sync::{atomic::Ordering, Mutex},
    time::{SystemTime, UNIX_EPOCH},
};
const CONFIG: &str = "google-oauth-client";
const SCOPE: &str = "openid email https://www.googleapis.com/auth/cloud-platform https://www.googleapis.com/auth/generative-language.retriever";
static REFRESH: Mutex<()> = Mutex::new(());
#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct Config {
    client_id: String,
    client_secret: String,
    project_id: String,
}
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Status {
    pub configured: bool,
    pub client_id: Option<String>,
    pub project_id: Option<String>,
}
#[derive(Serialize, Deserialize)]
struct Credential {
    forgekit_google_oauth: bool,
    client_id: String,
    client_secret: String,
    project_id: String,
    access_token: String,
    refresh_token: Option<String>,
    expires_at: u64,
}
fn now() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs()
}
fn config() -> Result<Option<Config>, String> {
    ai::optional_keychain_secret(CONFIG)?
        .map(|s| serde_json::from_str(&s).map_err(|_| "Konfigurasi Google OAuth tidak sah.".into()))
        .transpose()
}
pub fn status() -> Result<Status, String> {
    Ok(match config()? {
        Some(c) => Status {
            configured: true,
            client_id: Some(c.client_id),
            project_id: Some(c.project_id),
        },
        None => Status {
            configured: false,
            client_id: None,
            project_id: None,
        },
    })
}
fn validate(c: &Config) -> Result<(), String> {
    if !c.client_id.ends_with(".apps.googleusercontent.com")
        || c.client_id.len() > 256
        || !c
            .client_id
            .bytes()
            .all(|b| b.is_ascii_alphanumeric() || b"-_.".contains(&b))
        || c.client_secret.is_empty()
        || c.client_secret.len() > 512
        || c.client_secret.chars().any(char::is_control)
        || !(6..=63).contains(&c.project_id.len())
        || !c
            .project_id
            .bytes()
            .all(|b| b.is_ascii_lowercase() || b.is_ascii_digit() || b == b'-')
    {
        return Err("Gunakan OAuth Client ID bertipe Desktop app, client secret, dan Project ID milik ForgeKit dari Google Cloud.".into());
    }
    Ok(())
}
pub fn configure(
    client_id: String,
    client_secret: String,
    project_id: String,
) -> Result<Status, String> {
    let c = Config {
        client_id,
        client_secret,
        project_id,
    };
    validate(&c)?;
    ai::set_keychain_secret(
        CONFIG,
        &serde_json::to_string(&c).map_err(|_| "Konfigurasi tidak dapat disimpan.")?,
    )?;
    status()
}
fn token(data: &Value, c: &Config, previous: Option<&Credential>) -> Result<Credential, String> {
    let access = data["access_token"]
        .as_str()
        .filter(|s| !s.is_empty())
        .ok_or("Google tidak memberikan token akses.")?;
    if !data["token_type"]
        .as_str()
        .is_some_and(|t| t.eq_ignore_ascii_case("bearer"))
    {
        return Err("Token Google tidak sah.".into());
    }
    if previous.is_none()
        && !data["scope"].as_str().is_some_and(|s| {
            s.split_whitespace()
                .any(|s| s == "https://www.googleapis.com/auth/cloud-platform")
        })
    {
        return Err("Izin akses Gemini belum diberikan.".into());
    }
    let expires = data["expires_in"]
        .as_u64()
        .filter(|n| *n > 0)
        .ok_or("Masa berlaku Google tidak sah.")?;
    Ok(Credential {
        forgekit_google_oauth: true,
        client_id: c.client_id.clone(),
        client_secret: c.client_secret.clone(),
        project_id: c.project_id.clone(),
        access_token: access.into(),
        refresh_token: data["refresh_token"]
            .as_str()
            .map(str::to_owned)
            .or_else(|| previous.and_then(|p| p.refresh_token.clone())),
        expires_at: now().saturating_add(expires),
    })
}
pub fn access_token(key: &str, raw: &str) -> Result<String, String> {
    let _guard = REFRESH.lock().map_err(|_| "Sesi Google sedang dipakai.")?;
    let latest = ai::optional_keychain_secret(key)?.unwrap_or_else(|| raw.into());
    let credential: Credential =
        serde_json::from_str(&latest).map_err(|_| "Credential Google tidak sah.")?;
    if !credential.forgekit_google_oauth {
        return Err("Credential Google tidak dikenal.".into());
    }
    if credential.expires_at > now() + 60 {
        return Ok(credential.access_token);
    }
    let refresh = credential
        .refresh_token
        .as_deref()
        .ok_or("Sesi Google berakhir. Hubungkan ulang.")?;
    let c = Config {
        client_id: credential.client_id.clone(),
        client_secret: credential.client_secret.clone(),
        project_id: credential.project_id.clone(),
    };
    let response = auth::response(
        auth::client()?
            .post("https://oauth2.googleapis.com/token")
            .form(&[
                ("grant_type", "refresh_token"),
                ("client_id", c.client_id.as_str()),
                ("client_secret", c.client_secret.as_str()),
                ("refresh_token", refresh),
            ])
            .send()
            .map_err(|_| "Sesi Google belum dapat diperbarui.")?,
    )?;
    let updated = token(&response, &c, Some(&credential))?;
    ai::set_keychain_secret(
        key,
        &serde_json::to_string(&updated).map_err(|_| "Sesi Google tidak dapat disimpan.")?,
    )?;
    Ok(updated.access_token)
}
pub fn quota_project(key: &str) -> Result<Option<String>, String> {
    let Some(raw) = ai::optional_keychain_secret(key)? else {
        return Ok(None);
    };
    let Ok(c) = serde_json::from_str::<Credential>(&raw) else {
        return Ok(None);
    };
    if !c.forgekit_google_oauth
        || c.project_id.is_empty()
        || !c
            .project_id
            .bytes()
            .all(|b| b.is_ascii_lowercase() || b.is_ascii_digit() || b == b'-')
    {
        return Err("Project quota Google tidak sah.".into());
    }
    Ok(Some(c.project_id))
}
pub fn sign_in(id: &str) -> Result<ai::ConnectionProfile, String> {
    let c = config()?.ok_or("Google OAuth belum dikonfigurasi. Daftarkan OAuth Desktop client ForgeKit dan aktifkan Generative Language API pada Google Cloud.")?;
    validate(&c)?;
    auth::with_login(id, |cancelled| {
        let state = auth::random()?;
        let verifier = auth::random()?;
        let challenge = URL_SAFE_NO_PAD.encode(Sha256::digest(verifier.as_bytes()));
        let listener =
            TcpListener::bind("127.0.0.1:0").map_err(|_| "Callback Google tidak tersedia.")?;
        let redirect = format!(
            "http://127.0.0.1:{}/auth/callback",
            listener
                .local_addr()
                .map_err(|_| "Port Google tidak tersedia.")?
                .port()
        );
        let mut url = url::Url::parse("https://accounts.google.com/o/oauth2/v2/auth")
            .map_err(|_| "URL Google tidak sah.")?;
        url.query_pairs_mut().extend_pairs([
            ("client_id", c.client_id.as_str()),
            ("redirect_uri", redirect.as_str()),
            ("response_type", "code"),
            ("scope", SCOPE),
            ("state", state.as_str()),
            ("code_challenge", challenge.as_str()),
            ("code_challenge_method", "S256"),
            ("access_type", "offline"),
            ("prompt", "consent select_account"),
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
        let code = auth::wait_for_callback(listener, cancelled, |req, port| {
            auth::code_callback(req, port, &state, None)
        })?;
        let client = auth::client()?;
        let data = auth::response(
            client
                .post("https://oauth2.googleapis.com/token")
                .form(&[
                    ("client_id", c.client_id.as_str()),
                    ("client_secret", c.client_secret.as_str()),
                    ("code", code.as_str()),
                    ("code_verifier", verifier.as_str()),
                    ("redirect_uri", redirect.as_str()),
                    ("grant_type", "authorization_code"),
                ])
                .send()
                .map_err(|_| "Kode login Google belum dapat ditukar.")?,
        )?;
        let stored = token(&data, &c, None)?;
        let user = auth::response(
            client
                .get("https://openidconnect.googleapis.com/v1/userinfo")
                .bearer_auth(&stored.access_token)
                .send()
                .map_err(|_| "Identitas Google belum dapat dibaca.")?,
        )?;
        let subject = user["sub"]
            .as_str()
            .filter(|s| !s.is_empty() && s.len() <= 256)
            .ok_or("Identitas Google tidak sah.")?;
        let models = auth::response(
            client
                .get("https://generativelanguage.googleapis.com/v1beta/models")
                .bearer_auth(&stored.access_token)
                .header("x-goog-user-project", &c.project_id)
                .send()
                .map_err(|_| {
                    "Model Gemini belum dapat dibaca. Periksa API dan izin project Google Cloud."
                })?,
        )?;
        let models = models["models"]
            .as_array()
            .ok_or("Katalog Gemini tidak tersedia.")?;
        let mut ids: Vec<_> = models
            .iter()
            .filter(|m| {
                m["supportedGenerationMethods"]
                    .as_array()
                    .is_some_and(|methods| methods.iter().any(|m| m == "generateContent"))
            })
            .filter_map(|m| m["name"].as_str()?.strip_prefix("models/"))
            .filter(|id| {
                id.starts_with("gemini-")
                    && id
                        .bytes()
                        .all(|b| b.is_ascii_alphanumeric() || b"-_.".contains(&b))
            })
            .collect();
        ids.sort_unstable();
        let model = ids
            .iter()
            .find(|id| id.contains("flash") && !id.contains("preview"))
            .or(ids.first())
            .ok_or("Akun Google belum memiliki model teks Gemini.")?;
        if cancelled.load(Ordering::SeqCst) {
            return Err("Login dibatalkan.".into());
        }
        let key = format!("google-oauth-{id}");
        let profile = serde_json::from_value(json!({"id":id,"providerId":"google-gemini","connectionMode":"direct","credentialOwner":"forgekit","authMethod":"oauth_browser","label":user["email"].as_str().unwrap_or("Google / Gemini"),"identity":{"issuer":"https://accounts.google.com","subject":subject,"email":user["email"],"name":user["name"]},"registrationRef":c.client_id,"credentialRef":key,"accessState":"pending","enabled":true,"fallbackEligible":"unknown","priority":0,"quotaBucketRefs":[format!("google-project:{}",c.project_id)],"baseUrl":"https://generativelanguage.googleapis.com/v1beta/openai","model":model,"isDefault":false,"createdAt":now().to_string(),"updatedAt":now().to_string()})).map_err(|_| "Profil Google tidak dapat dibuat.")?;
        ai::set_keychain_secret(
            &key,
            &serde_json::to_string(&stored)
                .map_err(|_| "Credential Google tidak dapat disimpan.")?,
        )?;
        Ok(profile)
    })
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn rejects_malformed_registration_and_ungranted_scope() {
        let mut c = Config {
            client_id: "123-forgekit.apps.googleusercontent.com".into(),
            client_secret: "desktop-config".into(),
            project_id: "forgekit-studio".into(),
        };
        assert!(validate(&c).is_ok());
        assert!(token(&json!({"access_token":"x","token_type":"bearer","expires_in":3600,"scope":"openid email"}),&c,None).is_err());
        c.client_id = "https://evil.test".into();
        assert!(validate(&c).is_err());
    }
}
