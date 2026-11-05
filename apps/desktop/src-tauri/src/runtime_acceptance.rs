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

#[tauri::command]
fn record_runtime_acceptance(app: tauri::AppHandle, result: Value) -> Result<(), String> {
    let phase = std::env::var("FORGEKIT_ACCEPTANCE_PHASE").map_err(|error| error.to_string())?;
    let file = match phase.as_str() {
        "workspace-crash" => "workspace-crash.json",
        "workspace-recover" => "workspace-recover.json",
        "save" => "save.json",
        "reopen" => "reopen.json",
        "mismatch" => "mismatch.json",
        "wide" => "wide.json",
        "images-save" => "images-save.json",
        "images-reopen" => "images-reopen.json",
        "sfx-save" => "sfx-save.json",
        "sfx-reopen" => "sfx-reopen.json",
        "creative-save" => "creative-save.json",
        "creative-reopen" => "creative-reopen.json",
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
            "workspace-crash"
                | "workspace-recover"
                | "save"
                | "reopen"
                | "mismatch"
                | "wide"
                | "sfx-save"
                | "sfx-reopen"
                | "images-save"
                | "images-reopen"
                | "creative-save"
                | "creative-reopen"
                | "visual-review"
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
        } else if phase == "connections" {
            include_str!("../tests/connections-acceptance.js")
        } else if phase.starts_with("creative-") {
            include_str!("../tests/creative-acceptance.js")
        } else {
            include_str!("../tests/runtime-acceptance.js")
        }
    );
    context.config_mut().app.windows.clear();
    tauri::Builder::default()
        .manage(AppState::default())
        .invoke_handler(tauri::generate_handler![
            load_creator_draft,
            save_creator_draft,
            create_work_task,
            update_work_task,
            list_work_tasks,
            list_library,
            set_library_deleted,
            create_gfx_task,
            save_gfx_version,
            cancel_gfx_task,
            get_gfx_task,
            list_gfx_tasks,
            list_gfx_versions,
            load_gfx_version,
            export_gfx_artifact,
            get_workspace_info,
            load_gfx_draft,
            save_gfx_draft,
            create_workspace_backup,
            list_workspace_backups,
            verify_workspace_backup,
            restore_workspace_backup,
            finish_app_exit,
            probe_studio,
            read_studio,
            read_studio_explorer,
            capture_studio_context,
            save_image_version,
            list_image_versions,
            load_image_version,
            export_image_artifact,
            save_sfx_version,
            list_sfx_versions,
            load_sfx_version,
            export_sfx_version,
            list_ai_providers,
            save_ai_provider,
            delete_ai_provider,
            test_ai_provider,
            list_connection_profiles,
            save_connection_profile,
            delete_connection_profile,
            set_primary_profile,
            get_fallback_policy,
            save_fallback_policy,
            get_router_connection,
            save_router_connection,
            test_router_connection,
            probe_router_models,
            get_provider_usage,
            list_provider_models,
            get_provider_model_catalog,
            list_task_attempts,
            test_connection_profile,
            connect_provider_browser,
            list_chat_threads,
            create_chat_thread,
            load_chat_thread,
            latest_chat_turn,
            send_chat_message,
            cancel_chat_stream,
            generate_creative,
            generate_editor_recipe,
            resume_ai_task,
            get_creative_task,
            list_creative_versions,
            load_creative_version,
            cancel_creative,
            save_creative_revision,
            export_creative_geometry,
            export_creative_audio,
            record_runtime_acceptance,
        ])
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
                    "wide" => 1440.0,
                    "creative-save" | "creative-reopen" | "visual-review" | "provider-only-live" | "provider-only-review" | "provider-only-studio"
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
                        } else if phase.starts_with("creative-") {
                            180
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
