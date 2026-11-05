use std::fs;
use std::path::PathBuf;
use std::sync::atomic::{AtomicU64, Ordering};
use std::time::{SystemTime, UNIX_EPOCH};

use crate::artifacts::write_artifact;
use crate::storage::{GfxSpec, Storage};
use crate::tasks::Task;

fn temp_root() -> PathBuf {
    static TEST_SEQUENCE: AtomicU64 = AtomicU64::new(0);
    let sequence = TEST_SEQUENCE.fetch_add(1, Ordering::Relaxed);
    let suffix = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .expect("clock before epoch")
        .as_nanos();
    let root = std::env::temp_dir().join(format!("forgekit-test-{suffix}-{sequence}"));
    fs::create_dir_all(&root).expect("create temp root");
    root
}

#[test]
fn rejects_parent_and_absolute_paths() {
    let root = temp_root();
    assert!(write_artifact(&root, "../escape.svg", b"x").is_err());
    assert!(write_artifact(&root, "/tmp/escape.svg", b"x").is_err());
    fs::remove_dir_all(root).expect("remove temp root");
}

#[test]
fn writes_artifact_atomically_and_returns_hash() {
    let root = temp_root();
    let result = write_artifact(&root, "gfx/version.svg", b"svg").expect("write artifact");
    assert_eq!(result.relative_path, "gfx/version.svg");
    assert_eq!(result.byte_length, 3);
    assert_eq!(
        fs::read(root.join("gfx/version.svg")).expect("read artifact"),
        b"svg"
    );
    assert_eq!(result.sha256.len(), 64);
    fs::remove_dir_all(root).expect("remove temp root");
}

#[test]
fn cancelled_task_cannot_become_succeeded() {
    let mut task = Task::queued("version-1");
    task.start().expect("start task");
    task.cancel().expect("cancel task");
    assert!(task.succeed("version-1").is_err());
}

#[test]
fn task_history_survives_restart_and_reports_interrupted_work() {
    let root = temp_root();
    let database = root.join("forgekit.sqlite");
    let storage = Storage::open(&database).unwrap();
    assert!(storage.list_gfx_tasks().unwrap().is_empty());
    storage.ensure_default_records().unwrap();
    let cancelled = storage.create_gfx_task(&xml_spec()).unwrap();
    storage.cancel_gfx_task(&cancelled.id).unwrap();
    let pending = storage.create_gfx_task(&xml_spec()).unwrap();
    drop(storage);

    let reopened = Storage::open(&database).unwrap();
    let history = reopened.list_gfx_tasks().unwrap();
    assert_eq!(history.len(), 2);
    let interrupted = history
        .iter()
        .find(|row| row.task.id == pending.id)
        .unwrap();
    assert_eq!(interrupted.task.status, "interrupted");
    assert!(interrupted.task.error.is_some());
    assert_eq!(interrupted.title, xml_spec().title);
    assert!(interrupted.updated_at.parse::<u64>().unwrap() > 0);
    assert_eq!(
        history
            .iter()
            .find(|row| row.task.id == cancelled.id)
            .unwrap()
            .task
            .status,
        "cancelled"
    );
    drop(reopened);
    fs::remove_dir_all(root).unwrap();
}

#[test]
fn saves_and_reopens_gfx_version() {
    let root = temp_root();
    let database = root.join("forgekit.sqlite");
    let storage = Storage::open(&database).expect("open storage");
    storage
        .create_workspace("workspace-1", root.to_str().expect("utf8 root"))
        .expect("create workspace");
    storage
        .create_collection_item("item-1", "workspace-1", "Graphic")
        .expect("create collection item");
    drop(storage);

    let storage = Storage::open(&database).expect("reopen storage");
    let spec = GfxSpec {
        schema_version: 1,
        title: "ForgeKit".to_owned(),
        subtitle: "Create clearly".to_owned(),
        background: "#101216".to_owned(),
        accent: "#94ACFF".to_owned(),
        layout: "centered".to_owned(),
        width: 1200,
        height: 800,
    };
    let saved = storage
        .save_gfx_version("item-1", &spec)
        .expect("save version");
    drop(storage);

    let reopened = Storage::open(&database).expect("reopen storage");
    assert_eq!(
        reopened
            .load_gfx_version(&saved.id)
            .expect("load version")
            .spec,
        spec
    );
    fs::remove_dir_all(root).expect("remove temp root");
}

