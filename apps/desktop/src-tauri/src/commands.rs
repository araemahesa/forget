use crate::artifacts::ArtifactResult;
use crate::backup::{self, BackupInfo};
use crate::storage::{
    GfxDraft, GfxSpec, GfxTask, GfxTaskSummary, GfxVersion, Storage, StorageError,
};
use serde::Serialize;
use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::{
    atomic::{AtomicBool, Ordering},
    Arc, Mutex,
};
use tauri::{AppHandle, Manager, State};

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum CommandErrorCode {
    ValidationError,
    NotFound,
    StorageError,
    Cancelled,
    Conflict,
    StudioError,
}

#[derive(Debug, Clone, Serialize)]
pub struct CommandError {
    pub code: CommandErrorCode,
    pub message: String,
}

impl From<StorageError> for CommandError {
    fn from(error: StorageError) -> Self {
        let code = match error {
            StorageError::NotFound(_) => CommandErrorCode::NotFound,
            StorageError::InvalidInput(_) => CommandErrorCode::ValidationError,
            StorageError::Cancelled => CommandErrorCode::Cancelled,
            StorageError::Conflict => CommandErrorCode::Conflict,
            _ => CommandErrorCode::StorageError,
        };
        Self {
            code,
            message: error.to_string(),
        }
    }
}

#[derive(Default)]
pub struct AppState {
    // ponytail: one local GFX editor; use a DB worker when independent creators run concurrently.
    storage: Mutex<Option<Storage>>,
    cancellation: Mutex<HashMap<String, Arc<AtomicBool>>>,
    studio_snapshot: Mutex<Option<crate::context::ContextSnapshot>>,
    pub(crate) exit_requested: AtomicBool,
}

fn native_error(message: impl ToString) -> CommandError {
    CommandError {
        code: CommandErrorCode::StorageError,
        message: message.to_string(),
    }
}

fn data_directory(app: &AppHandle) -> Result<PathBuf, CommandError> {
    #[cfg(feature = "runtime-acceptance")]
    if let Some(directory) = crate::runtime_acceptance::data_directory() {
        std::fs::create_dir_all(&directory).map_err(native_error)?;
        return Ok(directory);
    }
    let directory = app.path().app_data_dir().map_err(native_error)?;
    std::fs::create_dir_all(&directory).map_err(native_error)?;
    Ok(directory)
}

fn workspace_root(app: &AppHandle) -> Result<PathBuf, CommandError> {
    let directory = data_directory(app)?.join("workspace");
    std::fs::create_dir_all(&directory).map_err(native_error)?;
    if std::fs::symlink_metadata(&directory)
        .map_err(native_error)?
        .file_type()
        .is_symlink()
    {
        return Err(native_error("Root ruang kerja tidak boleh berupa symlink"));
    }
    Ok(directory)
}

fn with_storage<T>(
    app: &AppHandle,
    state: &AppState,
    operation: impl FnOnce(&Storage) -> Result<T, StorageError>,
) -> Result<T, CommandError> {
    let mut guard = state
        .storage
        .lock()
        .map_err(|_| native_error("Kunci penyimpanan rusak"))?;
    if guard.is_none() {
        let storage = Storage::open(data_directory(app)?.join("forgekit.sqlite"))?;
        storage.ensure_default_records()?;
        *guard = Some(storage);
    }
    operation(guard.as_ref().expect("storage initialized")).map_err(CommandError::from)
}

#[tauri::command]
pub async fn save_sfx_version(
    app: AppHandle,
    recipe: crate::sfx::SfxRecipe,
    wav_bytes: Vec<u8>,
    work_task_id: Option<String>,
) -> Result<crate::sfx::SfxVersion, CommandError> {
    if wav_bytes.len() > 264644 {
        return Err(native_error("WAV melampaui batas 3 detik"));
    }
    tauri::async_runtime::spawn_blocking(move || {
        let state = app.state::<AppState>();
        with_storage(&app, &state, |storage| {
            storage.save_sfx_version_for_task(&recipe, &wav_bytes, work_task_id.as_deref())
        })
    })
    .await
    .map_err(native_error)?
}

#[tauri::command]
pub fn list_sfx_versions(
    app: AppHandle,
    state: State<'_, AppState>,
) -> Result<Vec<crate::sfx::SfxVersion>, CommandError> {
    with_storage(&app, &state, Storage::list_sfx_versions)
}

#[tauri::command]
pub fn load_sfx_version(
    app: AppHandle,
    state: State<'_, AppState>,
    id: String,
) -> Result<crate::sfx::LoadedSfxVersion, CommandError> {
    with_storage(&app, &state, |storage| storage.load_sfx_version(&id))
}

#[tauri::command]
pub fn export_sfx_version(
    app: AppHandle,
    state: State<'_, AppState>,
    id: String,
) -> Result<ArtifactResult, CommandError> {
    let root = workspace_root(&app)?;
    with_storage(&app, &state, |storage| {
        storage.export_sfx_version(&id, &root)
    })
}

#[tauri::command]
pub fn create_gfx_task(
    app: AppHandle,
    state: State<'_, AppState>,
    spec: GfxSpec,
) -> Result<GfxTask, CommandError> {
    with_storage(&app, &state, |storage| {
        let task = storage.create_gfx_task(&spec)?;
        state
            .cancellation
            .lock()
            .map_err(|_| StorageError::InvalidInput("Kunci tugas rusak".into()))?
            .insert(task.id.clone(), Arc::new(AtomicBool::new(false)));
        Ok(task)
    })
}

#[tauri::command]
pub async fn save_gfx_version(
    app: AppHandle,
    task_id: String,
    svg: String,
    png: Vec<u8>,
) -> Result<GfxVersion, CommandError> {
    // Reject the IPC payload before allocating decoder buffers.
    if svg.len() > 128 * 1024 || png.len() > 72 * 1024 * 1024 {
        return Err(CommandError {
            code: CommandErrorCode::ValidationError,
            message: "Ukuran artefak melampaui batas".into(),
        });
    }
    tauri::async_runtime::spawn_blocking(move || {
        let state = app.state::<AppState>();
        let cancellation = state
            .cancellation
            .lock()
            .map_err(|_| native_error("Kunci tugas rusak"))?
            .get(&task_id)
            .cloned()
            .ok_or_else(|| CommandError {
                code: CommandErrorCode::NotFound,
                message: "Tugas aktif tidak ditemukan".into(),
            })?;
        let root = workspace_root(&app)?;
        let result = with_storage(&app, &state, |storage| {
            storage.finish_gfx_task(&task_id, &svg, &png, &root, &cancellation)
        });
        state
            .cancellation
            .lock()
            .map_err(|_| native_error("Kunci tugas rusak"))?
            .remove(&task_id);
        result
    })
    .await
    .map_err(native_error)?
}

#[tauri::command]
pub async fn cancel_gfx_task(app: AppHandle, task_id: String) -> Result<GfxTask, CommandError> {
    // Set the flag without waiting for the storage lock held by an active save.
    if let Some(flag) = app
        .state::<AppState>()
        .cancellation
        .lock()
        .map_err(|_| native_error("Kunci tugas rusak"))?
        .get(&task_id)
    {
        flag.store(true, Ordering::SeqCst);
    }
    tauri::async_runtime::spawn_blocking(move || {
        let state = app.state::<AppState>();
        let result = with_storage(&app, &state, |storage| storage.cancel_gfx_task(&task_id));
        state
            .cancellation
            .lock()
            .map_err(|_| native_error("Kunci tugas rusak"))?
            .remove(&task_id);
        result
    })
    .await
    .map_err(native_error)?
}

#[tauri::command]
pub fn get_gfx_task(
    app: AppHandle,
    state: State<'_, AppState>,
    id: String,
) -> Result<GfxTask, CommandError> {
    with_storage(&app, &state, |storage| storage.get_gfx_task(&id))
}

#[tauri::command]
pub fn list_gfx_tasks(
    app: AppHandle,
    state: State<'_, AppState>,
) -> Result<Vec<GfxTaskSummary>, CommandError> {
    with_storage(&app, &state, Storage::list_gfx_tasks)
}

#[tauri::command]
pub fn list_gfx_versions(
    app: AppHandle,
    state: State<'_, AppState>,
) -> Result<Vec<GfxVersion>, CommandError> {
    with_storage(&app, &state, Storage::list_gfx_versions)
}

#[tauri::command]
pub fn load_gfx_version(
    app: AppHandle,
    state: State<'_, AppState>,
    id: String,
) -> Result<GfxVersion, CommandError> {
    let root = workspace_root(&app)?;
    with_storage(&app, &state, |storage| {
        storage.load_verified_gfx_version(&id, &root)
    })
}

