//! AnimationDocument v2 validation (mirrors packages/contracts/src/animation.ts).
//!
//! Besides structure, two motion rules are hard errors so the provider's bounded repair loop
//! fixes them before anything is saved: a loop whose first and last poses differ, and a part the
//! prompt locked (prohibition requirement) that has motion in the locked window.

use crate::storage::StorageError;
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::collections::{HashMap, HashSet};

pub const R15: &[&str] = &["LowerTorso", "UpperTorso", "Head", "LeftUpperArm", "LeftLowerArm", "LeftHand", "RightUpperArm", "RightLowerArm", "RightHand", "LeftUpperLeg", "LeftLowerLeg", "LeftFoot", "RightUpperLeg", "RightLowerLeg", "RightFoot"];
pub const R6: &[&str] = &["Torso", "Head", "Left Arm", "Right Arm", "Left Leg", "Right Leg"];
const ROOT: &str = "Root";
const MAX_CLIPS: usize = 4;
const MAX_DURATION: f64 = 120.;
const MAX_TRACKS: usize = 64;
const MAX_KEYS_PER_TRACK: usize = 240;
const MAX_TOTAL_KEYS: usize = 4000;
const MAX_PARTS: usize = 32;
const MAX_REQUIREMENTS: usize = 40;
const MAX_MARKERS: usize = 32;
const SEAM_ROTATION_DEG: f64 = 1.;
const SEAM_POSITION: f64 = 0.01;
const STILL_ROTATION_DEG: f64 = 0.5;
const STILL_POSITION: f64 = 0.005;

/// Optional controls the user set next to the prompt; the prompt still drives the motion.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct AnimationControls {
    pub mode: String,
    #[serde(default)]
    pub duration_seconds: Option<f64>,
    #[serde(default)]
    pub loop_mode: Option<String>,
    #[serde(default)]
    pub quality_profile: Option<String>,
}

impl AnimationControls {
    pub fn validate(&self) -> Result<(), StorageError> {
        if !matches!(self.mode.as_str(), "character" | "object")
            || self.duration_seconds.is_some_and(|d| !d.is_finite() || d <= 0. || d > MAX_DURATION)
            || self.loop_mode.as_deref().is_some_and(|m| !matches!(m, "once" | "loop" | "pingpong"))
            || self.quality_profile.as_deref().is_some_and(|q| !matches!(q, "draft" | "production" | "high_polish"))
        {
            return Err(invalid("Kontrol animasi tidak sah."));
        }
        Ok(())
    }
}

fn invalid(message: &str) -> StorageError {
    StorageError::InvalidInput(message.into())
}
fn id(value: &Value) -> Option<&str> {
    value.as_str().filter(|s| !s.is_empty() && s.len() <= 64 && s.chars().all(|c| c.is_ascii_alphanumeric() || matches!(c, '_' | '.' | '-')))
}
fn text(value: &Value, max: usize) -> bool {
    value.as_str().is_some_and(|s| !s.trim().is_empty() && s.chars().count() <= max && !s.chars().any(|c| c.is_control() && !matches!(c, '\n' | '\t' | '\r')))
}
fn vector(value: &Value, len: usize, bound: f64) -> Option<Vec<f64>> {
    let items = value.as_array().filter(|a| a.len() == len)?;
    let numbers: Vec<f64> = items.iter().map(|v| v.as_f64()).collect::<Option<_>>()?;
    numbers.iter().all(|n| n.is_finite() && n.abs() <= bound).then_some(numbers)
}
fn unit_quat(value: &Value) -> Option<Vec<f64>> {
    let q = vector(value, 4, 2.)?;
    ((q.iter().map(|v| v * v).sum::<f64>().sqrt() - 1.).abs() <= 1e-3).then_some(q)
}
fn angle_deg(a: &[f64], b: &[f64]) -> f64 {
    let dot: f64 = a.iter().zip(b).map(|(x, y)| x * y).sum();
    2. * dot.abs().min(1.).acos().to_degrees()
}
fn distance(a: &[f64], b: &[f64]) -> f64 {
    a.iter().zip(b).map(|(x, y)| (x - y).powi(2)).sum::<f64>().sqrt()
}

