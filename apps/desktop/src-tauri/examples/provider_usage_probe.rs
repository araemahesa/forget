//! Read-only limits for ForgeKit's connected accounts; no inference or global login changes.
use forgekit_desktop_lib::{ai, connections, model_catalog, provider_usage};
use rusqlite::{Connection, OpenFlags};
fn main() -> Result<(), Box<dyn std::error::Error>> {
    let path = std::env::args()
        .nth(1)
        .ok_or("Pass the existing ForgeKit SQLite path")?;
    let db = Connection::open_with_flags(path, OpenFlags::SQLITE_OPEN_READ_ONLY)?;
    let router = ai::get_router_connection(&db)?;
    let mut reports = Vec::new();
    for (index, account) in ai::list_connection_profiles(&db)?.into_iter().enumerate() {
        if !account.enabled || account.access_state != "ready" {
            reports.push(serde_json::json!({"accountIndex":index+1,"provider":account.provider_id,
                "mode":account.connection_mode,"status":"skipped","enabled":account.enabled,
                "accessState":account.access_state,"message":"Koneksi belum aktif/siap; credential tidak dipakai."}));
            continue;
        }
        let profile = connections::legacy(&account, Some(&router))?;
        // Independent, metadata-only access check: a quota 401 must not be
        // mistaken for proof that inference authorization is also invalid.
        // Record counts only; never account identity, model IDs or credentials.
        let catalog = model_catalog::catalog(&profile, true).ok();
        let access = serde_json::json!({"modelCatalogReadable":catalog.is_some(),
            "modelCount":catalog.as_ref().map(Vec::len)});
        match provider_usage::read_connection(&profile, &account, &router) {
            Ok(usage) => reports.push(serde_json::json!({"accountIndex":index+1,"provider":account.provider_id,"mode":account.connection_mode,"accessCheck":access,
                "status":usage.status,"source":usage.source,"checkedAt":usage.checked_at,"planType":usage.plan_type,
                "windows":usage.windows.iter().enumerate().map(|(i,w)| serde_json::json!({"index":i,"label":w.label,"usedPercent":w.used_percent,"windowDurationMins":w.window_duration_mins,"resetsAt":w.resets_at,"remaining":w.remaining,"limit":w.limit,"unit":w.unit})).collect::<Vec<_>>(),"message":usage.message})),
            Err(_) => reports.push(serde_json::json!({"accountIndex":index+1,"provider":account.provider_id,"accessCheck":access,"status":"error","message":"Saved account could not be read"})),
        }
    }
    println!("{}", serde_json::to_string_pretty(&reports)?);
    Ok(())
}
