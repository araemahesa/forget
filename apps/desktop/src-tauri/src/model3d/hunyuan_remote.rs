//! Authenticated image-to-3D worker client. Existing provider/Blender pipeline stays separate.
use base64::{engine::general_purpose::STANDARD, Engine};
use reqwest::blocking::{Client, Response};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::{
    fs,
    io::{Read, Write},
    path::{Path, PathBuf},
    process::Command,
    time::{Duration, SystemTime, UNIX_EPOCH},
};
use url::Url;

const MODEL: &str = "tencent/Hunyuan3D-2";
const MAX_IMAGE: usize = 2 * 1024 * 1024;
const MAX_GLB: usize = 64 * 1024 * 1024;
const DEFAULT_ENDPOINT: &str = "http://127.0.0.1:8765";
const BLENDER_IMPORT: &str = r#"
import bpy, sys
for obj in list(bpy.data.objects):
    bpy.data.objects.remove(obj, do_unlink=True)
bpy.ops.import_scene.gltf(filepath=sys.argv[sys.argv.index('--') + 1])
meshes = [obj for obj in bpy.context.scene.objects if obj.type == 'MESH']
if not meshes:
    raise RuntimeError('GLB has no mesh objects')
bpy.ops.object.select_all(action='DESELECT')
for obj in meshes:
    obj.select_set(True)
bpy.context.view_layer.objects.active = meshes[0]
for window in bpy.context.window_manager.windows:
    for area in window.screen.areas:
        if area.type == 'VIEW_3D':
            area.spaces.active.shading.type = 'MATERIAL'
            region = next((r for r in area.regions if r.type == 'WINDOW'), None)
            if region is not None:
                with bpy.context.temp_override(window=window, area=area, region=region):
                    bpy.ops.view3d.view_selected(use_all_regions=False)
"#;

#[derive(Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
struct Config {
    endpoint: String,
    token: String,
}

