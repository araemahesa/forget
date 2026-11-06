//! Discord identity uses a registered public desktop client and PKCE. No client secret in the app.
use crate::{ai, auth::browser as auth};
use base64::{engine::general_purpose::URL_SAFE_NO_PAD, Engine};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use sha2::{Digest, Sha256};
use std::{net::TcpListener, sync::atomic::Ordering};
const REDIRECT: &str = "http://127.0.0.1:38473/auth/callback";
const ACCOUNT: &str = "discord-account-v1";
const CONFIG: &str = "discord-client-id";
#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Profile {
    pub id: String,
    pub username: String,
    pub display_name: String,
    pub avatar_url: Option<String>,
}
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Status {
    pub client_id: Option<String>,
    pub redirect_uri: &'static str,
    pub profile: Option<Profile>,
}
#[derive(Serialize, Deserialize)]
struct Account {
    profile: Profile,
    access_token: String,
    refresh_token: Option<String>,
}
fn valid_id(s: &str) -> bool {
    (17..=22).contains(&s.len()) && s.bytes().all(|b| b.is_ascii_digit())
}
fn client_id() -> Result<Option<String>, String> {
    let id = ai::optional_keychain_secret(CONFIG)?
        .or_else(|| option_env!("FORGEKIT_DISCORD_CLIENT_ID").map(str::to_owned));
    if id.as_deref().is_some_and(|id| !valid_id(id)) {
        return Err("Discord Application ID tidak sah.".into());
    }
    Ok(id)
}
pub fn status() -> Result<Status, String> {
    let account = ai::optional_keychain_secret(ACCOUNT)?
        .map(|s| {
            serde_json::from_str::<Account>(&s)
                .map_err(|_| "Profil Discord tersimpan tidak sah. Hubungkan ulang.")
        })
        .transpose()?;
    Ok(Status {
        client_id: client_id()?,
        redirect_uri: REDIRECT,
        profile: account.map(|a| a.profile),
    })
}
pub fn configure(id: &str) -> Result<Status, String> {
    if !valid_id(id) {
        return Err("Isi Application ID numerik dari Discord Developer Portal, bukan token atau client secret.".into());
    }
    if status()?.profile.is_some() {
        return Err("Keluar dari Discord sebelum mengganti konfigurasi aplikasi.".into());
    }
    ai::set_keychain_secret(CONFIG, id)?;
    status()
}
fn profile(data: &Value) -> Result<Profile, String> {
    let id = data["id"]
        .as_str()
        .filter(|s| valid_id(s))
        .ok_or("Identitas Discord tidak sah.")?;
    let username = data["username"]
        .as_str()
        .filter(|s| !s.is_empty() && s.len() <= 128 && !s.chars().any(char::is_control))
        .ok_or("Nama Discord tidak tersedia.")?;
    let name = data["global_name"]
        .as_str()
        .filter(|s| !s.is_empty() && s.len() <= 128 && !s.chars().any(char::is_control))
        .unwrap_or(username);
    let avatar = data["avatar"].as_str().filter(|s| {
        s.len() <= 128
            && !s.is_empty()
            && s.chars()
                .all(|c| c.is_ascii_hexdigit() || c == '_' || c == 'a')
    });
    let avatar_url = avatar
        .map(|hash| format!("https://cdn.discordapp.com/avatars/{id}/{hash}.png?size=128"))
        .or_else(|| {
            let index = data["discriminator"]
                .as_str()
                .and_then(|d| d.parse::<u64>().ok())
                .filter(|d| *d > 0)
                .map(|d| d % 5)
                .or_else(|| id.parse::<u64>().ok().map(|id| (id >> 22) % 6))?;
            Some(format!(
                "https://cdn.discordapp.com/embed/avatars/{index}.png"
            ))
        });
    Ok(Profile {
        id: id.into(),
        username: username.into(),
        display_name: name.into(),
        avatar_url,
    })
}
pub fn sign_in() -> Result<Status, String> {
    let client_id = client_id()?.ok_or("Login Discord memerlukan Application ID ForgeKit. Buka konfigurasi pengembang pada pengaturan Akun.")?;
    auth::with_login("discord-login", |cancelled| {
        let listener = TcpListener::bind("127.0.0.1:38473").map_err(|_| {
            "Port callback Discord 38473 sedang digunakan. Tutup sesi login lain dan coba lagi."
        })?;
        let state = auth::random()?;
        let verifier = auth::random()?;
        let challenge = URL_SAFE_NO_PAD.encode(Sha256::digest(verifier.as_bytes()));
        let mut url = url::Url::parse("https://discord.com/oauth2/authorize")
            .map_err(|_| "URL Discord tidak sah.")?;
        url.query_pairs_mut().extend_pairs([
            ("client_id", client_id.as_str()),
            ("response_type", "code"),
            ("redirect_uri", REDIRECT),
            ("scope", "identify"),
            ("state", state.as_str()),
            ("code_challenge", challenge.as_str()),
            ("code_challenge_method", "S256"),
            ("prompt", "consent"),
        ]);
        if !std::process::Command::new("/usr/bin/open")
            .arg(url.as_str())
            .status()
            .is_ok_and(|s| s.success())
        {
            return Err("Browser sistem tidak dapat dibuka.".into());
        }
        let code = auth::wait_for_callback(listener, cancelled, |req, port| {
            auth::code_callback(req, port, &state, Some("https://discord.com"))
        })?;
        let client = auth::client()?;
        let token = auth::response(
            client
                .post("https://discord.com/api/oauth2/token")
                .form(&[
                    ("client_id", client_id.as_str()),
                    ("grant_type", "authorization_code"),
                    ("code", code.as_str()),
                    ("redirect_uri", REDIRECT),
                    ("code_verifier", verifier.as_str()),
                ])
                .send()
                .map_err(|_| "Discord belum dapat dihubungi.")?,
        )?;
        let access = token["access_token"].as_str().filter(|s| !s.is_empty()).ok_or("Discord tidak memberikan token login. Pastikan aplikasi terdaftar sebagai public client yang mendukung PKCE.")?;
        if !token["token_type"]
            .as_str()
            .is_some_and(|s| s.eq_ignore_ascii_case("bearer"))
            || !token["scope"]
                .as_str()
                .is_some_and(|s| s.split_whitespace().any(|s| s == "identify"))
        {
            return Err("Izin profil Discord belum diberikan.".into());
        }
        let user = auth::response(
            client
                .get("https://discord.com/api/v10/users/@me")
                .bearer_auth(access)
                .send()
                .map_err(|_| "Profil Discord belum dapat dibaca.")?,
        )?;
        let profile = profile(&user)?;
        if cancelled.load(Ordering::SeqCst) {
            return Err("Login dibatalkan.".into());
        }
        let account = Account {
            profile,
            access_token: access.into(),
            refresh_token: token["refresh_token"].as_str().map(str::to_owned),
        };
        ai::set_keychain_secret(
            ACCOUNT,
            &serde_json::to_string(&account).map_err(|_| "Profil tidak dapat disimpan.")?,
        )?;
        status()
    })
}
pub fn sign_out() -> Result<Status, String> {
    // Local logout is deterministic, even offline. The user can revoke consent in Discord.
    auth::cancel("discord-login");
    ai::delete_keychain_secret(ACCOUNT)?;
    status()
}
#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;
    #[test]
    fn only_trusted_avatar_urls_and_public_identity() {
        let p = profile(&json!({"id":"123456789012345678","username":"ari","global_name":"Ari","avatar":"../../evil"})).unwrap();
        assert!(p
            .avatar_url
            .unwrap()
            .starts_with("https://cdn.discordapp.com/embed/avatars/"));
        assert!(profile(&json!({"id":"bad","username":"ari"})).is_err());
        let p = profile(&json!({"id":"123456789012345678","username":"ari","global_name":null,"avatar":"abc123"})).unwrap();
        let public = serde_json::to_string(&p).unwrap();
        assert!(public.contains("/avatars/123456789012345678/abc123.png"));
        assert!(!public.contains("token"));
        assert_eq!(p.display_name, "ari");
    }
}
