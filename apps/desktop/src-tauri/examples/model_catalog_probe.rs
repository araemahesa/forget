//! Read-only model discovery against existing linked accounts; no inference prompts.
use forgekit_desktop_lib::{ai, connections, model_catalog};
use rusqlite::{Connection, OpenFlags};
fn main() -> Result<(), Box<dyn std::error::Error>> {
    let path = std::env::args()
        .nth(1)
        .ok_or("Pass the existing ForgeKit SQLite path")?;
    let db = Connection::open_with_flags(path, OpenFlags::SQLITE_OPEN_READ_ONLY)?;
    let router = ai::get_router_connection(&db)?;
    let mut reports = Vec::new();
    for account in ai::list_connection_profiles(&db)?
        .into_iter()
        .filter(|p| p.enabled && p.access_state == "ready")
    {
        let profile = connections::legacy(&account, Some(&router))?;
        let report = match model_catalog::catalog(&profile, true) {
            Ok(models) => {
                serde_json::json!({"provider":account.provider_id,"mode":account.connection_mode,"ok":true,"models":models})
            }
            Err(error) => {
                serde_json::json!({"provider":account.provider_id,"ok":false,"error":error})
            }
        };
        reports.push(report);
    }
    println!("{}", serde_json::to_string_pretty(&reports)?);
    Ok(())
}