#[test]
fn stores_both_artifacts_reopens_and_detects_tampering() {
    let root = temp_root();
    let database = root.join("forgekit.sqlite");
    let storage = Storage::open(&database).unwrap();
    storage.ensure_default_records().unwrap();
    let spec = GfxSpec {
        schema_version: 1,
        title: "ForgeKit".into(),
        subtitle: "Create clearly".into(),
        background: "#101216".into(),
        accent: "#94ACFF".into(),
        layout: "centered".into(),
        width: 128,
        height: 128,
    };
    let svg = r##"<svg xmlns="http://www.w3.org/2000/svg" width="128" height="128" viewBox="0 0 128 128" role="img" aria-label="ForgeKit"><rect width="128" height="128" fill="#101216"/><g data-layout="centered"><text>ForgeKit</text></g></svg>"##;
    let mut png = Vec::new();
    {
        let mut encoder = png::Encoder::new(&mut png, 128, 128);
        encoder.set_color(png::ColorType::Rgba);
        encoder.set_depth(png::BitDepth::Eight);
        encoder
            .write_header()
            .unwrap()
            .write_image_data(&vec![255; 128 * 128 * 4])
            .unwrap();
    }
    let task = storage.create_gfx_task(&spec).unwrap();
    let saved = storage
        .finish_gfx_task(
            &task.id,
            svg,
            &png,
            &root,
            &std::sync::atomic::AtomicBool::new(false),
        )
        .unwrap();
    assert!(saved.artifact.is_some());
    assert_eq!(storage.list_gfx_versions().unwrap().len(), 1);
    drop(storage);
    let reopened = Storage::open(&database).unwrap();
    let loaded = reopened
        .load_verified_gfx_version(&saved.id, &root)
        .unwrap();
    assert_eq!(loaded, saved);
    let artifact = loaded.artifact.unwrap();
    assert_eq!(
        fs::read(root.join(&artifact.svg_relative_path)).unwrap(),
        svg.as_bytes()
    );
    assert_eq!(
        fs::read(root.join(&artifact.png_relative_path)).unwrap(),
        png
    );
    let backups = root.join("backups");
    let recovered = root.join("recovered");
    fs::create_dir(&backups).unwrap();
    fs::create_dir(&recovered).unwrap();
    let backup = reopened.create_backup(&root, &backups).unwrap();
    assert_eq!(backup.artifact_count, 2);
    assert_eq!(crate::backup::list(&backups).unwrap().len(), 1);
    crate::backup::verify(&backups, &backup.id).unwrap();
    let restored =
        PathBuf::from(crate::backup::restore_copy(&backups, &backup.id, &recovered).unwrap());
    let restored_db = Storage::open(restored.join("forgekit.sqlite")).unwrap();
    assert_eq!(
        restored_db
            .load_verified_gfx_version(&saved.id, &restored.join("workspace"))
            .unwrap(),
        saved
    );
    assert!(restored_db
        .export_gfx_artifact(&saved.id, "png", &restored.join("workspace"))
        .is_ok());
    fs::write(root.join(&artifact.svg_relative_path), b"tampered").unwrap();
    assert!(reopened
        .load_verified_gfx_version(&saved.id, &root)
        .unwrap_err()
        .to_string()
        .contains("integritas"));
    assert!(reopened.create_backup(&root, &backups).is_err());
    assert_eq!(fs::read_dir(&backups).unwrap().count(), 1);
    fs::write(
        PathBuf::from(&backup.directory)
            .join("workspace")
            .join(&artifact.png_relative_path),
        b"tampered",
    )
    .unwrap();
    assert!(crate::backup::verify(&backups, &backup.id).is_err());
    assert!(crate::backup::restore_copy(&backups, &backup.id, &recovered).is_err());
    assert_eq!(fs::read_dir(&recovered).unwrap().count(), 1);
    fs::remove_dir_all(root).unwrap();
}

