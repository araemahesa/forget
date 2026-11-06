//! Account-scoped discovery. The webview selects IDs, never credential destinations.
use crate::{
    ai::{self, AiProviderProfile},
    connections,
};
use serde::Serialize;
use serde_json::Value;
use std::{
    collections::{HashMap, HashSet},
    sync::{LazyLock, Mutex},
    time::{Duration, Instant},
};
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProviderModel {
    pub id: String,
    pub display_name: String,
    pub reasoning_efforts: Vec<String>,
    pub default_reasoning_effort: Option<String>,
    pub tool_calling: String,
}
type Cache = HashMap<String, (Instant, Vec<ProviderModel>)>;
static CACHE: LazyLock<Mutex<Cache>> = LazyLock::new(|| Mutex::new(HashMap::new()));
const EFFORTS: &[&str] = &[
    "none", "minimal", "low", "medium", "high", "xhigh", "max", "ultra",
];
pub fn valid_effort(value: &str) -> bool {
    EFFORTS.contains(&value)
}
fn valid_id(v: &str) -> bool {
    !v.is_empty() && v.len() <= 200 && !v.chars().any(char::is_control)
}
fn parse_models(value: &Value, adapter: &str) -> Result<Vec<ProviderModel>, String> {
    let chatgpt = value.get("models").is_some();
    let rows = value[if chatgpt { "models" } else { "data" }]
        .as_array()
        .ok_or("Format katalog model tidak dikenali.")?;
    if rows.len() > 10000 {
        return Err("Katalog terlalu besar.".into());
    }
    let mut result = Vec::new();
    for row in rows {
        if row["hidden"] == true || (chatgpt && row.get("visibility").is_some_and(|v| v != "list"))
        {
            continue;
        }
        let id = row[if chatgpt { "slug" } else { "id" }]
            .as_str()
            .ok_or("Model tanpa ID.")?;
        if !valid_id(id) {
            return Err("ID model tidak sah.".into());
        }
        let levels = row
            .get("supported_reasoning_levels")
            .or_else(|| row.get("supportedReasoningEfforts"))
            .or_else(|| row.get("supported_reasoning_efforts"));
        let mut efforts: Vec<String> = levels
            .and_then(Value::as_array)
            .map(|levels| {
                levels
                    .iter()
                    .filter_map(|v| {
                        v.as_str()
                            .or_else(|| v["effort"].as_str())
                            .or_else(|| v["reasoningEffort"].as_str())
                            .or_else(|| v["reasoning_effort"].as_str())
                    })
                    .filter(|v| valid_effort(v))
                    .map(str::to_owned)
                    .collect()
            })
            .unwrap_or_default();
        if let Some(capability) = row
            .pointer("/capabilities/effort")
            .and_then(Value::as_object)
        {
            efforts = EFFORTS
                .iter()
                .filter(|level| {
                    capability
                        .get(**level)
                        .is_some_and(|v| v == true || v["supported"] == true)
                })
                .map(|v| (*v).into())
                .collect();
        }
        if efforts.is_empty() && levels.is_none() && row.pointer("/capabilities/effort").is_none() {
            efforts = documented_efforts(adapter, id)
                .iter()
                .map(|v| (*v).into())
                .collect();
        }
        efforts.sort_by_key(|v| EFFORTS.iter().position(|e| e == v).unwrap_or(99));
        efforts.dedup();
        let default = row
            .get("default_reasoning_level")
            .or_else(|| row.get("defaultReasoningEffort"))
            .or_else(|| row.get("default_reasoning_effort"))
            .and_then(Value::as_str)
            .filter(|v| efforts.iter().any(|e| e == v))
            .map(str::to_owned);
        let name = row
            .get("display_name")
            .or_else(|| row.get("displayName"))
            .and_then(Value::as_str)
            .filter(|v| !v.is_empty() && v.len() <= 256 && !v.chars().any(char::is_control))
            .unwrap_or(id);
        result.push(ProviderModel {
            id: id.into(),
            display_name: name.into(),
            reasoning_efforts: efforts,
            default_reasoning_effort: default,
            tool_calling: tool_support(row),
        });
    }
    Ok(result)
}
fn documented_efforts(adapter: &str, id: &str) -> &'static [&'static str] {
    // Compatibility fallback for list APIs without capability fields. Unknown models stay Auto.
    match adapter {
        "openai"
            if id == "o3"
                || id.starts_with("o3-")
                || id == "o4-mini"
                || id.starts_with("o4-mini-") =>
        {
            &["low", "medium", "high"]
        }
        "openai"
            if id == "gpt-5"
                || id.starts_with("gpt-5-mini")
                || id.starts_with("gpt-5-nano")
                || id.starts_with("gpt-5-2025") =>
        {
            &["minimal", "low", "medium", "high"]
        }
        "openai"
            if id == "gpt-5.1"
                || id.starts_with("gpt-5.1-codex")
                || id.starts_with("gpt-5.1-2025") =>
        {
            &["none", "low", "medium", "high"]
        }
        "gemini"
            if id.starts_with("gemini-2.5-flash")
                && !id.contains("image")
                && !id.contains("tts") =>
        {
            &["minimal", "low", "medium", "high"]
        }
        "gemini" if id.starts_with("gemini-2.5-pro") => &["low", "medium", "high"],
        "gemini"
            if id.starts_with("gemini-3-flash")
                || id.starts_with("gemini-3.1-flash-lite")
                || id.starts_with("gemini-4-argon") =>
        {
            &["minimal", "low", "medium", "high"]
        }
        _ => &[],
    }
}
fn cache_key(p: &AiProviderProfile) -> String {
    format!(
        "{}|{}|{}|{}|{}",
        p.id, p.provider_type, p.base_url, p.key_reference, p.updated_at
    )
}
pub fn catalog(profile: &AiProviderProfile, refresh: bool) -> Result<Vec<ProviderModel>, String> {
    ai::validate_profile(profile)?;
    let key = cache_key(profile);
    if !refresh {
        if let Some((at, rows)) = CACHE
            .lock()
            .map_err(|_| "Cache katalog terkunci.")?
            .get(&key)
        {
            if at.elapsed() < Duration::from_secs(300) {
                return Ok(rows.clone());
            }
        }
    }
    if crate::auth::claude::is_claude_code(profile) {
        crate::auth::claude::account_home(&profile.key_reference)?;
        return Ok(crate::auth::claude::models());
    }
    if crate::auth::codex::is_codex(profile) {
        let rows = crate::auth::codex::models(&profile.key_reference)?;
        CACHE
            .lock()
            .map_err(|_| "Cache katalog terkunci.")?
            .insert(key, (Instant::now(), rows.clone()));
        return Ok(rows);
    }
    let secret = ai::optional_keychain_secret(&profile.key_reference)?
        .map(|_| ai::get_keychain_secret(&profile.key_reference))
        .transpose()?;
    let project = if profile.provider_type == "gemini" {
        crate::auth::google::quota_project(&profile.key_reference)?
    } else {
        None
    };
    let base = format!("{}/models", profile.base_url.trim_end_matches('/'));
    let mut endpoint = base.clone();
    let mut seen = HashSet::new();
    let mut result = Vec::new();
    for page in 0..20 {
        if !seen.insert(endpoint.clone()) {
            return Err("Cursor katalog berulang.".into());
        }
        let data = connections::read_json_with_project(
            &endpoint,
            secret.as_deref(),
            profile.provider_type == "anthropic",
            project.as_deref(),
        )?;
        let rows = parse_models(&data, &profile.provider_type)?;
        if data["has_more"] == true {
            let cursor = data["last_id"]
                .as_str()
                .or_else(|| rows.last().map(|m| m.id.as_str()))
                .ok_or("Cursor katalog tidak tersedia.")?;
            if !valid_id(cursor) {
                return Err("Cursor katalog tidak sah.".into());
            }
            let mut url = url::Url::parse(&base).map_err(|_| "URL katalog tidak sah.")?;
            url.query_pairs_mut()
                .append_pair(
                    if profile.provider_type == "anthropic" {
                        "after_id"
                    } else {
                        "after"
                    },
                    cursor,
                )
                .append_pair("limit", "100");
            endpoint = url.to_string();
        } else {
            endpoint.clear();
        }
        result.extend(rows);
        if result.len() > 10000 {
            return Err("Katalog terlalu besar.".into());
        }
        if endpoint.is_empty() {
            break;
        }
        if page == 19 {
            return Err("Katalog melampaui batas halaman; coba ulang.".into());
        }
    }
    result.sort_by(|a, b| a.id.cmp(&b.id));
    result.dedup_by(|a, b| a.id == b.id);
    if result.is_empty() {
        return Err("Provider belum mengembalikan model yang dapat dipilih.".into());
    }
    let mut cache = CACHE.lock().map_err(|_| "Cache katalog terkunci.")?;
    if cache.len() >= 64 {
        cache.clear();
    }
    cache.insert(key, (Instant::now(), result.clone()));
    Ok(result)
}
pub(crate) fn tool_support(row: &Value) -> String {
    let reported = row
        .get("supports_tool_calling")
        .or_else(|| row.pointer("/capabilities/tool_calling/supported"))
        .or_else(|| row.pointer("/capabilities/tools"));
    match reported.and_then(Value::as_bool) {
        Some(true) => "supported",
        Some(false) => "unsupported",
        None => "unknown",
    }
    .into()
}
pub fn require_tools(profile: &AiProviderProfile) -> Result<(), String> {
    let cache = CACHE
        .lock()
        .map_err(|_| "Cache kemampuan model terkunci.")?;
    if cache
        .get(&cache_key(profile))
        .and_then(|(_, rows)| rows.iter().find(|m| m.id == profile.model))
        .is_some_and(|m| m.tool_calling == "unsupported")
    {
        return Err("[CAPABILITY] Model pilihan tidak mendukung tool calling. Pilih model yang mendukung tools atau tugas tanpa tools.".into());
    }
    Ok(()) // Missing metadata remains unknown; adapter errors are preserved, without fallback.
}
pub fn select(
    mut saved: AiProviderProfile,
    model: Option<&str>,
    effort: Option<&str>,
) -> Result<AiProviderProfile, String> {
    let model = model.unwrap_or(&saved.model);
    let effort = effort.filter(|v| !v.is_empty());
    // Saved configurations remain usable if a service has no discovery endpoint.
    if model != saved.model || effort.is_some() {
        let rows = catalog(&saved, false)?;
        let selected = rows
            .iter()
            .find(|row| row.id == model)
            .ok_or("Model tidak ada pada katalog akun ini. Muat ulang daftar model.")?;
        if effort.is_some_and(|v| !selected.reasoning_efforts.iter().any(|e| e == v)) {
            return Err("Tingkat penalaran tidak didukung model yang dipilih.".into());
        }
    }
    saved.model = model.into();
    saved.reasoning_effort = effort.map(str::to_owned);
    ai::validate_profile(&saved)?;
    Ok(saved)
}
#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;
    #[test]
    fn reads_account_capabilities_and_excludes_hidden_models() {
        let rows=parse_models(&json!({"models":[{"slug":"model-a","visibility":"list","default_reasoning_level":"high","supported_reasoning_levels":[{"effort":"low"},{"effort":"high"},{"effort":"made-up"}]},{"slug":"hidden","visibility":"hide"}]}),"openai").unwrap();
        assert_eq!(rows.len(), 1);
        assert_eq!(rows[0].reasoning_efforts, vec!["low", "high"]);
        assert_eq!(rows[0].default_reasoning_effort.as_deref(), Some("high"));
    }
    #[test]
    fn respects_explicit_empty_capabilities_and_anthropic_flags() {
        let rows=parse_models(&json!({"data":[{"id":"claude-a","capabilities":{"effort":{"low":{"supported":true},"high":{"supported":false},"max":{"supported":true}}}},{"id":"gpt-5","supportedReasoningEfforts":[]}]}),"openai").unwrap();
        assert_eq!(rows[0].reasoning_efforts, vec!["low", "max"]);
        assert!(rows[1].reasoning_efforts.is_empty());
    }
    #[test]
    fn selection_is_scoped_to_account_and_supported_efforts() {
        let p = AiProviderProfile {
            id: "selection-test".into(),
            name: "test".into(),
            provider_type: "openai-compatible".into(),
            base_url: "http://127.0.0.1:43210/v1".into(),
            model: "saved".into(),
            key_reference: "unused".into(),
            reasoning_effort: None,
            is_default: false,
            created_at: "1".into(),
            updated_at: "1".into(),
        };
        let rows = parse_models(&serde_json::json!({"data":[{"id":"selected","supportedReasoningEfforts":["low","high"]}]}),"openai-compatible").unwrap();
        CACHE
            .lock()
            .unwrap()
            .insert(cache_key(&p), (Instant::now(), rows));
        let chosen = select(p.clone(), Some("selected"), Some("high")).unwrap();
        assert_eq!(chosen.model, "selected");
        assert_eq!(chosen.reasoning_effort.as_deref(), Some("high"));
        assert_eq!(chosen.base_url, p.base_url);
        assert_eq!(chosen.key_reference, p.key_reference);
        assert!(select(p.clone(), Some("another-account-model"), None).is_err());
        assert!(select(p, Some("selected"), Some("max")).is_err());
    }

    #[test]
    fn unknown_models_stay_auto_and_invalid_ids_are_rejected() {
        assert!(
            parse_models(&json!({"data":[{"id":"future-model"}]}), "openai").unwrap()[0]
                .reasoning_efforts
                .is_empty()
        );
        assert!(parse_models(&json!({"data":[{"id":"bad\n"}]}), "openai").is_err());
    }
}
