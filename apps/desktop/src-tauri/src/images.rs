use crate::artifacts::{read_artifact, write_artifact, ArtifactResult};
use crate::gfx_assets::{is_xml_char, validate_png};
use crate::storage::{next_id, now_string, Storage, StorageError};
use quick_xml::{events::Event, Reader, XmlVersion};
use rusqlite::{params, OptionalExtension};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::collections::{BTreeMap, BTreeSet};
use std::path::Path;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum ImageKind {
    Icon,
    Texture,
    Clothing,
}

impl ImageKind {
    fn as_str(self) -> &'static str {
        match self {
            Self::Icon => "icon",
            Self::Texture => "texture",
            Self::Clothing => "clothing",
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ImageDocument {
    pub kind: ImageKind,
    pub spec: Value,
}

struct Slot {
    name: &'static str,
    width: u32,
    height: u32,
    view_box: String,
    label: String,
}

fn invalid(message: &str) -> StorageError {
    StorageError::InvalidInput(message.into())
}

impl ImageDocument {
    fn slots(&self) -> Result<Vec<Slot>, StorageError> {
        let spec = &self.spec;
        let text = |key: &str| spec[key].as_str().unwrap_or("");
        let choice = |key: &str, choices: &[&str]| choices.contains(&text(key));
        let number = |key: &str, min: f64, max: f64, integer: bool| {
            spec[key].as_f64().is_some_and(|value| {
                value.is_finite()
                    && (min..=max).contains(&value)
                    && (!integer || value.fract() == 0.0)
            })
        };
        let color = |key: &str| {
            let value = text(key);
            value.len() == 7
                && value.starts_with('#')
                && value[1..].bytes().all(|byte| byte.is_ascii_hexdigit())
        };
        let fields: &[&str] = match self.kind {
            ImageKind::Icon => &[
                "schemaVersion",
                "name",
                "glyph",
                "shape",
                "style",
                "background",
                "primaryColor",
                "secondaryColor",
                "strokeWidth",
                "padding",
                "size",
            ],
            ImageKind::Texture => &[
                "schemaVersion",
                "name",
                "pattern",
                "baseColor",
                "accentColor",
                "roughness",
                "metalness",
                "scale",
                "seed",
                "resolution",
            ],
            ImageKind::Clothing => &[
                "schemaVersion",
                "name",
                "kind",
                "baseColor",
                "accentColor",
                "pattern",
                "neckStyle",
                "pocket",
                "cuffColor",
                "shading",
                "templateGuide",
            ],
        };
        if spec.as_object().is_none_or(|object| {
            object.len() != fields.len() || !fields.iter().all(|key| object.contains_key(*key))
        }) || spec["schemaVersion"] != 1
            || text("name").trim().is_empty()
            || text("name").encode_utf16().count() > 60
            || text("name")
                .chars()
                .any(|c| c <= '\u{1f}' || c == '\u{7f}' || !is_xml_char(c))
        {
            return Err(invalid("Spesifikasi gambar tidak sah"));
        }
        let slot = |name, width, height, view_box, label| Slot {
            name,
            width,
            height,
            view_box,
            label,
        };
        let slots = match self.kind {
            ImageKind::Icon => {
                if !choice(
                    "glyph",
                    &[
                        "sword", "shield", "bow", "axe", "skull", "potion", "coin", "gem", "chest",
                        "key", "bag", "heart", "star", "spark", "flame", "bolt", "compass",
                        "crown",
                    ],
                ) || !choice(
                    "shape",
                    &["none", "circle", "rounded", "squircle", "hexagon", "shield"],
                ) || !choice("style", &["outline", "solid", "duotone"])
                    || !(text("background") == "transparent" || color("background"))
                    || !color("primaryColor")
                    || !color("secondaryColor")
                    || !number("strokeWidth", 1.0, 6.0, false)
                    || !number("padding", 0.0, 20.0, false)
                    || !number("size", 24.0, 1024.0, true)
                {
                    return Err(invalid("Spesifikasi ikon tidak sah"));
                }
                let size = spec["size"].as_f64().unwrap() as u32;
                vec![slot(
                    "icon",
                    size,
                    size,
                    "0 0 64 64".into(),
                    text("name").into(),
                )]
            }
            ImageKind::Texture => {
                if !choice(
                    "pattern",
                    &[
                        "noise",
                        "bricks",
                        "wood",
                        "metal_grid",
                        "hex_tiles",
                        "fabric",
                        "stone",
                    ],
                ) || !color("baseColor")
                    || !color("accentColor")
                    || !number("roughness", 0.0, 1.0, false)
                    || !number("metalness", 0.0, 1.0, false)
                    || !number("scale", 1.0, 16.0, true)
                    || !number("seed", 0.0, 999999.0, true)
                    || ![128.0, 256.0, 512.0].contains(&spec["resolution"].as_f64().unwrap_or(0.0))
                {
                    return Err(invalid("Spesifikasi tekstur tidak sah"));
                }
                let size = spec["resolution"].as_f64().unwrap() as u32;
                ["baseColor", "normal", "roughness", "height"]
                    .map(|name| {
                        slot(
                            name,
                            size,
                            size,
                            "0 0 256 256".into(),
                            format!("{} - {name} (1x1)", text("name")),
                        )
                    })
                    .into()
            }
            ImageKind::Clothing => {
                if !choice("kind", &["shirt", "pants", "tshirt"])
                    || !choice(
                        "pattern",
                        &["solid", "stripes", "denim", "camo", "hoodie", "plaid"],
                    )
                    || !choice("neckStyle", &["round", "v_neck", "collar", "crew"])
                    || !color("baseColor")
                    || !color("accentColor")
                    || !color("cuffColor")
                    || ["pocket", "shading", "templateGuide"]
                        .iter()
                        .any(|key| !spec[key].is_boolean())
                {
                    return Err(invalid("Spesifikasi pakaian tidak sah"));
                }
                let (width, height) = if text("kind") == "tshirt" {
                    (512, 512)
                } else {
                    (585, 559)
                };
                vec![
                    slot(
                        "template",
                        width,
                        height,
                        format!("0 0 {width} {height}"),
                        text("name").into(),
                    ),
                    slot(
                        "avatar",
                        320,
                        380,
                        "0 0 320 380".into(),
                        text("name").into(),
                    ),
                ]
            }
        };
        Ok(slots)
    }
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ImageInput {
    pub name: String,
    pub svg: String,
    pub png_bytes: Vec<u8>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ImageArtifact {
    pub name: String,
    pub format: String,
    #[serde(flatten)]
    pub file: ArtifactResult,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ImageVersion {
    pub id: String,
    pub sequence: i64,
    pub document: ImageDocument,
    pub created_at: String,
    pub artifacts: Vec<ImageArtifact>,
}

#[derive(Serialize)]
pub struct LoadedImageVersion {
    pub version: ImageVersion,
    pub svgs: BTreeMap<String, String>,
}

fn local_id(value: &str) -> bool {
    !value.is_empty()
        && value.len() <= 100
        && value
            .bytes()
            .all(|c| c.is_ascii_alphanumeric() || matches!(c, b'-' | b'_'))
}

fn paint(value: &str) -> bool {
    matches!(value, "none" | "transparent")
        || (matches!(value.len(), 4 | 7)
            && value.starts_with('#')
            && value[1..].bytes().all(|c| c.is_ascii_hexdigit()))
        || value
            .strip_prefix("url(#")
            .and_then(|v| v.strip_suffix(')'))
            .is_some_and(local_id)
        || value
            .strip_prefix("rgb(")
            .and_then(|v| v.strip_suffix(')'))
            .is_some_and(|v| {
                let channels = v.split(',').collect::<Vec<_>>();
                channels.len() == 3 && channels.iter().all(|v| v.trim().parse::<u8>().is_ok())
            })
}

fn validate_svg(slot: &Slot, svg: &str) -> Result<(), StorageError> {
    if svg.len() > 512 * 1024 || !svg.chars().all(is_xml_char) {
        return Err(invalid(
            "SVG melampaui batas atau mengandung karakter tidak sah",
        ));
    }
    let mut reader = Reader::from_str(svg);
    let mut stack = Vec::new();
    let mut root_seen = false;
    let mut closed = false;
    let mut ids = BTreeSet::new();
    let mut references = BTreeSet::new();
    let mut nodes = 0;
    loop {
        match reader
            .read_event()
            .map_err(|_| invalid("Struktur SVG tidak sah"))?
        {
            event @ (Event::Start(_) | Event::Empty(_)) => {
                let (tag, empty) = match event {
                    Event::Start(tag) => (tag, false),
                    Event::Empty(tag) => (tag, true),
                    _ => unreachable!(),
                };
                let name = tag.name().as_ref().to_owned();
                nodes += 1;
                if closed
                    || nodes > 10000
                    || stack.len() > 16
                    || !matches!(
                        name.as_str(),
                        "svg"
                            | "rect"
                            | "g"
                            | "circle"
                            | "path"
                            | "text"
                            | "line"
                            | "polygon"
                            | "ellipse"
                            | "defs"
                            | "pattern"
                            | "linearGradient"
                            | "stop"
                    )
                    || (name == "svg" && root_seen)
                {
                    return Err(invalid("Elemen SVG tidak didukung"));
                }
                let mut attributes = BTreeMap::new();
                for attribute in tag.attributes() {
                    let attribute = attribute.map_err(|_| invalid("Atribut SVG tidak sah"))?;
                    let key = attribute.key.as_ref();
                    if !matches!(
                        key,
                        "xmlns"
                            | "width"
                            | "height"
                            | "viewBox"
                            | "role"
                            | "aria-label"
                            | "fill"
                            | "fill-opacity"
                            | "stroke"
                            | "stroke-width"
                            | "stroke-opacity"
                            | "stroke-linecap"
                            | "stroke-linejoin"
                            | "stroke-dasharray"
                            | "x"
                            | "y"
                            | "x1"
                            | "x2"
                            | "y1"
                            | "y2"
                            | "cx"
                            | "cy"
                            | "r"
                            | "rx"
                            | "ry"
                            | "d"
                            | "points"
                            | "opacity"
                            | "transform"
                            | "text-anchor"
                            | "font-family"
                            | "font-size"
                            | "font-weight"
                            | "letter-spacing"
                            | "id"
                            | "patternUnits"
                            | "offset"
                            | "stop-color"
                            | "stop-opacity"
                    ) {
                        return Err(invalid("Atribut SVG tidak didukung"));
                    }
                    let value = attribute
                        .normalized_value(XmlVersion::Implicit1_0)
                        .map_err(|_| invalid("Nilai atribut SVG tidak sah"))?
                        .into_owned();
                    if !value.chars().all(is_xml_char)
                        || (matches!(key, "fill" | "stroke" | "stop-color") && !paint(&value))
                        || (key == "xmlns" && value != "http://www.w3.org/2000/svg")
                        || (key == "id" && (!local_id(&value) || !ids.insert(value.clone())))
                        || (key == "patternUnits" && value != "userSpaceOnUse")
                    {
                        return Err(invalid("Nilai atribut SVG tidak didukung"));
                    }
                    if matches!(key, "fill" | "stroke" | "stop-color") {
                        if let Some(id) = value
                            .strip_prefix("url(#")
                            .and_then(|v| v.strip_suffix(')'))
                        {
                            references.insert(id.to_owned());
                        }
                    }
                    attributes.insert(key.to_owned(), value);
                }
                if stack.is_empty() {
                    if root_seen || name != "svg" || empty {
                        return Err(invalid("Akar SVG tidak sah"));
                    }
                    for (key, expected) in [
                        ("xmlns", "http://www.w3.org/2000/svg".into()),
                        ("width", slot.width.to_string()),
                        ("height", slot.height.to_string()),
                        ("viewBox", slot.view_box.clone()),
                        ("aria-label", slot.label.clone()),
                    ] {
                        if attributes.get(key) != Some(&expected) {
                            return Err(invalid("SVG tidak sesuai dengan spesifikasi"));
                        }
                    }
                    root_seen = true;
                }
                if !empty {
                    stack.push(name);
                }
            }
            Event::End(tag) => {
                if stack.pop().as_deref() != Some(tag.name().as_ref()) {
                    return Err(invalid("Tag SVG tidak sesuai"));
                }
                closed = stack.is_empty();
            }
            Event::Text(text) if stack.is_empty() && !text.trim().is_empty() => {
                return Err(invalid("Teks di luar SVG"))
            }
            Event::GeneralRef(reference) => {
                if stack.is_empty() {
                    return Err(invalid("Referensi di luar SVG"));
                }
                match reference
                    .resolve_char_ref()
                    .map_err(|_| invalid("Referensi SVG tidak sah"))?
                {
                    Some(c) if is_xml_char(c) => {}
                    None if matches!(reference.as_ref(), "amp" | "lt" | "gt" | "quot" | "apos") => {
                    }
                    _ => return Err(invalid("Referensi SVG tidak didukung")),
                }
            }
            Event::Text(_) | Event::Comment(_) => {}
            Event::Eof => break,
            _ => return Err(invalid("Konten aktif atau deklarasi SVG tidak didukung")),
        }
    }
    if !root_seen || !closed || !stack.is_empty() || !references.is_subset(&ids) {
        return Err(invalid("SVG tidak lengkap atau referensi tidak ditemukan"));
    }
    Ok(())
}

impl Storage {
    pub fn save_image_version(
        &self,
        root: &Path,
        document: ImageDocument,
        images: Vec<ImageInput>,
    ) -> Result<ImageVersion, StorageError> {
        self.save_image_version_for_task(root, document, images, None)
    }

    pub fn save_image_version_for_task(
        &self,
        root: &Path,
        document: ImageDocument,
        images: Vec<ImageInput>,
        work_task_id: Option<&str>,
    ) -> Result<ImageVersion, StorageError> {
        let slots = document.slots()?;
        if images.len() != slots.len() {
            return Err(invalid("Kumpulan gambar tidak lengkap"));
        }
        for slot in &slots {
            let image = images
                .iter()
                .find(|image| image.name == slot.name)
                .ok_or_else(|| invalid("Peta gambar tidak ditemukan"))?;
            if image.png_bytes.len() > 5 * 1024 * 1024 {
                return Err(invalid("PNG melebihi 5 MiB"));
            }
            validate_svg(slot, &image.svg)?;
            validate_png(slot.width, slot.height, &image.png_bytes)?;
        }
        let id = next_id("image");
        let created_at = now_string();
        let transaction = self.connection.unchecked_transaction()?;
        let mut written = Vec::new();
        let result = (|| {
            let sequence: i64 = transaction.query_row(
                "SELECT COALESCE(MAX(sequence), 0) + 1 FROM image_version WHERE kind = ?1",
                [document.kind.as_str()],
                |row| row.get(0),
            )?;
            transaction.execute(
                "INSERT INTO image_version (id, kind, sequence, spec_json, created_at) VALUES (?1, ?2, ?3, ?4, ?5)",
                params![
                    id,
                    document.kind.as_str(),
                    sequence,
                    serde_json::to_string(&document.spec)?,
                    created_at
                ],
            )?;
            let mut artifacts = Vec::new();
            for image in &images {
                for (format, bytes) in [
                    ("svg", image.svg.as_bytes()),
                    ("png", image.png_bytes.as_slice()),
                ] {
                    let file = write_artifact(
                        root,
                        &format!("images/{id}/{}.{format}", image.name),
                        bytes,
                    )?;
                    written.push(file.relative_path.clone());
                    transaction.execute(
                        "INSERT INTO image_artifact VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
                        params![
                            id,
                            image.name,
                            format,
                            file.relative_path,
                            file.sha256,
                            file.byte_length
                        ],
                    )?;
                    artifacts.push(ImageArtifact {
                        name: image.name.clone(),
                        format: format.into(),
                        file,
                    });
                }
            }
            crate::creator_workspace::complete_save(
                &transaction,
                work_task_id,
                document.kind.as_str(),
                &document.spec,
                &id,
            )?;
            Ok(ImageVersion {
                id,
                sequence,
                document,
                created_at,
                artifacts,
            })
        })();
        match result {
            Ok(version) => {
                // A failed commit leaves files for orphan diagnostics; never delete committed data.
                transaction.commit()?;
                Ok(version)
            }
            Err(error) => {
                drop(transaction);
                for path in written {
                    let _ = std::fs::remove_file(root.join(path));
                }
                Err(error)
            }
        }
    }

    fn image_metadata(&self, id: &str) -> Result<ImageVersion, StorageError> {
        let engine: i64 = self
            .connection
            .query_row(
                "SELECT engine_version FROM image_version WHERE id = ?1",
                [id],
                |row| row.get(0),
            )
            .optional()?
            .ok_or_else(|| StorageError::NotFound(id.into()))?;
        if engine != crate::creator_workspace::ENGINE_VERSION {
            return Err(invalid(
                "Versi engine gambar tidak didukung. Artefak asli dipertahankan.",
            ));
        }
        let (sequence, kind, spec, created_at): (i64, String, String, String) = self
            .connection
            .query_row(
                "SELECT sequence, kind, spec_json, created_at FROM image_version WHERE id = ?1",
                [id],
                |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?, row.get(3)?)),
            )
            .optional()?
            .ok_or_else(|| StorageError::NotFound(id.into()))?;
        let document = ImageDocument {
            kind: serde_json::from_value(Value::String(kind))?,
            spec: serde_json::from_str(&spec)?,
        };
        document.slots()?;
        let artifacts = self.connection.prepare(
            "SELECT name, format, relative_path, sha256, byte_length FROM image_artifact WHERE version_id = ?1 ORDER BY name, format"
        )?.query_map([id], |row| Ok(ImageArtifact {
            name: row.get(0)?, format: row.get(1)?,
            file: ArtifactResult { relative_path: row.get(2)?, sha256: row.get(3)?, byte_length: row.get(4)? },
        }))?.collect::<Result<Vec<_>, _>>()?;
        Ok(ImageVersion {
            id: id.into(),
            sequence,
            document,
            created_at,
            artifacts,
        })
    }

    pub fn list_image_versions(&self, kind: ImageKind) -> Result<Vec<ImageVersion>, StorageError> {
        let ids = self
            .connection
            .prepare(
                "SELECT id FROM image_version WHERE kind = ?1 ORDER BY sequence DESC LIMIT 100",
            )?
            .query_map([kind.as_str()], |row| row.get::<_, String>(0))?
            .collect::<Result<Vec<_>, _>>()?;
        ids.iter().map(|id| self.image_metadata(id)).collect()
    }

    pub fn load_image_version(
        &self,
        root: &Path,
        id: &str,
    ) -> Result<LoadedImageVersion, StorageError> {
        let version = self.image_metadata(id)?;
        let slots = version.document.slots()?;
        if version.artifacts.len() != slots.len() * 2 {
            return Err(invalid("Artefak versi tidak lengkap"));
        }
        let mut svgs = BTreeMap::new();
        for slot in slots {
            for format in ["svg", "png"] {
                let artifact = version
                    .artifacts
                    .iter()
                    .find(|a| a.name == slot.name && a.format == format)
                    .ok_or_else(|| invalid("Artefak versi tidak ditemukan"))?;
                let file = &artifact.file;
                if file.relative_path != format!("images/{id}/{}.{format}", slot.name) {
                    return Err(invalid("Path artefak tidak sesuai versi"));
                }
                let bytes =
                    read_artifact(root, &file.relative_path, &file.sha256, file.byte_length)?;
                if format == "svg" {
                    let svg = String::from_utf8(bytes).map_err(|_| invalid("SVG bukan UTF-8"))?;
                    validate_svg(&slot, &svg)?;
                    svgs.insert(slot.name.into(), svg);
                } else {
                    validate_png(slot.width, slot.height, &bytes)?;
                }
            }
        }
        Ok(LoadedImageVersion { version, svgs })
    }

    pub fn export_image_artifact(
        &self,
        root: &Path,
        id: &str,
        name: &str,
        format: &str,
    ) -> Result<ArtifactResult, StorageError> {
        let loaded = self.load_image_version(root, id)?;
        let artifact = loaded
            .version
            .artifacts
            .iter()
            .find(|a| a.name == name && a.format == format)
            .ok_or_else(|| invalid("Format atau peta ekspor tidak tersedia"))?;
        let file = &artifact.file;
        let bytes = read_artifact(root, &file.relative_path, &file.sha256, file.byte_length)?;
        Ok(write_artifact(
            root,
            &format!("exports/{}-{name}.{format}", next_id("image")),
            &bytes,
        )?)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;
    use std::fs;

    fn documents() -> Vec<ImageDocument> {
        vec![
            ImageDocument {
                kind: ImageKind::Icon,
                spec: json!({
                    "schemaVersion": 1, "name": "Fixture", "glyph": "sword", "shape": "circle",
                    "style": "duotone", "background": "transparent", "primaryColor": "#FF405F",
                    "secondaryColor": "#FFD166", "strokeWidth": 2, "padding": 6, "size": 64
                }),
            },
            ImageDocument {
                kind: ImageKind::Texture,
                spec: json!({
                    "schemaVersion": 1, "name": "Fixture", "pattern": "bricks", "baseColor": "#7A3520",
                    "accentColor": "#B85333", "roughness": 0.8, "metalness": 0.05, "scale": 4,
                    "seed": 42, "resolution": 128
                }),
            },
            ImageDocument {
                kind: ImageKind::Clothing,
                spec: json!({
                    "schemaVersion": 1, "name": "Fixture", "kind": "shirt", "pattern": "stripes",
                    "baseColor": "#2C3E50", "accentColor": "#E74C3C", "neckStyle": "collar",
                    "pocket": true, "cuffColor": "#1A252F", "shading": true, "templateGuide": false
                }),
            },
        ]
    }

    fn inputs(document: &ImageDocument) -> Vec<ImageInput> {
        document.slots().unwrap().iter().map(|slot| {
            let mut png = Vec::new();
            let mut encoder = png::Encoder::new(&mut png, slot.width, slot.height);
            encoder.set_color(png::ColorType::Rgba);
            encoder.set_depth(png::BitDepth::Eight);
            encoder.write_header().unwrap()
                .write_image_data(&vec![160; (slot.width * slot.height * 4) as usize]).unwrap();
            ImageInput {
                name: slot.name.into(),
                svg: format!(r##"<svg xmlns="http://www.w3.org/2000/svg" width="{}" height="{}" viewBox="{}" aria-label="{}"><rect width="16" height="16" fill="#FF405F"/></svg>"##,
                    slot.width, slot.height, slot.view_box, slot.label),
                png_bytes: png,
            }
        }).collect()
    }

    fn root() -> std::path::PathBuf {
        let root = std::env::temp_dir().join(next_id("forgekit-images-test"));
        fs::create_dir_all(root.join("workspace")).unwrap();
        fs::create_dir(root.join("backups")).unwrap();
        fs::create_dir(root.join("recovered")).unwrap();
        root
    }

    #[test]
    fn drafts_library_and_task_receipts_survive_restart_and_backup() {
        use crate::creator_workspace::CreatorDraft;
        let root = root();
        let workspace = root.join("workspace");
        let database = root.join("forgekit.sqlite");
        let store = Storage::open(&database).unwrap();
        let mut saved = Vec::new();
        for document in documents() {
            let kind = document.kind.as_str();
            let job = store
                .create_work_task(kind, "save", &document.spec)
                .unwrap();
            assert!(store
                .update_work_task(&job.id, "succeeded", "complete", None, None)
                .is_err());
            store
                .update_work_task(&job.id, "running", "saving", None, None)
                .unwrap();
            let version = store
                .save_image_version_for_task(
                    &workspace,
                    document.clone(),
                    inputs(&document),
                    Some(&job.id),
                )
                .unwrap();
            let task = store.get_work_task(&job.id).unwrap();
            assert_eq!(task.status, "succeeded");
            assert_eq!(task.receipt.unwrap()["versionId"], version.id);
            assert_eq!(
                task.events
                    .iter()
                    .map(|event| event.sequence)
                    .collect::<Vec<_>>(),
                vec![1, 2, 3]
            );
            assert!(store
                .update_work_task(&job.id, "failed", "stopped", None, None)
                .is_err());
            let mut unfinished = document.spec.clone();
            unfinished["name"] = json!("");
            let draft = store
                .save_creator_draft(&CreatorDraft {
                    kind: kind.into(),
                    spec: unfinished.clone(),
                    baseline_version_id: Some(version.id.clone()),
                    engine_version: 1,
                    revision: 0,
                    updated_at: String::new(),
                })
                .unwrap();
            assert_eq!(draft.revision, 1);
            assert!(store
                .save_creator_draft(&CreatorDraft {
                    revision: 0,
                    ..draft
                })
                .is_err());
            store.set_library_deleted(kind, &version.id, true).unwrap();
            assert_eq!(store.list_library("", kind, false, 0).unwrap().len(), 0);
            assert_eq!(store.list_library("", kind, true, 0).unwrap().len(), 1);
            store.set_library_deleted(kind, &version.id, false).unwrap();
            saved.push((kind.to_owned(), version.id, unfinished));
        }
        assert_eq!(
            store
                .list_library("Fixture", "all", false, 0)
                .unwrap()
                .len(),
            3
        );
        assert!(store
            .list_library("'; DROP TABLE image_version; --", "all", false, 0)
            .unwrap()
            .is_empty());
        let interrupted = store
            .create_work_task("icon", "export", &documents()[0].spec)
            .unwrap();
        store
            .update_work_task(
                &interrupted.id,
                "running",
                "exporting",
                Some(json!({"versionId": saved[0].1})),
                None,
            )
            .unwrap();
        let pending = store
            .create_work_task("texture", "render", &documents()[1].spec)
            .unwrap();
        store
            .update_work_task(&pending.id, "cancel_requested", "stopped", None, None)
            .unwrap();
        let backup = store
            .create_backup(&workspace, &root.join("backups"))
            .unwrap();
        crate::backup::verify(&root.join("backups"), &backup.id).unwrap();
        let recovered =
            crate::backup::restore_copy(&root.join("backups"), &backup.id, &root.join("recovered"))
                .unwrap();
        drop(store);
        for path in [
            database,
            std::path::PathBuf::from(recovered).join("forgekit.sqlite"),
        ] {
            let store = Storage::open(&path).unwrap();
            for (kind, id, spec) in &saved {
                let draft = store.load_creator_draft(kind).unwrap().unwrap();
                assert_eq!(&draft.spec, spec);
                assert_eq!(draft.baseline_version_id.as_deref(), Some(id.as_str()));
            }
            let task = store.get_work_task(&interrupted.id).unwrap();
            assert_eq!(task.status, "interrupted");
            assert!(task.receipt.is_some());
            assert_eq!(
                store.get_work_task(&pending.id).unwrap().status,
                "interrupted"
            );
            assert_eq!(store.list_library("", "all", false, 0).unwrap().len(), 3);
        }
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn cancellation_and_mismatched_inputs_cannot_commit_image_versions() {
        let root = root();
        let store = Storage::open(root.join("forgekit.sqlite")).unwrap();
        let document = documents().remove(0);
        let job = store
            .create_work_task("icon", "save", &document.spec)
            .unwrap();
        store
            .update_work_task(&job.id, "running", "saving", None, None)
            .unwrap();
        let queued = store
            .create_work_task("icon", "render", &document.spec)
            .unwrap();
        assert!(store
            .update_work_task(&queued.id, "running", "rendering", None, None)
            .is_err());
        store
            .update_work_task(&queued.id, "failed", "stopped", None, None)
            .unwrap();
        store
            .update_work_task(&job.id, "cancel_requested", "stopped", None, None)
            .unwrap();
        assert!(store
            .save_image_version_for_task(
                &root.join("workspace"),
                document.clone(),
                inputs(&document),
                Some(&job.id)
            )
            .is_err());
        assert!(store
            .list_image_versions(ImageKind::Icon)
            .unwrap()
            .is_empty());
        assert!(store
            .orphan_artifacts(&root.join("workspace"))
            .unwrap()
            .is_empty());
        store
            .update_work_task(&job.id, "cancelled", "stopped", None, None)
            .unwrap();
        let different = store
            .create_work_task("icon", "save", &document.spec)
            .unwrap();
        store
            .update_work_task(&different.id, "running", "saving", None, None)
            .unwrap();
        let mut changed = document.clone();
        changed.spec["name"] = json!("Other name");
        assert!(store
            .save_image_version_for_task(
                &root.join("workspace"),
                changed.clone(),
                inputs(&changed),
                Some(&different.id)
            )
            .is_err());
        assert!(store
            .list_image_versions(ImageKind::Icon)
            .unwrap()
            .is_empty());
        assert!(store
            .orphan_artifacts(&root.join("workspace"))
            .unwrap()
            .is_empty());
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn image_restart_exports_backup_restore_and_integrity() {
        let root = root();
        let workspace = root.join("workspace");
        let database = root.join("forgekit.sqlite");
        let store = Storage::open(&database).unwrap();
        let mut versions = Vec::new();
        for document in documents() {
            assert!(store.list_image_versions(document.kind).unwrap().is_empty());
            let version = store
                .save_image_version(&workspace, document.clone(), inputs(&document))
                .unwrap();
            assert_eq!(version.sequence, 1);
            assert_eq!(version.artifacts.len(), document.slots().unwrap().len() * 2);
            versions.push(version);
        }
        assert!(store.orphan_artifacts(&workspace).unwrap().is_empty());
        write_artifact(
            &workspace,
            "images/interrupted/.file-forgekit-staging",
            b"partial",
        )
        .unwrap();
        assert_eq!(
            store.orphan_artifacts(&workspace).unwrap(),
            vec!["images/interrupted/.file-forgekit-staging"]
        );
        drop(store);
        let store = Storage::open(&database).unwrap();
        for version in &versions {
            assert_eq!(
                store.list_image_versions(version.document.kind).unwrap()[0].id,
                version.id
            );
            assert_eq!(
                store
                    .load_image_version(&workspace, &version.id)
                    .unwrap()
                    .svgs
                    .len(),
                version.artifacts.len() / 2
            );
            for artifact in &version.artifacts {
                let exported = store
                    .export_image_artifact(
                        &workspace,
                        &version.id,
                        &artifact.name,
                        &artifact.format,
                    )
                    .unwrap();
                assert_eq!(exported.sha256, artifact.file.sha256);
                assert_eq!(
                    fs::read(workspace.join(exported.relative_path)).unwrap(),
                    fs::read(workspace.join(&artifact.file.relative_path)).unwrap()
                );
            }
        }
        let backup = store
            .create_backup(&workspace, &root.join("backups"))
            .unwrap();
        assert_eq!(backup.artifact_count, 14);
        crate::backup::verify(&root.join("backups"), &backup.id).unwrap();
        let recovered =
            crate::backup::restore_copy(&root.join("backups"), &backup.id, &root.join("recovered"))
                .unwrap();
        let recovered = Path::new(&recovered);
        let restored = Storage::open(recovered.join("forgekit.sqlite")).unwrap();
        for version in &versions {
            restored
                .load_image_version(&recovered.join("workspace"), &version.id)
                .unwrap();
        }
        let first = &versions[0];
        assert!(store
            .export_image_artifact(&workspace, &first.id, "../secret", "svg")
            .is_err());
        fs::write(
            workspace.join(&first.artifacts[0].file.relative_path),
            b"corrupt",
        )
        .unwrap();
        assert!(store.load_image_version(&workspace, &first.id).is_err());
        assert!(store
            .export_image_artifact(&workspace, &first.id, "icon", "png")
            .is_err());
        drop(restored);
        drop(store);
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn image_boundary_rejects_invalid_specs_svg_png_and_missing_maps() {
        let root = root();
        let workspace = root.join("workspace");
        let store = Storage::open(":memory:").unwrap();
        for mut document in documents() {
            let good = inputs(&document);
            assert!(store
                .save_image_version(&workspace, document.clone(), Vec::new())
                .is_err());
            document.spec["name"] = json!("\u{0}");
            assert!(store
                .save_image_version(&workspace, document, good)
                .is_err());
        }
        let document = documents().remove(0);
        for attack in [
            "<script>alert(1)</script>",
            "<image href=\"https://example.com/secret\"/>",
            "<foreignObject/>",
            "<rect onload=\"alert(1)\"/>",
            "<rect fill=\"url(https://example.com)\"/>",
            "<rect fill=\"url(#missing)\"/>",
            "<style>*{fill:red}</style>",
            "<!DOCTYPE svg [<!ENTITY x SYSTEM \"file:///etc/passwd\">]>",
            "<rect><circle/></g>",
            "<text>&#0;</text>",
        ] {
            let mut images = inputs(&document);
            images[0].svg = images[0].svg.replace("</svg>", &format!("{attack}</svg>"));
            assert!(
                store
                    .save_image_version(&workspace, document.clone(), images)
                    .is_err(),
                "{attack}"
            );
        }
        let mut images = inputs(&document);
        images[0].png_bytes.truncate(40);
        assert!(store
            .save_image_version(&workspace, document.clone(), images)
            .is_err());
        let mut bad = document.clone();
        bad.spec["size"] = json!(1025);
        assert!(bad.slots().is_err());
        bad = document.clone();
        bad.spec["padding"] = json!(0.5);
        assert!(bad.slots().is_ok());
        assert!(store
            .list_image_versions(ImageKind::Icon)
            .unwrap()
            .is_empty());
        assert!(store.orphan_artifacts(&workspace).unwrap().is_empty());
        drop(store);
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn image_write_failure_rolls_back_and_keeps_existing_files() {
        let root = root();
        let workspace = root.join("workspace");
        let store = Storage::open(":memory:").unwrap();
        fs::write(workspace.join("images"), b"existing user file").unwrap();
        let document = documents().remove(0);
        assert!(store
            .save_image_version(&workspace, document.clone(), inputs(&document))
            .is_err());
        assert!(store
            .list_image_versions(ImageKind::Icon)
            .unwrap()
            .is_empty());
        assert_eq!(
            fs::read(workspace.join("images")).unwrap(),
            b"existing user file"
        );
        drop(store);
        fs::remove_dir_all(root).unwrap();
    }
}
