//! Validated geometry data becomes an editable .blend, internal preview and comparison renders.
use crate::{artifacts::{read_artifact, sha256_hex, write_artifact}, references::ReferenceImage, tools::{ToolCall, ToolDefinition}};
use base64::{engine::general_purpose::STANDARD, Engine};
use serde_json::{json, Value};
use std::{collections::HashMap, fs, io::Read, path::{Path, PathBuf}, process::{Command, Stdio}, sync::{LazyLock, Mutex}, time::{Duration, Instant}};
const SCRIPT: &str = include_str!("../../scripts/blender/blender_build.py");
const INSPECTION: &str = include_str!("../../scripts/blender/blender_reference.py");
const RECONSTRUCTION: &str = include_str!("../../scripts/blender/blender_reconstruction.py");
const TEXTURE: &str = include_str!("../../scripts/blender/blender_texture.py");
const MATERIALS: &str = include_str!("../../../../../packages/contracts/src/model3d-materials.json");
const WIRE: &str = "forgekit_blender_build";
static ACTIVE_BUILDS: LazyLock<Mutex<HashMap<String, PathBuf>>> = LazyLock::new(|| Mutex::new(HashMap::new()));
struct ActiveBuild(String);
impl Drop for ActiveBuild { fn drop(&mut self) { if let Ok(mut jobs)=ACTIVE_BUILDS.lock() { jobs.remove(&self.0); } } }

// Only the trusted builder's private scratch directory is exposed; callers cannot supply a path.
pub fn build_progress(root:&Path,document:&Value,references:&[ReferenceImage],known_preview:Option<&str>)->Result<Value,String> {
    let key=folder(document,references);
    let scratch=ACTIVE_BUILDS.lock().map_err(|_|"Status Blender tidak tersedia.")?.get(&key).cloned();
    let mut result=json!({"phase":"waiting"});
    if let Some(scratch)=scratch {
        result["phase"]=json!("building");
        if known_preview==Some(&key) {return Ok(json!({"phase":"rendering","previewId":key}));}
        let path=scratch.join("preview.json");
        if fs::metadata(&path).is_ok_and(|m|m.is_file() && m.len()<=72*1024*1024) {
            // The builder writes once after evaluating all geometry. Incomplete writes are retried on the next poll.
            if let Ok(bytes)=fs::read(path) {
                if let Ok(mesh)=serde_json::from_slice::<Value>(&bytes) {
                    if mesh["schemaVersion"]==1 && mesh["meshes"].as_array().is_some_and(|v|v.len()==document["recipe"]["parts"].as_array().map_or(0,Vec::len)) {
                        result["phase"]=json!("rendering");result["previewId"]=json!(key);result["mesh"]=mesh;
                    }
                }
            }
        }
    } else if root.join(format!("{key}/manifest.json")).is_file() {
        if known_preview==Some(&key) {return Ok(json!({"phase":"ready","previewId":key}));}
        let bundle=preview(root,document,references)?;
        result=json!({"phase":"ready","previewId":key,"mesh":bundle["mesh"]});
    }
    Ok(result)
}

