//! Local, bounded decoding of explicitly selected attachment bytes; no model-provided commands.
use base64::{engine::general_purpose::STANDARD, Engine};
use std::{fs, path::{Path, PathBuf}, process::{Command, Stdio}, time::{Duration, Instant}};
use crate::references::ReferenceImage;

const LIMIT: usize = 32 * 1024 * 1024;
fn executable(name: &str) -> Result<PathBuf, String> {
    for directory in ["/opt/homebrew/bin", "/usr/local/bin", "/usr/bin"] {
        let path = Path::new(directory).join(name);
        if path.is_file() { return Ok(path); }
    }
    Err(format!("Pemroses {name} belum tersedia. Pasang dependensi lampiran melalui Homebrew."))
}
fn run(command: &mut Command, seconds: u64) -> Result<(), String> {
    let mut child = command.stdin(Stdio::null()).stdout(Stdio::null()).stderr(Stdio::null()).spawn()
        .map_err(|_| "Pemroses lampiran gagal dijalankan.")?;
    let start = Instant::now();
    loop {
        match child.try_wait().map_err(|_| "Status pemroses tidak dapat dibaca.")? {
            Some(status) if status.success() => return Ok(()),
            Some(_) => return Err("File rusak, terkunci, codec tidak didukung, atau format tidak cocok. Pilih file lain.".into()),
            None if start.elapsed() > Duration::from_secs(seconds) => { let _ = child.kill(); let _ = child.wait(); return Err("Pemrosesan lampiran melewati batas waktu. Gunakan file lebih kecil.".into()); }
            None => std::thread::sleep(Duration::from_millis(100)),
        }
    }
}
fn bounded_read(path: &Path, max: usize) -> Result<Vec<u8>, String> {
    use std::io::Read;
    let mut bytes = Vec::new();
    fs::File::open(path).map_err(|_| "Hasil lampiran tidak tersedia.")?.take(max as u64 + 1).read_to_end(&mut bytes).map_err(|_| "Hasil lampiran tidak terbaca.")?;
    if bytes.len() > max { return Err("Hasil lampiran terlalu besar. Gunakan file lebih sederhana.".into()); }
    Ok(bytes)
}
fn text(path: &Path) -> Result<String,String> {
    let bytes = bounded_read(path, 256 * 1024)?;
    let mut value = String::from_utf8(bytes).map_err(|_| "File teks harus menggunakan UTF-8.")?;
    if value.contains('\0') { return Err("File bukan teks UTF-8 yang didukung.".into()); }
    if value.len() > 24000 { let mut end = 24000; while !value.is_char_boundary(end) { end -= 1; } value.truncate(end); value.push_str("\n[Isi dipotong pada 24.000 byte.]"); }
    Ok(value)
}
fn image(path: &Path) -> Result<String,String> {
    Ok(format!("data:image/png;base64,{}", STANDARD.encode(bounded_read(path, 450 * 1024)?)))
}
fn transcript(input: &Path, dir: &Path) -> Result<String,String> {
    let wave = dir.join("voice.wav");
    run(Command::new(executable("ffmpeg")?).args(["-nostdin","-v","error","-y","-protocol_whitelist","file,pipe","-i"]).arg(input)
        .args(["-t","120","-vn","-ar","16000","-ac","1","-c:a","pcm_s16le"]).arg(&wave), 45)?;
    let model = std::env::var_os("HOME").map(PathBuf::from).ok_or("Folder pengguna tidak tersedia.")?
        .join("Library/Application Support/dev.forgekit.studio/models/ggml-base.bin");
    if !model.is_file() { return Err("Model transkripsi lokal belum tersedia (models/ggml-base.bin).".into()); }
    let output = dir.join("transcript");
    run(Command::new(executable("whisper-cli")?).args(["-m"]).arg(model).arg("-f").arg(wave).args(["-l","auto","-otxt","-of"]).arg(&output).args(["-t","4","-ng"]), 180)?;
    let value = text(&dir.join("transcript.txt"))?;
    if value.trim().is_empty() { return Err("Tidak ada ucapan yang dapat ditranskripsi. Pilih rekaman suara yang lebih jelas.".into()); }
    Ok(format!("Transkrip otomatis, maksimal 120 detik; dapat salah mengenali ucapan:\n{value}"))
}
pub fn prepare(name: &str, encoded: &str) -> Result<ReferenceImage,String> {
    if name.is_empty() || name.len() > 256 || name.chars().any(char::is_control) || encoded.len() > (LIMIT * 4 / 3 + 4) {
        return Err("Nama atau ukuran file tidak sah. Maksimal 32 MiB per file.".into());
    }
    let extension = name.rsplit('.').next().unwrap_or("").to_ascii_lowercase();
    let kind = match extension.as_str() {
        "pdf" => "pdf", "mp4"|"mov"|"webm"|"mkv" => "video",
        "mp3"|"wav"|"m4a"|"ogg"|"flac"|"aac" => "audio",
        "glb"|"fbx"|"obj"|"stl"|"ply"|"blend" => "model3d",
        "txt"|"md"|"json"|"csv"|"lua"|"luau"|"js"|"ts"|"py"|"html"|"css"|"xml" => "text",
        _ => return Err("Format belum didukung. Gunakan gambar, PDF, video, audio, GLB/FBX/OBJ/STL/PLY/BLEND, atau teks/kode.".into()),
    };
    let bytes = STANDARD.decode(encoded).map_err(|_| "File base64 tidak sah.")?;
    if bytes.is_empty() || bytes.len() > LIMIT { return Err("File kosong atau melebihi 32 MiB.".into()); }
    if kind == "pdf" && !bytes.starts_with(b"%PDF-") { return Err("Isi file bukan PDF.".into()); }
    if extension == "glb" && !bytes.starts_with(b"glTF") { return Err("Isi file bukan GLB.".into()); }
    let dir = std::env::temp_dir().join(crate::storage::next_id("forgekit-attachment"));
    fs::create_dir(&dir).map_err(|_| "Folder pemrosesan tidak tersedia.")?;
    // A private temporary directory prevents other local users from reading selected files.
    #[cfg(unix)] { use std::os::unix::fs::PermissionsExt; fs::set_permissions(&dir,fs::Permissions::from_mode(0o700)).map_err(|_| "Izin folder gagal diatur.")?; }
    let result = (|| {
        let input = dir.join(format!("input.{extension}")); fs::write(&input, &bytes).map_err(|_| "File gagal disiapkan.")?;
        let mut attachment = ReferenceImage { name:name.into(), kind:kind.into(), size:bytes.len() as u64, ..Default::default() };
        match kind {
            "text" => { attachment.text = text(&input)?; attachment.summary = "Teks UTF-8 · maksimal 24.000 byte".into(); }
            "audio" => { attachment.text = transcript(&input, &dir)?; attachment.summary = "Transkrip lokal · 120 detik pertama".into(); }
            "pdf" => {
                let output = dir.join("document.txt");
                run(Command::new(executable("pdftotext")?).args(["-f","1","-l","12","-enc","UTF-8","-nopgbrk"]).arg(&input).arg(&output), 30)?;
                attachment.text = text(&output)?;
                run(Command::new(executable("pdftoppm")?).args(["-f","1","-l","3","-scale-to","900","-png"]).arg(&input).arg(dir.join("page")), 45)?;
                let mut pages = fs::read_dir(&dir).map_err(|_| "Halaman PDF tidak terbaca.")?.filter_map(Result::ok).map(|e| e.path()).filter(|p|p.extension().is_some_and(|e|e=="png")).collect::<Vec<_>>(); pages.sort();
                for page in pages { attachment.frames.push(image(&page)?); }
                if attachment.frames.is_empty() { return Err("PDF tidak memiliki halaman yang dapat dibaca.".into()); }
                attachment.summary = "PDF · visual 3 halaman pertama, teks maksimal 12 halaman / 24.000 byte".into();
            }
            "video" => {
                // Fixed thumbnail filters sample the first 120 seconds without loading the full video into memory.
                for (index, position) in [0, 5, 15].iter().enumerate() {
                    let output = dir.join(format!("frame-{index}.png"));
                    let result = run(Command::new(executable("ffmpeg")?).args(["-nostdin","-v","error","-y","-protocol_whitelist","file,pipe","-i"]).arg(&input)
                        .args(["-ss",&position.to_string(),"-frames:v","1","-vf","scale=900:900:force_original_aspect_ratio=decrease"]).arg(&output), 30);
                    if index==0 { result?; }
                    if output.is_file() { attachment.frames.push(image(&output)?); }
                }
                if attachment.frames.is_empty() { return Err("Video tidak memiliki frame yang dapat dibaca.".into()); }
                attachment.summary = "Cuplikan video pada 0, 5, dan 15 detik bila tersedia".into();
                attachment.text = match transcript(&input,&dir) { Ok(value)=> value, Err(error)=>format!("Audio video tidak dianalisis (tidak ada trek suara atau transkripsi gagal): {error}") };
            }
            "model3d" => {
                let blender = crate::model3d::blender::binary().ok_or("Pasang Blender untuk memproses model 3D.")?;
                let script = dir.join("inspect.py"); fs::write(&script, include_str!("../scripts/blender/attachment_model.py")).map_err(|_| "Pemroses 3D tidak tersedia.")?;
                run(Command::new(blender).args(["--background","--factory-startup","--disable-autoexec","--python-exit-code","1","--python"]).arg(script).arg("--").arg(&input).arg(&dir), 120)?;
                attachment.text = text(&dir.join("model.txt"))?;
                for index in 0..3 { attachment.frames.push(image(&dir.join(format!("view-{index}.png")))?); }
                attachment.summary = "3 tampak geometri dan ukuran · tekstur/animasi tidak dianalisis".into();
            }
            _ => unreachable!(),
        }
        crate::references::validate(std::slice::from_ref(&attachment))?;
        Ok(attachment)
    })();
    let _ = fs::remove_dir_all(&dir);
    result
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn selected_text_is_content_not_executable_and_limits_are_enforced() {
        let file = prepare("notes.luau", &STANDARD.encode(b"print('reference only')")).unwrap();
        assert_eq!(file.kind,"text"); assert!(file.text.contains("reference only"));
        assert!(prepare("bad.exe","AAAA").is_err());
        assert!(prepare("fake.pdf",&STANDARD.encode(b"not a PDF")).is_err());
        assert!(prepare("notes.txt",&STANDARD.encode(b"\0binary")).is_err());
        assert!(prepare("notes.txt","").is_err());
    }
}