#[test]
fn draft_preserves_invalid_fields_and_rejects_stale_revision_across_connections() {
    let root = temp_root();
    let database = root.join("forgekit.sqlite");
    let first = Storage::open(&database).unwrap();
    first.ensure_default_records().unwrap();
    assert!(first.load_gfx_draft().unwrap().is_none());
    let second = Storage::open(&database).unwrap();
    let mut spec = serde_json::to_value(xml_spec()).unwrap();
    spec["title"] = serde_json::json!("");
    spec["background"] = serde_json::json!("#");
    spec["width"] = serde_json::json!(-0.5);
    let initial = first.save_gfx_draft(&spec, None, 0).unwrap();
    assert_eq!(initial.revision, 1);
    assert!(matches!(
        second.save_gfx_draft(&spec, None, 0),
        Err(crate::storage::StorageError::Conflict)
    ));
    let updated = second.save_gfx_draft(&spec, None, 1).unwrap();
    assert_eq!(updated.revision, 2);
    assert!(matches!(
        first.save_gfx_draft(&spec, None, 1),
        Err(crate::storage::StorageError::Conflict)
    ));
    drop(first);
    drop(second);
    let reopened = Storage::open(&database).unwrap();
    assert_eq!(reopened.load_gfx_draft().unwrap().unwrap(), updated);
    assert!(reopened
        .save_gfx_draft(&spec, Some("missing-version"), 2)
        .is_err());
    spec["title"] = serde_json::json!("x".repeat(4097));
    assert!(reopened.save_gfx_draft(&spec, None, 2).is_err());
    assert_eq!(reopened.load_gfx_draft().unwrap().unwrap(), updated);
    assert!(reopened.list_gfx_versions().unwrap().is_empty());
    fs::remove_dir_all(root).unwrap();
}

#[test]
fn backup_includes_committed_wal_draft_without_changing_active_data() {
    let root = temp_root();
    let database = root.join("forgekit.sqlite");
    let storage = Storage::open(&database).unwrap();
    storage.ensure_default_records().unwrap();
    storage
        .connection
        .pragma_update(None, "journal_mode", "WAL")
        .unwrap();
    let spec = serde_json::to_value(xml_spec()).unwrap();
    let draft = storage.save_gfx_draft(&spec, None, 0).unwrap();
    let backups = root.join("backups");
    let recovered = root.join("recovered");
    fs::create_dir(&backups).unwrap();
    fs::create_dir(&recovered).unwrap();
    let backup = storage.create_backup(&root, &backups).unwrap();
    assert_eq!(backup.artifact_count, 0);
    let restored = crate::backup::restore_copy(&backups, &backup.id, &recovered).unwrap();
    let copy = Storage::open(PathBuf::from(restored).join("forgekit.sqlite")).unwrap();
    assert_eq!(copy.load_gfx_draft().unwrap().unwrap(), draft);
    let newer = storage.save_gfx_draft(&spec, None, 1).unwrap();
    assert_eq!(newer.revision, 2);
    assert_eq!(copy.load_gfx_draft().unwrap().unwrap().revision, 1);
    assert!(crate::backup::verify(&backups, "../escape").is_err());
    use std::os::unix::fs::symlink;
    symlink(&backup.directory, backups.join("backup-link")).unwrap();
    assert!(crate::backup::verify(&backups, "backup-link").is_err());
    fs::remove_dir_all(root).unwrap();
}

#[test]
fn future_database_schema_is_rejected_without_applying_migrations() {
    let root = temp_root();
    let database = root.join("forgekit.sqlite");
    let connection = rusqlite::Connection::open(&database).unwrap();
    connection.pragma_update(None, "user_version", 999).unwrap();
    assert!(Storage::open(&database).is_err());
    let tables: i64 = connection
        .query_row(
            "SELECT COUNT(*) FROM sqlite_master WHERE type = 'table'",
            [],
            |row| row.get(0),
        )
        .unwrap();
    assert_eq!(tables, 0);
    fs::remove_dir_all(root).unwrap();
}

