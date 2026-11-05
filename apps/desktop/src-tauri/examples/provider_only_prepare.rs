//! Copies only this application's selected connection metadata into an isolated acceptance DB.
//! No token export, login, source DB migration, or production artifact writes.
use forgekit_desktop_lib::{ai, storage::Storage};
use rusqlite::{Connection, OpenFlags};
fn main() -> Result<(), Box<dyn std::error::Error>> {
    let args: Vec<_> = std::env::args().collect();
    let source_path = std::path::Path::new(args.get(1).ok_or("source db")?);
    let destination_path = std::path::Path::new(args.get(2).ok_or("isolated destination db")?);
    if source_path == destination_path
        || (destination_path.exists()
            && source_path.canonicalize()? == destination_path.canonicalize()?)
    {
        return Err("Acceptance destination must differ from the production DB".into());
    }
    if let Some(parent) = destination_path.parent() {
        std::fs::create_dir_all(parent)?;
    }
    let source = Connection::open_with_flags(
        args.get(1).ok_or("source db")?,
        OpenFlags::SQLITE_OPEN_READ_ONLY,
    )?;
    let selected = ai::list_connection_profiles(&source)?
        .into_iter()
        .find(|p| p.is_default && p.enabled && p.access_state == "ready")
        .ok_or("No ready primary ForgeKit account")?;
    let destination = Storage::open(destination_path)?;
    destination.save_connection_profile(&selected)?;
    println!(
        "{}",
        serde_json::json!({"prepared":true,"provider":selected.provider_id,"authMethod":selected.auth_method,"model":selected.model,"isolated":true,"credentialsExported":false})
    );
    Ok(())
}
