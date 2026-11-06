// Compiled only for opt-in local acceptance. No test command exists in normal builds.
use crate::commands::*;
use serde_json::Value;
use std::path::PathBuf;
use tauri::{ipc::CapabilityBuilder, Manager};

pub fn requested() -> bool {
    std::env::var("FORGEKIT_ACCEPTANCE_PHASE").is_ok()
}

pub fn data_directory() -> Option<PathBuf> {
    requested()
        .then(|| PathBuf::from(env!("CARGO_MANIFEST_DIR")).join(if std::env::var("FORGEKIT_ACCEPTANCE_PHASE").as_deref()==Ok("provider-only-live") {"target/runtime-acceptance/provider-only-live-data"}else{"target/runtime-acceptance/data"}))
}

/// Appends one Studio IPC observation (command, latency, result) for the acceptance
/// report. No-op outside an acceptance run, so a feature build behaves like release.
pub fn studio_observation(command: &str, elapsed_ms: u128, result: Value) {
    if !requested() {
        return;
    }
    let directory = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("target/runtime-acceptance");
    let line = serde_json::json!({
        "command": command,
        "elapsedMs": elapsed_ms,
        "observedAt": std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map(|d| d.as_millis())
            .unwrap_or_default(),
        "result": result,
    });
    let write = || -> std::io::Result<()> {
        use std::io::Write;
        std::fs::create_dir_all(&directory)?;
        let mut file = std::fs::OpenOptions::new()
            .create(true)
            .append(true)
            .open(directory.join("studio-observations.jsonl"))?;
        writeln!(file, "{line}")
    };
    if let Err(error) = write() {
        eprintln!("runtime acceptance: studio observation not recorded: {error}");
    }
}

#[tauri::command]
fn record_runtime_acceptance(app: tauri::AppHandle, result: Value) -> Result<(), String> {
    let phase = std::env::var("FORGEKIT_ACCEPTANCE_PHASE").map_err(|error| error.to_string())?;
    let file = match phase.as_str() {
        "connections" => "connections.json",
        "provider-only-live" => "provider-only-live.json",
        "provider-all-domains" => "provider-all-domains.json",
        "provider-apply" => "provider-apply.json",
        "blender-reference-live" => "blender-reference-live.json",
        "blender-review" => "blender-review.json",
        "provider-only-review" => "provider-only-review.json",
        "provider-only-studio" => "provider-only-studio.json",
        _ => return Err("Unknown acceptance phase".into()),
    };
    let directory = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("target/runtime-acceptance");
    std::fs::create_dir_all(&directory).map_err(|error| error.to_string())?;
    if result["checkpoint"].is_string() {
        std::fs::write(
            directory.join(format!("{phase}-progress.json")),
            serde_json::to_vec_pretty(&result).map_err(|error| error.to_string())?,
        )
        .map_err(|error| error.to_string())?;
        return Ok(());
    }
    std::fs::write(
        directory.join(file),
        serde_json::to_vec_pretty(&result).map_err(|error| error.to_string())?,
    )
    .map_err(|error| error.to_string())?;
    app.exit(if result["ok"].as_bool() == Some(true) {
        0
    } else {
        1
    });
    Ok(())
}

pub fn run(mut context: tauri::Context<tauri::Wry>) {
    let phase = std::env::var("FORGEKIT_ACCEPTANCE_PHASE").expect("acceptance phase");
    assert!(
        matches!(
            phase.as_str(),
            "visual-review"
                | "connections"
                | "provider-only-live"
                | "provider-only-review"
                | "provider-only-studio"
                | "provider-all-domains"
                | "provider-apply"
                | "blender-reference-live"
                | "blender-review"
        ),
        "Unknown acceptance phase"
    );
    let script = format!(
        "window.__forgekitAcceptancePhase = {};\n{}",
        serde_json::to_string(&phase).unwrap(),
        if phase == "blender-review" {
            "window.addEventListener('DOMContentLoaded',()=>{window.location.hash='#create/model-3d';});"
        } else if phase == "blender-reference-live" {
            include_str!("../tests/blender-reference-live.js")
        } else if phase == "visual-review" {
            ""
        } else if phase == "provider-only-review" {
            include_str!("../tests/provider-only-review.js")
        } else if phase == "provider-only-studio" {
            include_str!("../tests/provider-only-studio.js")
        } else if phase == "provider-apply" {
            include_str!("../tests/provider-apply.js")
        } else if phase == "provider-all-domains" {
            include_str!("../tests/provider-all-domains.js")
        } else if phase == "provider-only-live" {
            include_str!("../tests/provider-only-live.js")
        } else {
            // "connections"
            include_str!("../tests/connections-acceptance.js")
        }
    );
    context.config_mut().app.windows.clear();
    tauri::Builder::default()
        .manage(AppState::default())
        .invoke_handler(app_commands!(record_runtime_acceptance))
        .setup(move |app| {
            app.add_capability(
                CapabilityBuilder::new("runtime-acceptance")
                    .window("main")
                    .permission("allow-record-runtime-acceptance"),
            )?;
            tauri::WebviewWindowBuilder::new(
                app,
                "main",
                tauri::WebviewUrl::App("index.html".into()),
            )
            .title("ForgeKit runtime acceptance")
            .inner_size(
                match phase.as_str() {
                    "visual-review" | "provider-only-live" | "provider-only-review" | "provider-only-studio"
                | "provider-all-domains" => 1280.0,
                    _ => 800.0,
                },
                700.0,
            )
            .focused(true)
            .initialization_script(script.clone())
            .build()?;
            // Bound a hung WebView/IPC test without an external polling daemon.
            let handle = app.handle().clone();
            if phase != "visual-review" && phase != "provider-only-review" && phase != "blender-review" {
                std::thread::spawn(move || {
                    std::thread::sleep(std::time::Duration::from_secs(
                        if phase == "provider-all-domains" {
                            2400
                        } else if phase == "provider-only-live" || phase == "provider-only-studio" {
                            600
                        } else {
                            90
                        },
                    ));
                    handle.exit(2);
                });
            }
            Ok(())
        })
        .run(context)
        .expect("run native acceptance");
}
