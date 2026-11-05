//! Fixed local analyzers only. Source is parsed in an isolated temporary directory, never executed.
use crate::tools::{ToolCall, ToolDefinition};
use serde::Deserialize;
use serde_json::{json, Value};
use std::{fs, path::PathBuf, process::{Command, Stdio}, sync::atomic::{AtomicU64, Ordering}, time::{Duration, Instant}};
static NEXT: AtomicU64 = AtomicU64::new(0);
const WIRE: &str = "forgekit_luau_check";
fn binaries() -> Option<(PathBuf, PathBuf)> {
    let root = PathBuf::from(std::env::var_os("HOME")?).join(".rokit/tool-storage");
    let format = root.join("johnnymorganz/stylua/0.20.0/stylua");
    let lint = root.join("kampfkarren/selene/0.27.1/selene");
    (format.is_file() && lint.is_file()).then_some((format, lint))
}
pub fn definitions() -> Vec<ToolDefinition> {
    if binaries().is_none() { return vec![]; }
    vec![ToolDefinition { name: "luau.check".into(), wire_name: WIRE.into(), strict: true,
        description: "Parse Luau with StyLua 0.20 and lint Roblox APIs with Selene 0.27. Source is never executed or installed. Does not prove runtime behavior or Luau types. Use before installing Script/LocalScript; fix actual diagnostics within task budget.".into(),
        input_schema: json!({"type":"object","additionalProperties":false,"required":["source"],"properties":{"source":{"type":"string","minLength":1,"maxLength":65536}}}) }]
}
pub fn handles(call: &ToolCall) -> bool { call.name == WIRE }
#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct Input { source: String }
struct Scratch(PathBuf);
impl Drop for Scratch { fn drop(&mut self) { let _ = fs::remove_dir_all(&self.0); } }
fn output(directory: &PathBuf, executable: &PathBuf, args: &[&str], prefix: &str) -> Result<Value,String> {
    let out = directory.join(format!("{prefix}.out")); let err = directory.join(format!("{prefix}.err"));
    let mut process = Command::new(executable).args(args).current_dir(directory).stdin(Stdio::null())
        .stdout(fs::File::create(&out).map_err(|e|e.to_string())?).stderr(fs::File::create(&err).map_err(|e|e.to_string())?)
        .spawn().map_err(|e|format!("[TOOL_NOT_DISPATCHED] Analyzer tidak dapat dimulai: {e}"))?;
    let deadline = Instant::now()+Duration::from_secs(5);
    let status = loop { match process.try_wait() {
        Ok(Some(status)) => break status,
        Ok(None) if Instant::now()<deadline => std::thread::sleep(Duration::from_millis(10)),
        _ => { let _=process.kill(); let _=process.wait(); return Ok(json!({"passed":false,"timedOut":true,"diagnostics":"Analyzer melebihi batas 5 detik; belum terverifikasi."})); }
    }};
    let read = |path| -> String { use std::io::Read; let mut bytes=Vec::new(); if let Ok(file)=fs::File::open(path) { let _=file.take(8192).read_to_end(&mut bytes); } String::from_utf8_lossy(&bytes).into_owned() };
    Ok(json!({"passed":status.success(),"exitCode":status.code(),"stdout":read(out),"stderr":read(err),"diagnosticLimitBytes":8192}))
}
pub fn execute(call: &ToolCall) -> Result<Value,String> {
    if !handles(call) || call.arguments.len()>400_000 { return Err("[TOOL_NOT_DISPATCHED] Input pemeriksaan Luau tidak sah.".into()); }
    let input: Input = serde_json::from_str(&call.arguments).map_err(|_|"[TOOL_NOT_DISPATCHED] Schema pemeriksaan Luau tidak sah.")?;
    if input.source.trim().is_empty() || input.source.len()>65536 { return Err("[TOOL_NOT_DISPATCHED] Source harus 1–65536 byte.".into()); }
    let (format,lint)=binaries().ok_or("[TOOL_NOT_DISPATCHED] StyLua 0.20.0 dan Selene 0.27.1 belum terpasang pada tool cache Rokit.")?;
    let scratch=Scratch(std::env::temp_dir().join(format!("forgekit-luau-{}-{}",std::process::id(),NEXT.fetch_add(1,Ordering::Relaxed))));
    fs::create_dir(&scratch.0).map_err(|e|e.to_string())?;
    #[cfg(unix)] { use std::os::unix::fs::PermissionsExt; fs::set_permissions(&scratch.0, fs::Permissions::from_mode(0o700)).map_err(|e|e.to_string())?; }
    fs::write(scratch.0.join("source.luau"),&input.source).map_err(|e|e.to_string())?;
    fs::write(scratch.0.join("selene.toml"),"std = \"roblox\"\n").map_err(|e|e.to_string())?;
    fs::write(scratch.0.join("roblox.yml"),include_str!("roblox-stdlib.yml")).map_err(|e|e.to_string())?;
    let syntax=output(&scratch.0,&format,&["--no-editorconfig","--verify","--num-threads","1","source.luau"],"syntax")?;
    let lint=if syntax["passed"]==true { output(&scratch.0,&lint,&["--config","selene.toml","--display-style","Json2","--num-threads","1","source.luau"],"lint")? } else {json!({"skipped":"Syntax belum sah."})};
    Ok(json!({"readOnly":true,"sourceHash":crate::artifacts::sha256_hex(input.source.as_bytes()),"implementationVersion":"stylua-0.20.0+selene-0.27.1","syntax":syntax,"lint":lint,"verification":"static_only","notice":"Tidak menjalankan source. Runtime, performa, tipe Luau, dan hasil visual belum diperiksa."}))
}
#[cfg(test)] mod tests {
    use super::*;
    fn call(source:&str)->ToolCall {ToolCall{id:"syntax".into(),name:WIRE.into(),arguments:json!({"source":source}).to_string()}}
    #[test] fn rejects_unbounded_or_foreign_inputs() {assert!(execute(&call("")).is_err());assert!(execute(&call(&"x".repeat(65537))).is_err()); let mut c=call("print(1)");c.name="shell".into();assert!(execute(&c).is_err());}
    #[test] fn installed_analyzers_parse_without_executing_source() {
        if binaries().is_none(){return;}
        let valid=execute(&call("local x: number = 1\nprint(x)\n")).unwrap(); assert_eq!(valid["syntax"]["passed"],true); assert_eq!(valid["lint"]["passed"],true, "{valid}");
        let invalid=execute(&call("local = !")).unwrap(); assert_eq!(invalid["syntax"]["passed"],false);
        let never=execute(&call("error('this source must never execute')")).unwrap(); assert_eq!(never["syntax"]["passed"],true);
    }
}
