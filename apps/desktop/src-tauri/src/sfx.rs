use crate::artifacts::{sha256_hex, write_artifact, ArtifactResult};
use crate::storage::{Storage, StorageError};
use rusqlite::{params, OptionalExtension};
use serde::{Deserialize, Serialize};
use std::path::Path;
use std::time::{SystemTime, UNIX_EPOCH};

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct SfxRecipe {
    pub schema_version: u8,
    pub name: String,
    pub category: String,
    pub waveform: String,
    pub duration_ms: f64,
    pub frequency_start: f64,
    pub frequency_end: f64,
    pub attack_ms: f64,
    pub decay_ms: f64,
    pub sustain: f64,
    pub release_ms: f64,
    pub filter_cutoff: f64,
    pub noise_mix: f64,
    pub volume: f64,
    pub r#loop: bool,
    pub seed: u32,
}

impl SfxRecipe {
    fn validate(&self) -> Result<(), StorageError> {
        let ranges = [
            (self.duration_ms, 50.0, 3000.0),
            (self.frequency_start, 20.0, 4000.0),
            (self.frequency_end, 20.0, 4000.0),
            (self.attack_ms, 0.0, 1000.0),
            (self.decay_ms, 0.0, 2000.0),
            (self.sustain, 0.0, 1.0),
            (self.release_ms, 10.0, 2000.0),
            (self.filter_cutoff, 100.0, 12000.0),
            (self.noise_mix, 0.0, 1.0),
            (self.volume, 0.05, 1.0),
        ];
        if self.schema_version != 1
            || self.name.trim().is_empty()
            || self.name.encode_utf16().count() > 60
            || self
                .name
                .chars()
                .any(|c| c.is_control() || matches!(c, '\u{fffe}' | '\u{ffff}'))
            || ![
                "coin",
                "laser",
                "explosion",
                "jump",
                "powerup",
                "hit",
                "ui_click",
                "footstep",
            ]
            .contains(&self.category.as_str())
            || !["sine", "square", "sawtooth", "triangle", "noise"]
                .contains(&self.waveform.as_str())
            || self.seed > 999999
            || ranges
                .iter()
                .any(|(value, min, max)| !value.is_finite() || value < min || value > max)
        {
            return Err(StorageError::InvalidInput(
                "Resep efek suara tidak sah".into(),
            ));
        }
        Ok(())
    }
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SfxVersion {
    pub id: String,
    pub sequence: i64,
    pub recipe: SfxRecipe,
    pub sha256: String,
    pub byte_length: usize,
    pub created_at: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LoadedSfxVersion {
    pub version: SfxVersion,
    pub wav_bytes: Vec<u8>,
}

fn validate_wav(recipe: &SfxRecipe, wav: &[u8]) -> Result<(), StorageError> {
    recipe.validate()?;
    let sample_count = ((recipe.duration_ms / 1000.0) * 44100.0).floor() as usize;
    let length = 44 + sample_count * 2;
    let u32_at = |index| u32::from_le_bytes(wav[index..index + 4].try_into().unwrap());
    if wav.len() != length
        || &wav[0..4] != b"RIFF"
        || u32_at(4) as usize != length - 8
        || &wav[8..16] != b"WAVEfmt "
        || u32_at(16) != 16
        || wav[20..24] != [1, 0, 1, 0]
        || u32_at(24) != 44100
        || u32_at(28) != 88200
        || wav[32..36] != [2, 0, 16, 0]
        || &wav[36..40] != b"data"
        || u32_at(40) as usize != length - 44
    {
        return Err(StorageError::InvalidInput(
            "WAV harus PCM mono 16-bit 44.1 kHz dengan durasi sesuai resep".into(),
        ));
    }
    Ok(())
}

fn from_row(
    row: &rusqlite::Row<'_>,
) -> rusqlite::Result<(String, i64, String, String, usize, String)> {
    Ok((
        row.get(0)?,
        row.get(1)?,
        row.get(2)?,
        row.get(3)?,
        row.get(4)?,
        row.get(5)?,
    ))
}

fn decode(row: (String, i64, String, String, usize, String)) -> Result<SfxVersion, StorageError> {
    let recipe: SfxRecipe = serde_json::from_str(&row.2)?;
    recipe.validate()?;
    Ok(SfxVersion {
        id: row.0,
        sequence: row.1,
        recipe,
        sha256: row.3,
        byte_length: row.4,
        created_at: row.5,
    })
}

impl Storage {
    pub fn save_sfx_version(
        &self,
        recipe: &SfxRecipe,
        wav: &[u8],
    ) -> Result<SfxVersion, StorageError> {
        self.save_sfx_version_for_task(recipe, wav, None)
    }

    pub fn save_sfx_version_for_task(
        &self,
        recipe: &SfxRecipe,
        wav: &[u8],
        work_task_id: Option<&str>,
    ) -> Result<SfxVersion, StorageError> {
        validate_wav(recipe, wav)?;
        let recipe_json = serde_json::to_string(recipe)?;
        let hash = sha256_hex(wav);
        let stamp = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .map_err(std::io::Error::other)?
            .as_nanos();
        let id = format!("sfx-{stamp}");
        // ponytail: audio is capped at 265 KB/3 seconds; keep WAV in this transaction.
        // Move long-form audio to the artifact store when Music Composer is implemented.
        let transaction = self.connection.unchecked_transaction()?;
        transaction.execute(
            "INSERT INTO sfx_version (id, sequence, recipe_json, wav, sha256, created_at)
             SELECT ?1, COALESCE(MAX(sequence), 0) + 1, ?2, ?3, ?4, ?5 FROM sfx_version",
            params![id, recipe_json, wav, hash, (stamp / 1_000_000).to_string()],
        )?;
        crate::creator_workspace::complete_save(
            &transaction,
            work_task_id,
            "sfx",
            &serde_json::to_value(recipe)?,
            &id,
        )?;
        transaction.commit()?;
        Ok(self.load_sfx_version(&id)?.version)
    }

    pub fn list_sfx_versions(&self) -> Result<Vec<SfxVersion>, StorageError> {
        let mut statement = self.connection.prepare(
            "SELECT id, sequence, recipe_json, sha256, length(wav), created_at
             FROM sfx_version ORDER BY sequence DESC LIMIT 100",
        )?;
        let rows = statement
            .query_map([], from_row)?
            .collect::<Result<Vec<_>, _>>()?;
        rows.into_iter().map(decode).collect()
    }

    pub fn load_sfx_version(&self, id: &str) -> Result<LoadedSfxVersion, StorageError> {
        let engine: i64 = self
            .connection
            .query_row(
                "SELECT engine_version FROM sfx_version WHERE id = ?1",
                [id],
                |row| row.get(0),
            )
            .optional()?
            .ok_or_else(|| StorageError::NotFound(id.into()))?;
        if engine != crate::creator_workspace::ENGINE_VERSION {
            return Err(StorageError::InvalidInput(
                "Versi engine audio tidak didukung. WAV asli dipertahankan.".into(),
            ));
        }
        let row = self
            .connection
            .query_row(
                "SELECT id, sequence, recipe_json, sha256, length(wav), created_at, wav
             FROM sfx_version WHERE id = ?1",
                [id],
                |row| Ok((from_row(row)?, row.get::<_, Vec<u8>>(6)?)),
            )
            .optional()?
            .ok_or_else(|| StorageError::NotFound(id.into()))?;
        let version = decode(row.0)?;
        validate_wav(&version.recipe, &row.1)?;
        if sha256_hex(&row.1) != version.sha256 {
            return Err(StorageError::InvalidInput("Integritas WAV gagal".into()));
        }
        Ok(LoadedSfxVersion {
            version,
            wav_bytes: row.1,
        })
    }

    pub fn export_sfx_version(
        &self,
        id: &str,
        root: &Path,
    ) -> Result<ArtifactResult, StorageError> {
        let loaded = self.load_sfx_version(id)?;
        let stamp = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .map_err(std::io::Error::other)?
            .as_nanos();
        Ok(write_artifact(
            root,
            &format!("exports/sfx-{}-{stamp}.wav", loaded.version.sequence),
            &loaded.wav_bytes,
        )?)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;

    fn recipe() -> SfxRecipe {
        serde_json::from_value(serde_json::json!({
            "schemaVersion": 1, "name": "Laser", "category": "laser", "waveform": "sine",
            "durationMs": 200, "frequencyStart": 400, "frequencyEnd": 100,
            "attackMs": 2, "decayMs": 100, "sustain": 0.5, "releaseMs": 50,
            "filterCutoff": 3000, "noiseMix": 0, "volume": 0.5, "loop": false, "seed": 42
        }))
        .unwrap()
    }

    fn wav() -> Vec<u8> {
        let mut wav = vec![0; 44 + 8820 * 2];
        wav[0..4].copy_from_slice(b"RIFF");
        wav[4..8].copy_from_slice(&(17676u32).to_le_bytes());
        wav[8..16].copy_from_slice(b"WAVEfmt ");
        wav[16..20].copy_from_slice(&16u32.to_le_bytes());
        wav[20..24].copy_from_slice(&[1, 0, 1, 0]);
        wav[24..28].copy_from_slice(&44100u32.to_le_bytes());
        wav[28..32].copy_from_slice(&88200u32.to_le_bytes());
        wav[32..36].copy_from_slice(&[2, 0, 16, 0]);
        wav[36..40].copy_from_slice(b"data");
        wav[40..44].copy_from_slice(&17640u32.to_le_bytes());
        for (i, bytes) in wav[44..].as_chunks_mut::<2>().0.iter_mut().enumerate() {
            let sample =
                ((i as f64 / 44100.0 * 440.0 * std::f64::consts::TAU).sin() * 8000.0) as i16;
            bytes.copy_from_slice(&sample.to_le_bytes());
        }
        wav
    }

    #[test]
    fn audio_draft_revision_and_save_receipt_are_atomic() {
        use crate::creator_workspace::CreatorDraft;
        let store = Storage::open(":memory:").unwrap();
        let input = serde_json::to_value(recipe()).unwrap();
        let job = store.create_work_task("sfx", "save", &input).unwrap();
        store
            .update_work_task(&job.id, "running", "saving", None, None)
            .unwrap();
        let saved = store
            .save_sfx_version_for_task(&recipe(), &wav(), Some(&job.id))
            .unwrap();
        assert_eq!(store.get_work_task(&job.id).unwrap().status, "succeeded");
        assert_eq!(
            store.get_work_task(&job.id).unwrap().receipt.unwrap()["versionId"],
            saved.id
        );
        assert!(store
            .save_sfx_version_for_task(&recipe(), &wav(), Some(&job.id))
            .is_err());
        assert_eq!(store.list_sfx_versions().unwrap().len(), 1);
        let mut unfinished = input;
        unfinished["name"] = serde_json::json!("");
        unfinished["durationMs"] = serde_json::json!(-0.5);
        let mut draft = CreatorDraft {
            kind: "sfx".into(),
            spec: unfinished.clone(),
            baseline_version_id: Some(saved.id.clone()),
            revision: 0,
            engine_version: 1,
            updated_at: String::new(),
        };
        let first = store.save_creator_draft(&draft).unwrap();
        assert_eq!(first.spec, unfinished);
        assert!(store.save_creator_draft(&draft).is_err());
        draft.revision = first.revision;
        draft.spec["name"] = serde_json::json!("Updated draft");
        assert_eq!(store.save_creator_draft(&draft).unwrap().revision, 2);
        draft.revision = 2;
        draft.engine_version = 99;
        assert!(store.save_creator_draft(&draft).is_err());
        store
            .connection
            .execute(
                "UPDATE sfx_version SET engine_version = 99 WHERE id = ?1",
                [&saved.id],
            )
            .unwrap();
        assert!(store.load_sfx_version(&saved.id).is_err());
    }

    #[test]
    fn sfx_restart_export_backup_and_tampering() {
        let stamp = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        let root = std::env::temp_dir().join(format!("forgekit-sfx-{stamp}"));
        fs::create_dir_all(root.join("workspace")).unwrap();
        fs::create_dir(root.join("backups")).unwrap();
        fs::create_dir(root.join("recoveries")).unwrap();
        let db = root.join("forgekit.sqlite");
        let store = Storage::open(&db).unwrap();
        assert!(store.list_sfx_versions().unwrap().is_empty());
        let first = store.save_sfx_version(&recipe(), &wav()).unwrap();
        assert_eq!(first.sequence, 1);
        drop(store);
        let store = Storage::open(&db).unwrap();
        assert_eq!(store.list_sfx_versions().unwrap()[0].id, first.id);
        let loaded = store.load_sfx_version(&first.id).unwrap();
        assert_eq!(loaded.wav_bytes, wav());
        assert_eq!(loaded.version.sha256, sha256_hex(&wav()));
        let exported = store
            .export_sfx_version(&first.id, &root.join("workspace"))
            .unwrap();
        assert_eq!(
            fs::read(root.join("workspace").join(exported.relative_path)).unwrap(),
            wav()
        );
        let backup = store
            .create_backup(&root.join("workspace"), &root.join("backups"))
            .unwrap();
        crate::backup::verify(&root.join("backups"), &backup.id).unwrap();
        let recovery = crate::backup::restore_copy(
            &root.join("backups"),
            &backup.id,
            &root.join("recoveries"),
        )
        .unwrap();
        let recovered = Storage::open(Path::new(&recovery).join("forgekit.sqlite")).unwrap();
        assert_eq!(
            recovered.load_sfx_version(&first.id).unwrap().wav_bytes,
            wav()
        );
        assert_eq!(
            store.save_sfx_version(&recipe(), &wav()).unwrap().sequence,
            2
        );
        let mut corrupted = wav();
        corrupted[100] ^= 0xff;
        store
            .connection
            .execute(
                "UPDATE sfx_version SET wav = ?1 WHERE id = ?2",
                params![corrupted, first.id],
            )
            .unwrap();
        assert!(store.load_sfx_version(&first.id).is_err());
        assert!(store
            .export_sfx_version(&first.id, &root.join("workspace"))
            .is_err());
        drop(recovered);
        drop(store);
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn sfx_rejects_invalid_recipe_and_malformed_wav() {
        let store = Storage::open(":memory:").unwrap();
        let mut bad = recipe();
        bad.duration_ms = 1e12;
        assert!(store.save_sfx_version(&bad, &[]).is_err());
        bad = recipe();
        bad.name = " \n".into();
        assert!(store.save_sfx_version(&bad, &wav()).is_err());
        for bytes in [vec![], vec![0; wav().len()], wav()[0..100].to_vec()] {
            assert!(store.save_sfx_version(&recipe(), &bytes).is_err());
        }
        let mut wrong_rate = wav();
        wrong_rate[24] = 0;
        assert!(store.save_sfx_version(&recipe(), &wrong_rate).is_err());
        assert!(store.list_sfx_versions().unwrap().is_empty());
    }
}
