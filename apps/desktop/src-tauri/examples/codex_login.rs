//! Explicit live acceptance: starts ForgeKit-owned login, then saves a NEW account.
//! Never imports an existing Orca/Codex/browser credential. Output is redacted.
use forgekit_desktop_lib::{ai, codex_auth, connections, model_catalog, provider_usage};
use rusqlite::{Connection, OpenFlags};
fn main() -> Result<(), Box<dyn std::error::Error>> {
    let db_path = std::env::args()
        .nth(1)
        .ok_or("Pass the existing ForgeKit SQLite path")?;
    let db = Connection::open_with_flags(db_path, OpenFlags::SQLITE_OPEN_READ_WRITE)?;
    let id = format!(
        "codex-{}",
        std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)?
            .as_nanos()
    );
    eprintln!("ForgeKit is opening its own ChatGPT login. Complete sign-in in the browser.");
    let mut account = codex_auth::sign_in(&id)?;
    account.is_default = ai::list_connection_profiles(&db)?.is_empty();
    if let Err(e) = ai::save_connection_profile(&db, &account) {
        let _ = codex_auth::disconnect(account.credential_ref.as_deref().unwrap());
        return Err(e.into());
    }
    let profile = connections::legacy(&account, None)?;
    let catalog = model_catalog::catalog(&profile, true)?;
    let test = ai::test_ai_provider(&profile)?;
    connections::verify(&db, &account, test.ok)?;
    let usage = provider_usage::read(&profile)?;
    println!(
        "{}",
        serde_json::to_string_pretty(&serde_json::json!({
            "authMethod":"codex_oauth", "credentialOwner":"forgekit", "newAccountSaved":true,
            "modelCount":catalog.len(),"inferenceVerified":test.ok,"inferenceMessage":test.message,
            "usageStatus":usage.status,"usageSource":usage.source,"checkedAt":usage.checked_at,
            "planType":usage.plan_type,"windows":usage.windows.iter().map(|w|serde_json::json!({
                "label":w.label,"usedPercent":w.used_percent,"windowDurationMins":w.window_duration_mins,"resetsAt":w.resets_at
            })).collect::<Vec<_>>(),"message":usage.message
        }))?
    );
    Ok(())
}
