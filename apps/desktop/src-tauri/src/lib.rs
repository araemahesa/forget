mod provider_usage_http;
mod attachments;
mod references;
mod blender;
mod blender_insert;
mod reference_model;
mod hunyuan_remote;
mod hunyuan_edit;
mod model_profile;
mod agent;
mod obsidian;
mod obsidian_learning;
pub mod ai;
mod ai_protocol;
pub mod artifacts;
pub mod backup;
mod browser_auth;
pub mod codex_auth;
pub mod commands;
pub mod connections;
pub mod connectors;
pub mod context;
pub mod creative;
pub mod creator_workspace;
mod discord;
pub mod editor_ai;
mod explorer;
mod gfx_assets;
mod google_auth;
pub mod images;
mod luau_checks;
pub mod model_catalog;
pub mod provider_usage;
pub mod routing;
#[cfg(feature = "runtime-acceptance")]
mod runtime_acceptance;
pub mod sfx;
pub mod storage;
pub mod studio;
pub mod supervisor;
mod task_activity;
pub mod task_journal;
pub mod tasks;
pub mod tools;

use commands::*;
use tauri::{Emitter, Manager};

pub fn run() {
    let context = tauri::generate_context!();
    #[cfg(feature = "runtime-acceptance")]
    if runtime_acceptance::requested() {
        runtime_acceptance::run(context);
        return;
    }
    tauri::Builder::default()
        .manage(AppState::default())
        .invoke_handler(tauri::generate_handler![
            hunyuan_load_config,
            hunyuan_save_config,
            hunyuan_health,
            hunyuan_start,
            hunyuan_poll,
            hunyuan_cancel,
            hunyuan_download,
            hunyuan_load_model,
            hunyuan_edit_model,
            hunyuan_list_models,
            hunyuan_open_blender,
            hunyuan_reveal_model,
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
            capture_studio_context,
            read_studio_explorer,
            save_sfx_version,
            list_sfx_versions,
            load_sfx_version,
            export_sfx_version,
            save_image_version,
            list_image_versions,
            load_image_version,
            export_image_artifact,
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
            list_provider_models,
            get_provider_model_catalog,
            get_provider_usage,
            list_task_attempts,
            test_connection_profile,
            get_google_oauth_config,
            configure_google_oauth,
            get_discord_account,
            configure_discord,
            login_discord,
            logout_discord,
            connect_provider_browser,
            cancel_provider_browser,
            list_chat_threads,
            create_chat_thread,
            rename_chat_thread,
            delete_chat_thread,
            load_chat_thread,
            latest_chat_turn,
            send_chat_message,
            prepare_attachment,
            cancel_chat_stream,
            generate_creative,
            blender_status,
            obsidian_status,
            build_blender_model,
            load_blender_bundle,
            get_model_build_progress,
            reveal_blender_model,
            open_blender_model,
            insert_blender_model,
            cancel_blender_model,

            get_creative_task,
            resume_ai_task,
            list_creative_versions,
            load_creative_version,
            cancel_creative,
            save_creative_revision,
            generate_editor_recipe,
            export_creative_geometry,
            export_creative_audio,
            list_mcp_connectors,
            save_mcp_connector,
            toggle_mcp_connector,
            list_available_mcp_tools
        ])
        .build(context)
        .expect("error while building ForgeKit Studio")
        .run(|app, event| {
            if matches!(event, tauri::RunEvent::Exit) {
                ai::shutdown();
                codex_auth::shutdown();
                studio::shutdown();
            }
            if let tauri::RunEvent::ExitRequested {
                code: None, api, ..
            } = event
            {
                // The frontend flushes pending drafts before acknowledging ordinary Quit.
                if !app.webview_windows().is_empty() {
                    api.prevent_exit();
                    app.state::<AppState>()
                        .exit_requested
                        .store(true, std::sync::atomic::Ordering::SeqCst);
                    let _ = app.emit("forgekit:exit-requested", ());
                }
            }
        });
}

#[cfg(test)]
mod storage_tests;
