//! Developer check: reads a connected Claude Code account's model catalog and plan usage
//! through the CLI (no model request). Prints names and percentages only.
use forgekit_desktop_lib::auth;
fn main() -> Result<(), String> {
    let key = std::env::args().nth(1).ok_or("usage: claude_probe claude-<account-id>")?;
    let start = std::time::Instant::now();
    for m in auth::claude::models(&key, true)? { println!("model {} = {}", m.id, m.display_name); }
    println!("models read in {:?}", start.elapsed());
    let start = std::time::Instant::now();
    let (windows, plan) = auth::claude::usage(&key)?;
    println!("plan {:?}", plan);
    for w in windows { println!("usage {} {}% resets {:?} scope {}", w.label, w.used_percent, w.resets_at, w.scope); }
    println!("usage read in {:?}", start.elapsed());
    Ok(())
}