#[tauri::command]
pub fn export_gfx_artifact(
    app: AppHandle,
    state: State<'_, AppState>,
    id: String,
    kind: String,
) -> Result<ArtifactResult, CommandError> {
    let root = workspace_root(&app)?;
    with_storage(&app, &state, |storage| {
        storage.export_gfx_artifact(&id, &kind, &root)
    })
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkspaceInfo {
    root_path: String,
    orphan_artifacts: Vec<String>,
}

#[tauri::command]
pub fn get_workspace_info(
    app: AppHandle,
    state: State<'_, AppState>,
) -> Result<WorkspaceInfo, CommandError> {
    let root = workspace_root(&app)?;
    let orphan_artifacts = with_storage(&app, &state, |storage| storage.orphan_artifacts(&root))?;
    Ok(WorkspaceInfo {
        root_path: root.to_string_lossy().into_owned(),
        orphan_artifacts,
    })
}

#[tauri::command]
pub fn load_gfx_draft(
    app: AppHandle,
    state: State<'_, AppState>,
) -> Result<Option<GfxDraft>, CommandError> {
    with_storage(&app, &state, Storage::load_gfx_draft)
}

#[tauri::command]
pub async fn save_gfx_draft(
    app: AppHandle,
    spec: serde_json::Value,
    baseline_version_id: Option<String>,
    expected_revision: i64,
) -> Result<GfxDraft, CommandError> {
    tauri::async_runtime::spawn_blocking(move || {
        let state = app.state::<AppState>();
        with_storage(&app, &state, |storage| {
            storage.save_gfx_draft(&spec, baseline_version_id.as_deref(), expected_revision)
        })
    })
    .await
    .map_err(native_error)?
}

fn backup_root(app: &AppHandle, name: &str) -> Result<PathBuf, CommandError> {
    let directory = data_directory(app)?.join(name);
    std::fs::create_dir_all(&directory).map_err(native_error)?;
    if std::fs::symlink_metadata(&directory)
        .map_err(native_error)?
        .file_type()
        .is_symlink()
    {
        return Err(native_error("Direktori backup tidak boleh berupa symlink"));
    }
    Ok(directory)
}

#[tauri::command]
pub async fn create_workspace_backup(app: AppHandle) -> Result<BackupInfo, CommandError> {
    tauri::async_runtime::spawn_blocking(move || {
        let root = backup_root(&app, "backups")?;
        let workspace = workspace_root(&app)?;
        let state = app.state::<AppState>();
        with_storage(&app, &state, |storage| {
            storage.create_backup(&workspace, &root)
        })
    })
    .await
    .map_err(native_error)?
}

#[tauri::command]
pub fn list_workspace_backups(app: AppHandle) -> Result<Vec<BackupInfo>, CommandError> {
    backup::list(&backup_root(&app, "backups")?).map_err(CommandError::from)
}

#[tauri::command]
pub async fn verify_workspace_backup(
    app: AppHandle,
    id: String,
) -> Result<BackupInfo, CommandError> {
    tauri::async_runtime::spawn_blocking(move || {
        backup::verify(&backup_root(&app, "backups")?, &id).map_err(CommandError::from)
    })
    .await
    .map_err(native_error)?
}

#[tauri::command]
pub async fn restore_workspace_backup(app: AppHandle, id: String) -> Result<String, CommandError> {
    tauri::async_runtime::spawn_blocking(move || {
        backup::restore_copy(
            &backup_root(&app, "backups")?,
            &id,
            &backup_root(&app, "recovered")?,
        )
        .map_err(CommandError::from)
    })
    .await
    .map_err(native_error)?
}

#[tauri::command]
pub fn finish_app_exit(app: AppHandle, state: State<'_, AppState>) -> Result<(), CommandError> {
    if !state.exit_requested.swap(false, Ordering::SeqCst) {
        return Err(native_error("Tidak ada permintaan keluar aplikasi"));
    }
    app.exit(0);
    Ok(())
}

fn studio_error(message: String) -> CommandError {
    CommandError {
        code: CommandErrorCode::StudioError,
        message,
    }
}

#[tauri::command]
pub async fn save_image_version(
    app: AppHandle,
    document: crate::images::ImageDocument,
    images: Vec<crate::images::ImageInput>,
    work_task_id: Option<String>,
) -> Result<crate::images::ImageVersion, CommandError> {
    tauri::async_runtime::spawn_blocking(move || {
        let root = workspace_root(&app)?;
        let state = app.state::<AppState>();
        with_storage(&app, &state, |storage| {
            storage.save_image_version_for_task(&root, document, images, work_task_id.as_deref())
        })
    })
    .await
    .map_err(native_error)?
}

#[tauri::command]
pub async fn list_image_versions(
    app: AppHandle,
    kind: crate::images::ImageKind,
) -> Result<Vec<crate::images::ImageVersion>, CommandError> {
    tauri::async_runtime::spawn_blocking(move || {
        let state = app.state::<AppState>();
        with_storage(&app, &state, |storage| storage.list_image_versions(kind))
    })
    .await
    .map_err(native_error)?
}

#[tauri::command]
pub async fn load_image_version(
    app: AppHandle,
    id: String,
) -> Result<crate::images::LoadedImageVersion, CommandError> {
    tauri::async_runtime::spawn_blocking(move || {
        let root = workspace_root(&app)?;
        let state = app.state::<AppState>();
        with_storage(&app, &state, |storage| {
            storage.load_image_version(&root, &id)
        })
    })
    .await
    .map_err(native_error)?
}

#[tauri::command]
pub async fn export_image_artifact(
    app: AppHandle,
    id: String,
    name: String,
    format: String,
) -> Result<crate::artifacts::ArtifactResult, CommandError> {
    tauri::async_runtime::spawn_blocking(move || {
        let root = workspace_root(&app)?;
        let state = app.state::<AppState>();
        with_storage(&app, &state, |storage| {
            storage.export_image_artifact(&root, &id, &name, &format)
        })
    })
    .await
    .map_err(native_error)?
}

#[tauri::command]
pub async fn probe_studio() -> Result<crate::studio::StudioReport, CommandError> {
    let started = std::time::Instant::now();
    let result = tauri::async_runtime::spawn_blocking(crate::studio::probe)
        .await
        .map_err(native_error)?
        .map_err(studio_error);
    #[cfg(feature = "runtime-acceptance")]
    crate::runtime_acceptance::studio_observation(
        "probe_studio",
        started.elapsed().as_millis(),
        match &result {
            Ok(report) => serde_json::to_value(report).unwrap_or_default(),
            Err(error) => serde_json::json!({"error":error.message}),
        },
    );
    #[cfg(not(feature = "runtime-acceptance"))]
    let _ = started;
    result
}

#[tauri::command]
pub async fn read_studio(
    studio_id: String,
    tool: String,
    path: Option<String>,
    depth: Option<u8>,
) -> Result<serde_json::Value, CommandError> {
    tauri::async_runtime::spawn_blocking(move || {
        let p = path.as_deref().unwrap_or("game");
        let d = depth.unwrap_or(2).clamp(1, 4);
        crate::studio::read_target(&studio_id, &tool, p, d).map(|(_, value)| value)
    })
    .await
    .map_err(native_error)?
    .map_err(studio_error)
}

#[tauri::command]
pub async fn capture_studio_context(
    app: AppHandle,
    studio_id: String,
    path: String,
    depth: u8,
) -> Result<crate::context::ContextSnapshot, CommandError> {
    let started = std::time::Instant::now();
    let result: Result<crate::context::ContextSnapshot, CommandError> =
        tauri::async_runtime::spawn_blocking(move || {
            let snapshot =
                crate::context::capture(&studio_id, &path, depth).map_err(native_error)?;
            let state = app.state::<AppState>();
            let mut previous = state.studio_snapshot.lock().map_err(native_error)?;
            // Still read live every cycle; avoid storing an identical tree every three seconds.
            // The reused receipt retains its original observation time (conservative freshness).
            if let Some(old) = previous
                .as_ref()
                .filter(|old| crate::context::reusable(old, &snapshot))
            {
                return Ok(old.clone());
            }
            with_storage(&app, &state, |storage| storage.save_context(&snapshot))?;
            *previous = Some(snapshot.clone());
            Ok(snapshot)
        })
        .await
        .map_err(native_error)?;
    #[cfg(feature = "runtime-acceptance")]
    crate::runtime_acceptance::studio_observation(
        "capture_studio_context",
        started.elapsed().as_millis(),
        match &result {
            Ok(snapshot) => serde_json::to_value(snapshot).unwrap_or_default(),
            Err(error) => serde_json::json!({"error":error.message}),
        },
    );
    #[cfg(not(feature = "runtime-acceptance"))]
    let _ = started;
    result
}

#[tauri::command]
pub async fn load_creator_draft(
    app: AppHandle,
    kind: String,
) -> Result<Option<crate::creator_workspace::CreatorDraft>, CommandError> {
    tauri::async_runtime::spawn_blocking(move || {
        with_storage(&app, &app.state::<AppState>(), |storage| {
            storage.load_creator_draft(&kind)
        })
    })
    .await
    .map_err(native_error)?
}

#[tauri::command]
pub async fn save_creator_draft(
    app: AppHandle,
    draft: crate::creator_workspace::CreatorDraft,
) -> Result<crate::creator_workspace::CreatorDraft, CommandError> {
    tauri::async_runtime::spawn_blocking(move || {
        with_storage(&app, &app.state::<AppState>(), |storage| {
            storage.save_creator_draft(&draft)
        })
    })
    .await
    .map_err(native_error)?
}

#[tauri::command]
pub async fn create_work_task(
    app: AppHandle,
    kind: String,
    action: String,
    input: serde_json::Value,
) -> Result<crate::creator_workspace::WorkTask, CommandError> {
    tauri::async_runtime::spawn_blocking(move || {
        with_storage(&app, &app.state::<AppState>(), |storage| {
            storage.create_work_task(&kind, &action, &input)
        })
    })
    .await
    .map_err(native_error)?
}

#[tauri::command]
pub async fn update_work_task(
    app: AppHandle,
    id: String,
    status: String,
    stage: String,
    receipt: Option<serde_json::Value>,
    error: Option<String>,
) -> Result<crate::creator_workspace::WorkTask, CommandError> {
    tauri::async_runtime::spawn_blocking(move || {
        with_storage(&app, &app.state::<AppState>(), |storage| {
            storage.update_work_task(&id, &status, &stage, receipt, error)
        })
    })
    .await
    .map_err(native_error)?
}

#[tauri::command]
pub async fn list_work_tasks(
    app: AppHandle,
) -> Result<Vec<crate::creator_workspace::WorkTask>, CommandError> {
    tauri::async_runtime::spawn_blocking(move || {
        with_storage(&app, &app.state::<AppState>(), Storage::list_work_tasks)
    })
    .await
    .map_err(native_error)?
}

#[tauri::command]
pub async fn list_library(
    app: AppHandle,
    query: String,
    kind: String,
    deleted: bool,
    offset: i64,
) -> Result<Vec<crate::creator_workspace::LibraryEntry>, CommandError> {
    tauri::async_runtime::spawn_blocking(move || {
        with_storage(&app, &app.state::<AppState>(), |storage| {
            storage.list_library(&query, &kind, deleted, offset)
        })
    })
    .await
    .map_err(native_error)?
}

#[tauri::command]
pub async fn set_library_deleted(
    app: AppHandle,
    kind: String,
    id: String,
    deleted: bool,
) -> Result<(), CommandError> {
    tauri::async_runtime::spawn_blocking(move || {
        with_storage(&app, &app.state::<AppState>(), |storage| {
            storage.set_library_deleted(&kind, &id, deleted)
        })
    })
    .await
    .map_err(native_error)?
}

#[tauri::command]
pub async fn list_ai_providers(
    app: AppHandle,
) -> Result<Vec<crate::ai::AiProviderProfile>, CommandError> {
    tauri::async_runtime::spawn_blocking(move || {
        with_storage(&app, &app.state::<AppState>(), Storage::list_ai_profiles)
    })
    .await
    .map_err(native_error)?
}

fn saved_ai_profile(
    app: &AppHandle,
    id: &str,
) -> Result<crate::ai::AiProviderProfile, CommandError> {
    with_storage(app, &app.state::<AppState>(), |storage| {
        let profiles = storage.list_connection_profiles()?;
        let profile = profiles
            .iter()
            .find(|p| p.id == id)
            .ok_or_else(|| StorageError::NotFound("Provider tersimpan tidak ditemukan.".into()))?;
        if !profile.enabled
            || matches!(
                profile.access_state.as_str(),
                "revoked" | "reauth_required" | "identity_only"
            )
        {
            return Err(StorageError::InvalidInput(
                "Koneksi tidak memiliki akses AI aktif. Hubungkan ulang.".into(),
            ));
        }
        crate::connections::legacy(profile, Some(&storage.get_router_connection()?))
            .map_err(StorageError::InvalidInput)
    })
}

#[tauri::command]
pub async fn save_ai_provider(
    app: AppHandle,
    profile: crate::ai::AiProviderProfile,
    secret: Option<String>,
) -> Result<(), CommandError> {
    crate::ai::validate_profile(&profile).map_err(native_error)?;
    let connection = crate::ai::ConnectionProfile {
        id: profile.id.clone(),
        provider_id: profile.provider_type.clone(),
        connection_mode: "direct".into(),
        credential_owner: "forgekit".into(),
        router_instance_id: None,
        upstream_connection_ref: None,
        auth_method: if profile.provider_type == "local-llm" {
            "local_runtime"
        } else {
            "api_key"
        }
        .into(),
        label: profile.name,
        identity: None,
        registration_ref: None,
        credential_ref: Some(profile.key_reference),
        access_state: "pending".into(),
        enabled: true,
        fallback_eligible: "unknown".into(),
        fallback_disabled_reason: None,
        priority: 0,
        quota_bucket_refs: vec![format!("unverified:{}", profile.provider_type)],
        base_url: profile.base_url,
        model: profile.model,
        is_default: profile.is_default,
        created_at: profile.created_at,
        updated_at: profile.updated_at,
    };
    save_connection_profile(app, connection, secret).await
}

#[tauri::command]
pub async fn delete_ai_provider(app: AppHandle, id: String) -> Result<(), CommandError> {
    delete_connection_profile(app, id).await
}

#[tauri::command]
pub async fn test_ai_provider(
    app: AppHandle,
    profile: crate::ai::AiProviderProfile,
) -> Result<crate::ai::ProviderTestResult, CommandError> {
    tauri::async_runtime::spawn_blocking(move || {
        let saved = saved_ai_profile(&app, &profile.id)?;
        crate::ai::authorize_provider_access(&saved).map_err(native_error)?;
        crate::ai::test_ai_provider(&saved).map_err(native_error)
    })
    .await
    .map_err(native_error)?
}

#[tauri::command]
pub async fn list_connection_profiles(
    app: AppHandle,
) -> Result<Vec<crate::ai::ConnectionProfile>, CommandError> {
    tauri::async_runtime::spawn_blocking(move || {
        with_storage(
            &app,
            &app.state::<AppState>(),
            Storage::list_connection_profiles,
        )
    })
    .await
    .map_err(native_error)?
}

#[tauri::command]
pub async fn save_connection_profile(
    app: AppHandle,
    mut profile: crate::ai::ConnectionProfile,
    secret: Option<String>,
) -> Result<(), CommandError> {
    tauri::async_runtime::spawn_blocking(move || {
        let (existing, router) = with_storage(&app, &app.state::<AppState>(), |s| {
            Ok((s.list_connection_profiles()?, s.get_router_connection()?))
        })?;
        // Migrations 0015/0016 retired local inference; never let a save re-enable it.
        if profile.provider_id == "local-llm" || profile.auth_method == "local_runtime" {
            return Err(native_error(
                "Inferensi lokal sudah dihentikan. Pilih akun provider AI.",
            ));
        }
        let old = existing.iter().find(|p| p.id == profile.id);
        if let Some(old) = old {
            crate::connections::validate_destination(old, &profile).map_err(native_error)?;
        }
        if crate::routing::is_profile_active(&profile.id) {
            return Err(native_error(
                "Koneksi masih dipakai tugas aktif. Hentikan tugas sebelum mengubah credential.",
            ));
        }
        if profile.auth_method == "oauth_browser"
            && (old.is_none_or(|p| p.auth_method != "oauth_browser") || secret.is_some())
        {
            return Err(native_error(
                "Credential OAuth hanya dapat diperbarui melalui login browser.",
            ));
        }
        profile.identity = old.and_then(|p| p.identity.clone());
        profile.registration_ref = old.and_then(|p| p.registration_ref.clone());
        profile.upstream_connection_ref = None;
        profile.created_at = old
            .map(|p| p.created_at.clone())
            .unwrap_or_else(crate::storage::now_string);
        profile.updated_at = crate::storage::now_string();
        if profile.connection_mode == "router" {
            if secret.is_some() {
                return Err(native_error(
                    "Credential router disimpan pada gateway, bukan profil upstream.",
                ));
            }
            profile.credential_ref = None;
            profile.router_instance_id = Some(router.id.clone());
            profile.base_url = crate::connections::inference_base(&router);
            profile.auth_method = "router_dashboard".into();
            profile.quota_bucket_refs = vec![format!("router:{}", router.id)];
        } else {
            profile.credential_ref = Some(
                old.and_then(|p| p.credential_ref.clone())
                    .unwrap_or_else(|| format!("provider-{}", profile.id)),
            );
            profile.router_instance_id = None;
        }
        profile.access_state = if old
            .is_some_and(|p| p.model == profile.model && p.base_url == profile.base_url)
            && secret.is_none()
        {
            old.unwrap().access_state.clone()
        } else {
            "pending".into()
        };
        profile.fallback_eligible =
            if profile.access_state == "ready" && profile.connection_mode == "direct" {
                "supported"
            } else {
                "unknown"
            }
            .into();
        crate::ai::validate_connection_profile(&profile).map_err(native_error)?;
        crate::connections::legacy(&profile, Some(&router)).map_err(native_error)?;
        let key_ref = profile.credential_ref.as_deref();
        let previous_secret = if let (Some(key_ref), Some(key)) = (key_ref, secret.as_ref()) {
            let previous = crate::ai::optional_keychain_secret(key_ref).map_err(native_error)?;
            crate::ai::set_keychain_secret(key_ref, key).map_err(native_error)?;
            previous
        } else {
            None
        };
        let result = with_storage(&app, &app.state::<AppState>(), |storage| {
            storage.save_connection_profile(&profile)
        });
        if result.is_err() && secret.is_some() {
            if let Some(key_ref) = key_ref {
                if let Some(previous) = previous_secret {
                    crate::ai::set_keychain_secret(key_ref, &previous).map_err(native_error)?;
                } else {
                    crate::ai::delete_keychain_secret(key_ref).map_err(native_error)?;
                }
            }
        }
        result
    })
    .await
    .map_err(native_error)?
}

#[tauri::command]
pub async fn delete_connection_profile(app: AppHandle, id: String) -> Result<(), CommandError> {
    tauri::async_runtime::spawn_blocking(move || {
        let profiles = with_storage(
            &app,
            &app.state::<AppState>(),
            Storage::list_connection_profiles,
        )?;
        if crate::routing::is_profile_active(&id) {
            return Err(native_error(
                "Koneksi dipakai tugas aktif. Hentikan tugas sebelum memutuskan akun.",
            ));
        }
        if let Some(p) = profiles.into_iter().find(|item| item.id == id) {
            if p.connection_mode == "direct" {
                if let Some(key_ref) = p.credential_ref {
                    if p.auth_method == "codex_oauth" {
                        // Codex tokens live in the account's private CODEX_HOME, not the Keychain.
                        crate::auth::codex::disconnect(&key_ref).map_err(native_error)?;
                    } else {
                        crate::ai::delete_keychain_secret(&key_ref).map_err(native_error)?;
                    }
                }
            }
        }
        with_storage(&app, &app.state::<AppState>(), |storage| {
            storage.delete_connection_profile(&id)
        })
    })
    .await
    .map_err(native_error)?
}

#[tauri::command]
pub async fn set_primary_profile(app: AppHandle, id: String) -> Result<(), CommandError> {
    tauri::async_runtime::spawn_blocking(move || {
        with_storage(&app, &app.state::<AppState>(), |storage| {
            storage.set_primary_connection_profile(&id)
        })
    })
    .await
    .map_err(native_error)?
}

#[tauri::command]
pub async fn get_fallback_policy(
    app: AppHandle,
) -> Result<crate::ai::FallbackPolicy, CommandError> {
    tauri::async_runtime::spawn_blocking(move || {
        with_storage(&app, &app.state::<AppState>(), Storage::get_fallback_policy)
    })
    .await
    .map_err(native_error)?
}

#[tauri::command]
pub async fn save_fallback_policy(
    app: AppHandle,
    policy: crate::ai::FallbackPolicy,
) -> Result<(), CommandError> {
    tauri::async_runtime::spawn_blocking(move || {
        with_storage(&app, &app.state::<AppState>(), |storage| {
            storage.save_fallback_policy(&policy)
        })
    })
    .await
    .map_err(native_error)?
}

#[tauri::command]
pub async fn get_router_connection(
    app: AppHandle,
) -> Result<crate::ai::RouterConnection, CommandError> {
    tauri::async_runtime::spawn_blocking(move || {
        with_storage(
            &app,
            &app.state::<AppState>(),
            Storage::get_router_connection,
        )
    })
    .await
    .map_err(native_error)?
}

#[tauri::command]
pub async fn save_router_connection(
    app: AppHandle,
    mut router: crate::ai::RouterConnection,
    secret: Option<String>,
) -> Result<(), CommandError> {
    tauri::async_runtime::spawn_blocking(move || {
        crate::connections::validate_router(&router).map_err(native_error)?;
        router.detected_version = None;
        router.management_access = "unknown".into();
        router.last_verified_at = None;
        let profiles = with_storage(
            &app,
            &app.state::<AppState>(),
            Storage::list_connection_profiles,
        )?;
        if profiles
            .iter()
            .any(|p| p.connection_mode == "router" && crate::routing::is_profile_active(&p.id))
        {
            return Err(native_error(
                "Gateway dipakai tugas aktif. Hentikan tugas sebelum mengubah gateway.",
            ));
        }
        let old = with_storage(
            &app,
            &app.state::<AppState>(),
            Storage::get_router_connection,
        )?;
        let previous_secret = crate::ai::optional_keychain_secret(&router.inference_credential_ref).map_err(native_error)?;
        if secret.is_none() && previous_secret.is_some() {
            crate::connections::validate_retained_credential(&old.base_url, &router.base_url)
                .map_err(native_error)?;
        }
        if let Some(key) = secret.as_ref() {
            crate::ai::set_keychain_secret(&router.inference_credential_ref, key)
                .map_err(native_error)?;
        }
        let result = with_storage(&app, &app.state::<AppState>(), |storage| {
            let old = storage.get_router_connection()?;
            let tx = storage.connection.unchecked_transaction()?;
            crate::ai::save_router_connection(&tx, &router)?;
            if old.base_url != router.base_url || secret.is_some() {
                let base = crate::connections::inference_base(&router);
                tx.execute("UPDATE connection_profile SET base_url=?1,access_state='pending',fallback_eligible='unknown',updated_at=?2 WHERE router_instance_id=?3",rusqlite::params![base,crate::storage::now_string(),router.id])?;
                tx.execute("UPDATE ai_provider_profile SET base_url=?1 WHERE id IN (SELECT id FROM connection_profile WHERE router_instance_id=?2)",rusqlite::params![base,router.id])?;
                tx.execute("DELETE FROM connection_verification WHERE profile_id IN (SELECT id FROM connection_profile WHERE router_instance_id=?1)",[&router.id])?;
            }
            tx.commit()?;
            Ok(())
        });
        if result.is_err() && secret.is_some() {
            if let Some(previous) = previous_secret {
                crate::ai::set_keychain_secret(&router.inference_credential_ref, &previous).map_err(native_error)?;
            } else {
                crate::ai::delete_keychain_secret(&router.inference_credential_ref).map_err(native_error)?;
            }
        }
        result
    })
    .await
    .map_err(native_error)?
}

#[tauri::command]
pub async fn test_router_connection(
    app: AppHandle,
    _router: Option<crate::ai::RouterConnection>,
) -> Result<crate::ai::ProviderTestResult, CommandError> {
    tauri::async_runtime::spawn_blocking(move || {
        let router = with_storage(
            &app,
            &app.state::<AppState>(),
            Storage::get_router_connection,
        )?;
        crate::ai::test_router_connection(&router).map_err(native_error)
    })
    .await
    .map_err(native_error)?
}

#[tauri::command]
pub async fn probe_router_models(
    app: AppHandle,
) -> Result<crate::connections::RouterProbe, CommandError> {
    tauri::async_runtime::spawn_blocking(move || {
        let mut router = with_storage(
            &app,
            &app.state::<AppState>(),
            Storage::get_router_connection,
        )?;
        let probe = crate::connections::probe_router(&router).map_err(native_error)?;
        router.detected_version = probe.detected_version.clone();
        router.last_verified_at = Some(crate::storage::now_string());
        router.management_access = "unknown".into();
        with_storage(&app, &app.state::<AppState>(), |s| {
            s.save_router_connection(&router)
        })?;
        Ok(probe)
    })
    .await
    .map_err(native_error)?
}

#[tauri::command]
pub async fn get_provider_model_catalog(
    app: AppHandle,
    profile_id: String,
    authorize: Option<bool>,
) -> Result<Vec<crate::model_catalog::ProviderModel>, CommandError> {
    tauri::async_runtime::spawn_blocking(move || {
        let profile = saved_ai_profile(&app, &profile_id)?;
        if authorize == Some(true) {
            crate::ai::authorize_provider_access(&profile).map_err(native_error)?;
        }
        crate::model_catalog::catalog(&profile, true).map_err(native_error)
    })
    .await
    .map_err(native_error)?
}

#[tauri::command]
pub async fn get_provider_usage(
    app: AppHandle,
    profile_id: String,
) -> Result<crate::provider_usage::ProviderUsage, CommandError> {
    tauri::async_runtime::spawn_blocking(move || {
        let profile = saved_ai_profile(&app, &profile_id)?;
        let (connection, router) = with_storage(&app, &app.state::<AppState>(), |storage| {
            let connection = storage
                .list_connection_profiles()?
                .into_iter()
                .find(|p| p.id == profile_id)
                .ok_or_else(|| StorageError::NotFound("Akun tersimpan tidak ditemukan.".into()))?;
            Ok((connection, storage.get_router_connection()?))
        })?;
        crate::provider_usage::read_connection(&profile, &connection, &router).map_err(native_error)
    })
    .await
    .map_err(native_error)?
}

#[tauri::command]
pub async fn list_provider_models(
    app: AppHandle,
    profile_id: String,
) -> Result<Vec<String>, CommandError> {
    tauri::async_runtime::spawn_blocking(move || {
        let profile = saved_ai_profile(&app, &profile_id)?;
        crate::connections::models(&profile).map_err(native_error)
    })
    .await
    .map_err(native_error)?
}

#[tauri::command]
pub async fn list_task_attempts(
    app: AppHandle,
    task_id: String,
) -> Result<Vec<serde_json::Value>, CommandError> {
    tauri::async_runtime::spawn_blocking(move || with_storage(&app,&app.state::<AppState>(),|s| {
        let mut stmt = s.connection.prepare("SELECT id,profile_id,provider_id,model_id,status,started_at,completed_at,error FROM task_attempt WHERE task_id=?1 ORDER BY started_at,rowid")?;
        let rows = stmt.query_map([task_id],|r| Ok(serde_json::json!({"id":r.get::<_,String>(0)?,"profileId":r.get::<_,String>(1)?,"providerId":r.get::<_,String>(2)?,"modelId":r.get::<_,String>(3)?,"status":r.get::<_,String>(4)?,"startedAt":r.get::<_,String>(5)?,"completedAt":r.get::<_,Option<String>>(6)?,"error":r.get::<_,Option<String>>(7)?})))?.collect::<Result<Vec<_>,_>>()?;
        Ok(rows)
    })).await.map_err(native_error)?
}

#[tauri::command]
pub async fn test_connection_profile(
    app: AppHandle,
    profile: crate::ai::ConnectionProfile,
) -> Result<crate::ai::ProviderTestResult, CommandError> {
    tauri::async_runtime::spawn_blocking(move || {
        let original = with_storage(&app, &app.state::<AppState>(), |s| {
            s.list_connection_profiles()?
                .into_iter()
                .find(|p| p.id == profile.id)
                .ok_or_else(|| StorageError::NotFound("Koneksi telah dilepas.".into()))
        })?;
        let _capacity = crate::routing::CapacityLease::acquire(&original).map_err(native_error)?;
        let saved = saved_ai_profile(&app, &profile.id)?;
        crate::ai::authorize_provider_access(&saved).map_err(native_error)?;
        let result = crate::ai::test_ai_provider(&saved).map_err(native_error)?;
        with_storage(&app, &app.state::<AppState>(), |s| {
            let profile = s
                .list_connection_profiles()?
                .into_iter()
                .find(|p| p.id == saved.id)
                .ok_or_else(|| StorageError::NotFound("Koneksi telah dilepas.".into()))?;
            if profile.model == saved.model
                && profile.base_url == saved.base_url
                && profile.updated_at == original.updated_at
            {
                crate::connections::verify(&s.connection, &profile, result.ok)?;
            }
            Ok(())
        })?;
        Ok(result)
    })
    .await
    .map_err(native_error)?
}

#[tauri::command]
pub fn cancel_provider_browser(session_id: String) {
    crate::auth::browser::cancel(&session_id);
}

#[tauri::command]
pub async fn connect_provider_browser(
    app: AppHandle,
    provider_id: String,
    _router_base_url: Option<String>,
    session_id: Option<String>,
) -> Result<crate::ai::ProviderConnectSession, CommandError> {
    tauri::async_runtime::spawn_blocking(move || {
        let id = session_id.ok_or_else(|| native_error("ID sesi login tidak tersedia."))?;
        if id.len() > 100 || id.is_empty() || !id.chars().all(|c| c.is_ascii_alphanumeric() || c == '-') { return Err(native_error("ID sesi login tidak sah.")); }
        if provider_id == "claude" || provider_id == "antigravity-9router" {
            let base = if provider_id == "antigravity-9router" { Some(with_storage(&app, &app.state::<AppState>(), Storage::get_router_connection)?.base_url) } else { None };
            let session = crate::ai::create_connect_session(&provider_id, base.as_deref()).map_err(native_error)?;
            if !std::process::Command::new("/usr/bin/open").arg(&session.auth_url).status().is_ok_and(|s| s.success()) { return Err(native_error("Browser sistem tidak dapat dibuka.")); }
            return Ok(session);
        }
        let mut profile = if provider_id == "openai" {
            crate::auth::codex::sign_in(&id)
        } else {
            if provider_id != "google-gemini" { return Err(native_error("Provider browser tidak didukung.")); }
            crate::auth::google::sign_in(&id)
        }.map_err(native_error)?;
        let result = with_storage(&app, &app.state::<AppState>(), |storage| {
            profile.is_default = storage.list_connection_profiles()?.is_empty();
            storage.save_connection_profile(&profile)
        });
        if result.is_err() { if let Some(key) = &profile.credential_ref { let _ = crate::ai::delete_keychain_secret(key); } }
        result?;
        let legacy = crate::connections::legacy(&profile, None).map_err(native_error)?;
        let verified = crate::ai::test_ai_provider(&legacy).is_ok_and(|r| r.ok);
        with_storage(&app, &app.state::<AppState>(), |s| { crate::connections::verify(&s.connection, &profile, verified)?; Ok(()) })?;
        Ok(crate::ai::ProviderConnectSession { session_id: id, provider_id, mode: profile.connection_mode, auth_url: String::new(), status: "connected".into(), expires_at: String::new(), message: Some(if verified { "Akun tersambung dan respons AI berhasil diuji." } else { "Login selesai. Respons model belum terverifikasi; gunakan Uji koneksi pada akun." }.into()) })
    })
    .await
    .map_err(native_error)?
}

#[tauri::command]
pub async fn list_chat_threads(app: AppHandle) -> Result<Vec<crate::ai::ChatThread>, CommandError> {
    tauri::async_runtime::spawn_blocking(move || {
        with_storage(&app, &app.state::<AppState>(), Storage::list_chat_threads)
    })
    .await
    .map_err(native_error)?
}

#[tauri::command]
pub async fn create_chat_thread(
    app: AppHandle,
    title: String,
    provider_id: Option<String>,
    model: String,
    system_prompt: Option<String>,
) -> Result<crate::ai::ChatThread, CommandError> {
    tauri::async_runtime::spawn_blocking(move || {
        with_storage(&app, &app.state::<AppState>(), |storage| {
            storage.create_chat_thread(
                &title,
                provider_id.as_deref(),
                &model,
                system_prompt.as_deref(),
            )
        })
    })
    .await
    .map_err(native_error)?
}

#[tauri::command]
pub async fn rename_chat_thread(
    app: AppHandle,
    id: String,
    title: String,
) -> Result<(), CommandError> {
    tauri::async_runtime::spawn_blocking(move || {
        with_storage(&app, &app.state::<AppState>(), |storage| {
            storage.rename_chat_thread(&id, &title)
        })
    })
    .await
    .map_err(native_error)?
}

#[tauri::command]
pub async fn delete_chat_thread(app: AppHandle, id: String) -> Result<(), CommandError> {
    crate::ai::cancel_ai_stream(&id);
    tauri::async_runtime::spawn_blocking(move || {
        with_storage(&app, &app.state::<AppState>(), |storage| {
            storage.delete_chat_thread(&id)
        })
    })
    .await
    .map_err(native_error)?
}

#[tauri::command]
pub async fn load_chat_thread(
    app: AppHandle,
    thread_id: String,
) -> Result<Vec<crate::ai::ChatMessage>, CommandError> {
    tauri::async_runtime::spawn_blocking(move || {
        with_storage(&app, &app.state::<AppState>(), |storage| {
            storage.list_chat_messages(&thread_id)
        })
    })
    .await
    .map_err(native_error)?
}

fn run_connected<T>(
    app: &AppHandle,
    task_id: &str,
    primary: &crate::ai::AiProviderProfile,
    lease: &crate::ai::StreamLease,
    allow_fallback: bool,
    mut operation: impl FnMut(&crate::ai::AiProviderProfile, u64) -> Result<T, String>,
) -> Result<T, String> {
    let (candidates, mut policy) = with_storage(app,&app.state::<AppState>(),|s| {
        let profiles = s.list_connection_profiles()?;
        let router = s.get_router_connection()?;
        let mut policy = s.get_fallback_policy()?;
        if allow_fallback {
            // Every verified account on the selected provider can supply independent capacity.
            let selected = profiles.iter().find(|p| p.id == primary.id).ok_or_else(|| StorageError::InvalidInput("Akun pilihan tidak ditemukan.".into()))?;
            policy.enabled = true;
            policy.routing_owner = "forgekit".into();
            policy.allow_cross_provider = false;
            policy.allow_model_change = false;
            policy.allowed_provider_ids = vec![selected.provider_id.clone()];
            policy.ordered_profile_ids = profiles.iter().filter(|p| p.id != selected.id && p.provider_id == selected.provider_id && p.base_url == selected.base_url && p.auth_method == selected.auth_method).map(|p| p.id.clone()).collect();
            policy.max_attempts = 5;
            policy.max_elapsed_ms = if s.get_creative_task(task_id)?["kind"] == "model3d" {1_200_000} else {600_000};
        }
        let mut ordered = profiles.iter().filter(|p|p.id == primary.id).cloned().collect::<Vec<_>>();
        for id in &policy.ordered_profile_ids {
            if let Some(p) = profiles.iter().find(|p|p.id == *id && p.id != primary.id) { ordered.push(p.clone()); }
        }
        let candidates = ordered.into_iter().filter_map(|p| {
            let mut p = p;
            let mut transport = match crate::connections::legacy(&p,Some(&router)) {
                Ok(transport) => transport,
                Err(error) if p.id == primary.id => return Some(Err(StorageError::InvalidInput(error))),
                Err(_) => return None,
            };
            if p.id == primary.id || allow_fallback {
                transport.model = primary.model.clone();
                transport.reasoning_effort = primary.reasoning_effort.clone();
                p.model = primary.model.clone();
            }
            let mut blocked_until = crate::provider_usage::blocked_until_ms(&transport);
            for bucket in &p.quota_bucket_refs {
                let value = match s.connection.query_row("SELECT COALESCE(MAX(until_ms),0) FROM connection_cooldown WHERE bucket_id=?1",[bucket],|r|r.get::<_,u64>(0)) {
                    Ok(value) => value,
                    Err(error) => return Some(Err(error.into())),
                };
                blocked_until = blocked_until.max(value);
            }
            Some(Ok(crate::routing::Candidate { connection:p,transport,blocked_until }))
        }).collect::<Result<Vec<_>,StorageError>>()?;
        Ok((candidates,policy))
    }).map_err(|e|e.message)?;
    if !allow_fallback {
        policy.enabled = false;
    }
    crate::routing::run(
        task_id,
        &candidates,
        &policy,
        lease,
        |attempt, cooldown| {
            with_storage(app,&app.state::<AppState>(),|s| {
            let tx = s.connection.unchecked_transaction()?;
            crate::ai::record_task_attempt(&tx,attempt)?;
            let profile = candidates.iter().find(|c|c.connection.id == attempt.profile_id).ok_or_else(||StorageError::NotFound("Koneksi attempt tidak ditemukan.".into()))?;
            for bucket in &profile.connection.quota_bucket_refs {
                if cooldown > 0 { tx.execute("INSERT INTO connection_cooldown(bucket_id,until_ms) VALUES(?1,?2) ON CONFLICT(bucket_id) DO UPDATE SET until_ms=MAX(until_ms,excluded.until_ms)",rusqlite::params![bucket,crate::routing::now_ms()+cooldown])?; }
            }
            if attempt.status == "started" {
                let provider = serde_json::json!({"profileId":attempt.profile_id,"adapterId":profile.transport.provider_type,"modelId":attempt.model_id,"reasoningEffort":profile.transport.reasoning_effort});
                tx.execute("UPDATE creative_task SET request_json=json_set(request_json,'$.provider',json(?2)) WHERE id=?1",rusqlite::params![task_id,provider.to_string()])?;
            }
            if attempt.status == "succeeded" {
                tx.execute("UPDATE connection_profile SET access_state='ready',fallback_eligible=CASE WHEN connection_mode='direct' THEN 'supported' ELSE 'unknown' END WHERE id=?1 AND model=?2 AND base_url=?3",rusqlite::params![profile.connection.id,profile.connection.model,profile.connection.base_url])?;
            }
            if attempt.error.as_deref().is_some_and(|e|crate::routing::Failure::classify(e)==crate::routing::Failure::Authentication) {
                tx.execute("UPDATE connection_profile SET access_state=CASE WHEN connection_mode='router' THEN 'pending' ELSE 'reauth_required' END WHERE id=?1",[&attempt.profile_id])?;
            }
            tx.commit()?;
            Ok(())
        }).map_err(|e|e.message)?;
            use tauri::Emitter;
            app.emit("forgekit:ai-attempt",serde_json::json!({"taskId":task_id,"attempt":attempt,"accountLabel":candidates.iter().find(|c|c.connection.id == attempt.profile_id).map(|c| if c.connection.connection_mode=="router" {"Otomatis via 9router"} else {c.connection.label.as_str()})})).map_err(|_|"Event attempt gagal dikirim.".to_string())
        },
        |active, seconds| {
            let result = operation(active, seconds);
            if let Err(error) = &result {
                if matches!(crate::routing::Failure::classify(error), crate::routing::Failure::RateLimit | crate::routing::Failure::Quota | crate::routing::Failure::Outage) {
                    let unsafe_switch = with_storage(app, &app.state::<AppState>(), |s| Ok(s.ai_checkpoint(task_id)?.is_some_and(|cp| !cp.can_switch_account()))).map_err(|e| e.message)?;
                    if unsafe_switch { return Err(format!("[UNKNOWN_RESULT] Hasil atau operasi sudah tercatat; pergantian akun dihentikan. {error}")); }
                }
            }
            result
        },
    )
}

fn run_studio_tool(
    app: &AppHandle,
    task_id: &str,
    target: &crate::studio::TargetStamp,
    call: &crate::tools::ToolCall,
    lease: &crate::ai::StreamLease,
    chat: bool,
    writable: bool,
) -> Result<serde_json::Value, String> {
    if lease.is_cancelled() {
        return Err("[CANCELLED][TOOL_NOT_DISPATCHED] Permintaan dibatalkan sebelum operasi.".into());
    }
    with_storage(app, &app.state::<AppState>(), |s| {
        s.creative_stage(task_id, "tool_running", None)
    })
    .map_err(|e| e.message)?;
    let prior = with_storage(app, &app.state::<AppState>(), |s| {
        s.begin_agent_tool(task_id, &target.studio_id, call)
    })
    .map_err(|e| e.message)?;
    let result = if let Some(value) = prior {
        Ok(value)
    } else {
        let (result, not_executed) = if lease.is_cancelled() {
            (Err("[CANCELLED][TOOL_NOT_DISPATCHED] Permintaan dibatalkan sebelum operasi.".into()), true)
        } else {
            match crate::studio::agent_call(target, call, writable) {
                Ok(val) => (Ok(val), false),
                Err(err) => {
                    let not_exec = err.is_not_executed();
                    (Err(err.to_string()), not_exec)
                }
            }
        };
        with_storage(app, &app.state::<AppState>(), |s| {
            s.finish_agent_tool_with_status(task_id, &call.id, &result, not_executed)
        })
        .map_err(|e| e.message)?;
        result
    };
    with_storage(app, &app.state::<AppState>(), |s| {
        s.creative_stage(task_id, if chat { "streaming" } else { "planning" }, None)
    })
    .map_err(|e| e.message)?;
    result
}

#[tauri::command]
pub async fn prepare_attachment(name: String, base64: String) -> Result<crate::references::ReferenceImage, CommandError> {
    tauri::async_runtime::spawn_blocking(move || crate::attachments::prepare(&name, &base64).map_err(native_error)).await.map_err(native_error)?
}

#[tauri::command]
pub async fn send_chat_message(
    app: AppHandle,
    thread_id: String,
    user_content: String,
    provider: crate::ai::AiProviderProfile,
    request_id: String,
    mode: String,
    context_snapshot_id: Option<String>,
    studio_id: Option<String>,
    creative_version_id: Option<String>,
    reference_images: Option<Vec<crate::references::ReferenceImage>>,
) -> Result<crate::ai::ChatMessage, CommandError> {
    if user_content.trim().is_empty()
        || user_content.len() > 128000
        || request_id.is_empty()
        || request_id.len() > 128
        || request_id.chars().any(char::is_control)
        || !matches!(mode.as_str(), "auto" | "ask" | "plan")
    {
        return Err(native_error(
            "Pesan, ID permintaan, atau mode tugas tidak sah.",
        ));
    }
    let lease = crate::ai::begin_stream(&thread_id).map_err(native_error)?;
    tauri::async_runtime::spawn_blocking(move || {
        let attachment = if let Some(ref id) = creative_version_id {
            if studio_id.is_none() { return Err(native_error("Hubungkan map tujuan sebelum menerapkan karya.")); }
            let root = workspace_root(&app)?;
            Some(with_storage(&app, &app.state::<AppState>(), |storage| {
                let version = storage.load_creative_version(id)?;
                storage.verify_creative_artifact(&root, &version)?;
                Ok((crate::creative::application_context(&version)?, version["document"]["kind"].as_str().unwrap_or("").to_owned()))
            })?)
        } else { None };
        let saved = saved_ai_profile(&app, &provider.id)?;
        let provider = crate::model_catalog::select(saved, Some(&provider.model), provider.reasoning_effort.as_deref()).map_err(native_error)?;
        if let Some(replay) = with_storage(&app, &app.state::<AppState>(), |s| {
            s.begin_reference_turn(&request_id, &thread_id, &user_content, &provider, &mode, context_snapshot_id.as_deref(), studio_id.as_deref(), creative_version_id.as_deref().zip(attachment.as_ref().map(|a| a.1.as_str())), reference_images.as_deref().unwrap_or(&[]))
        })? {
            return Ok(replay);
        }
        let result = (|| {
            let context = if let Some(ref id) = context_snapshot_id {
                with_storage(&app, &app.state::<AppState>(), |s| s.creative_stage(&request_id,"reading_context",None))?;
                Some(with_storage(&app, &app.state::<AppState>(), |s| s.context_for_chat(id))?)
            } else { None };
            if let (Some(snapshot), Some(target)) = (context.as_ref(), studio_id.as_deref()) {
                if snapshot.studio_id != target { return Err(native_error("Snapshot dan map tujuan berbeda. Kirim ulang dengan konteks map yang aktif.")); }
            }
            let frozen = studio_id.as_deref().map(|id| crate::studio::freeze(id, context.as_ref())).transpose().map_err(native_error)?;
            let history = with_storage(&app, &app.state::<AppState>(), |s| {
                s.list_chat_messages(&thread_id)
            })?;
            let mut definitions = if context.is_some() { crate::tools::definitions() } else { vec![] };
            if let Some(ref target) = frozen {
                definitions.extend(crate::studio::agent_catalog(target, mode == "auto").map_err(native_error)?);
            }
            let mut messages = vec![serde_json::json!({"role":"system","content":crate::agent::instructions_with_vault(&user_content,"chat",context.as_ref(),studio_id.as_deref()).map_err(native_error)?})];
            if let Some(ref attachment) = attachment {
                messages.push(serde_json::json!({"role":"system","content":attachment.0}));
            }
            if mode != "auto" { messages.push(serde_json::json!({"role":"system","content":"Percakapan lama ini hanya baca. Jangan melakukan perubahan."})); }
            for message in &history {
                let mut value = serde_json::json!({"role":message.role,"content":message.content});
                if message.role == "user" {
                    if let Some(ref references) = message.tool_results {
                        let images: Vec<crate::references::ReferenceImage> = serde_json::from_value(references.clone()).map_err(native_error)?;
                        crate::references::attach(&mut value, &images).map_err(native_error)?;
                    }
                }
                messages.push(value);
            }
            if mode == "auto" {
                definitions.extend(crate::studio::luau_checks::definitions());
                definitions.extend(crate::model3d::blender::definitions());
            }
            // User-configured MCP servers live only for this request; dropping the set stops them.
            let connectors = with_storage(&app, &app.state::<AppState>(), Storage::list_mcp_connectors)?;
            let mut mcp = if connectors.iter().any(|c| c.is_enabled) {
                crate::mcp::Toolset::start(&connectors, mode == "auto", &|| lease.is_cancelled())
            } else {
                crate::mcp::Toolset::default()
            };
            definitions.extend(mcp.definitions.iter().cloned());
            if !mcp.warnings.is_empty() {
                messages.insert(1, serde_json::json!({"role":"system","content":format!(
                    "Sebagian konektor MCP tidak dapat dijalankan dan tool-nya tidak tersedia: {}",
                    mcp.warnings.join("; ")
                )}));
            }
            with_storage(&app, &app.state::<AppState>(), |s| s.creative_stage(&request_id,"streaming",None))?;
            let content = run_connected(&app,&request_id,&provider,&lease,true,|active,_seconds| {
                let mut cp = checkpoint_for(&app,&request_id,active,&messages,!definitions.is_empty(),true)?;
                let tokens = cp.budget.output_tokens;
                // Live preview only: each account attempt starts a fresh draft, and the
                // persisted assistant message (not this stream) completes the turn.
                emit_chat_chunk(&app, &thread_id, &request_id, "", false, true);
                let stream = |chunk: &str| { emit_chat_chunk(&app, &thread_id, &request_id, chunk, false, false); Ok(()) };
                crate::ai::execute_agent_checkpoint(active, &lease, &definitions, tokens, &mut cp, stream, |call| {
                    if crate::studio::luau_checks::handles(call) { return run_luau_check(&app,&request_id,call); }
                    if crate::model3d::blender::handles(call) { return run_blender_tool(&app,&request_id,&user_content,active,call,&lease); }
                    if call.name.starts_with("forgekit_studio_") {
                        return run_studio_tool(&app,&request_id,frozen.as_ref().ok_or("Tidak ada target Studio.")?,call,&lease,true,mode == "auto");
                    }
                    if crate::mcp::handles(call) {
                        with_storage(&app, &app.state::<AppState>(), |s| s.creative_stage(&request_id,"tool_running",None)).map_err(|e|e.message)?;
                        let output = mcp.call(call, &|| lease.is_cancelled());
                        with_storage(&app, &app.state::<AppState>(), |s| s.creative_stage(&request_id,"streaming",None)).map_err(|e|e.message)?;
                        return output;
                    }
                    use tauri::Emitter;
                    let snapshot = context.as_ref().ok_or("Tidak ada snapshot map.")?;
                    with_storage(&app, &app.state::<AppState>(), |s| s.creative_stage(&request_id,"tool_running",None)).map_err(|e|e.message)?;
                    crate::studio::validate_snapshot(snapshot)?;
                    let receipt = crate::tools::execute(snapshot, call)?;
                    let receipt = with_storage(&app, &app.state::<AppState>(), |s| s.record_tool_receipt(&request_id,&receipt)).map_err(|e|e.message)?;
                    app.emit("forgekit:ai-tool",serde_json::json!({"threadId":thread_id,"requestId":request_id,"receipt":receipt})).map_err(|_| "Event tool gagal dikirim.")?;
                    with_storage(&app, &app.state::<AppState>(), |s| s.creative_stage(&request_id,"streaming",None)).map_err(|e|e.message)?;
                    serde_json::to_value(receipt).map_err(|_| "Receipt tool tidak sah.".into())
                }, |cp| persist_checkpoint(&app,&request_id,active,cp))
            }).map_err(native_error)?;
            if lease.is_cancelled() { return Err(native_error("Permintaan dibatalkan.")); }
            if let Some(target) = frozen.as_ref() { crate::studio::current(target).map_err(native_error)?; }
            with_storage(&app, &app.state::<AppState>(), |s| s.complete_chat_turn(&request_id,&content))
        })();
        emit_chat_chunk(&app, &thread_id, &request_id, "", true, false);
        if let Err(ref error) = result {
            with_storage(&app, &app.state::<AppState>(), |s| s.creative_stage(
                &request_id, if lease.is_cancelled() {"cancelled"} else {"failed"}, Some(&error.message),
            ))?;
        }
        publish_activity(&app, &request_id);
        result
    }).await.map_err(native_error)?
}

/// Best-effort live text for the chat UI. Losing an event never affects the saved turn.
fn emit_chat_chunk(app: &AppHandle, thread_id: &str, request_id: &str, chunk: &str, done: bool, reset: bool) {
    use tauri::Emitter;
    let _ = app.emit(
        "forgekit:ai-chunk",
        serde_json::json!({"threadId":thread_id,"requestId":request_id,"chunk":chunk,"done":done,"reset":reset}),
    );
}

#[tauri::command]
pub async fn latest_chat_turn(
    app: AppHandle,
    thread_id: String,
) -> Result<Option<serde_json::Value>, CommandError> {
    tauri::async_runtime::spawn_blocking(move || {
        with_storage(&app, &app.state::<AppState>(), |s| {
            s.latest_chat_turn(&thread_id)
        })
    })
    .await
    .map_err(native_error)?
}

#[tauri::command]
pub fn cancel_chat_stream(thread_id: String) -> Result<(), CommandError> {
    crate::ai::cancel_ai_stream(&thread_id);
    Ok(())
}

#[tauri::command]
pub async fn generate_creative(
    app: AppHandle,
    mut request: crate::creative::CreativeRequest,
    studio_id: Option<String>,
    context_snapshot_id: Option<String>,
) -> Result<serde_json::Value, CommandError> {
    request.prepare_image_input();
    request.validate()?;
    if request.provider_id.as_deref().is_none_or(|id| id.is_empty()) {
        return Err(native_error("Pilih akun provider dan model sebelum membuat karya."));
    }
    if request.blender { return Err(native_error("Gunakan AI Chat untuk build Blender, atau build versi Model 3D tersimpan.")); }
    let lease =
        crate::ai::begin_stream(&format!("creative:{}", request.task_id)).map_err(native_error)?;
    tauri::async_runtime::spawn_blocking(move || {
        let provider = request
            .provider_id
            .as_ref()
            .map(|id| {
                let saved = saved_ai_profile(&app, id)?;
                crate::model_catalog::select(
                    saved,
                    request.model_id.as_deref(),
                    request.reasoning_effort.as_deref(),
                )
                .map_err(native_error)
            })
            .transpose()?;
        let parent = request
            .parent_version_id
            .as_ref()
            .map(|id| {
                with_storage(&app, &app.state::<AppState>(), |s| {
                    let v = s.load_creative_version(id)?;
                    s.verify_creative_artifact(
                        &workspace_root(&app).map_err(|e| StorageError::InvalidInput(e.message))?,
                        &v,
                    )?;
                    Ok(v["document"].clone())
                })
            })
            .transpose()?;
        if request.kind=="model3d" && request.reference_images.is_empty() {
            if let Some(parent)=request.parent_version_id.as_deref(){request.reference_images=blender_references(&app,parent)?;}
        }
        with_storage(&app, &app.state::<AppState>(), |s| {
            s.create_creative_agent_task(&request, provider.as_ref(), studio_id.as_deref(), context_snapshot_id.as_deref())
        })?;
        let result = (|| {
            with_storage(&app, &app.state::<AppState>(), |s| {
                s.creative_stage(&request.task_id, "planning", None)
            })?;
            if request.kind == "model3d" && crate::model3d::blender::binary().is_none() { return Err(native_error("Blender belum ditemukan. Pasang Blender lalu lanjutkan tugas; provider belum dijalankan.")); }
            let context = context_snapshot_id.as_deref().map(|id| with_storage(&app,&app.state::<AppState>(),|s|s.context_for_chat(id))).transpose()?;
            if let (Some(snapshot), Some(target)) = (context.as_ref(), studio_id.as_deref()) {
                if snapshot.studio_id != target { return Err(native_error("Snapshot dan map tujuan berbeda. Kirim ulang dengan konteks map yang aktif.")); }
            }
            let frozen = studio_id.as_deref().map(|id| crate::studio::freeze(id, context.as_ref())).transpose().map_err(native_error)?;
            let definitions = frozen.as_ref().map(|id|crate::studio::agent_catalog(id,false)).transpose().map_err(native_error)?.unwrap_or_default();
            let messages = crate::creative::messages(&request, parent.as_ref(), context.as_ref(), studio_id.as_deref()).map_err(native_error)?;
            let document = if let Some(provider) = provider.as_ref() {
                run_connected(
                    &app,
                    &request.task_id,
                    provider,
                    &lease,
                    true,
                    |active, seconds| {
                        let mut cp = checkpoint_for(&app,&request.task_id,active,&messages,!definitions.is_empty(),true)?;
                        cp.deadline_ms = cp.deadline_ms.min(crate::routing::now_ms() + seconds * 1000);
                        with_storage(&app, &app.state::<AppState>(), |s| s.creative_stage(&request.task_id, "streaming", None)).map_err(|e| e.message)?;
                        let document = if let Some(state)=cp.model_review.as_ref() {state.candidate.clone()} else {
                            crate::ai::execute_recipe_checkpoint(active,&lease,&definitions,crate::creative::output_tokens(&request.kind,&request.quality),&mut cp,
                                |call| run_studio_tool(&app,&request.task_id,frozen.as_ref().ok_or("Tidak ada target Studio.")?,call,&lease,false,false),
                                |cp| persist_checkpoint(&app,&request.task_id,active,cp),
                                |raw| crate::creative::parse(&request,raw))?
                        };
                        if request.kind=="model3d" && !crate::model3d::blender::visual_references(&request.reference_images).is_empty() {
                            crate::model3d::reference_model::refine(&workspace_root(&app).map_err(|e|e.message)?,&request,active,&lease,&mut cp,document,|cp|persist_checkpoint(&app,&request.task_id,active,cp))
                        } else {Ok(document)}
                    },
                )
                .map_err(native_error)?
            } else {
                crate::creative::plan(&request, None, parent.as_ref(), &lease)
                    .map_err(native_error)?
            };
            if lease.is_cancelled() {
                return Err(native_error("Permintaan dibatalkan."));
            }
            with_storage(&app, &app.state::<AppState>(), |s| {
                s.creative_stage(&request.task_id, "validating", None)
            })?;
            if let Some(target) = frozen.as_ref() { crate::studio::current(target).map_err(native_error)?; }
            let root = workspace_root(&app)?;
            if request.kind == "model3d" { crate::model3d::blender::build(&root, &document, &request.reference_images, || lease.is_cancelled()).map_err(native_error)?; }
            if lease.is_cancelled() { return Err(native_error("Permintaan dibatalkan.")); }
            with_storage(&app, &app.state::<AppState>(), |s| {
                s.save_creative_result(&root, &request, &document)
            })
        })();
        if let Err(ref error) = result {
            with_storage(&app, &app.state::<AppState>(), |s| {
                s.creative_stage(
                    &request.task_id,
                    if lease.is_cancelled() {
                        "cancelled"
                    } else {
                        "failed"
                    },
                    Some(&error.message),
                )
            })?;
        }
        publish_activity(&app, &request.task_id);
        result
    })
    .await
    .map_err(native_error)?
}

#[tauri::command]
pub async fn get_creative_task(
    app: AppHandle,
    id: String,
) -> Result<serde_json::Value, CommandError> {
    tauri::async_runtime::spawn_blocking(move || {
        with_storage(&app, &app.state::<AppState>(), |s| s.get_creative_task(&id))
    })
    .await
    .map_err(native_error)?
}
#[tauri::command]
pub async fn list_creative_versions(
    app: AppHandle,
    kind: String,
) -> Result<Vec<serde_json::Value>, CommandError> {
    tauri::async_runtime::spawn_blocking(move || {
        with_storage(&app, &app.state::<AppState>(), |s| {
            s.list_creative_versions(&kind)
        })
    })
    .await
    .map_err(native_error)?
}
#[tauri::command]
pub async fn load_creative_version(
    app: AppHandle,
    id: String,
) -> Result<serde_json::Value, CommandError> {
    tauri::async_runtime::spawn_blocking(move || {
        let root = workspace_root(&app)?;
        with_storage(&app, &app.state::<AppState>(), |s| {
            let version = s.load_creative_version(&id)?;
            s.verify_creative_artifact(&root, &version)?;
            Ok(version)
        })
    })
    .await
    .map_err(native_error)?
}
#[tauri::command]
pub fn cancel_creative(id: String) {
    crate::ai::cancel_ai_stream(&format!("creative:{id}"));
}

#[tauri::command]
pub async fn save_creative_revision(
    app: AppHandle,
    task_id: String,
    parent_version_id: Option<String>,
    document: serde_json::Value,
) -> Result<serde_json::Value, CommandError> {
    let lease = crate::ai::begin_stream(&format!("creative:{task_id}")).map_err(native_error)?;
    tauri::async_runtime::spawn_blocking(move || {
        crate::creative::validate_document(&document, crate::creative::document_budget(&document))?;
        let reference_images = parent_version_id.as_deref().map(|id|blender_references(&app,id)).transpose()?.unwrap_or_default();
        let request = crate::creative::CreativeRequest {
            task_id,
            kind: document["kind"].as_str().unwrap_or("").into(),
            prompt: "Revisi editor manual".into(),
            quality: "high".into(),
            provider_id: None,
            model_id: None,
            reasoning_effort: None,
            parent_version_id,
            reference_images, blender: false,
        };
        let root = workspace_root(&app)?;
        with_storage(&app, &app.state::<AppState>(), |s| {
            if let Some(id) = &request.parent_version_id {
                let parent = s.load_creative_version(id)?;
                s.verify_creative_artifact(&root, &parent)?;
            }
            s.create_creative_task(&request, None)?;
            s.creative_stage(&request.task_id, "planning", None)?;
            s.creative_stage(&request.task_id, "validating", None)?;
            Ok(())
        })?;
        let result = (|| {
            if request.kind == "model3d" { crate::model3d::blender::build(&root, &document, &request.reference_images, || lease.is_cancelled()).map_err(native_error)?; }
            if lease.is_cancelled() { return Err(native_error("[CANCELLED] Revisi dibatalkan; versi sebelumnya dipertahankan.")); }
            with_storage(&app, &app.state::<AppState>(), |s| s.save_creative_result(&root, &request, &document))
        })();
        if let Err(ref error) = result {
            with_storage(&app, &app.state::<AppState>(), |s| s.creative_stage(&request.task_id, if lease.is_cancelled() {"cancelled"} else {"failed"}, Some(&error.message)))?;
        }
        publish_activity(&app, &request.task_id);
        result
    })
    .await
    .map_err(native_error)?
}

#[tauri::command]
pub async fn export_creative_geometry(
    app: AppHandle,
    version_id: String,
    format: String,
    bytes: Vec<u8>,
) -> Result<ArtifactResult, CommandError> {
    tauri::async_runtime::spawn_blocking(move || {
        if format != "wav" {
            crate::creative::validate_export(&format, &bytes)?;
        }
        let root = workspace_root(&app)?;
        with_storage(&app, &app.state::<AppState>(), |s| {
            let version = s.load_creative_version(&version_id)?;
            s.verify_creative_artifact(&root, &version)?;
            match version["document"]["kind"].as_str() {
                Some("music") if format == "wav" => crate::creative::validate_music_export(
                    &bytes,
                    version["document"]["recipe"]["durationSeconds"]
                        .as_f64()
                        .unwrap_or(0.),
                )?,
                Some("model3d") if format == "glb" || format == "obj" => {}
                Some("animation") if format == "glb" => {}
                _ => {
                    return Err(StorageError::InvalidInput(
                        "Format ekspor berbeda dari jenis artefak.".into(),
                    ))
                }
            }
            let artifact = crate::artifacts::write_artifact(
                &root,
                &format!(
                    "exports/{}-{}.{}",
                    version_id,
                    crate::storage::next_id("export"),
                    format
                ),
                &bytes,
            )?;
            s.connection.execute(
                "INSERT INTO creative_export VALUES (?1,?2,?3,?4,?5,?6)",
                rusqlite::params![
                    artifact.relative_path,
                    version_id,
                    artifact.sha256,
                    artifact.byte_length,
                    format,
                    crate::storage::now_string()
                ],
            )?;
            Ok(artifact)
        })
    })
    .await
    .map_err(native_error)?
}

#[tauri::command]
pub async fn export_creative_audio(
    app: AppHandle,
    version_id: String,
    bytes: Vec<u8>,
) -> Result<ArtifactResult, CommandError> {
    export_creative_geometry(app, version_id, "wav".into(), bytes).await
}

#[tauri::command]
pub async fn list_mcp_connectors(
    app: AppHandle,
) -> Result<Vec<crate::connectors::McpConnectorConfig>, CommandError> {
    tauri::async_runtime::spawn_blocking(move || {
        with_storage(&app, &app.state::<AppState>(), Storage::list_mcp_connectors)
    })
    .await
    .map_err(native_error)?
}

#[tauri::command]
pub async fn save_mcp_connector(
    app: AppHandle,
    config: crate::connectors::McpConnectorConfig,
) -> Result<(), CommandError> {
    tauri::async_runtime::spawn_blocking(move || {
        with_storage(&app, &app.state::<AppState>(), |storage| {
            storage.save_mcp_connector(&config)
        })
    })
    .await
    .map_err(native_error)?
}

#[tauri::command]
pub async fn toggle_mcp_connector(
    app: AppHandle,
    id: String,
    enabled: bool,
) -> Result<(), CommandError> {
    tauri::async_runtime::spawn_blocking(move || {
        with_storage(&app, &app.state::<AppState>(), |storage| {
            storage.toggle_mcp_connector(&id, enabled)
        })
    })
    .await
    .map_err(native_error)?
}

#[tauri::command]
pub async fn delete_mcp_connector(app: AppHandle, id: String) -> Result<(), CommandError> {
    tauri::async_runtime::spawn_blocking(move || {
        with_storage(&app, &app.state::<AppState>(), |storage| storage.delete_mcp_connector(&id))
    })
    .await
    .map_err(native_error)?
}

/// Starts the given connector (or every enabled one) and reports the tools it really exposes.
#[tauri::command]
pub async fn list_available_mcp_tools(
    app: AppHandle,
    config: Option<crate::connectors::McpConnectorConfig>,
) -> Result<Vec<crate::connectors::McpToolInfo>, CommandError> {
    tauri::async_runtime::spawn_blocking(move || {
        if let Some(config) = config {
            // Testing one connector reports its exact error to the settings UI.
            crate::connectors::validate(&config).map_err(native_error)?;
            return crate::mcp::discover(&config).map_err(native_error);
        }
        // Across all enabled connectors a broken server must not hide the working ones,
        // matching how chat skips a connector that fails to start.
        let configs = with_storage(&app, &app.state::<AppState>(), Storage::list_mcp_connectors)?;
        Ok(configs
            .iter()
            .filter(|c| c.is_enabled)
            .filter_map(|config| crate::mcp::discover(config).ok())
            .flatten()
            .collect())
    })
    .await
    .map_err(native_error)?
}

#[tauri::command]
pub async fn get_discord_account() -> Result<crate::discord::Status, CommandError> {
    tauri::async_runtime::spawn_blocking(crate::discord::status)
        .await
        .map_err(native_error)?
        .map_err(native_error)
}
#[tauri::command]
pub async fn configure_discord(client_id: String) -> Result<crate::discord::Status, CommandError> {
    tauri::async_runtime::spawn_blocking(move || crate::discord::configure(&client_id))
        .await
        .map_err(native_error)?
        .map_err(native_error)
}
#[tauri::command]
pub async fn login_discord() -> Result<crate::discord::Status, CommandError> {
    tauri::async_runtime::spawn_blocking(crate::discord::sign_in)
        .await
        .map_err(native_error)?
        .map_err(native_error)
}
#[tauri::command]
pub async fn logout_discord() -> Result<crate::discord::Status, CommandError> {
    tauri::async_runtime::spawn_blocking(crate::discord::sign_out)
        .await
        .map_err(native_error)?
        .map_err(native_error)
}

#[tauri::command]
pub async fn get_google_oauth_config() -> Result<crate::auth::google::Status, CommandError> {
    tauri::async_runtime::spawn_blocking(crate::auth::google::status)
        .await
        .map_err(native_error)?
        .map_err(native_error)
}
#[tauri::command]
pub async fn configure_google_oauth(
    client_id: String,
    client_secret: String,
    project_id: String,
) -> Result<crate::auth::google::Status, CommandError> {
    tauri::async_runtime::spawn_blocking(move || {
        crate::auth::google::configure(client_id, client_secret, project_id)
    })
    .await
    .map_err(native_error)?
    .map_err(native_error)
}

#[tauri::command]
pub async fn read_studio_explorer(studio_id: String, query: crate::studio::explorer::Query) -> Result<serde_json::Value, CommandError> {
    tauri::async_runtime::spawn_blocking(move || crate::studio::explorer::read(&studio_id, &query)).await.map_err(native_error)?.map_err(studio_error)
}

fn run_blender_tool(app:&AppHandle,task_id:&str,prompt:&str,provider:&crate::ai::AiProviderProfile,call:&crate::tools::ToolCall,lease:&crate::ai::StreamLease)->Result<serde_json::Value,String>{
    let document=crate::model3d::blender::input(call)?;
    with_storage(app,&app.state::<AppState>(),|s|s.creative_stage(task_id,"tool_running",None)).map_err(|e|e.message)?;
    let result=(|| {
        let root=workspace_root(app).map_err(|e|e.message)?;
        let deadline=with_storage(app,&app.state::<AppState>(),|s|s.ai_checkpoint(task_id)).map_err(|e|e.message)?.map(|cp|cp.deadline_ms).unwrap_or(0);
        let references:Vec<crate::references::ReferenceImage>=with_storage(app,&app.state::<AppState>(),|s|s.get_creative_task(task_id)).map_err(|e|e.message).and_then(|task|serde_json::from_value(task.get("referenceImages").cloned().unwrap_or_else(||serde_json::json!([]))).map_err(|e|e.to_string()))?;
        let receipt=crate::model3d::blender::build(&root,&document,&references,||lease.is_cancelled() || crate::routing::now_ms()>=deadline)?;
        let id=format!("blender-{}",crate::artifacts::sha256_hex(format!("{task_id}:{}",call.id).as_bytes()));
        let version=with_storage(app,&app.state::<AppState>(),|s| {
            if let Ok(task)=s.get_creative_task(&id) { if let Some(version)=task["versionId"].as_str() {return s.load_creative_version(version);} }
            let request=crate::creative::CreativeRequest {task_id:id,kind:"model3d".into(),prompt:prompt.chars().take(4000).collect(),quality:"high".into(),provider_id:Some(provider.id.clone()),model_id:Some(provider.model.clone()),reasoning_effort:provider.reasoning_effort.clone(),parent_version_id:None,reference_images:references.clone(),blender:true};
            s.create_creative_task(&request,Some(provider))?;s.creative_stage(&request.task_id,"planning",None)?;s.creative_stage(&request.task_id,"validating",None)?;
            s.save_blender_tool_result(&root,&request,&document,task_id,call)
        }).map_err(|e|e.message)?;
        Ok(serde_json::json!({"versionId":version["id"],"name":document["recipe"]["name"],"bundle":receipt,"openInForgeKit":"#create/model-3d","comparisonImages":crate::model3d::blender::comparison_images(&root,&document,&references)?,"notice":"File .blend dan referensi tersimpan. Periksa render yang dikembalikan terhadap gambar asli lalu perbaiki perbedaan melalui Blender. Belum dipasang ke Roblox; tidak ada sertifikasi kemiripan 100%."}))
    })();
    with_storage(app,&app.state::<AppState>(),|s|s.creative_stage(task_id,"streaming",None)).map_err(|e|e.message)?;
    result
}

fn blender_document(app:&AppHandle,id:&str)->Result<serde_json::Value,CommandError>{
    let root=workspace_root(app)?;
    with_storage(app,&app.state::<AppState>(),|s| {
        let version=s.load_creative_version(id)?;s.verify_creative_artifact(&root,&version)?;
        if version["document"]["kind"]!="model3d" {return Err(StorageError::InvalidInput("Pilih versi Model 3D.".into()));}
        Ok(version["document"].clone())
    })
}
fn blender_references(app:&AppHandle,id:&str)->Result<Vec<crate::references::ReferenceImage>,CommandError>{
    with_storage(app,&app.state::<AppState>(),|s| {
        let version=s.load_creative_version(id)?;
        let task=s.get_creative_task(version["taskId"].as_str().ok_or_else(||StorageError::InvalidInput("Task karya tidak sah.".into()))?)?;
        serde_json::from_value(task.get("referenceImages").cloned().unwrap_or_else(||serde_json::json!([]))).map_err(StorageError::from)
    })
}
#[tauri::command]
pub fn blender_status()->serde_json::Value {crate::model3d::blender::status()}
#[tauri::command]
pub async fn build_blender_model(app:AppHandle,version_id:String)->Result<serde_json::Value,CommandError>{
    tauri::async_runtime::spawn_blocking(move || {
        let lease=crate::ai::begin_stream(&format!("blender:{version_id}")).map_err(native_error)?;
        let document=blender_document(&app,&version_id)?;
        crate::model3d::blender::build(&workspace_root(&app)?,&document,&blender_references(&app,&version_id)?,||lease.is_cancelled()).map_err(native_error)
    }).await.map_err(native_error)?
}
#[tauri::command]
pub async fn get_model_build_progress(app:AppHandle,task_id:Option<String>,version_id:Option<String>,known_preview:Option<String>)->Result<serde_json::Value,CommandError>{
    tauri::async_runtime::spawn_blocking(move || {
        if task_id.is_some()==version_id.is_some() {return Err(native_error("Pilih satu tugas atau versi Model 3D."));}
        let (document,references,phase)=if let Some(id)=task_id {
            let (task,checkpoint)=with_storage(&app,&app.state::<AppState>(),|s|Ok((s.get_creative_task(&id)?,s.ai_checkpoint(&id)?)))?;
            if task["kind"]!="model3d" {return Err(native_error("Pratinjau proses hanya untuk Model 3D."));}
            let phase=checkpoint.as_ref().map(|cp|cp.phase.clone()).unwrap_or_else(||task["status"].as_str().unwrap_or("planning").into());
            let document=checkpoint.as_ref().and_then(|cp|cp.model_review.as_ref().map(|review|review.candidate.clone()).or_else(||cp.final_text.as_ref().and_then(|text|serde_json::from_str::<serde_json::Value>(text).ok()).map(|recipe|serde_json::json!({"kind":"model3d","recipe":recipe}))));
            let Some(document)=document else{return Ok(serde_json::json!({"phase":phase}));};
            crate::creative::validate_document(&document,crate::creative::MODEL_MAX_PARTS)?;
            let references=serde_json::from_value(task.get("referenceImages").cloned().unwrap_or_else(||serde_json::json!([]))).map_err(native_error)?;
            (document,references,phase)
        }else{
            let id=version_id.unwrap();
            (blender_document(&app,&id)?,blender_references(&app,&id)?,"building".into())
        };
        let mut result=crate::model3d::blender::build_progress(&workspace_root(&app)?,&document,&references,known_preview.as_deref()).map_err(native_error)?;
        if result["phase"]=="waiting" || result["phase"]=="ready" {result["phase"]=serde_json::json!(phase);}
        Ok(result)
    }).await.map_err(native_error)?
}
#[tauri::command]
pub async fn load_blender_bundle(app:AppHandle,version_id:String)->Result<serde_json::Value,CommandError>{
    tauri::async_runtime::spawn_blocking(move || {
        let document=blender_document(&app,&version_id)?;
        let mut preview=crate::model3d::blender::preview(&workspace_root(&app)?,&document,&blender_references(&app,&version_id)?).map_err(native_error)?;
        let report=with_storage(&app,&app.state::<AppState>(),|s| {
            let version=s.load_creative_version(&version_id)?;
            Ok(s.ai_checkpoint(version["taskId"].as_str().unwrap_or(""))?.and_then(|cp|crate::model3d::reference_model::report(&cp,&document)))
        })?;
        if let Some(report)=report {if preview.is_object(){preview["receipt"]["referenceReview"]=report;}}
        Ok(preview)
    }).await.map_err(native_error)?
}
#[tauri::command]
pub async fn insert_blender_model(app:AppHandle,version_id:String,studio_id:String,context_snapshot_id:String)->Result<serde_json::Value,CommandError>{
    tauri::async_runtime::spawn_blocking(move || {
        let document=blender_document(&app,&version_id)?;
        let root=workspace_root(&app)?;
        let bundle=crate::model3d::blender::preview(&root,&document,&blender_references(&app,&version_id)?).map_err(native_error)?;
        if bundle.is_null() {return Err(native_error("Bangun hasil Blender terlebih dahulu."));}
        let snapshot=with_storage(&app,&app.state::<AppState>(),|s|s.context_for_chat(&context_snapshot_id))?;
        let target=crate::studio::freeze(&studio_id,Some(&snapshot)).map_err(native_error)?;
        crate::studio::insert_blender(&target,&root,&document,&bundle["mesh"],&version_id).map_err(native_error)
    }).await.map_err(native_error)?
}
#[tauri::command]
pub async fn reveal_blender_model(app:AppHandle,version_id:String)->Result<(),CommandError>{
    tauri::async_runtime::spawn_blocking(move || {
        let document=blender_document(&app,&version_id)?;
        crate::model3d::blender::reveal(&workspace_root(&app)?,&document,&blender_references(&app,&version_id)?).map_err(native_error)
    }).await.map_err(native_error)?
}
#[tauri::command]
pub async fn open_blender_model(app:AppHandle,version_id:String)->Result<(),CommandError>{
    tauri::async_runtime::spawn_blocking(move || {
        let document=blender_document(&app,&version_id)?;
        crate::model3d::blender::open_model(&workspace_root(&app)?,&document,&blender_references(&app,&version_id)?).map_err(native_error)
    }).await.map_err(native_error)?
}
#[tauri::command]
pub fn cancel_blender_model(version_id:String)->Result<(),CommandError>{
    if version_id.is_empty() || version_id.len()>128 || version_id.chars().any(char::is_control) {return Err(native_error("ID versi tidak sah."));}
    crate::ai::cancel_ai_stream(&format!("blender:{version_id}"));Ok(())
}

#[tauri::command]
pub async fn resume_ai_task(
    app: AppHandle,
    id: String,
    mode: Option<String>,
) -> Result<serde_json::Value, CommandError> {
    let task = with_storage(&app, &app.state::<AppState>(), |s| s.get_creative_task(&id))?;
    let stream_key = if task["kind"] == "chat" {
        task["threadId"]
            .as_str()
            .ok_or_else(|| native_error("Thread tidak tersedia."))?
            .to_owned()
    } else {
        format!("creative:{id}")
    };
    let lease = crate::ai::begin_stream(&stream_key).map_err(native_error)?;
    tauri::async_runtime::spawn_blocking(move ||{
        let mut cp=with_storage(&app,&app.state::<AppState>(),|s|s.ai_checkpoint(&id))?.ok_or_else(||native_error("Checkpoint lama tidak cukup untuk dilanjutkan; receipt tetap tersedia."))?;
        let verify=mode.as_deref()==Some("verify");
        let resume_edit=mode.as_deref()==Some("stop_play");
        if resume_edit && (task["kind"]!="chat" || cp.recovery()["canResumeEdit"]!=true) {return Err(native_error("Checkpoint tidak mengizinkan pemulihan Edit."));}
        if mode.as_deref().is_some_and(|v|v!="verify" && v!="finalize" && v!="stop_play") {return Err(native_error("Mode pemulihan tidak sah."));}
        if task["recovery"][if verify {"canVerify"}else if resume_edit {"canResumeEdit"}else{"canFinalize"}]!=true || cp.segment>=3{return Err(native_error("Budget/segmen checkpoint tidak cukup untuk finalisasi. Tinjau hasil parsial dan receipt."));}
        let p=&task["provider"];
        let saved=saved_ai_profile(&app,p["profileId"].as_str().ok_or_else(||native_error("Identitas akun checkpoint tidak tersedia."))?)?;
        let provider=crate::model_catalog::select(saved,p["modelId"].as_str(),p["reasoningEffort"].as_str()).map_err(native_error)?;
        if crate::supervisor::fingerprint(&provider)!=cp.fingerprint{return Err(native_error("[TARGET_CONFLICT] Akun/model/revisi koneksi berubah. Checkpoint tidak dilanjutkan."));}

        let mut frozen: Option<crate::studio::TargetStamp> = cp.map_epoch.as_deref().map(serde_json::from_str).transpose().map_err(|_| native_error("Checkpoint lama tidak memiliki target terverifikasi. Baca ulang map dan mulai tugas baru."))?;
        if verify || resume_edit {
            let expected = frozen.as_ref().ok_or_else(|| native_error("Target checkpoint belum terkunci; mulai tugas baru."))?;
            crate::studio::current(expected).map_err(native_error)?;
            if resume_edit {
                frozen = Some(crate::studio::stop_play_for_resume(expected).map_err(native_error)?);
                cp.map_epoch = Some(serde_json::to_string(frozen.as_ref().unwrap()).map_err(native_error)?);
            }
        }
        let mut verify_tools=if verify || resume_edit {crate::studio::agent_catalog(frozen.as_ref().unwrap(),resume_edit).map_err(native_error)?}else{vec![]};
        if resume_edit {verify_tools.extend(crate::studio::luau_checks::definitions());}
        with_storage(&app,&app.state::<AppState>(),|s|s.resume_checkpoint_task(&id,verify))?;
        if verify {cp.final_text=None;cp.candidate_hash=None;}
        if task["kind"] == "model3d" { cp.budget.request_seconds = 600; }
        cp.segment+=1;cp.deadline_ms=crate::routing::now_ms()+if task["kind"] == "model3d" {600_000}else{120_000};cp.final_only=!(verify || resume_edit);cp.phase=if verify {"read_back_continuation"}else{"awaiting_continuation"}.into();
        if resume_edit {cp.final_text=None;cp.no_progress=0;cp.history.push(serde_json::json!({"role":"system","content":"Pengguna menghentikan Play. Mode Edit sudah diperiksa backend. Lanjutkan rencana pada target semula; operasi notExecuted boleh direncanakan ulang dengan ID call baru. Jangan ulang write yang sudah dieksekusi; periksa read-back terlebih dahulu."}));}
        if verify {cp.history.push(serde_json::json!({"role":"system","content":"Pemulihan baca saja. Periksa efek pada target semula melalui tools baca. Jangan membuat atau mengulang perubahan. Bedakan receipt eksekusi, observasi read-back, dan hasil yang benar-benar cocok dengan tujuan. Sebutkan mismatch atau ketidakpastian dalam jawaban akhir."}));}
        let result=(||{
            let kind=task["kind"].as_str().ok_or_else(||native_error("Jenis checkpoint tidak sah."))?;
            if kind=="chat" {
                with_storage(&app,&app.state::<AppState>(),|s|s.creative_stage(&id,"streaming",None))?;
                let content=run_connected(&app,&id,&provider,&lease,false,|active,_|crate::ai::execute_agent_checkpoint(active,&lease,&verify_tools,8192,&mut cp,|_| Ok(()),|call|{ if resume_edit && crate::studio::luau_checks::handles(call) {return run_luau_check(&app, &id, call);} if !resume_edit && (!verify || crate::studio::is_write(&call.name)){return Err("[SAFETY] Pemulihan tidak menjalankan write.".into());} run_studio_tool(&app,&id,frozen.as_ref().ok_or("Target tidak tersedia.")?,call,&lease,true,resume_edit) },|cp|persist_checkpoint(&app,&id,active,cp))).map_err(native_error)?;
                if lease.is_cancelled(){return Err(native_error("[CANCELLED] Finalisasi dibatalkan."));}
                let message=with_storage(&app,&app.state::<AppState>(),|s|s.complete_chat_turn(&id,&content))?;
                return Ok(serde_json::json!({"message":message}));
            }
            let editor=matches!(kind,"gfx"|"icon"|"clothing"|"texture"|"sfx");
            let request=crate::creative::CreativeRequest{task_id:id.clone(),kind:kind.into(),prompt:task["prompt"].as_str().unwrap_or("").into(),quality:task["quality"].as_str().unwrap_or("balanced").into(),provider_id:Some(provider.id.clone()),model_id:Some(provider.model.clone()),reasoning_effort:provider.reasoning_effort.clone(),parent_version_id:task["parentVersionId"].as_str().map(str::to_owned),reference_images:serde_json::from_value(task.get("referenceImages").cloned().unwrap_or_else(||serde_json::json!([]))).map_err(native_error)?,blender:false};
            let value=run_connected(&app,&id,&provider,&lease,false,|active,_|{
                let value=if let Some(state)=cp.model_review.as_ref(){state.candidate.clone()}else{crate::ai::execute_recipe_checkpoint(active,&lease,&[],crate::creative::output_tokens(&request.kind,&request.quality),&mut cp,|_|Err("Tools tidak tersedia pada finalisasi.".into()),|cp|persist_checkpoint(&app,&id,active,cp),|raw|if editor{crate::editor_ai::parse(kind,raw)}else{crate::creative::parse(&request,raw)})?};
                if kind=="model3d" && !crate::model3d::blender::visual_references(&request.reference_images).is_empty(){crate::model3d::reference_model::refine(&workspace_root(&app).map_err(|e|e.message)?,&request,active,&lease,&mut cp,value,|cp|persist_checkpoint(&app,&id,active,cp))}else{Ok(value)}
            }).map_err(native_error)?;
            if lease.is_cancelled(){return Err(native_error("[CANCELLED] Finalisasi dibatalkan."));}
            if editor {
                with_storage(&app,&app.state::<AppState>(),|s|s.finish_editor_ai_task(&id,&value))?;
                Ok(serde_json::json!({"spec":value,"taskId":id,"source":"ai","provider":p}))
            }else{
                with_storage(&app,&app.state::<AppState>(),|s|s.creative_stage(&id,"validating",None))?;
                let root=workspace_root(&app)?;
                if request.kind == "model3d" { crate::model3d::blender::build(&root, &value, &request.reference_images, || lease.is_cancelled()).map_err(native_error)?; }
                if lease.is_cancelled() { return Err(native_error("Permintaan dibatalkan.")); }
                with_storage(&app,&app.state::<AppState>(),|s|s.save_creative_result(&root,&request,&value))
            }
        })();
        if let Err(ref error)=result {with_storage(&app,&app.state::<AppState>(),|s|s.creative_stage(&id,if lease.is_cancelled(){"cancelled"}else{"failed"},Some(&error.message)))?;}
        publish_activity(&app, &id);
        result
    }).await.map_err(native_error)?
}

#[tauri::command]
pub async fn generate_editor_recipe(
    app: AppHandle,
    task_id: String,
    kind: String,
    prompt: String,
    provider_id: Option<String>,
    model_id: Option<String>,
    reasoning_effort: Option<String>,
    current_spec: Option<serde_json::Value>,
) -> Result<serde_json::Value, CommandError> {
    if task_id.trim().is_empty()
        || task_id.len() > 128
        || prompt.trim().is_empty()
        || prompt.len() > 16000
        || !matches!(
            kind.as_str(),
            "gfx" | "icon" | "clothing" | "texture" | "sfx"
        )
    {
        return Err(native_error("Input tugas editor tidak sah."));
    }
    if provider_id
        .as_deref()
        .is_none_or(|id| id.trim().is_empty() || matches!(id, "local" | "local-llm"))
        || model_id.as_deref().is_none_or(|id| id.trim().is_empty())
    {
        return Err(native_error(
            "Pilih akun provider dan model sebelum menyusun desain.",
        ));
    }
    let lease = crate::ai::begin_stream(&format!("creative:{}", task_id)).map_err(native_error)?;
    tauri::async_runtime::spawn_blocking(move || {
        let provider = provider_id
            .as_ref()
            .map(|id| {
                let saved = saved_ai_profile(&app, id)?;
                crate::model_catalog::select(
                    saved,
                    model_id.as_deref(),
                    reasoning_effort.as_deref(),
                )
                .map_err(native_error)
            })
            .transpose()?;

        let provider = provider.as_ref().ok_or_else(|| native_error("Pilih akun provider aktif sebelum menyusun desain."))?;
        with_storage(&app,&app.state::<AppState>(),|s|s.create_editor_ai_task(&task_id,&kind,&prompt,provider,current_spec.as_ref()))?;
        let result=(||{
            let messages=crate::editor_ai::messages(&kind,&prompt,current_spec.as_ref()).map_err(native_error)?;
            let recipe=run_connected(&app,&task_id,provider,&lease,true,|active,_|{
                let mut cp=checkpoint_for(&app,&task_id,active,&messages,false,false)?;
                crate::ai::execute_recipe_checkpoint(active,&lease,&[],4096,&mut cp,|_|Err("Tool tidak tersedia.".into()),
                    |cp|persist_checkpoint(&app,&task_id,active,cp),|raw|crate::editor_ai::parse(&kind,raw))
            }).map_err(native_error)?;
            if lease.is_cancelled(){return Err(native_error("[CANCELLED] Penyusunan dibatalkan; hasil sebelumnya dipertahankan."));}
            with_storage(&app,&app.state::<AppState>(),|s|s.finish_editor_ai_task(&task_id,&recipe))?;
            Ok(serde_json::json!({"spec":recipe,"taskId":task_id,"source":"ai","provider":{"profileId":provider.id,"adapterId":provider.provider_type,"modelId":provider.model}}))
        })();
        if let Err(ref error)=result {with_storage(&app,&app.state::<AppState>(),|s|s.creative_stage(&task_id,if lease.is_cancelled(){"cancelled"}else{"failed"},Some(&error.message)))?;}
        publish_activity(&app, &task_id);
        result
    })
    .await
    .map_err(native_error)?
}

fn persist_checkpoint(
    app: &AppHandle,
    id: &str,
    profile: &crate::ai::AiProviderProfile,
    cp: &crate::supervisor::Checkpoint,
) -> Result<(), String> {
    let mut current = saved_ai_profile(app, &profile.id).map_err(|e| e.message)?;
    current.model = profile.model.clone();
    current.reasoning_effort = profile.reasoning_effort.clone();
    if crate::supervisor::fingerprint(&current) != cp.fingerprint {
        return Err(
            "[TARGET_CONFLICT] Koneksi berubah saat tugas berjalan. Hasil lama dipertahankan."
                .into(),
        );
    }
    with_storage(app, &app.state::<AppState>(), |s| {
        s.persist_ai_checkpoint(id, cp)
    })
    .map_err(|e| e.message)?;
    publish_activity(app, id);
    Ok(())
}

fn checkpoint_for(
    app: &AppHandle,
    id: &str,
    profile: &crate::ai::AiProviderProfile,
    messages: &[serde_json::Value],
    tools: bool,
    complex: bool,
) -> Result<crate::supervisor::Checkpoint, String> {
    if let Some(mut cp) = with_storage(app, &app.state::<AppState>(), |s| s.ai_checkpoint(id))
        .map_err(|e| e.message)?
    {
        if cp.fingerprint != crate::supervisor::fingerprint(profile) {
            cp.switch_account(profile)?;
            persist_checkpoint(app, id, profile, &cp)?;
        }
        return Ok(cp);
    }
    let target = with_storage(app, &app.state::<AppState>(), |s| s.get_creative_task(id))
        .map_err(|e| e.message)?;
    let mut budget = crate::supervisor::Budget::for_task(tools, complex);
    let kind = target["kind"].as_str().unwrap_or("");
    if kind == "model3d" || (kind == "chat" && crate::agent::select_skills(target["prompt"].as_str().unwrap_or(""), "chat", false).iter().any(|skill|skill.id == "model-3d")) {
        budget = crate::supervisor::Budget::for_model3d(tools, target["quality"].as_str().unwrap_or("high"));
    }
    let mut cp = crate::supervisor::Checkpoint::new(profile, messages, budget);
    if let Some(studio) = target["studioId"].as_str() {
        cp.map_epoch = Some(crate::studio::map_epoch(studio)?);
        cp.studio_id = Some(studio.into());
    }
    with_storage(app, &app.state::<AppState>(), |s| {
        s.persist_ai_checkpoint(id, &cp)
    })
    .map_err(|e| e.message)?;
    Ok(cp)
}

fn run_luau_check(
    app: &AppHandle,
    task_id: &str,
    call: &crate::tools::ToolCall,
) -> Result<serde_json::Value, String> {
    with_storage(app, &app.state::<AppState>(), |s| {
        s.creative_stage(task_id, "validating", None)
    })
    .map_err(|e| e.message)?;
    let result = crate::studio::luau_checks::execute(call);
    with_storage(app, &app.state::<AppState>(), |s| {
        s.creative_stage(task_id, "streaming", None)
    })
    .map_err(|e| e.message)?;
    result
}

fn publish_activity(app: &AppHandle, id: &str) {
    use tauri::Emitter;
    if let Ok(task) = with_storage(app, &app.state::<AppState>(), |s| s.get_creative_task(id)) {
        // Delivery is optional: the exact same revision is available from durable task reads.
        let _ = app.emit("forgekit:task-event", &task["activity"]);
    }
    let _ = with_storage(app,&app.state::<AppState>(),|s| {
        if let Err(error)=crate::obsidian::sync_learning(&s.connection) {
            eprintln!("[OBSIDIAN_LEARNING] {error}");
        }
        Ok(())
    });
}

#[tauri::command]
pub async fn obsidian_status(app: AppHandle) -> Result<serde_json::Value, CommandError> {
    // Vault files can wait for filesystem permissions; keep that wait off the UI thread.
    tauri::async_runtime::spawn_blocking(move || {
        let mut status=crate::obsidian::status().map_err(native_error)?;
        let learning=with_storage(&app,&app.state::<AppState>(),|s|Ok(crate::obsidian::sync_learning(&s.connection)))?;
        match learning {
            Ok(fields) => {if let Some(fields)=fields.as_object(){status.as_object_mut().unwrap().extend(fields.clone());}},
            Err(error) => {status["learningError"]=serde_json::json!(error);},
        }
        Ok(status)
    }).await.map_err(native_error)?
}


// Hunyuan remains separate from procedural recipes and Blender generation.
#[tauri::command]
pub async fn hunyuan_load_config(app: AppHandle, ) -> Result<serde_json::Value, CommandError> {
    tauri::async_runtime::spawn_blocking(move || {
        crate::model3d::hunyuan_remote::load_config(&data_directory(&app)?).map_err(native_error)
    })
    .await
    .map_err(native_error)?
}

#[tauri::command]
pub async fn hunyuan_save_config(app: AppHandle, endpoint: String, token: Option<String>,) -> Result<serde_json::Value, CommandError> {
    tauri::async_runtime::spawn_blocking(move || {
        crate::model3d::hunyuan_remote::save_config(&data_directory(&app)?, &endpoint, token.as_deref()).map_err(native_error)
    })
    .await
    .map_err(native_error)?
}

#[tauri::command]
pub async fn hunyuan_health(app: AppHandle, ) -> Result<serde_json::Value, CommandError> {
    tauri::async_runtime::spawn_blocking(move || {
        crate::model3d::hunyuan_remote::health(&data_directory(&app)?).map_err(native_error)
    })
    .await
    .map_err(native_error)?
}

#[tauri::command]
pub async fn hunyuan_start(app: AppHandle, image_base64: String, seed: u32, steps: u32, texture: bool,) -> Result<serde_json::Value, CommandError> {
    tauri::async_runtime::spawn_blocking(move || {
        crate::model3d::hunyuan_remote::start(&data_directory(&app)?, &image_base64, seed, steps, texture).map_err(native_error)
    })
    .await
    .map_err(native_error)?
}

#[tauri::command]
pub async fn hunyuan_poll(app: AppHandle, id: String,) -> Result<serde_json::Value, CommandError> {
    tauri::async_runtime::spawn_blocking(move || {
        crate::model3d::hunyuan_remote::poll(&data_directory(&app)?, &id).map_err(native_error)
    })
    .await
    .map_err(native_error)?
}

#[tauri::command]
pub async fn hunyuan_cancel(app: AppHandle, id: String,) -> Result<serde_json::Value, CommandError> {
    tauri::async_runtime::spawn_blocking(move || {
        crate::model3d::hunyuan_remote::cancel(&data_directory(&app)?, &id).map_err(native_error)
    })
    .await
    .map_err(native_error)?
}

#[tauri::command]
pub async fn hunyuan_download(app: AppHandle, id: String,) -> Result<serde_json::Value, CommandError> {
    tauri::async_runtime::spawn_blocking(move || {
        crate::model3d::hunyuan_remote::download(&data_directory(&app)?, &workspace_root(&app)?, &id).map_err(native_error)
    })
    .await
    .map_err(native_error)?
}

#[tauri::command]
pub async fn hunyuan_load_model(app: AppHandle, relative_path: String,) -> Result<serde_json::Value, CommandError> {
    tauri::async_runtime::spawn_blocking(move || {
        crate::model3d::hunyuan_remote::load_model(&workspace_root(&app)?, &relative_path).map_err(native_error)
    })
    .await
    .map_err(native_error)?
}

#[tauri::command]
pub async fn hunyuan_list_models(app: AppHandle, ) -> Result<serde_json::Value, CommandError> {
    tauri::async_runtime::spawn_blocking(move || {
        crate::model3d::hunyuan_remote::list_models(&workspace_root(&app)?).map_err(native_error)
    })
    .await
    .map_err(native_error)?
}

#[tauri::command]
pub async fn hunyuan_open_blender(app: AppHandle, relative_path: String,) -> Result<(), CommandError> {
    tauri::async_runtime::spawn_blocking(move || {
        crate::model3d::hunyuan_remote::open_blender(&workspace_root(&app)?, &relative_path).map_err(native_error)
    })
    .await
    .map_err(native_error)?
}

#[tauri::command]
pub async fn hunyuan_reveal_model(app: AppHandle, relative_path: String) -> Result<(), CommandError> {
    tauri::async_runtime::spawn_blocking(move || {
        crate::model3d::hunyuan_remote::reveal_models(&workspace_root(&app)?, &relative_path).map_err(native_error)
    })
    .await
    .map_err(native_error)?
}

#[tauri::command]
pub async fn hunyuan_edit_model(
    app: AppHandle,
    relative_path: String,
    prompt: String,
    provider_id: String,
    model_id: String,
    reasoning_effort: Option<String>,
) -> Result<serde_json::Value, CommandError> {
    if prompt.trim().is_empty() || prompt.len()>16000 || provider_id.trim().is_empty() || model_id.trim().is_empty() || provider_id.len()>200 || model_id.len()>200 {
        return Err(native_error("Pilih provider/model aktif dan prompt edit 1..16000 byte."));
    }
    crate::model3d::hunyuan_remote::model_path(&relative_path).map_err(native_error)?;
    let lease=crate::ai::begin_stream("hunyuan-edit").map_err(native_error)?;
    tauri::async_runtime::spawn_blocking(move || {
        let saved=saved_ai_profile(&app,&provider_id)?;
        let provider=crate::model_catalog::select(saved,Some(&model_id),reasoning_effort.as_deref()).map_err(native_error)?;
        crate::model3d::hunyuan_edit::edit(&workspace_root(&app)?,&relative_path,&prompt,&provider,&lease).map_err(native_error)
    }).await.map_err(native_error)?
}
