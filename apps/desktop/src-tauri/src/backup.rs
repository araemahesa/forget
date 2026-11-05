use crate::artifacts::{read_artifact, sha256_hex, write_artifact, ArtifactResult};
use crate::storage::{Storage, StorageError};
use rusqlite::{Connection, OpenFlags};
use serde::{Deserialize, Serialize};
use std::fs;
use std::io;
use std::path::{Path, PathBuf};
use std::time::{SystemTime, UNIX_EPOCH};

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct Manifest {
    schema_version: u8,
    created_at: String,
    database: FileEntry,
    artifacts: Vec<FileEntry>,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct FileEntry {
    relative_path: String,
    sha256: String,
    byte_length: usize,
}

impl From<ArtifactResult> for FileEntry {
    fn from(value: ArtifactResult) -> Self {
        Self {
            relative_path: value.relative_path,
            sha256: value.sha256,
            byte_length: value.byte_length,
        }
    }
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BackupInfo {
    pub id: String,
    pub directory: String,
    pub created_at: String,
    pub artifact_count: usize,
    pub byte_length: usize,
}

fn real_directory(directory: &Path) -> Result<(), StorageError> {
    let metadata = fs::symlink_metadata(directory)?;
    if !metadata.is_dir() || metadata.file_type().is_symlink() {
        return Err(StorageError::InvalidInput(
            "Direktori backup tidak sah".into(),
        ));
    }
    Ok(())
}

fn backup_directory(root: &Path, id: &str) -> Result<PathBuf, StorageError> {
    if !id.starts_with("backup-")
        || id.len() > 80
        || !id
            .bytes()
            .all(|b| b.is_ascii_digit() || b.is_ascii_lowercase() || b == b'-')
    {
        return Err(StorageError::InvalidInput("ID backup tidak sah".into()));
    }
    real_directory(root)?;
    let directory = root.join(id);
    real_directory(&directory)?;
    Ok(directory)
}

fn artifact_entries(connection: &Connection) -> Result<Vec<FileEntry>, StorageError> {
    let version: i64 = connection.pragma_query_value(None, "user_version", |row| row.get(0))?;
    let query = if version >= 7 {
        "SELECT relative_path, sha256, byte_length FROM artifact
         UNION ALL SELECT relative_path, sha256, byte_length FROM image_artifact
         UNION ALL SELECT json_extract(artifact_json,'$.relativePath') AS relative_path,
         json_extract(artifact_json,'$.sha256'), json_extract(artifact_json,'$.byteLength') FROM creative_version
         UNION ALL SELECT relative_path,sha256,byte_length FROM creative_export ORDER BY relative_path"
    } else if version >= 4 {
        "SELECT relative_path, sha256, byte_length FROM artifact
         UNION ALL SELECT relative_path, sha256, byte_length FROM image_artifact ORDER BY relative_path"
    } else {
        "SELECT relative_path, sha256, byte_length FROM artifact ORDER BY relative_path"
    };
    let mut statement = connection.prepare(query)?;
    let entries = statement.query_map([], |row| {
        Ok(FileEntry {
            relative_path: row.get(0)?,
            sha256: row.get(1)?,
            byte_length: row.get(2)?,
        })
    })?;
    Ok(entries.collect::<Result<Vec<_>, _>>()?)
}

// Hunyuan receipts live outside SQLite; include every saved model, not the gallery's latest 100.
fn workspace_entries(
    connection: &Connection,
    workspace: &Path,
) -> Result<Vec<FileEntry>, StorageError> {
    let mut entries = artifact_entries(connection)?;
    let root = workspace.join("hunyuan3d");
    match fs::symlink_metadata(&root) {
        Err(error) if error.kind() == io::ErrorKind::NotFound => return Ok(entries),
        Err(error) => return Err(error.into()),
        Ok(_) => real_directory(&root)?,
    }
    for directory in fs::read_dir(&root)? {
        let directory = directory?;
        let id = directory.file_name().to_string_lossy().into_owned();
        if id.len() != 32
            || !id
                .bytes()
                .all(|b| b.is_ascii_digit() || (b'a'..=b'f').contains(&b))
        {
            continue;
        }
        real_directory(&directory.path())?;
        let relative = format!("hunyuan3d/{id}/manifest.json");
        let path = workspace.join(&relative);
        let metadata = fs::symlink_metadata(&path)?;
        if !metadata.is_file() || metadata.file_type().is_symlink() || metadata.len() > 8192 {
            return Err(StorageError::InvalidInput(
                "Manifest Hunyuan backup tidak sah".into(),
            ));
        }
        let bytes = fs::read(&path)?;
        let receipt: serde_json::Value = serde_json::from_slice(&bytes)?;
        let model_relative = format!("hunyuan3d/{id}/model.glb");
        let length = receipt["byteLength"].as_u64();
        let hash = receipt["sha256"].as_str().unwrap_or("");
        if receipt["jobId"] != id
            || receipt["model"] != "tencent/Hunyuan3D-2"
            || receipt["relativePath"] != model_relative
            || !length.is_some_and(|n| (28..=64 * 1024 * 1024).contains(&n))
            || hash.len() != 64
            || !hash.bytes().all(|b| b.is_ascii_hexdigit())
        {
            return Err(StorageError::InvalidInput(
                "Manifest Hunyuan backup tidak sesuai".into(),
            ));
        }
        let manifest_entry = FileEntry {
            relative_path: relative,
            sha256: sha256_hex(&bytes),
            byte_length: bytes.len(),
        };
        // Recheck both files through the shared path, symlink and checksum guard before recording them.
        read_artifact(
            workspace,
            &manifest_entry.relative_path,
            &manifest_entry.sha256,
            manifest_entry.byte_length,
        )?;
        read_artifact(workspace, &model_relative, hash, length.unwrap() as usize)?;
        entries.push(manifest_entry);
        entries.push(FileEntry {
            relative_path: model_relative,
            sha256: hash.into(),
            byte_length: length.unwrap() as usize,
        });
    }
    entries.sort_by(|a, b| a.relative_path.cmp(&b.relative_path));
    Ok(entries)
}

fn read_only_database(directory: &Path) -> Result<Connection, StorageError> {
    let connection = Connection::open_with_flags(
        directory.join("forgekit.sqlite"),
        OpenFlags::SQLITE_OPEN_READ_ONLY,
    )?;
    let integrity: String = connection.query_row("PRAGMA integrity_check", [], |row| row.get(0))?;
    let version: i64 = connection.pragma_query_value(None, "user_version", |row| row.get(0))?;
    let foreign_key_error = connection.prepare("PRAGMA foreign_key_check")?.exists([])?;
    if integrity != "ok"
        || !(2..=crate::storage::SCHEMA_VERSION).contains(&version)
        || foreign_key_error
    {
        return Err(StorageError::InvalidInput(
            "Database backup tidak valid atau versinya tidak didukung".into(),
        ));
    }
    Ok(connection)
}

fn read_manifest(directory: &Path) -> Result<Manifest, StorageError> {
    let file = directory.join("manifest.json");
    let metadata = fs::symlink_metadata(&file)?;
    if !metadata.is_file() || metadata.file_type().is_symlink() || metadata.len() > 4 * 1024 * 1024
    {
        return Err(StorageError::InvalidInput(
            "Manifest backup tidak sah".into(),
        ));
    }
    let manifest: Manifest = serde_json::from_slice(&fs::read(file)?)?;
    if manifest.schema_version != 1
        || manifest.database.relative_path != "forgekit.sqlite"
        || manifest.created_at.parse::<u64>().is_err()
        || std::iter::once(&manifest.database)
            .chain(&manifest.artifacts)
            .any(|entry| {
                entry.byte_length > 72 * 1024 * 1024
                    || entry.sha256.len() != 64
                    || !entry.sha256.bytes().all(|b| b.is_ascii_hexdigit())
            })
    {
        return Err(StorageError::InvalidInput(
            "Versi atau path manifest tidak didukung".into(),
        ));
    }
    Ok(manifest)
}

fn info(id: &str, directory: &Path, manifest: &Manifest) -> BackupInfo {
    BackupInfo {
        id: id.into(),
        directory: directory.to_string_lossy().into_owned(),
        created_at: manifest.created_at.clone(),
        artifact_count: manifest.artifacts.len(),
        byte_length: manifest.database.byte_length
            + manifest
                .artifacts
                .iter()
                .map(|entry| entry.byte_length)
                .sum::<usize>(),
    }
}

pub fn verify(root: &Path, id: &str) -> Result<BackupInfo, StorageError> {
    let directory = backup_directory(root, id)?;
    let manifest = read_manifest(&directory)?;
    read_artifact(
        &directory,
        &manifest.database.relative_path,
        &manifest.database.sha256,
        manifest.database.byte_length,
    )?;
    let connection = read_only_database(&directory)?;
    let workspace = directory.join("workspace");
    real_directory(&workspace)?;
    let entries = workspace_entries(&connection, &workspace)?;
    if entries.len() != manifest.artifacts.len() {
        return Err(StorageError::InvalidInput(
            "Jumlah artefak backup tidak cocok".into(),
        ));
    }
    for (entry, recorded) in entries.iter().zip(&manifest.artifacts) {
        if entry.relative_path != recorded.relative_path
            || entry.sha256 != recorded.sha256
            || entry.byte_length != recorded.byte_length
        {
            return Err(StorageError::InvalidInput(
                "Manifest artefak backup tidak cocok".into(),
            ));
        }
        read_artifact(
            &workspace,
            &entry.relative_path,
            &entry.sha256,
            entry.byte_length,
        )?;
    }
    Ok(info(id, &directory, &manifest))
}

pub fn list(root: &Path) -> Result<Vec<BackupInfo>, StorageError> {
    real_directory(root)?;
    let mut directories = fs::read_dir(root)?.collect::<Result<Vec<_>, _>>()?;
    directories.sort_by_key(|entry| std::cmp::Reverse(entry.file_name()));
    let mut result = Vec::new();
    for entry in directories {
        let id = entry.file_name().to_string_lossy().into_owned();
        if !id.starts_with("backup-") {
            continue;
        }
        let directory = backup_directory(root, &id)?;
        // Listing reads metadata only; explicit verification checks every file.
        result.push(info(&id, &directory, &read_manifest(&directory)?));
        if result.len() == 20 {
            break;
        }
    }
    Ok(result)
}

impl Storage {
    pub fn create_backup(&self, workspace: &Path, root: &Path) -> Result<BackupInfo, StorageError> {
        real_directory(root)?;
        real_directory(workspace)?;
        let stamp = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .map_err(io::Error::other)?
            .as_nanos();
        let id = format!("backup-{stamp}");
        let staging = root.join(format!(".{id}-staging"));
        fs::create_dir(&staging)?;
        let result = (|| {
            let database = staging.join("forgekit.sqlite");
            // VACUUM INTO snapshots a live SQLite database, including committed WAL data.
            self.connection
                .execute("VACUUM INTO ?1", [database.to_string_lossy().as_ref()])?;
            fs::File::open(&database)?.sync_all()?;
            let bytes = fs::read(&database)?;
            if bytes.len() > 72 * 1024 * 1024 {
                return Err(StorageError::InvalidInput(
                    "Database melampaui batas backup 72 MiB".into(),
                ));
            }
            let connection = read_only_database(&staging)?;
            let entries = workspace_entries(&connection, workspace)?;
            let destination = staging.join("workspace");
            fs::create_dir(&destination)?;
            for entry in &entries {
                let bytes = read_artifact(
                    workspace,
                    &entry.relative_path,
                    &entry.sha256,
                    entry.byte_length,
                )?;
                write_artifact(&destination, &entry.relative_path, &bytes)?;
            }
            let manifest = Manifest {
                schema_version: 1,
                created_at: (stamp / 1_000_000).to_string(),
                database: FileEntry {
                    relative_path: "forgekit.sqlite".into(),
                    sha256: sha256_hex(&bytes),
                    byte_length: bytes.len(),
                },
                artifacts: entries,
            };
            let serialized = serde_json::to_vec_pretty(&manifest)?;
            if serialized.len() > 4 * 1024 * 1024 {
                return Err(StorageError::InvalidInput(
                    "Manifest melampaui batas 4 MiB".into(),
                ));
            }
            write_artifact(&staging, "manifest.json", &serialized)?;
            fs::File::open(&destination)?.sync_all()?;
            fs::File::open(&staging)?.sync_all()?;
            let destination = root.join(&id);
            fs::rename(&staging, &destination)?;
            fs::File::open(root)?.sync_all()?;
            Ok(info(&id, &destination, &manifest))
        })();
        if result.is_err() {
            let _ = fs::remove_dir_all(&staging);
        }
        result
    }
}

pub fn restore_copy(root: &Path, id: &str, recovery_root: &Path) -> Result<String, StorageError> {
    verify(root, id)?;
    real_directory(recovery_root)?;
    let source = backup_directory(root, id)?;
    let manifest = read_manifest(&source)?;
    let stamp = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_err(io::Error::other)?
        .as_nanos();
    let staging = recovery_root.join(format!(".recovery-{stamp}-staging"));
    fs::create_dir(&staging)?;
    let result = (|| {
        let database = &manifest.database;
        let bytes = read_artifact(
            &source,
            &database.relative_path,
            &database.sha256,
            database.byte_length,
        )?;
        write_artifact(&staging, "forgekit.sqlite", &bytes)?;
        let destination = staging.join("workspace");
        fs::create_dir(&destination)?;
        for entry in &manifest.artifacts {
            let bytes = read_artifact(
                &source.join("workspace"),
                &entry.relative_path,
                &entry.sha256,
                entry.byte_length,
            )?;
            write_artifact(&destination, &entry.relative_path, &bytes)?;
        }
        write_artifact(
            &staging,
            "manifest.json",
            &serde_json::to_vec_pretty(&manifest)?,
        )?;
        fs::File::open(&destination)?.sync_all()?;
        fs::File::open(&staging)?.sync_all()?;
        let destination = recovery_root.join(format!("recovery-{stamp}"));
        fs::rename(&staging, &destination)?;
        fs::File::open(recovery_root)?.sync_all()?;
        Ok(destination.to_string_lossy().into_owned())
    })();
    if result.is_err() {
        let _ = fs::remove_dir_all(&staging);
    }
    result
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn hunyuan_backup_round_trip_includes_all_models_and_rejects_corruption() {
        let root = std::env::temp_dir().join(format!(
            "forgekit-hunyuan-backup-{}-{}",
            std::process::id(),
            SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        fs::create_dir(&root).unwrap();
        let workspace = root.join("workspace");
        let backups = root.join("backups");
        let recovered = root.join("recovered");
        for directory in [&workspace, &backups, &recovered] {
            fs::create_dir(directory).unwrap();
        }
        let storage = Storage::open(root.join("forgekit.sqlite")).unwrap();
        let mut document = br#"{"asset":{"version":"2.0"},"meshes":[{"primitives":[]}]}"#.to_vec();
        while document.len() % 4 != 0 {
            document.push(b' ');
        }
        let mut glb = b"glTF".to_vec();
        glb.extend(2u32.to_le_bytes());
        glb.extend(((28 + document.len()) as u32).to_le_bytes());
        glb.extend((document.len() as u32).to_le_bytes());
        glb.extend(b"JSON");
        glb.extend(document);
        glb.extend(0u32.to_le_bytes());
        glb.extend(b"BIN\0");
        // More than the gallery limit: backups must never silently truncate saved models.
        for number in 0..101 {
            let id = format!("{number:032x}");
            let relative = format!("hunyuan3d/{id}/model.glb");
            let receipt = serde_json::json!({"jobId":id,"model":"tencent/Hunyuan3D-2",
                "relativePath":relative,"sha256":sha256_hex(&glb),"byteLength":glb.len()});
            write_artifact(&workspace, &relative, &glb).unwrap();
            write_artifact(
                &workspace,
                &format!("hunyuan3d/{id}/manifest.json"),
                &serde_json::to_vec(&receipt).unwrap(),
            )
            .unwrap();
        }
        let backup = storage.create_backup(&workspace, &backups).unwrap();
        assert_eq!(backup.artifact_count, 202);
        assert_eq!(verify(&backups, &backup.id).unwrap().artifact_count, 202);
        let restored = PathBuf::from(restore_copy(&backups, &backup.id, &recovered).unwrap());
        for number in 0..101 {
            for name in ["model.glb", "manifest.json"] {
                let relative = format!("hunyuan3d/{number:032x}/{name}");
                assert_eq!(
                    fs::read(restored.join("workspace").join(&relative)).unwrap(),
                    fs::read(workspace.join(relative)).unwrap()
                );
            }
        }
        let model = format!("hunyuan3d/{:032x}/model.glb", 0);
        fs::write(workspace.join(&model), b"corrupt").unwrap();
        assert!(storage.create_backup(&workspace, &backups).is_err());
        assert_eq!(fs::read_dir(&backups).unwrap().count(), 1);
        fs::write(workspace.join(&model), &glb).unwrap();
        fs::write(
            workspace.join(format!("hunyuan3d/{:032x}/manifest.json", 0)),
            b"{}",
        )
        .unwrap();
        assert!(storage.create_backup(&workspace, &backups).is_err());
        fs::write(
            PathBuf::from(&backup.directory)
                .join("workspace")
                .join(&model),
            b"corrupt",
        )
        .unwrap();
        assert!(verify(&backups, &backup.id).is_err());
        assert!(restore_copy(&backups, &backup.id, &recovered).is_err());
        assert_eq!(fs::read_dir(&recovered).unwrap().count(), 1);
        drop(storage);
        fs::remove_dir_all(root).unwrap();
    }
}