fn endpoint(value: &str) -> Result<String, String> {
    let url = Url::parse(value.trim()).map_err(|_| "URL worker tidak sah.")?;
    let loopback = matches!(
        url.host_str(),
        Some("127.0.0.1" | "localhost" | "[::1]" | "::1")
    );
    if !(url.scheme() == "https" || (url.scheme() == "http" && loopback))
        || url.host_str().is_none()
        || !url.username().is_empty()
        || url.password().is_some()
        || url.query().is_some()
        || url.fragment().is_some()
        || url.path() != "/"
    {
        return Err("Gunakan origin HTTPS atau HTTP loopback melalui SSH tunnel, tanpa path, akun, query, atau fragmen.".into());
    }
    Ok(url.as_str().trim_end_matches('/').to_owned())
}
fn valid_token(value: &str) -> bool {
    (32..=256).contains(&value.len())
        && value
            .bytes()
            .all(|b| b.is_ascii_alphanumeric() || b == b'-' || b == b'_')
}
fn config_dir(data: &Path) -> Result<PathBuf, String> {
    let path = data.join("hunyuan-remote");
    if let Ok(meta) = fs::symlink_metadata(&path) {
        if meta.file_type().is_symlink() || !meta.is_dir() {
            return Err("Direktori worker tidak aman.".into());
        }
    } else {
        fs::create_dir(&path).map_err(|_| "Direktori worker tidak dapat dibuat.")?;
    }
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        fs::set_permissions(&path, fs::Permissions::from_mode(0o700))
            .map_err(|_| "Izin konfigurasi worker gagal diatur.")?;
    }
    Ok(path)
}
fn read_config(data: &Path) -> Result<Option<Config>, String> {
    let path = config_dir(data)?.join("config.json");
    let meta = match fs::symlink_metadata(&path) {
        Ok(value) => value,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(None),
        Err(_) => return Err("Konfigurasi worker tidak dapat dibaca.".into()),
    };
    if meta.file_type().is_symlink() || !meta.is_file() || meta.len() > 8192 {
        return Err("Konfigurasi worker tidak aman.".into());
    }
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        if meta.permissions().mode() & 0o077 != 0 {
            return Err("Izin token worker harus privat (0600).".into());
        }
    }
    let config: Config =
        serde_json::from_slice(&fs::read(path).map_err(|_| "Konfigurasi worker gagal dibaca.")?)
            .map_err(|_| "Konfigurasi worker rusak.")?;
    endpoint(&config.endpoint)?;
    if !config.token.is_empty() && !valid_token(&config.token) {
        return Err("Token worker tidak sah.".into());
    }
    Ok(Some(config))
}
fn public_config(config: Option<&Config>) -> Value {
    json!({"endpoint":config.map_or(DEFAULT_ENDPOINT, |c| c.endpoint.as_str()),"hasToken":config.is_some_and(|c|!c.token.is_empty()),"configured":config.is_some_and(|c|!c.token.is_empty())})
}
pub fn load_config(data: &Path) -> Result<Value, String> {
    Ok(public_config(read_config(data)?.as_ref()))
}
pub fn save_config(data: &Path, address: &str, token: Option<&str>) -> Result<Value, String> {
    let address = endpoint(address)?;
    let old = read_config(data)?;
    if token.is_none()
        && old
            .as_ref()
            .is_some_and(|c| c.endpoint != address && !c.token.is_empty())
    {
        return Err("Endpoint berubah; masukkan token tujuan baru agar token lama tidak terkirim ke server lain.".into());
    }
    let config = Config {
        endpoint: address,
        token: token
            .map(str::to_owned)
            .unwrap_or_else(|| old.map_or_else(String::new, |c| c.token)),
    };
    if !config.token.is_empty() && !valid_token(&config.token) {
        return Err(
            "Token harus 32–256 karakter huruf, angka, tanda hubung, atau garis bawah.".into(),
        );
    }
    let dir = config_dir(data)?;
    let stamp = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_err(|_| "Waktu sistem tidak sah.")?
        .as_nanos();
    let temp = dir.join(format!(".config-{}-{stamp}.tmp", std::process::id()));
    let mut options = fs::OpenOptions::new();
    options.create_new(true).write(true);
    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt;
        options.mode(0o600);
    }
    let result = (|| {
        let mut file = options
            .open(&temp)
            .map_err(|_| "Konfigurasi worker gagal dibuat.")?;
        file.write_all(
            &serde_json::to_vec(&config).map_err(|_| "Konfigurasi worker gagal diserialisasi.")?,
        )
        .and_then(|_| file.sync_all())
        .map_err(|_| "Konfigurasi worker gagal disimpan.")?;
        fs::rename(&temp, dir.join("config.json"))
            .map_err(|_| "Konfigurasi worker gagal diganti.")?;
        Ok(public_config(Some(&config)))
    })();
    if result.is_err() {
        let _ = fs::remove_file(temp);
    }
    result
}
fn connection(data: &Path) -> Result<(Client, Config), String> {
    let config = read_config(data)?.ok_or("Simpan endpoint dan token worker terlebih dahulu.")?;
    if !valid_token(&config.token) {
        return Err("Token worker belum diatur.".into());
    }
    let mut builder = Client::builder()
        .connect_timeout(Duration::from_secs(10))
        .timeout(Duration::from_secs(90))
        .redirect(reqwest::redirect::Policy::none());
    if config.endpoint.starts_with("http://") {
        builder = builder.no_proxy();
    }
    Ok((
        builder.build().map_err(|_| "Klien worker gagal dibuat.")?,
        config,
    ))
}
fn body(mut response: Response, limit: usize) -> Result<Vec<u8>, String> {
    if !response.status().is_success() {
        return Err(match response.status().as_u16() {
            401 | 403 => "Token worker ditolak. Periksa token dan koneksi.",
            404 => "Job atau endpoint worker tidak ditemukan.",
            409 | 429 | 503 => "Worker sibuk atau belum siap; tunggu lalu coba lagi.",
            413 => "Gambar atau hasil melebihi batas ukuran worker.",
            _ => "Worker menolak permintaan; periksa log server.",
        }
        .into());
    }
    if response.content_length().is_some_and(|n| n > limit as u64) {
        return Err("Respons worker terlalu besar.".into());
    }
    let mut bytes = Vec::new();
    (&mut response)
        .take(limit as u64 + 1)
        .read_to_end(&mut bytes)
        .map_err(|_| "Respons worker terputus.")?;
    if bytes.len() > limit {
        return Err("Respons worker terlalu besar.".into());
    }
    Ok(bytes)
}
fn json_body(response: Response) -> Result<Value, String> {
    serde_json::from_slice(&body(response, 64 * 1024)?)
        .map_err(|_| "Respons JSON worker tidak sah.".into())
}
fn transport(_: reqwest::Error) -> String {
    "Worker tidak dapat dihubungi. Periksa status instance, SSH tunnel, dan endpoint.".into()
}
pub fn health(data: &Path) -> Result<Value, String> {
    let (client, config) = connection(data)?;
    let value = json_body(
        client
            .get(format!("{}/health", config.endpoint))
            .bearer_auth(&config.token)
            .timeout(Duration::from_secs(15))
            .send()
            .map_err(transport)?,
    )?;
    if value["model"] != MODEL {
        return Err("Worker bukan Hunyuan3D-2 yang didukung.".into());
    }
    if !value["ready"].is_boolean() || !value["cuda_available"].is_boolean() {
        return Err("Worker tidak melaporkan kesiapan CUDA dengan benar.".into());
    }
    Ok(
        json!({"model":MODEL,"ready":value["ready"],"cuda_available":value["cuda_available"],
        "gpu":value["gpu"].as_str().unwrap_or("").chars().take(128).collect::<String>(),
        "cuda_version":value["cuda_version"].as_str().unwrap_or("").chars().take(32).collect::<String>()}),
    )
}
fn job_id(id: &str) -> Result<(), String> {
    if id.len() != 32
        || !id
            .bytes()
            .all(|b| b.is_ascii_digit() || (b'a'..=b'f').contains(&b))
    {
        return Err("ID job tidak sah.".into());
    }
    Ok(())
}
fn remember_job(data: &Path, id: &str, origin: &str) -> Result<(), String> {
    job_id(id)?;
    let root = config_dir(data)?;
    let relative = format!("jobs/{id}.json");
    let bytes = json!({"id":id,"endpoint":origin}).to_string().into_bytes();
    match crate::artifacts::write_artifact(&root,&relative,&bytes) {
        Ok(_)=>Ok(()),
        Err(e) if e.kind()==std::io::ErrorKind::AlreadyExists=>{
            crate::artifacts::read_artifact(&root,&relative,&crate::artifacts::sha256_hex(&bytes),bytes.len()).map(|_|()).map_err(|_|"Job tercatat untuk worker berbeda.".into())
        },
        Err(_)=>Err("Job GPU diterima tetapi receipt lokal gagal disimpan. Jangan kirim ulang; periksa server.".into()),
    }
}
fn check_job_origin(data: &Path, id: &str, origin: &str) -> Result<(), String> {
    job_id(id)?;
    let root = config_dir(data)?;
    let expected = json!({"id":id,"endpoint":origin}).to_string().into_bytes();
    crate::artifacts::read_artifact(
        &root,
        &format!("jobs/{id}.json"),
        &crate::artifacts::sha256_hex(&expected),
        expected.len(),
    )
    .map(|_| ())
    .map_err(|_| {
        "Job bukan milik koneksi tersimpan ini. Pulihkan endpoint asal atau lepaskan job lokal."
            .into()
    })
}
fn job(value: Value, expected: Option<&str>) -> Result<Value, String> {
    let id = value["id"]
        .as_str()
        .ok_or("Worker tidak memberikan ID job.")?;
    job_id(id)?;
    if expected.is_some_and(|expected| expected != id)
        || value["model"] != MODEL
        || !matches!(
            value["status"].as_str(),
            Some("queued" | "running" | "succeeded" | "failed" | "cancelled")
        )
    {
        return Err("Kontrak job worker tidak sesuai.".into());
    }
    // Do not reflect arbitrary upstream text/URLs (or a leaked server secret) into the UI.
    let mut clean = json!({"id":id,"status":value["status"],"model":MODEL});
    if value["status"] == "failed" {
        clean["error"] =
            json!("Generasi gagal di GPU. Periksa log worker; tidak ada fallback otomatis.");
    }
    Ok(clean)
}
fn validate_image(encoded: &str) -> Result<(), String> {
    if encoded.len() > MAX_IMAGE.div_ceil(3) * 4 {
        return Err("Gambar PNG maksimal 2 MiB.".into());
    }
    let bytes = STANDARD
        .decode(encoded)
        .map_err(|_| "Base64 gambar tidak sah.")?;
    if bytes.len() > MAX_IMAGE || bytes.len() < 24 || !bytes.starts_with(b"\x89PNG\r\n\x1a\n") {
        return Err("Gunakan gambar PNG maksimal 2 MiB.".into());
    }
    let w = u32::from_be_bytes(bytes[16..20].try_into().unwrap());
    let h = u32::from_be_bytes(bytes[20..24].try_into().unwrap());
    if w < 16 || h < 16 || w > 1536 || h > 1536 {
        return Err("Resolusi PNG 16–1536 px per sisi.".into());
    }
    crate::gfx_assets::validate_png(w, h, &bytes).map_err(|_| "Isi PNG tidak sah.".into())
}
pub fn start(
    data: &Path,
    image_base64: &str,
    seed: u32,
    steps: u32,
    texture: bool,
) -> Result<Value, String> {
    start_with_context(data, image_base64, seed, steps, texture, || {
        // Image-only inference has no text input. Vault guides stay local for review/audit.
        crate::obsidian::context("", "model3d", false)
    })
}
fn start_with_context(
    data: &Path,
    image_base64: &str,
    seed: u32,
    steps: u32,
    texture: bool,
    collect_context: impl FnOnce() -> Result<String, String>,
) -> Result<Value, String> {
    validate_image(image_base64)?;
    if seed > 2_147_483_647 || !(1..=50).contains(&steps) {
        return Err("Seed atau jumlah langkah di luar batas.".into());
    }
    let (client, config) = connection(data)?;
    let context = collect_context()?; // Fail before submitting GPU work if configured guides are invalid.
    let mut result=job(json_body(client.post(format!("{}/v1/jobs",config.endpoint)).bearer_auth(&config.token).json(&json!({"image_base64":image_base64,"seed":seed,"steps":steps,"texture":texture})).send().map_err(|_|"Permintaan GPU terputus; job mungkin sudah diterima. Jangan kirim ulang sebelum memeriksa worker.".to_owned())?)?,None)?;
    let id = result["id"].as_str().unwrap();
    remember_job(data, id, &config.endpoint)?;
    if !context.is_empty() {
        match save_context(data, id, &context) {
            Ok(snapshot) => result["obsidianSnapshot"] = snapshot,
            // Keep the accepted ID recoverable; a local audit failure must not invite resubmission.
            Err(_) => result["obsidianWarning"] = json!("Job diterima; snapshot panduan lokal gagal disimpan. Jangan kirim ulang job."),
        }
    }
    Ok(result)
}
fn save_context(data: &Path, id: &str, context: &str) -> Result<Value, String> {
    job_id(id)?;
    let root = config_dir(data)?;
    let relative = format!("jobs/{id}.obsidian.json");
    let snapshot = json!({"jobId":id,"model":MODEL,"purpose":"local-review-checklist","sentToWorker":false,"context":context});
    let saved = crate::artifacts::write_artifact(&root, &relative, snapshot.to_string().as_bytes())
        .map_err(|_| "Snapshot panduan lokal gagal disimpan.")?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        fs::set_permissions(root.join(&relative), fs::Permissions::from_mode(0o600))
            .map_err(|_| "Izin snapshot panduan lokal gagal diatur.")?;
    }
    Ok(json!({"relativePath":format!("hunyuan-remote/{relative}"),"sha256":saved.sha256,"byteLength":saved.byte_length,"purpose":"local-review-checklist","sentToWorker":false}))
}
pub fn poll(data: &Path, id: &str) -> Result<Value, String> {
    job_id(id)?;
    let (client, config) = connection(data)?;
    check_job_origin(data, id, &config.endpoint)?;
    job(
        json_body(
            client
                .get(format!("{}/v1/jobs/{id}", config.endpoint))
                .bearer_auth(&config.token)
                .send()
                .map_err(transport)?,
        )?,
        Some(id),
    )
}
pub fn cancel(data: &Path, id: &str) -> Result<Value, String> {
    job_id(id)?;
    let (client, config) = connection(data)?;
    check_job_origin(data, id, &config.endpoint)?;
    job(
        json_body(
            client
                .delete(format!("{}/v1/jobs/{id}", config.endpoint))
                .bearer_auth(&config.token)
                .timeout(Duration::from_secs(5))
                .send()
                .map_err(transport)?,
        )?,
        Some(id),
    )
}
fn no_uri(value: &Value) -> bool {
    match value {
        Value::Object(map) => map.iter().all(|(k, v)| k != "uri" && no_uri(v)),
        Value::Array(items) => items.iter().all(no_uri),
        _ => true,
    }
}
pub(crate) fn validate_glb(bytes: &[u8]) -> Result<(), String> {
    let bad = || "GLB worker tidak sah atau memakai resource eksternal.".to_owned();
    if bytes.len() < 28
        || bytes.len() > MAX_GLB
        || &bytes[..4] != b"glTF"
        || u32::from_le_bytes(bytes[4..8].try_into().unwrap()) != 2
        || u32::from_le_bytes(bytes[8..12].try_into().unwrap()) as usize != bytes.len()
    {
        return Err(bad());
    }
    let mut offset = 12;
    let mut document = None;
    let mut bin_seen = false;
    while offset < bytes.len() {
        if offset + 8 > bytes.len() {
            return Err(bad());
        }
        let size = u32::from_le_bytes(bytes[offset..offset + 4].try_into().unwrap()) as usize;
        let kind = &bytes[offset + 4..offset + 8];
        offset += 8;
        if size % 4 != 0 || offset + size > bytes.len() {
            return Err(bad());
        }
        if document.is_none() {
            if kind != b"JSON" || size > 4 * 1024 * 1024 {
                return Err(bad());
            }
            let value: Value =
                serde_json::from_slice(&bytes[offset..offset + size]).map_err(|_| bad())?;
            if value["asset"]["version"] != "2.0"
                || !no_uri(&value)
                || !value["meshes"].as_array().is_some_and(|m| !m.is_empty())
            {
                return Err(bad());
            }
            document = Some(value);
        } else if kind == b"BIN\0" && !bin_seen {
            bin_seen = true;
        } else {
            return Err(bad());
        }
        offset += size;
    }
    if document.is_none() || !bin_seen {
        return Err(bad());
    }
    Ok(())
}
pub(crate) fn model_path(relative: &str) -> Result<String, String> {
    let parts: Vec<_> = relative.split('/').collect();
    if parts.len() != 3 || parts[0] != "hunyuan3d" || parts[2] != "model.glb" {
        return Err("Path model Hunyuan tidak sah.".into());
    }
    job_id(parts[1])?;
    Ok(parts[1].into())
}
pub(crate) fn manifest(workspace: &Path, id: &str) -> Result<Option<Value>, String> {
    job_id(id)?;
    let path = workspace.join(format!("hunyuan3d/{id}/manifest.json"));
    // Resolve each directory before reading; never follow a user-supplied symlink.
    let mut current = workspace.to_path_buf();
    for part in ["hunyuan3d", id, "manifest.json"] {
        current.push(part);
        match fs::symlink_metadata(&current) {
            Ok(m) if m.file_type().is_symlink() => return Err("Path model tidak aman.".into()),
            Ok(_) => {}
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => return Ok(None),
            Err(_) => return Err("Manifest model tidak dapat dibaca.".into()),
        }
    }
    let meta = fs::metadata(&path).map_err(|_| "Manifest model tidak dapat dibaca.")?;
    if !meta.is_file() || meta.len() > 8192 {
        return Err("Manifest model tidak sah.".into());
    }
    let value: Value =
        serde_json::from_slice(&fs::read(path).map_err(|_| "Manifest model tidak dapat dibaca.")?)
            .map_err(|_| "Manifest model rusak.")?;
    if value["jobId"] != id
        || value["model"] != MODEL
        || value["relativePath"] != format!("hunyuan3d/{id}/model.glb")
        || !value["byteLength"]
            .as_u64()
            .is_some_and(|n| n <= MAX_GLB as u64)
        || value["sha256"].as_str().map_or(true, |s| {
            s.len() != 64 || !s.bytes().all(|b| b.is_ascii_hexdigit())
        })
    {
        return Err("Manifest model tidak sesuai.".into());
    }
    Ok(Some(value))
}
pub(crate) fn model_bytes(workspace: &Path, relative: &str) -> Result<Vec<u8>, String> {
    let id = model_path(relative)?;
    let receipt = manifest(workspace, &id)?.ok_or("Manifest model tidak ditemukan.")?;
    let bytes = crate::artifacts::read_artifact(
        workspace,
        relative,
        receipt["sha256"].as_str().unwrap(),
        receipt["byteLength"].as_u64().unwrap() as usize,
    )
    .map_err(|_| "Integritas model lokal gagal diperiksa.")?;
    validate_glb(&bytes)?;
    Ok(bytes)
}
pub fn download(data: &Path, workspace: &Path, id: &str) -> Result<Value, String> {
    job_id(id)?;
    if let Some(receipt) = manifest(workspace, id)? {
        model_bytes(workspace, receipt["relativePath"].as_str().unwrap())?;
        return Ok(receipt);
    }
    if poll(data, id)?["status"] != "succeeded" {
        return Err("Model belum selesai; tunggu status berhasil.".into());
    }
    let (client, config) = connection(data)?;
    let bytes = body(
        client
            .get(format!("{}/v1/jobs/{id}/model.glb", config.endpoint))
            .bearer_auth(&config.token)
            .send()
            .map_err(transport)?,
        MAX_GLB,
    )?;
    validate_glb(&bytes)?;
    let relative = format!("hunyuan3d/{id}/model.glb");
    // Recover an interrupted save only if immutable model bytes match exactly.
    let expected = crate::artifacts::sha256_hex(&bytes);
    match crate::artifacts::write_artifact(workspace, &relative, &bytes) {
        Ok(_) => {}
        Err(e) if e.kind() == std::io::ErrorKind::AlreadyExists => {
            crate::artifacts::read_artifact(workspace, &relative, &expected, bytes.len())
                .map_err(|_| "Model lama berbeda; tidak ditimpa.")?;
        }
        Err(_) => return Err("GLB gagal disimpan; hasil server tetap dipertahankan.".into()),
    }
    let receipt = json!({"relativePath":relative,"sha256":expected,"byteLength":bytes.len(),"model":MODEL,"jobId":id,"createdAt":SystemTime::now().duration_since(UNIX_EPOCH).map_err(|_|"Waktu sistem tidak sah.")?.as_secs()});
    crate::artifacts::write_artifact(
        workspace,
        &format!("hunyuan3d/{id}/manifest.json"),
        receipt.to_string().as_bytes(),
    )
    .map_err(|_| "Manifest gagal disimpan; file GLB tidak dihapus.")?;
    // Local immutable copy and manifest committed before requesting remote cleanup.
    // A failed DELETE never discards the saved model; server retention TTL remains fallback.
    let _ = cancel(data, id);
    Ok(receipt)
}
pub fn load_model(workspace: &Path, relative_path: &str) -> Result<Value, String> {
    let bytes = model_bytes(workspace, relative_path)?;
    Ok(json!({"base64":STANDARD.encode(&bytes),"byteLength":bytes.len()}))
}
pub fn list_models(workspace: &Path) -> Result<Value, String> {
    let root = workspace.join("hunyuan3d");
    match fs::symlink_metadata(&root) {
        Ok(m) if m.file_type().is_symlink() || !m.is_dir() => {
            return Err("Direktori model tidak aman.".into())
        }
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => return Ok(json!([])),
        Err(_) => return Err("Direktori model tidak dapat dibaca.".into()),
        _ => {}
    }
    let mut receipts = Vec::new();
    // ponytail: show latest 100 saved models; add pagination when this library exceeds that UI ceiling.
    for entry in fs::read_dir(root).map_err(|_| "Daftar model gagal dibaca.")? {
        let entry = entry.map_err(|_| "Daftar model tidak lengkap.")?;
        let id = entry.file_name().to_string_lossy().into_owned();
        if job_id(&id).is_ok() {
            if let Some(receipt) = manifest(workspace, &id)? {
                receipts.push(receipt);
            }
        }
    }
    receipts.sort_by_key(|v| std::cmp::Reverse(v["createdAt"].as_u64().unwrap_or(0)));
    receipts.truncate(100);
    Ok(json!(receipts))
}
pub fn reveal_models(workspace: &Path, relative_path: &str) -> Result<(), String> {
    model_bytes(workspace, relative_path)?;
    let path = workspace
        .join(relative_path)
        .canonicalize()
        .map_err(|_| "Path model gagal diperiksa.")?;
    #[cfg(target_os = "macos")]
    let result = Command::new("/usr/bin/open").arg("-R").arg(path).status();
    #[cfg(target_os = "windows")]
    let result = Command::new("explorer")
        .arg(path.parent().ok_or("Folder model tidak tersedia.")?)
        .status();
    #[cfg(not(any(target_os = "macos", target_os = "windows")))]
    let result = Command::new("xdg-open")
        .arg(path.parent().ok_or("Folder model tidak tersedia.")?)
        .status();
    if !result.map_err(|_| "Folder hasil gagal dibuka.")?.success() {
        return Err("Folder hasil gagal dibuka.".into());
    }
    Ok(())
}
pub fn open_blender(workspace: &Path, relative_path: &str) -> Result<(), String> {
    model_bytes(workspace, relative_path)?;
    let executable = crate::model3d::blender::binary().ok_or("Blender belum ditemukan di Mac.")?;
    let path = workspace
        .join(relative_path)
        .canonicalize()
        .map_err(|_| "Path model gagal diperiksa.")?;
    // Arguments are not shell-interpolated; the script is fixed, not provider-generated code.
    Command::new(executable)
        .args([
            "--factory-startup",
            "--disable-autoexec",
            "--python-expr",
            BLENDER_IMPORT,
            "--",
        ])
        .arg(path)
        .spawn()
        .map_err(|_| "Blender gagal dibuka.")?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    fn root() -> PathBuf {
        let p = std::env::temp_dir().join(format!(
            "forgekit-hunyuan-{}-{}",
            std::process::id(),
            SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        fs::create_dir(&p).unwrap();
        p
    }
    fn glb() -> Vec<u8> {
        let mut text = br#"{"asset":{"version":"2.0"},"meshes":[{"primitives":[]}]}"#.to_vec();
        while text.len() % 4 != 0 {
            text.push(b' ');
        }
        let length = 12 + 8 + text.len() + 8;
        let mut bytes = b"glTF".to_vec();
        bytes.extend(2u32.to_le_bytes());
        bytes.extend((length as u32).to_le_bytes());
        bytes.extend((text.len() as u32).to_le_bytes());
        bytes.extend(b"JSON");
        bytes.extend(text);
        bytes.extend(0u32.to_le_bytes());
        bytes.extend(b"BIN\0");
        bytes
    }
    #[test]
    fn endpoints_and_tokens_are_private() {
        for url in [
            "http://example.com",
            "http://127.0.0.1.evil.test",
            "https://user:password@example.com",
            "https://example.com/api",
            "https://example.com?token=x",
            "file:///tmp/worker",
        ] {
            assert!(endpoint(url).is_err(), "{url}");
        }
        assert_eq!(
            endpoint("http://127.0.0.1:8765/").unwrap(),
            DEFAULT_ENDPOINT
        );
        let root = root();
        let token = "x".repeat(48);
        let saved = save_config(&root, DEFAULT_ENDPOINT, Some(&token)).unwrap();
        assert_eq!(saved["hasToken"], true);
        assert!(!saved.to_string().contains(&token));
        assert!(save_config(&root, "https://example.com", None).is_err());
        assert_eq!(
            save_config(&root, DEFAULT_ENDPOINT, None).unwrap()["hasToken"],
            true
        );
        assert_eq!(
            save_config(&root, DEFAULT_ENDPOINT, Some("")).unwrap()["hasToken"],
            false
        );
        fs::remove_dir_all(root).unwrap();
    }
    #[test]
    fn start_keeps_guides_local_and_retains_accepted_id_on_snapshot_failure() {
        use std::net::TcpListener;
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        let address = format!("http://{}", listener.local_addr().unwrap());
        let root = root();
        let token = "s".repeat(48);
        save_config(&root, &address, Some(&token)).unwrap();
        let mut png = Vec::new();
        {
            let mut encoder = png::Encoder::new(&mut png, 16, 16);
            encoder.set_color(png::ColorType::Rgba);
            encoder.set_depth(png::BitDepth::Eight);
            let mut writer = encoder.write_header().unwrap();
            writer.write_image_data(&vec![255; 16 * 16 * 4]).unwrap();
        }
        let image = STANDARD.encode(png);
        let rejected = start_with_context(&root, &image, 42, 20, true, || Err("Invalid guides".into()));
        assert_eq!(rejected.unwrap_err(), "Invalid guides");
        listener.set_nonblocking(true).unwrap();
        assert_eq!(listener.accept().unwrap_err().kind(), std::io::ErrorKind::WouldBlock);
        listener.set_nonblocking(false).unwrap();
        let context = "LOCAL PRIVATE GUIDE: inspect texture, topology, scale, and silhouette";
        let blocked = format!("jobs/{}.obsidian.json", "b".repeat(32));
        crate::artifacts::write_artifact(&config_dir(&root).unwrap(), &blocked, b"existing snapshot").unwrap();
        let worker_image = image.clone();
        let worker = std::thread::spawn(move || {
            for id in ["a".repeat(32), "b".repeat(32)] {
                let (mut stream, _) = listener.accept().unwrap();
                stream.set_read_timeout(Some(Duration::from_secs(5))).unwrap();
                let mut bytes = Vec::new();
                let split = loop {
                    let mut block = [0; 1024];
                    let n = stream.read(&mut block).unwrap();
                    assert!(n > 0);
                    bytes.extend_from_slice(&block[..n]);
                    if let Some(end) = bytes.windows(4).position(|v| v == b"\r\n\r\n") {
                        break end + 4;
                    }
                };
                let headers = String::from_utf8(bytes[..split].to_vec()).unwrap().to_lowercase();
                assert!(headers.starts_with("post /v1/jobs http"));
                assert!(headers.contains(&format!("authorization: bearer {token}")));
                let length: usize = headers.lines().find_map(|line| line.strip_prefix("content-length: ")).unwrap().trim().parse().unwrap();
                while bytes.len() < split + length {
                    let mut block = [0; 1024];
                    let n = stream.read(&mut block).unwrap();
                    assert!(n > 0);
                    bytes.extend_from_slice(&block[..n]);
                }
                let request: Value = serde_json::from_slice(&bytes[split..split + length]).unwrap();
                assert_eq!(request, json!({"image_base64":worker_image,"seed":42,"steps":20,"texture":true}));
                assert!(!String::from_utf8_lossy(&bytes).contains(context));
                let response = json!({"id":id,"model":MODEL,"status":"queued"}).to_string();
                write!(stream,"HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{}",response.len(),response).unwrap();
            }
        });
        let result = start_with_context(&root, &image, 42, 20, true, || Ok(context.into())).unwrap();
        let snapshot = &result["obsidianSnapshot"];
        assert_eq!(snapshot["sentToWorker"], false);
        assert!(!result.to_string().contains(context));
        let relative = snapshot["relativePath"].as_str().unwrap();
        let bytes = crate::artifacts::read_artifact(&root, relative, snapshot["sha256"].as_str().unwrap(), snapshot["byteLength"].as_u64().unwrap() as usize).unwrap();
        let packet: Value = serde_json::from_slice(&bytes).unwrap();
        assert_eq!(packet["context"], context);
        assert_eq!(packet["jobId"], result["id"]);
        assert_eq!(packet["purpose"], "local-review-checklist");
        assert_eq!(packet["sentToWorker"], false);
        assert!(!String::from_utf8_lossy(&bytes).contains(&"s".repeat(48)));
        #[cfg(unix)] {
            use std::os::unix::fs::PermissionsExt;
            assert_eq!(fs::metadata(root.join(relative)).unwrap().permissions().mode() & 0o777, 0o600);
            assert_eq!(fs::metadata(config_dir(&root).unwrap()).unwrap().permissions().mode() & 0o777, 0o700);
        }
        check_job_origin(&root, result["id"].as_str().unwrap(), &address).unwrap();
        let result = start_with_context(&root, &image, 42, 20, true, || Ok(context.into())).unwrap();
        assert_eq!(result["id"], "b".repeat(32));
        assert!(result.get("obsidianWarning").is_some());
        assert!(result.get("obsidianSnapshot").is_none());
        check_job_origin(&root, result["id"].as_str().unwrap(), &address).unwrap();
        assert_eq!(fs::read(config_dir(&root).unwrap().join(blocked)).unwrap(), b"existing snapshot");
        worker.join().unwrap();
        fs::remove_dir_all(root).unwrap();
    }
    #[test]
    fn blender_import_script_is_fixed_and_sets_material_preview() {
        assert!(BLENDER_IMPORT.contains("bpy.data.objects.remove(obj, do_unlink=True)"));
        assert!(BLENDER_IMPORT.contains("bpy.ops.import_scene.gltf(filepath=sys.argv[sys.argv.index('--') + 1])"));
        assert!(BLENDER_IMPORT.contains("shading.type = 'MATERIAL'"));
        assert!(BLENDER_IMPORT.contains("bpy.ops.view3d.view_selected(use_all_regions=False)"));
        assert!(!BLENDER_IMPORT.contains("exec("));
        assert!(!BLENDER_IMPORT.contains("eval("));
    }
    #[test]
    fn invalid_images_and_job_paths_rejected() {
        assert!(validate_image(&STANDARD.encode(b"not png")).is_err());
        assert!(validate_image(&"A".repeat(3 * 1024 * 1024)).is_err());
        for id in ["../x", "a/b", "", "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA"] {
            assert!(job_id(id).is_err());
        }
        assert!(model_path("hunyuan3d/../../secret").is_err());
        assert!(job(
            json!({"id":"a".repeat(32),"model":MODEL,"status":"fake"}),
            None
        )
        .is_err());
    }
    #[test]
    fn glb_requires_embedded_resources_and_integrity() {
        let mut bytes = glb();
        assert!(validate_glb(&bytes).is_ok());
        bytes[4] = 1;
        assert!(validate_glb(&bytes).is_err());
        assert!(!no_uri(
            &json!({"images":[{"uri":"https://example.com/x.png"}]})
        ));
        let root = root();
        let id = "a".repeat(32);
        let relative = format!("hunyuan3d/{id}/model.glb");
        let bytes = glb();
        crate::artifacts::write_artifact(&root, &relative, &bytes).unwrap();
        let receipt = json!({"jobId":id,"model":MODEL,"relativePath":relative,"sha256":crate::artifacts::sha256_hex(&bytes),"byteLength":bytes.len()});
        crate::artifacts::write_artifact(
            &root,
            &format!("hunyuan3d/{id}/manifest.json"),
            receipt.to_string().as_bytes(),
        )
        .unwrap();
        assert_eq!(
            load_model(&root, &relative).unwrap()["byteLength"],
            bytes.len()
        );
        fs::write(root.join(&relative), b"corrupt").unwrap();
        assert!(load_model(&root, &relative).is_err());
        fs::remove_dir_all(root).unwrap();
    }
    #[test]
    fn http_contract_uses_bearer_and_ignores_upstream_output_urls() {
        use std::net::TcpListener;
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        let address = format!("http://{}", listener.local_addr().unwrap());
        let root = root();
        let token = "z".repeat(48);
        save_config(&root, &address, Some(&token)).unwrap();
        remember_job(&root, &"a".repeat(32), &address).unwrap();
        remember_job(&root, &"c".repeat(32), &address).unwrap();
        let worker = std::thread::spawn(move || {
            let (mut stream, _) = listener.accept().unwrap();
            stream
                .set_read_timeout(Some(Duration::from_secs(5)))
                .unwrap();
            let mut buffer = [0; 8192];
            let n = stream.read(&mut buffer).unwrap();
            let request = String::from_utf8_lossy(&buffer[..n]).to_lowercase();
            assert!(request.contains(&format!("authorization: bearer {token}")));
            assert!(request.starts_with("get /v1/jobs/"));
            let response=json!({"id":"a".repeat(32),"model":MODEL,"status":"succeeded","output_url":"https://evil.test/secret","token":"never reflect"}).to_string();
            write!(stream,"HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{}",response.len(),response).unwrap();
        });
        let result = poll(&root, &"a".repeat(32)).unwrap();
        assert_eq!(result["status"], "succeeded");
        assert!(result.get("output_url").is_none());
        assert!(result.get("token").is_none());
        worker.join().unwrap();
        fs::remove_dir_all(root).unwrap();
    }
    #[test]
    fn completed_job_saves_validated_glb_and_survives_worker_shutdown() {
        use std::net::TcpListener;
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        let address = format!("http://{}", listener.local_addr().unwrap());
        let root = root();
        let workspace = root.join("workspace");
        fs::create_dir(&workspace).unwrap();
        let token = "k".repeat(48);
        save_config(&root, &address, Some(&token)).unwrap();
        remember_job(&root, &"a".repeat(32), &address).unwrap();
        remember_job(&root, &"c".repeat(32), &address).unwrap();
        let id = "c".repeat(32);
        let expected = glb();
        let served = expected.clone();
        let worker_id = id.clone();
        let worker = std::thread::spawn(move || {
            for phase in 0..3 {
                let (mut stream, _) = listener.accept().unwrap();
                stream
                    .set_read_timeout(Some(Duration::from_secs(5)))
                    .unwrap();
                let mut request = Vec::new();
                loop {
                    let mut block = [0; 1024];
                    let n = stream.read(&mut block).unwrap();
                    if n == 0 {
                        break;
                    }
                    request.extend_from_slice(&block[..n]);
                    if request.windows(4).any(|v| v == b"\r\n\r\n") {
                        break;
                    }
                }
                let request = String::from_utf8_lossy(&request);
                assert!(request
                    .to_lowercase()
                    .contains(&format!("authorization: bearer {token}")));
                let response = match phase {
                    0 => {
                        assert!(request.starts_with(&format!("GET /v1/jobs/{worker_id} HTTP")));
                        json!({"id":worker_id,"model":MODEL,"status":"succeeded"})
                            .to_string()
                            .into_bytes()
                    }
                    1 => {
                        assert!(request
                            .starts_with(&format!("GET /v1/jobs/{worker_id}/model.glb HTTP")));
                        served.clone()
                    }
                    _ => {
                        assert!(request.starts_with(&format!("DELETE /v1/jobs/{worker_id} HTTP")));
                        json!({"id":worker_id,"model":MODEL,"status":"cancelled"})
                            .to_string()
                            .into_bytes()
                    }
                };
                write!(
                    stream,
                    "HTTP/1.1 200 OK\r\nContent-Length: {}\r\nConnection: close\r\n\r\n",
                    response.len()
                )
                .unwrap();
                stream.write_all(&response).unwrap();
            }
        });
        let saved = download(&root, &workspace, &id).unwrap();
        worker.join().unwrap();
        assert_eq!(saved["sha256"], crate::artifacts::sha256_hex(&expected));
        assert_eq!(
            STANDARD
                .decode(
                    load_model(&workspace, saved["relativePath"].as_str().unwrap()).unwrap()
                        ["base64"]
                        .as_str()
                        .unwrap()
                )
                .unwrap(),
            expected
        );
        assert_eq!(download(&root, &workspace, &id).unwrap(), saved); // no network when immutable result already saved
        assert_eq!(
            list_models(&workspace).unwrap().as_array().unwrap().len(),
            1
        );
        fs::remove_dir_all(root).unwrap();
    }
    #[test]
    fn hunyuan_handlers_have_scoped_main_window_permissions() {
        let handlers = include_str!("../lib.rs");
        let build = include_str!("../../build.rs");
        let capability: Value = serde_json::from_str(include_str!("../../capabilities/default.json")).unwrap();
        assert_eq!(capability["windows"], json!(["main"]));
        let permissions = capability["permissions"].as_array().unwrap();
        let commands: Vec<_> = handlers.lines().filter_map(|line| {
            let command = line.trim().strip_prefix("hunyuan_")?;
            Some(format!("hunyuan_{}", command.trim_end_matches(',')))
        }).collect();
        assert_eq!(commands.len(), 12);
        for command in commands {
            assert!(build.contains(&format!("\"{command}\"")), "missing app command: {command}");
            let permission = format!("allow-{}", command.replace('_', "-"));
            assert!(permissions.contains(&json!(permission)), "missing scoped permission: {command}");
        }
    }

}