#[cfg(test)]
mod local_acceptance {
    use super::*;
    #[test]
    #[ignore = "Requires installed local decoders and FORGEKIT_ATTACHMENT_FIXTURES"]
    fn extracts_real_pdf_voice_video_and_geometry_for_the_provider() {
        let fixtures = PathBuf::from(std::env::var_os("FORGEKIT_ATTACHMENT_FIXTURES").unwrap());
        for (name, kind, frames) in [("reference.pdf","pdf",1),("voice.wav","audio",0),("clip.mp4","video",1),("cube.obj","model3d",3)] {
            let attachment = prepare(name,&STANDARD.encode(fs::read(fixtures.join(name)).unwrap())).unwrap_or_else(|e|panic!("{name}: {e}"));
            assert_eq!(attachment.kind,kind);
            assert_eq!(attachment.frames.len(),frames);
            assert!(!attachment.text.is_empty());
            if kind=="audio" { assert!(attachment.text.to_lowercase().contains("forge")); }
            let mut message = serde_json::json!({"role":"user","content":"Describe the selected attachment"});
            crate::references::attach(&mut message,std::slice::from_ref(&attachment)).unwrap();
            for adapter in ["openai","anthropic","gemini"] {
                let payload = crate::references::for_adapter(std::slice::from_ref(&message), adapter);
                assert!(payload[0]["content"].as_array().unwrap().iter().any(|b| b["text"].as_str().is_some_and(|s|s.contains(&attachment.text))));
            }
            fs::write(fixtures.join(format!("{name}.prepared.json")), serde_json::to_vec(&attachment).unwrap()).unwrap();
        }
    }
}
