use serde::Serialize;
use sha2::{Digest, Sha256};
use std::fs::{self, OpenOptions};
use std::io::{self, Write};
use std::path::{Component, Path, PathBuf};
use std::sync::atomic::{AtomicU64, Ordering};
use std::time::{SystemTime, UNIX_EPOCH};

static STAGING_SEQUENCE: AtomicU64 = AtomicU64::new(0);

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ArtifactResult {
    pub relative_path: String,
    pub sha256: String,
    pub byte_length: usize,
}

fn validate_relative_path(relative: &str) -> io::Result<PathBuf> {
    let path = Path::new(relative);
    if relative.is_empty() || path.is_absolute() {
        return Err(io::Error::new(
            io::ErrorKind::InvalidInput,
            "Path artefak harus relatif",
        ));
    }
    if path.components().any(|component| {
        matches!(
            component,
            Component::ParentDir | Component::RootDir | Component::Prefix(_)
        )
    }) {
        return Err(io::Error::new(
            io::ErrorKind::InvalidInput,
            "Path artefak keluar dari ruang kerja",
        ));
    }
    if !path
        .components()
        .any(|component| matches!(component, Component::Normal(_)))
    {
        return Err(io::Error::new(
            io::ErrorKind::InvalidInput,
            "Path artefak tidak memiliki nama file",
        ));
    }
    Ok(path.to_path_buf())
}

pub fn sha256_hex(bytes: &[u8]) -> String {
    let digest = Sha256::digest(bytes);
    digest.iter().map(|byte| format!("{byte:02x}")).collect()
}

pub(crate) fn ensure_safe_parent(
    root: &Path,
    relative_parent: Option<&Path>,
    create: bool,
) -> io::Result<PathBuf> {
    let canonical_root = root.canonicalize()?;
    let mut current = canonical_root;
    if let Some(parent) = relative_parent {
        for component in parent.components() {
            let Component::Normal(name) = component else {
                continue;
            };
            let next = current.join(name);
            match fs::symlink_metadata(&next) {
                Ok(metadata) => {
                    if metadata.file_type().is_symlink() || !metadata.is_dir() {
                        return Err(io::Error::new(
                            io::ErrorKind::InvalidInput,
                            "Induk artefak bukan direktori nyata",
                        ));
                    }
                }
                Err(error) if create && error.kind() == io::ErrorKind::NotFound => {
                    fs::create_dir(&next)?;
                }
                Err(error) => return Err(error),
            }
            current = next;
        }
    }
    Ok(current)
}

pub fn read_artifact(
    root: &Path,
    relative: &str,
    hash: &str,
    length: usize,
) -> io::Result<Vec<u8>> {
    let relative = validate_relative_path(relative)?;
    let parent = ensure_safe_parent(root, relative.parent(), false)?;
    let target = parent.join(
        relative
            .file_name()
            .ok_or_else(|| io::Error::other("Nama file tidak tersedia"))?,
    );
    let metadata = fs::symlink_metadata(&target)?;
    if !metadata.is_file()
        || metadata.file_type().is_symlink()
        || metadata.len() != length as u64
        || length > 72 * 1024 * 1024
    {
        return Err(io::Error::other("Pemeriksaan integritas artefak gagal"));
    }
    let bytes = fs::read(target)?;
    if sha256_hex(&bytes) != hash {
        return Err(io::Error::other("Pemeriksaan integritas artefak gagal"));
    }
    Ok(bytes)
}

pub fn write_artifact(root: &Path, relative: &str, bytes: &[u8]) -> io::Result<ArtifactResult> {
    let relative_path = validate_relative_path(relative)?;
    let parent = ensure_safe_parent(root, relative_path.parent(), true)?;
    let filename = relative_path.file_name().ok_or_else(|| {
        io::Error::new(
            io::ErrorKind::InvalidInput,
            "Path artefak tidak memiliki nama file",
        )
    })?;
    let target = parent.join(filename);

    if fs::symlink_metadata(&target).is_ok() {
        return Err(io::Error::new(
            io::ErrorKind::AlreadyExists,
            "Target artefak sudah ada",
        ));
    }

    let stamp = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_err(|_| io::Error::other("Waktu sistem mendahului epoch"))?
        .as_nanos();
    let sequence = STAGING_SEQUENCE.fetch_add(1, Ordering::Relaxed);
    let staging = parent.join(format!(
        ".{}-forgekit-staging-{stamp}-{sequence}",
        filename.to_string_lossy()
    ));
    let mut file = OpenOptions::new()
        .create_new(true)
        .write(true)
        .open(&staging)?;
    let result = (|| {
        file.write_all(bytes)?;
        file.sync_all()?;
        drop(file);
        fs::rename(&staging, &target)?;
        fs::File::open(&parent)?.sync_all()?;
        Ok(ArtifactResult {
            relative_path: relative.replace('\\', "/"),
            sha256: sha256_hex(bytes),
            byte_length: bytes.len(),
        })
    })();
    if result.is_err() {
        let _ = fs::remove_file(&staging);
    }
    result
}