pub fn binary() -> Option<PathBuf> {
    let mut paths = vec![PathBuf::from("/Applications/Blender.app/Contents/MacOS/Blender")];
    if let Some(home)=std::env::var_os("HOME") { paths.push(PathBuf::from(home).join("Applications/Blender.app/Contents/MacOS/Blender")); }
    if let Some(path)=std::env::var_os("PATH") { for dir in std::env::split_paths(&path) { paths.push(dir.join(if cfg!(windows){"blender.exe"}else{"blender"})); } }
    paths.into_iter().find(|p|p.is_file())
}
pub fn status() -> Value { json!({"available":binary().is_some(),"message":if binary().is_some(){"Blender terdeteksi"}else{"Pasang Blender dari blender.org, lalu periksa ulang."}}) }
pub fn definitions() -> Vec<ToolDefinition> {
    if binary().is_none() { return vec![]; }
    vec![ToolDefinition { name:"blender.build".into(),wire_name:WIRE.into(),strict:false,
        description:"Build an editable .blend with packed task references and actual renders. Supports reconstruction: local visual-hull geometry, packed UV reference-color texture and fallback vertex colors from 2-6 consistent orthographic reference crops; not neural reconstruction, hidden concavities remain unknown. Also supports custom mesh, lathe, profiles/holes and primitives. Inspect returned renders against original references and refine mismatches. No guaranteed 100% similarity. Never pass code, paths, URLs or asset IDs.".into(),
        input_schema:json!({"type":"object","additionalProperties":false,"required":["recipe"],"properties":{"recipe":{"type":"object","description":"Model3dRecipe from model-3d skill, exportFormat=blend. Up to 128 parts/200000 triangles. reconstruction:{resolution:64|96|128,views:[{image:0,view:front|back|right|left|top|bottom,crop:[x,y,width,height],background:#RRGGBB|alpha,tolerance:0.01..0.4}]}, 2-6 unique orthographic views on at least two axes; crop top-left normalized, image index in flattened task references. Also mesh:{vertices,faces}, lathe:{points}, profile:{outline,holes,bevel}, bevel, segments, smooth, PBR. No paths or URLs."}}}) }]
}
pub fn handles(call:&ToolCall)->bool {call.name==WIRE}
pub fn input(call:&ToolCall)->Result<Value,String> {
    if !handles(call) || call.arguments.len()>256*1024 {return Err("[TOOL_NOT_DISPATCHED] Input Blender tidak sah.".into());}
    let value:Value=serde_json::from_str(&call.arguments).map_err(|_|"JSON Blender tidak sah.")?;
    if value.as_object().is_none_or(|v|v.len()!=1 || !v.contains_key("recipe")) {return Err("Blender hanya menerima recipe model.".into());}
    let document=json!({"kind":"model3d","recipe":value["recipe"]});
    crate::creative::validate_document(&document,crate::creative::MODEL_MAX_PARTS).map_err(|e|e.to_string())?;
    Ok(document)
}
fn folder(document:&Value,references:&[ReferenceImage])->String {
    format!("exports/blender/{}",sha256_hex(format!("{SCRIPT}\n{INSPECTION}\n{RECONSTRUCTION}\n{TEXTURE}\n{MATERIALS}\n{document}\n{}",serde_json::to_string(references).unwrap()).as_bytes()))
}
pub fn visual_references(references:&[ReferenceImage])->Vec<ReferenceImage> {
    references.iter().flat_map(|r|std::iter::once(&r.data_url).filter(|v|!v.is_empty()).chain(&r.frames).enumerate().map(|(i,url)|ReferenceImage{name:format!("{} · {}",r.name.chars().take(100).collect::<String>(),i+1),data_url:url.clone(),..Default::default()})).collect()
}
fn formats(document:&Value,references:&[ReferenceImage])->Vec<&'static str> {
    let count=visual_references(references).len();
    if count==0 {vec!["model.blend","preview.json"]}
    else if count==1 {vec!["model.blend","preview.json","view-front.png","view-back.png","view-right.png","view-left.png","view-top.png","view-bottom.png"]}
    else if document["recipe"]["parts"].as_array().is_some_and(|parts|parts.iter().any(|p|p["primitive"]=="reconstruction")) {vec!["model.blend","preview.json","view-front.png","view-right.png","view-top.png"]}
    else {vec!["model.blend","preview.json","view-perspective.png","view-front.png","view-right.png"]}
}
pub fn cached(root:&Path,document:&Value,references:&[ReferenceImage])->Result<Option<Value>,String> {
    let base=folder(document,references);let path=root.join(format!("{base}/manifest.json"));
    if !path.exists(){return Ok(None);}
    if fs::symlink_metadata(&path).map_err(|e|e.to_string())?.file_type().is_symlink(){return Err("Manifest Blender bukan file nyata.".into());}
    let bytes=fs::read(path).map_err(|e|e.to_string())?;
    if bytes.len()>32768 {return Err("Manifest Blender terlalu besar.".into());}
    let receipt:Value=serde_json::from_slice(&bytes).map_err(|_|"Manifest Blender rusak.")?;
    let files=receipt["files"].as_array().ok_or("Daftar file Blender hilang.")?;
    let expected=formats(document,references);
    if files.len()!=expected.len() || receipt["sourceRecipeSha256"]!=sha256_hex(document.to_string().as_bytes()) {return Err("Bundle Blender tidak cocok dengan recipe.".into());}
    for (file,name) in files.iter().zip(expected) {
        if file["relativePath"]!=format!("{base}/{name}") {return Err("Path file Blender tidak sah.".into());}
        let length=file["byteLength"].as_u64().filter(|n|*n<=72*1024*1024).ok_or("Ukuran file Blender tidak sah.")? as usize;
        read_artifact(root,file["relativePath"].as_str().unwrap(),file["sha256"].as_str().ok_or("Hash file hilang.")?,length).map_err(|e|e.to_string())?;
    }
    Ok(Some(receipt))
}
struct Scratch(PathBuf);
impl Drop for Scratch {fn drop(&mut self){let _=fs::remove_dir_all(&self.0);}}
pub fn build(root:&Path,document:&Value,references:&[ReferenceImage],cancelled:impl Fn()->bool)->Result<Value,String> {
    crate::creative::validate_document(document,crate::creative::MODEL_MAX_PARTS).map_err(|e|e.to_string())?;
    crate::references::validate(references)?;
    if document["kind"]!="model3d" {return Err("Blender hanya menerima Model 3D.".into());}
    let images=visual_references(references);
    for part in document["recipe"]["parts"].as_array().unwrap().iter().filter(|p|p["primitive"]=="reconstruction") {
        if part["reconstruction"]["views"].as_array().unwrap().iter().any(|v|v["image"].as_u64().unwrap() as usize>=images.len()) {return Err("Rekonstruksi memerlukan gambar referensi tugas yang sesuai; indeks gambar tidak ditemukan.".into());}
    }
    let executable=binary().ok_or("Blender belum ditemukan. Pasang dari blender.org.")?;
    if cancelled(){return Err("[CANCELLED] Pembuatan Blender dibatalkan.".into());}
    let base=folder(document,references);
    // Take the build lock before touching recipe.json: two identical builds racing to create it
    // would otherwise fail with "already exists" instead of the clear "already building" message.
    let folder=crate::artifacts::ensure_safe_parent(root,Some(Path::new(&base)),true).map_err(|e|e.to_string())?;
    let lock=fs::OpenOptions::new().read(true).write(true).create(true).truncate(false).open(folder.join("build.lock")).map_err(|e|e.to_string())?;
    lock.try_lock().map_err(|_|"Model yang sama sedang dibangun. Tunggu lalu periksa hasil.")?;
    let recipe_path=format!("{base}/recipe.json");let recipe_bytes=document["recipe"].to_string().into_bytes();
    if root.join(&recipe_path).exists() {read_artifact(root,&recipe_path,&sha256_hex(&recipe_bytes),recipe_bytes.len()).map_err(|e|e.to_string())?;}
    else {write_artifact(root,&recipe_path,&recipe_bytes).map_err(|e|e.to_string())?;}
    if let Some(receipt)=cached(root,document,references)? {return Ok(receipt);}
    let scratch=Scratch(std::env::temp_dir().join(crate::storage::next_id("forgekit-blender")));
    fs::create_dir(&scratch.0).map_err(|e|e.to_string())?;
    #[cfg(unix)] {use std::os::unix::fs::PermissionsExt; fs::set_permissions(&scratch.0,fs::Permissions::from_mode(0o700)).map_err(|e|e.to_string())?;}
    for (name,body) in [("build.py",SCRIPT),("blender_reference.py",INSPECTION),("blender_reconstruction.py",RECONSTRUCTION),("blender_texture.py",TEXTURE),("model3d-materials.json",MATERIALS)] {fs::write(scratch.0.join(name),body).map_err(|e|e.to_string())?;}
    fs::write(scratch.0.join("recipe.json"),document["recipe"].to_string()).map_err(|e|e.to_string())?;
    fs::write(scratch.0.join("references.json"),serde_json::to_vec(&visual_references(references)).unwrap()).map_err(|e|e.to_string())?;
    let log=fs::File::create(scratch.0.join("build.log")).map_err(|e|e.to_string())?;
    ACTIVE_BUILDS.lock().map_err(|_|"Status Blender tidak tersedia.")?.insert(base.clone(),scratch.0.clone());
    let _active=ActiveBuild(base.clone());
    let mut child=Command::new(executable).args(["--background","--factory-startup","--disable-autoexec","--python-exit-code","1","--python"]).arg(scratch.0.join("build.py")).arg("--").arg(scratch.0.join("recipe.json")).arg(&scratch.0).current_dir(&scratch.0).stdin(Stdio::null()).stdout(log.try_clone().map_err(|e|e.to_string())?).stderr(log).spawn().map_err(|e|format!("Blender tidak dapat dimulai: {e}"))?;
    let seconds=if document["recipe"]["parts"].as_array().unwrap().iter().any(|p|p["primitive"]=="reconstruction") {300} else {120};
    let deadline=Instant::now()+Duration::from_secs(seconds);
    let status=loop {
        match child.try_wait() {
            Ok(Some(status))=>break status,
            Ok(None) if !cancelled() && Instant::now()<deadline=>std::thread::sleep(Duration::from_millis(50)),
            _=>{let _=child.kill();let _=child.wait();return Err(if cancelled(){"[CANCELLED] Pembuatan Blender dibatalkan.".into()}else{format!("Blender melewati batas {seconds} detik atau proses gagal; tidak ada hasil final yang diterapkan.")});}
        }
    };
    if !status.success(){let mut log=String::new();let _=fs::File::open(scratch.0.join("build.log")).and_then(|f|f.take(8192).read_to_string(&mut log));return Err(format!("Blender gagal; file final belum disimpan. {log}"));}
    if cancelled(){return Err("[CANCELLED] Hasil Blender tidak diterapkan.".into());}
    let metrics:Value=serde_json::from_slice(&fs::read(scratch.0.join("metrics.json")).map_err(|e|e.to_string())?).map_err(|_|"Metrik Blender tidak sah.")?;
    if metrics["parts"].as_u64()!=document["recipe"]["parts"].as_array().map(|p|p.len() as u64) || metrics["triangles"].as_u64().is_none_or(|n|n==0 || n>200000) || metrics["blendReopened"]!=true {return Err("Metrik geometri Blender tidak sesuai recipe.".into());}
    let mut files=vec![];
    for name in formats(document,references) {
        let path=scratch.0.join(name);
        if fs::metadata(&path).map_err(|e|e.to_string())?.len()>72*1024*1024{return Err("File Blender melebihi 72 MiB.".into());}
        let bytes=fs::read(path).map_err(|e|e.to_string())?;
        let valid=if name.ends_with(".blend") {bytes.starts_with(b"BLENDER")} else if name.ends_with(".png") {crate::gfx_assets::validate_png(768,768,&bytes).is_ok()} else {serde_json::from_slice::<Value>(&bytes).is_ok_and(|v|v["schemaVersion"]==1 && v["meshes"].as_array().is_some_and(|v|v.len()==metrics["parts"].as_u64().unwrap() as usize))};
        if !valid{return Err(format!("File {name} hasil Blender tidak sah."));}
        files.push(serde_json::to_value(write_artifact(root,&format!("{base}/{name}"),&bytes).map_err(|e|e.to_string())?).map_err(|e|e.to_string())?);
    }
    let receipt=json!({"files":files,"metrics":metrics,"sourceRecipeSha256":sha256_hex(document.to_string().as_bytes()),"visualSimilarity":"unverified","studioApplied":false,"deliverable":"blend"});
    write_artifact(root,&format!("{base}/manifest.json"),receipt.to_string().as_bytes()).map_err(|e|e.to_string())?;
    Ok(receipt)
}
pub fn comparison_images(root:&Path,document:&Value,references:&[ReferenceImage])->Result<Vec<ReferenceImage>,String> {
    let Some(receipt)=cached(root,document,references)? else{return Ok(vec![])};
    receipt["files"].as_array().unwrap().iter().skip(2).map(|file| {
        let bytes=read_artifact(root,file["relativePath"].as_str().unwrap(),file["sha256"].as_str().unwrap(),file["byteLength"].as_u64().unwrap() as usize).map_err(|e|e.to_string())?;
        Ok(ReferenceImage{name:Path::new(file["relativePath"].as_str().unwrap()).file_name().unwrap().to_string_lossy().into_owned(),data_url:format!("data:image/png;base64,{}",STANDARD.encode(bytes)),..Default::default()})
    }).collect()
}
pub fn preview(root:&Path,document:&Value,references:&[ReferenceImage])->Result<Value,String>{
    let Some(receipt)=cached(root,document,references)? else{return Ok(Value::Null)};
    let file=&receipt["files"][1];
    let bytes=read_artifact(root,file["relativePath"].as_str().unwrap(),file["sha256"].as_str().unwrap(),file["byteLength"].as_u64().unwrap() as usize).map_err(|e|e.to_string())?;
    let mesh:Value=serde_json::from_slice(&bytes).map_err(|e|e.to_string())?;
    Ok(json!({"receipt":receipt,"mesh":mesh,"views":comparison_images(root,document,references)?,"references":visual_references(references)}))
}
pub fn open_model(root:&Path,document:&Value,references:&[ReferenceImage])->Result<(),String> {
    cached(root,document,references)?.ok_or("Model belum dibangun melalui Blender.")?;
    Command::new(binary().ok_or("Blender belum ditemukan.")?).arg("--disable-autoexec").arg(root.join(folder(document,references)).join("model.blend")).spawn().map_err(|e|e.to_string())?;Ok(())
}
pub fn reveal(root:&Path,document:&Value,references:&[ReferenceImage])->Result<(),String>{
    cached(root,document,references)?.ok_or("Model belum dibangun melalui Blender.")?;
    Command::new(if cfg!(target_os="macos"){ "/usr/bin/open" }else if cfg!(windows){"explorer"}else{"xdg-open"}).arg(root.join(folder(document,references))).spawn().map_err(|e|e.to_string())?;Ok(())
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn model_tool_rejects_code_paths_and_degenerate_profiles_before_dispatch(){
        let mut call=ToolCall{id:"test".into(),name:WIRE.into(),arguments:json!({"recipe":{},"python":"import os"}).to_string()};
        assert!(input(&call).is_err());
        call.arguments=json!({"recipe":{"name":"Blade","category":"prop","seed":0,"exportFormat":"glb","parts":[{"id":"blade","name":"Blade","primitive":"profile","position":[0,0,0],"size":[4,6,0.2],"rotation":[0,0,0],"color":"#c8102e","material":"Metal","profile":{"outline":[[0,0],[0.5,0],[0.5,0.5],[0,0.5]],"holes":[],"bevel":0.01}}]}}).to_string();
        assert!(input(&call).is_ok());
        let mut v:Value=serde_json::from_str(&call.arguments).unwrap();v["recipe"]["parts"][0]["profile"]["outline"]=json!([[0,0],[1,0],[0.5,0]]);call.arguments=v.to_string();assert!(input(&call).is_err());
    }
}

