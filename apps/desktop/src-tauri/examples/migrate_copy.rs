use forgekit_desktop_lib::storage::Storage;

fn main() -> Result<(), Box<dyn std::error::Error>> {
    let root = std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("target/migration-copies")
        .canonicalize()?;
    let path = std::path::PathBuf::from(
        std::env::args()
            .nth(1)
            .ok_or("Expected copied database path")?,
    )
    .canonicalize()?;
    if !path.starts_with(root) || !path.is_file() {
        return Err("Migration check accepts only existing target/migration-copies files".into());
    }
    Storage::open(path)?;
    println!("PASS copied database migration");
    Ok(())
}