pub fn validate(r: &Value, requested_mode: Option<&str>) -> Result<(), StorageError> {
    let fail = |message: &str| Err(invalid(message));
    let mode = r["animationMode"].as_str().unwrap_or("");
    if !matches!(mode, "character" | "object") {
        return fail("animationMode harus character atau object.");
    }
    if requested_mode.is_some_and(|m| m != mode) {
        return Err(StorageError::InvalidInput(format!("Mode dokumen ({mode}) berbeda dari mode yang diminta ({}).", requested_mode.unwrap())));
    }
    if !text(&r["name"], 120)
        || r["targetEngine"] != "roblox" || r["units"] != "stud" || r["coordinateSystem"] != "y-up-right-handed"
        || r["rotationConvention"] != "quaternion-xyzw-local" || r["timeUnit"] != "seconds"
        || !matches!(r["qualityProfile"].as_str(), Some("draft" | "production" | "high_polish"))
    {
        return fail("Nama, konvensi (roblox/stud/y-up/quaternion-xyzw-local/seconds) atau qualityProfile tidak sah.");
    }
    let allowed: HashSet<&str> = match r.as_object().map(|o| o.keys().map(String::as_str).collect::<Vec<_>>()) {
        Some(keys) => keys.into_iter().collect(),
        None => return fail("Dokumen animasi harus objek."),
    };
    let expected = ["schemaVersion", "name", "targetEngine", "units", "coordinateSystem", "rotationConvention", "timeUnit", "qualityProfile", "animationMode", "motionIntent", "clips", if mode == "character" { "character" } else { "object" }];
    if allowed.iter().any(|k| !expected.contains(k)) {
        return fail("Dokumen animasi memuat field di luar schema v2.");
    }

    // Targets that tracks and requirement bindings may name.
    let mut targets: HashSet<String> = HashSet::new();
    let mut in_place = false;
    if mode == "character" {
        let c = &r["character"];
        let joints = match c["rigType"].as_str() { Some("R15") => R15, Some("R6") => R6, _ => return fail("rigType harus R6 atau R15.") };
        if c["rigSource"] != "reference" || !matches!(c["rootPolicy"].as_str(), Some("in_place" | "root_motion")) || !matches!(c["priority"].as_str(), Some("Core" | "Idle" | "Movement" | "Action")) {
            return fail("Target karakter perlu rigSource reference, rootPolicy, dan priority yang sah.");
        }
        targets.extend(joints.iter().map(|j| j.to_string()));
        if c["rootPolicy"] == "root_motion" { targets.insert(ROOT.into()); } else { in_place = true; }
    } else {
        let parts = r["object"]["parts"].as_array().filter(|p| !p.is_empty() && p.len() <= MAX_PARTS).ok_or_else(|| invalid("Objek perlu 1–32 bagian."))?;
        let mut parents: HashMap<String, Option<String>> = HashMap::new();
        for p in parts {
            let pid = id(&p["id"]).ok_or_else(|| invalid("ID bagian objek tidak sah."))?;
            if !targets.insert(pid.into()) { return fail("ID bagian objek duplikat."); }
            let color_ok = p["color"].as_str().is_some_and(|c| c.len() == 7 && c.starts_with('#') && c[1..].chars().all(|h| h.is_ascii_hexdigit()));
            let size_ok = vector(&p["size"], 3, 512.).is_some_and(|s| s.iter().all(|v| *v > 0.));
            if !text(&p["name"], 80) || !matches!(p["shape"].as_str(), Some("block" | "cylinder" | "sphere" | "wedge")) || !color_ok || !size_ok
                || vector(&p["pivot"], 3, 2048.).is_none() || vector(&p["offset"], 3, 2048.).is_none() || unit_quat(&p["restRotation"]).is_none()
            {
                return fail("Bagian objek perlu nama, bentuk, warna #RRGGBB, ukuran positif, pivot, offset, dan restRotation quaternion satuan.");
            }
            parents.insert(pid.into(), if p["parentId"].is_null() { None } else { Some(id(&p["parentId"]).ok_or_else(|| invalid("parentId tidak sah."))?.into()) });
        }
        for (part, parent) in &parents {
            let (mut cursor, mut steps) = (parent.clone(), 0);
            while let Some(current) = cursor {
                if !parents.contains_key(&current) { return fail("Parent bagian objek tidak ditemukan."); }
                steps += 1;
                if steps > parents.len() { return Err(StorageError::InvalidInput(format!("Hierarki bagian {part} membentuk siklus."))); }
                cursor = parents[&current].clone();
            }
        }
    }

    // Clips.
    let clips = r["clips"].as_array().filter(|c| !c.is_empty() && c.len() <= MAX_CLIPS).ok_or_else(|| invalid("Perlu 1–4 clip."))?;
    let mut clip_durations: HashMap<String, f64> = HashMap::new();
    let mut total_keys = 0;
    for clip in clips {
        let cid = id(&clip["id"]).ok_or_else(|| invalid("ID clip tidak sah."))?;
        let duration = clip["durationSeconds"].as_f64().filter(|d| d.is_finite() && *d > 0. && *d <= MAX_DURATION).ok_or_else(|| invalid("Durasi clip harus 0–120 detik."))?;
        if !text(&clip["name"], 120) || !matches!(clip["loopMode"].as_str(), Some("once" | "loop" | "pingpong")) || clip_durations.insert(cid.into(), duration).is_some() {
            return fail("Nama, loopMode, atau ID clip tidak sah/duplikat.");
        }
        let tracks = clip["tracks"].as_array().filter(|t| !t.is_empty() && t.len() <= MAX_TRACKS).ok_or_else(|| invalid("Clip perlu 1–64 track."))?;
        let mut seen = HashSet::new();
        for track in tracks {
            let target = track["targetId"].as_str().unwrap_or("");
            let property = track["property"].as_str().unwrap_or("");
            if !targets.contains(target) { return Err(StorageError::InvalidInput(format!("Target \"{target}\" tidak ada pada rig/objek."))); }
            if !matches!(property, "rotation" | "position") || !matches!(track["interpolation"].as_str(), Some("linear" | "smooth" | "step")) { return fail("Properti atau interpolasi track tidak sah."); }
            if !seen.insert((target.to_string(), property.to_string())) { return fail("Satu target hanya boleh punya satu track per properti."); }
            if mode == "character" && property == "position" && target != ROOT { return fail("Karakter hanya boleh punya track posisi pada Root (root motion)."); }
            if target == ROOT && property != "position" { return fail("Root hanya menerima track posisi."); }
            if in_place && target == ROOT { return fail("Mode in_place tidak boleh menggerakkan Root."); }
            let keys = track["keys"].as_array().filter(|k| !k.is_empty() && k.len() <= MAX_KEYS_PER_TRACK).ok_or_else(|| invalid("Track perlu 1–240 key."))?;
            total_keys += keys.len();
            let mut previous: Option<(f64, Vec<f64>)> = None;
            for key in keys {
                let t = key["timeSeconds"].as_f64().filter(|t| t.is_finite() && *t >= 0. && *t <= duration + 1e-9).ok_or_else(|| invalid("Waktu key di luar durasi clip."))?;
                let value = if property == "rotation" { unit_quat(&key["value"]).ok_or_else(|| invalid("Rotasi harus quaternion satuan [x,y,z,w]."))? } else { vector(&key["value"], 3, 2048.).ok_or_else(|| invalid("Posisi harus [x,y,z] dalam stud."))? };
                if let Some((pt, pv)) = &previous {
                    if t <= *pt { return fail("Waktu key harus naik ketat."); }
                    if property == "rotation" && angle_deg(pv, &value) >= 179.5 { return fail("Putaran ≥180° antar dua key ambigu; tambahkan key perantara untuk putaran penuh."); }
                }
                previous = Some((t, value));
            }
            // A loop must end where it starts; held values make the first/last keys the seam poses.
            if clip["loopMode"] == "loop" {
                let first = if property == "rotation" { unit_quat(&keys[0]["value"]) } else { vector(&keys[0]["value"], 3, 2048.) }.unwrap();
                let last = previous.map(|(_, v)| v).unwrap();
                let gap = if property == "rotation" { angle_deg(&first, &last) } else { distance(&first, &last) };
                if gap > if property == "rotation" { SEAM_ROTATION_DEG } else { SEAM_POSITION } {
                    return Err(StorageError::InvalidInput(format!("Loop \"{cid}\": pose awal dan akhir {target} berbeda {gap:.2}; samakan agar loop tidak meloncat.")));
                }
            }
        }
        let markers = clip["markers"].as_array().filter(|m| m.len() <= MAX_MARKERS).ok_or_else(|| invalid("Marker clip tidak sah."))?;
        let mut marker_ids = HashSet::new();
        for m in markers {
            let event_ok = m["eventType"].as_str().is_some_and(|e| !e.is_empty() && e.len() <= 40 && e.starts_with(|c: char| c.is_ascii_lowercase()) && e.chars().all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || c == '_'));
            let time_ok = m["timeSeconds"].as_f64().is_some_and(|t| t.is_finite() && t >= 0. && t <= duration);
            if !event_ok || !time_ok || !id(&m["id"]).is_some_and(|i| marker_ids.insert(i.to_string())) { return fail("Marker perlu id unik, waktu dalam durasi, dan eventType snake_case."); }
        }
    }
    if total_keys > MAX_TOTAL_KEYS { return fail("Total key melampaui 4000."); }

    // Motion intent: every requirement traces back to the prompt and to concrete targets.
    let intent = &r["motionIntent"];
    if !text(&intent["originalPrompt"], 4000) || !intent["assumptions"].as_array().is_some_and(|a| a.len() <= 20 && a.iter().all(|v| text(v, 300))) {
        return fail("motionIntent perlu originalPrompt dan daftar asumsi.");
    }
    let requirements = intent["requirements"].as_array().filter(|r| !r.is_empty() && r.len() <= MAX_REQUIREMENTS).ok_or_else(|| invalid("Perlu 1–40 kebutuhan dari prompt."))?;
    let mut requirement_ids = HashSet::new();
    for req in requirements {
        let rid = id(&req["id"]).filter(|i| requirement_ids.insert(i.to_string())).ok_or_else(|| invalid("ID kebutuhan tidak sah atau duplikat."))?;
        let kind = req["kind"].as_str().unwrap_or("");
        if !matches!(kind, "action" | "sequence" | "timing" | "direction" | "style" | "contact" | "prohibition" | "other") || !text(&req["text"], 300) || !text(&req["excerpt"], 400) {
            return fail("Jenis, teks, atau kutipan prompt kebutuhan tidak sah.");
        }
        let binding = &req["binding"];
        if binding.is_null() {
            if kind == "prohibition" { return fail("Larangan harus menyebut target yang wajib diam."); }
            continue;
        }
        let clip_id = binding["clipId"].as_str().unwrap_or("");
        let duration = *clip_durations.get(clip_id).ok_or_else(|| invalid("Clip binding kebutuhan tidak ditemukan."))?;
        let ids: Vec<&str> = binding["targetIds"].as_array().map(|a| a.iter().filter_map(Value::as_str).collect()).unwrap_or_default();
        if ids.is_empty() || ids.iter().any(|t| !targets.contains(*t)) { return fail("Target binding kebutuhan tidak ada pada rig/objek."); }
        let window = vector(&binding["window"], 2, MAX_DURATION).filter(|w| w[0] >= 0. && w[1] <= duration + 1e-9 && w[0] < w[1]).ok_or_else(|| invalid("Jendela waktu kebutuhan harus [mulai, selesai] di dalam clip."))?;
        if kind == "prohibition" {
            let clip = clips.iter().find(|c| c["id"] == clip_id).unwrap();
            for track in clip["tracks"].as_array().unwrap().iter().filter(|t| ids.contains(&t["targetId"].as_str().unwrap_or(""))) {
                let rotation = track["property"] == "rotation";
                let values: Vec<Vec<f64>> = track["keys"].as_array().unwrap().iter()
                    .filter(|k| k["timeSeconds"].as_f64().is_some_and(|t| t >= window[0] - 1e-9 && t <= window[1] + 1e-9))
                    .filter_map(|k| if rotation { unit_quat(&k["value"]) } else { vector(&k["value"], 3, 2048.) }).collect();
                let rest = if rotation { vec![0., 0., 0., 1.] } else { vec![0., 0., 0.] };
                let moved = values.iter().any(|v| if rotation { angle_deg(v, &rest) > STILL_ROTATION_DEG } else { distance(v, &rest) > STILL_POSITION });
                if moved {
                    return Err(StorageError::InvalidInput(format!("Kebutuhan \"{rid}\" melarang {} bergerak, tetapi track-nya berubah dari pose diam. Hapus atau netralkan track itu.", track["targetId"].as_str().unwrap_or(""))));
                }
            }
        }
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn door() -> Value {
        json!({
            "schemaVersion": 2, "name": "Pintu", "targetEngine": "roblox", "units": "stud", "coordinateSystem": "y-up-right-handed",
            "rotationConvention": "quaternion-xyzw-local", "timeUnit": "seconds", "qualityProfile": "high_polish", "animationMode": "object",
            "object": {"parts": [
                {"id": "frame", "name": "Kusen", "parentId": null, "shape": "block", "size": [0.5, 8, 0.5], "color": "#553311", "pivot": [0, 4, 0], "offset": [0, 0, 0], "restRotation": [0, 0, 0, 1]},
                {"id": "panel", "name": "Daun", "parentId": "frame", "shape": "block", "size": [4, 7, 0.3], "color": "#885522", "pivot": [0.25, -0.5, 0], "offset": [2, 0, 0], "restRotation": [0, 0, 0, 1]}
            ]},
            "motionIntent": {"originalPrompt": "Buka pintu, kusen diam", "assumptions": [], "requirements": [
                {"id": "open", "kind": "action", "text": "Pintu membuka", "excerpt": "Buka pintu", "binding": {"clipId": "open", "targetIds": ["panel"], "window": [0, 1.2]}},
                {"id": "still", "kind": "prohibition", "text": "Kusen diam", "excerpt": "kusen diam", "binding": {"clipId": "open", "targetIds": ["frame"], "window": [0, 1.2]}}
            ]},
            "clips": [{"id": "open", "name": "Buka", "durationSeconds": 1.2, "loopMode": "once", "markers": [{"id": "done", "timeSeconds": 1.2, "eventType": "door_open"}], "tracks": [
                {"targetId": "panel", "property": "rotation", "interpolation": "smooth", "keys": [{"timeSeconds": 0, "value": [0, 0, 0, 1]}, {"timeSeconds": 1.2, "value": [0, 0.7660444, 0, 0.6427876]}]}
            ]}]
        })
    }

    #[test]
    fn accepts_valid_document_and_checks_requested_mode() {
        assert!(validate(&door(), Some("object")).is_ok());
        assert!(validate(&door(), Some("character")).unwrap_err().to_string().contains("berbeda"));
    }

    #[test]
    fn rejects_moving_a_prohibited_part_and_mismatched_loops() {
        let mut moving = door();
        moving["clips"][0]["tracks"].as_array_mut().unwrap().push(json!({"targetId": "frame", "property": "position", "interpolation": "linear", "keys": [{"timeSeconds": 0, "value": [0, 0, 0]}, {"timeSeconds": 1, "value": [0, 0.5, 0]}]}));
        assert!(validate(&moving, None).unwrap_err().to_string().contains("melarang frame"));
        let mut looped = door();
        looped["clips"][0]["loopMode"] = json!("loop");
        assert!(validate(&looped, None).unwrap_err().to_string().contains("pose awal dan akhir"));
    }

    #[test]
    fn rejects_structural_problems() {
        for (path, value, expected) in [
            ("/clips/0/tracks/0/keys/1/value", json!([0, 0, 0, 2]), "quaternion satuan"),
            ("/clips/0/tracks/0/keys/1/timeSeconds", json!(0), "naik ketat"),
            ("/clips/0/tracks/0/targetId", json!("ghost"), "tidak ada"),
            ("/clips/0/tracks/0/keys/1/value", json!([0, 1, 0, 0]), "≥180°"),
            ("/object/parts/0/parentId", json!("panel"), "siklus"),
            ("/units", json!("meter"), "konvensi"),
        ] {
            let mut doc = door();
            *doc.pointer_mut(path).unwrap() = value;
            let error = validate(&doc, None).unwrap_err().to_string();
            assert!(error.contains(expected), "{path}: {error}");
        }
    }

    #[test]
    fn character_in_place_cannot_move_root_and_controls_are_bounded() {
        let mut doc = door();
        doc["animationMode"] = json!("character");
        doc.as_object_mut().unwrap().remove("object");
        doc["character"] = json!({"rigType": "R15", "rigSource": "reference", "rootPolicy": "in_place", "priority": "Action"});
        doc["motionIntent"]["requirements"] = json!([{"id": "wave", "kind": "action", "text": "Melambai", "excerpt": "lambai", "binding": {"clipId": "open", "targetIds": ["RightUpperArm"], "window": [0, 1]}}]);
        doc["clips"][0]["tracks"] = json!([{"targetId": "RightUpperArm", "property": "rotation", "interpolation": "linear", "keys": [{"timeSeconds": 0, "value": [0, 0, 0, 1]}]}]);
        assert!(validate(&doc, Some("character")).is_ok());
        doc["clips"][0]["tracks"].as_array_mut().unwrap().push(json!({"targetId": "Root", "property": "position", "interpolation": "linear", "keys": [{"timeSeconds": 0, "value": [0, 0, 0]}]}));
        assert!(validate(&doc, None).unwrap_err().to_string().contains("Root"));
        assert!(AnimationControls { mode: "object".into(), duration_seconds: Some(0.), loop_mode: None, quality_profile: None }.validate().is_err());
        assert!(AnimationControls { mode: "object".into(), duration_seconds: Some(1.2), loop_mode: Some("loop".into()), quality_profile: Some("high_polish".into()) }.validate().is_ok());
    }
}