#[cfg(test)]
mod live_tests {
    use super::*;
    #[test]
    #[ignore = "Actual Blender rendering and live preview polling, isolated workspace; no provider or Studio"]
    fn installed_blender_publishes_actual_preview_before_rendering_finishes() {
        let root=std::env::temp_dir().join(crate::storage::next_id("blender-progress"));fs::create_dir(&root).unwrap();
        let document=json!({"kind":"model3d","recipe":{"name":"Live preview fixture","category":"prop","seed":0,"exportFormat":"blend","parts":[{"id":"body","name":"Body","primitive":"sphere","position":[0,0,0],"size":[2,3,2],"rotation":[0,0,0],"color":"#aa2233","material":"Metal"}]}});
        let mut png=vec![];{let mut encoder=png::Encoder::new(&mut png,32,32);encoder.set_color(png::ColorType::Rgb);encoder.set_depth(png::BitDepth::Eight);encoder.write_header().unwrap().write_image_data(&[120,20,30].repeat(32*32)).unwrap();}
        let references=vec![ReferenceImage{name:"fixture.png".into(),data_url:format!("data:image/png;base64,{}",STANDARD.encode(png)),..Default::default()}];
        assert_eq!(build_progress(&root,&document,&references,None).unwrap()["phase"],"waiting");
        let mut observed=None;
        std::thread::scope(|scope| {
            let job=scope.spawn(||build(&root,&document,&references,||false));
            while !job.is_finished() {
                let progress=build_progress(&root,&document,&references,observed.as_deref()).unwrap();
                if progress["mesh"].is_object() {
                    assert_eq!(progress["mesh"]["meshes"][0]["id"],"body");
                    assert!(!job.is_finished(),"Preview must be available while Blender is still working");
                    observed=Some(progress["previewId"].as_str().unwrap().to_string());
                } else if observed.is_some() { assert!(progress.get("mesh").is_none()); }
                std::thread::sleep(Duration::from_millis(20));
            }
            job.join().unwrap().unwrap();
        });
        assert!(observed.is_some(),"Actual geometry was not available during rendering");
        let completed=build_progress(&root,&document,&references,observed.as_deref()).unwrap();
        assert_eq!(completed["phase"],"ready");assert!(completed.get("mesh").is_none());
        assert!(!ACTIVE_BUILDS.lock().unwrap().contains_key(&folder(&document,&references)));
        let other=json!({"kind":"model3d","recipe":{"name":"Other job","category":"prop","seed":0,"exportFormat":"blend","parts":document["recipe"]["parts"]}});
        assert_eq!(build_progress(&root,&other,&references,None).unwrap()["phase"],"waiting");
        fs::remove_dir_all(root).unwrap();
    }
    #[test]
    #[ignore = "Run scripts/test_blender_reconstruction.py first; actual Blender/native runner, no user database or Studio"]
    fn installed_blender_reconstructs_reference_volume_and_colors_with_cache_integrity() {
        let fixture=Path::new(env!("CARGO_MANIFEST_DIR")).join("../../../docs/test-evidence/2026-11-02/image-reconstruction/stepped-solid");
        let recipe:Value=serde_json::from_slice(&fs::read(fixture.join("recipe.json")).expect("Generate the orthographic fixture first")).unwrap();
        let references:Vec<ReferenceImage>=serde_json::from_slice(&fs::read(fixture.join("references.json")).unwrap()).unwrap();
        let document=json!({"kind":"model3d","recipe":recipe});
        let root=std::env::temp_dir().join(crate::storage::next_id("reconstruction-native"));fs::create_dir(&root).unwrap();
        assert!(build(&root,&document,&[],||false).unwrap_err().contains("indeks gambar"));
        assert!(!root.join("exports").exists());
        let receipt=build(&root,&document,&references,||false).unwrap();
        assert_eq!(receipt["metrics"]["blendReopened"],true);
        assert_eq!(receipt["metrics"]["textureImagesPacked"],1);
        assert_eq!(receipt["metrics"]["reconstructions"][0]["views"].as_array().unwrap().len(),3);
        assert_eq!(receipt["files"].as_array().unwrap().len(),5);
        assert!(receipt["files"][4]["relativePath"].as_str().unwrap().ends_with("view-top.png"));
        let bundle=preview(&root,&document,&references).unwrap();
        assert_eq!(bundle["mesh"]["meshes"][0]["colors"].as_array().unwrap().len(),bundle["mesh"]["meshes"][0]["positions"].as_array().unwrap().len());
        let textured=&bundle["mesh"]["meshes"][0];
        assert_eq!(textured["uvs"].as_array().unwrap().len(),textured["positions"].as_array().unwrap().len()/3*2);
        let texture=&textured["texture"];
        let bytes=STANDARD.decode(texture["dataUrl"].as_str().unwrap().strip_prefix("data:image/png;base64,").unwrap()).unwrap();
        crate::gfx_assets::validate_png(texture["width"].as_u64().unwrap() as u32,texture["height"].as_u64().unwrap() as u32,&bytes).unwrap();
        crate::model3d::blender_insert::plan(&document,&bundle["mesh"]).unwrap();
        assert_eq!(cached(&root,&document,&references).unwrap(),Some(receipt.clone()));
        let mesh=&receipt["files"][1];
        fs::write(root.join(mesh["relativePath"].as_str().unwrap()),b"{}").unwrap();
        assert!(cached(&root,&document,&references).is_err());
        fs::remove_dir_all(root).unwrap();
    }
    #[test]
    #[ignore = "Requires an installed Blender; generates actual files in a temporary isolated workspace"]
    fn installed_blender_builds_reopenable_files_and_checks_cached_integrity() {
        assert!(binary().is_some());
        let root=std::env::temp_dir().join(crate::storage::next_id("blender-acceptance"));fs::create_dir(&root).unwrap();
        let document=json!({"kind":"model3d","recipe":{"name":"Profile with hole","category":"prop","seed":0,"exportFormat":"glb","parts":[{"id":"blade","name":"Blade","primitive":"profile","position":[0,2,0],"size":[4,6,0.2],"rotation":[0,0,15],"color":"#c8102e","material":"Metal","profile":{"outline":[[-0.5,-0.5],[0.5,-0.5],[0.5,0.5],[-0.5,0.5]],"holes":[[[-0.15,-0.15],[-0.15,0.15],[0.15,0.15],[0.15,-0.15]]],"bevel":0.01}}]}});
        let receipt=build(&root,&document,&[],||false).unwrap();
        assert_eq!(receipt["files"].as_array().unwrap().len(),2);
        assert_eq!(receipt["metrics"]["parts"],1);
        assert_eq!(cached(&root,&document,&[]).unwrap().unwrap(),receipt);
        assert!(preview(&root,&document,&[]).unwrap()["mesh"]["meshes"].as_array().unwrap().len()>0);
        fs::write(root.join(receipt["files"][1]["relativePath"].as_str().unwrap()),b"tampered").unwrap();
        assert!(cached(&root,&document,&[]).is_err());
        fs::remove_dir_all(root).unwrap();
    }
}