#[test]
fn both_schema14_variants_upgrade_without_losing_accounts_or_history() {
    for missing_checkpoint in [false, true] {
        let root = temp_root();
        let database = root.join("forgekit.sqlite");
        let storage = Storage::open(&database).unwrap();
        storage.ensure_default_records().unwrap();
        let account: crate::ai::ConnectionProfile = serde_json::from_value(serde_json::json!({
            "id":"own-codex","providerId":"openai","connectionMode":"direct","credentialOwner":"forgekit",
            "authMethod":"codex_oauth","label":"Connected account","credentialRef":"codex-own-codex",
            "accessState":"ready","enabled":true,"fallbackEligible":"supported","priority":0,
            "quotaBucketRefs":["chatgpt:own"],"baseUrl":crate::codex_auth::BASE_URL,"model":"chosen-model",
            "isDefault":true,"createdAt":"1","updatedAt":"1"
        })).unwrap();
        storage.save_connection_profile(&account).unwrap();
        let before = storage.list_connection_profiles().unwrap();
        storage.connection.execute_batch("INSERT INTO chat_thread VALUES('history','Keep me','own-codex','chosen-model',NULL,'1','1');
            INSERT INTO chat_message VALUES('message','history',1,'user','Preserve my work',NULL,NULL,NULL,'1');
            INSERT INTO fallback_policy (id, enabled) VALUES ('default',1);
            PRAGMA user_version=14;").unwrap();
        if missing_checkpoint {
            storage.connection.execute_batch("DROP TABLE ai_checkpoint;").unwrap();
        }
        drop(storage);
        let upgraded = Storage::open(&database).unwrap();
        assert_eq!(upgraded.connection.pragma_query_value::<i64, _>(None, "user_version", |r| r.get(0)).unwrap(), crate::storage::SCHEMA_VERSION);
        assert_eq!(upgraded.list_connection_profiles().unwrap(), before);
        assert_eq!(upgraded.connection.query_row("SELECT content FROM chat_message WHERE id='message'", [], |r| r.get::<_, String>(0)).unwrap(), "Preserve my work");
        assert_eq!(upgraded.connection.query_row("SELECT enabled FROM fallback_policy LIMIT 1", [], |r| r.get::<_, i64>(0)).unwrap(), 0);
        upgraded.connection.prepare("SELECT task_id,checkpoint_json,updated_at FROM ai_checkpoint").unwrap();
        assert!(upgraded.connection.prepare("PRAGMA foreign_key_check").unwrap().query([]).unwrap().next().unwrap().is_none());
        let snapshots: Vec<_> = fs::read_dir(&root).unwrap().flatten().filter(|e| e.file_name().to_string_lossy().starts_with("forgekit-before-schema-15-")).collect();
        assert_eq!(snapshots.len(), 1);
        let backup = rusqlite::Connection::open(snapshots[0].path()).unwrap();
        assert_eq!(backup.pragma_query_value::<i64, _>(None, "user_version", |r| r.get(0)).unwrap(), 14);
        drop(backup);
        drop(upgraded);
        Storage::open(&database).unwrap();
        assert_eq!(fs::read_dir(&root).unwrap().flatten().filter(|e| e.file_name().to_string_lossy().starts_with("forgekit-before-schema-15-")).count(), 1);
        fs::remove_dir_all(root).unwrap();
    }
}

#[test]
fn response_read_failure_rolls_back_version_without_deleting_committed_artifacts() {
    let root = temp_root();
    let database = root.join("forgekit.sqlite");
    let storage = Storage::open(&database).unwrap();
    storage.ensure_default_records().unwrap();
    // Real SQLite fault injection: make the response unreadable once output is staged.
    let probe = rusqlite::Connection::open(&database).unwrap();
    probe
        .execute_batch(
            "CREATE TRIGGER unreadable_response AFTER UPDATE OF status ON task
             WHEN NEW.status = 'succeeded' BEGIN
                 UPDATE gfx_version SET checks_json = 'invalid json'
                 WHERE id = NEW.output_version_id;
             END;",
        )
        .unwrap();
    let spec = xml_spec();
    let svg = r##"<svg xmlns="http://www.w3.org/2000/svg" width="128" height="128" viewBox="0 0 128 128" role="img" aria-label="ForgeKit"><text>ForgeKit</text></svg>"##;
    let mut png = Vec::new();
    {
        let mut encoder = png::Encoder::new(&mut png, 128, 128);
        encoder.set_color(png::ColorType::Rgba);
        encoder.set_depth(png::BitDepth::Eight);
        encoder
            .write_header()
            .unwrap()
            .write_image_data(&vec![255; 128 * 128 * 4])
            .unwrap();
    }
    let task = storage.create_gfx_task(&spec).unwrap();
    let result = storage.finish_gfx_task(
        &task.id,
        svg,
        &png,
        &root,
        &std::sync::atomic::AtomicBool::new(false),
    );
    assert!(matches!(result, Err(crate::storage::StorageError::Json(_))));
    assert_eq!(storage.get_gfx_task(&task.id).unwrap().status, "failed");
    assert!(storage.list_gfx_versions().unwrap().is_empty());
    let artifact_count: i64 = probe
        .query_row("SELECT COUNT(*) FROM artifact", [], |row| row.get(0))
        .unwrap();
    assert_eq!(artifact_count, 0);
    assert!(storage.orphan_artifacts(&root).unwrap().is_empty());
    fs::remove_dir_all(root).unwrap();
}

#[test]
fn cancelled_save_writes_no_version_or_artifact() {
    let root = temp_root();
    let storage = Storage::open(root.join("forgekit.sqlite")).unwrap();
    storage.ensure_default_records().unwrap();
    let spec = GfxSpec {
        schema_version: 1,
        title: "ForgeKit".into(),
        subtitle: "".into(),
        background: "#101216".into(),
        accent: "#94ACFF".into(),
        layout: "centered".into(),
        width: 128,
        height: 128,
    };
    let task = storage.create_gfx_task(&spec).unwrap();
    storage.cancel_gfx_task(&task.id).unwrap();
    assert!(storage
        .finish_gfx_task(
            &task.id,
            "",
            &[],
            &root,
            &std::sync::atomic::AtomicBool::new(true)
        )
        .is_err());
    assert!(storage.list_gfx_versions().unwrap().is_empty());
    assert!(!root.join("gfx").exists());
    assert_eq!(storage.get_gfx_task(&task.id).unwrap().status, "cancelled");
    fs::remove_dir_all(root).unwrap();
}

fn xml_spec() -> GfxSpec {
    GfxSpec {
        schema_version: 1,
        title: "ForgeKit".into(),
        subtitle: "".into(),
        background: "#101216".into(),
        accent: "#94ACFF".into(),
        layout: "centered".into(),
        width: 128,
        height: 128,
    }
}

#[test]
fn xml_rejects_illegal_brief_text_before_persistence() {
    let storage = Storage::open(":memory:").unwrap();
    storage.ensure_default_records().unwrap();
    for text in [
        "\u{fffe}", "\u{ffff}", "\0", "\t", "\r", "\n", "\u{1f}", "\u{7f}",
    ] {
        for title in [true, false] {
            let mut spec = xml_spec();
            if title {
                spec.title = text.into();
            } else {
                spec.subtitle = text.into();
            }
            assert!(
                matches!(
                    storage.create_gfx_task(&spec),
                    Err(crate::storage::StorageError::InvalidInput(_))
                ),
                "{spec:?}"
            );
            assert!(
                matches!(
                    storage.save_gfx_version("default-gfx-item", &spec),
                    Err(crate::storage::StorageError::InvalidInput(_))
                ),
                "{spec:?}"
            );
        }
    }
    assert!(storage.list_gfx_versions().unwrap().is_empty());
}

#[test]
fn xml_accepts_legal_brief_text_with_non_bmp_characters() {
    let storage = Storage::open(":memory:").unwrap();
    storage.ensure_default_records().unwrap();
    let mut spec = xml_spec();
    spec.title = "\u{d7ff}\u{e000}\u{fffd}\u{10000}🚀\u{10ffff}\u{85} & < > \" '".into();
    spec.subtitle = spec.title.clone();
    storage.create_gfx_task(&spec).unwrap();
    let saved = storage.save_gfx_version("default-gfx-item", &spec).unwrap();
    assert_eq!(saved.spec, spec);
}
