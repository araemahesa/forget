//! Fixed import pipeline for verified Blender output; never executes recipe/provider code.
use serde_json::{json, Value};
use std::path::Path;

const SCRIPT: &str = include_str!("../../scripts/luau/blender_insert.lua");
const MESH_TRIANGLES: usize = 20_000;

pub(crate) fn script(payload: &Value) -> Result<String, String> {
    let body = payload.to_string();
    // JSON is data inside a Lua long string. Select a delimiter absent from that data.
    let mut equal = "=".to_string();
    while body.contains(&format!("]{equal}]")) { equal.push('='); }
    let code = format!("local payload=game:GetService('HttpService'):JSONDecode([{equal}[{body}]{equal}])\n{SCRIPT}");
    if code.len() > 65_000 { return Err("Chunk mesh melebihi batas transport.".into()); }
    Ok(code)
}

pub(crate) fn plan(document: &Value, preview: &Value) -> Result<Vec<Value>, String> {
    let meshes = preview["meshes"].as_array().ok_or("Buffer Blender hilang.")?;
    let parts = document["recipe"]["parts"].as_array().ok_or("Recipe model hilang.")?;
    if preview["schemaVersion"] != 1 || meshes.len() != parts.len() { return Err("Buffer tidak cocok dengan model Blender.".into()); }
    let presets: Value = serde_json::from_str(include_str!("../../../../../packages/contracts/src/model3d-materials.json")).unwrap();
    let mut steps = vec![]; let mut total = 0; let mut index = 0;
    for (mesh, part) in meshes.iter().zip(parts) {
        if mesh["id"] != part["id"] { return Err("Identitas geometri Blender berbeda.".into()); }
        let numbers = |key: &str, bound: f64| -> Result<Vec<f64>, String> {
            mesh[key].as_array().ok_or("Buffer Blender hilang.")?.iter().map(|v|v.as_f64().filter(|n|n.is_finite() && n.abs() <= bound).ok_or("Koordinat/normals Blender tidak sah.".into())).collect()
        };
        let positions = numbers("positions", 20_000.)?; let normals = numbers("normals", 1.001)?;
        if positions.is_empty() || positions.len() % 9 != 0 || normals.len() != positions.len() { return Err("Buffer triangle Blender tidak sah.".into()); }
        let colors=if mesh.get("colors").is_some() {
            let values=numbers("colors",1.)?;
            if values.len()!=positions.len() || values.iter().any(|n|*n<0.) {return Err("Warna vertex Blender tidak sah.".into());}
            Some(values.into_iter().map(|n|if n<=0.0031308 {12.92*n} else {1.055*n.powf(1./2.4)-0.055}).collect::<Vec<_>>())
        } else {None};
        total += positions.len()/9; if total > 200_000 { return Err("Model melampaui 200.000 triangle.".into()); }
        for (mesh_chunk,(positions, normals)) in positions.chunks(MESH_TRIANGLES*9).zip(normals.chunks(MESH_TRIANGLES*9)).enumerate() {
            index += 1;
            let mut low = [f64::INFINITY;3]; let mut high = [f64::NEG_INFINITY;3];
            for point in positions.chunks_exact(3) { for i in 0..3 {low[i]=low[i].min(point[i]);high[i]=high[i].max(point[i]);} }
            let center: Vec<f64> = (0..3).map(|i|(low[i]+high[i])/2.).collect();
            let size: Vec<f64> = (0..3).map(|i|(high[i]-low[i]).max(0.001)).collect();
            let centered: Vec<f64> = positions.iter().enumerate().map(|(i,n)|n-center[i%3]).collect();
            // Bound each RPC independently. 96 triangles also fit worst-case finite f64 JSON.
            let per_rpc=if colors.is_some() {64} else {96};
            for (chunk, (points, normals)) in centered.chunks(per_rpc*9).zip(normals.chunks(per_rpc*9)).enumerate() {
                let mut step=json!({"action":"append","index":index,"offset":chunk*per_rpc,"positions":points,"normals":normals});
                if let Some(colors)=&colors {
                    let start=mesh_chunk*MESH_TRIANGLES*9+chunk*per_rpc*9;
                    step["colors"]=json!(&colors[start..start+points.len()]);
                }
                steps.push(step);
            }
            let material = part["material"].as_str().ok_or("Material tidak sah.")?;
            let color = part["color"].as_str().ok_or("Warna tidak sah.")?;
            let rgb: Vec<u8> = if colors.is_some() {vec![255,255,255]} else {[1,3,5].into_iter().map(|i|u8::from_str_radix(&color[i..i+2],16).map_err(|_|"Warna tidak sah.")).collect::<Result<_,_>>()?};
            let surface = |key:&str|part.get(key).unwrap_or(&presets[material][key]).clone();
            let name:String=part["name"].as_str().ok_or("Nama mesh tidak sah.")?.chars().take(50).collect();
            steps.push(json!({"action":"finishPart","index":index,"triangles":positions.len()/9,"name":name,"partId":part["id"],"center":center,"size":size,"color":rgb,"material":if material=="Plastic" {"SmoothPlastic"} else {material},"opacity":surface("opacity"),"roughness":surface("roughness"),"metalness":surface("metalness")}));
        }
    }
    steps.push(json!({"action":"commit","parts":index,"triangles":total}));
    Ok(steps)
}

pub(crate) fn run(root: &Path, document: &Value, preview: &Value, version_id: &str, mut execute: impl FnMut(&str)->Result<Value,String>) -> Result<Value,String> {
    let steps = plan(document, preview)?;
    let source = crate::artifacts::sha256_hex(format!("{version_id}:{}", document).as_bytes());
    let probe = execute(&script(&json!({"action":"probe","source":source}))?)?;
    if probe["ok"] != true {return Err("Studio belum memverifikasi impor mesh; tidak ada upload atau perubahan.".into());}
    if probe["reused"] == true {return Ok(probe);}
    let document_id = probe["documentId"].as_str().filter(|s|!s.is_empty() && s.len()<=256 && !s.chars().any(char::is_control)).ok_or("Identitas dokumen Studio belum tersedia; tidak ada upload atau perubahan.")?;
    if probe["placeId"].as_str().is_none_or(|s|s.parse::<u64>().is_err()) || probe["owner"].as_u64().is_none_or(|id|id==0 || id>9_007_199_254_740_991) || !matches!(probe["ownerType"].as_str(),Some("User"|"Group")) {return Err("Pemilik/map tujuan tidak sah; tidak ada upload.".into());}
    let attempt = crate::storage::next_id("blender-import");
    let journal = format!("imports/blender/{attempt}");
    let common = json!({"source":source,"documentId":document_id,"placeId":probe["placeId"],"versionId":version_id});
    let mut begin = common.clone(); begin["action"]=json!("begin");begin["name"]=json!(document["recipe"]["name"].as_str().unwrap_or("Model Blender").chars().take(90).collect::<String>());begin["owner"]=probe["owner"].clone();begin["ownerType"]=probe["ownerType"].clone();
    let record = |name:&str, value:&Value|crate::artifacts::write_artifact(root,&format!("{journal}/{name}.json"),value.to_string().as_bytes()).map(|_|()).map_err(|e|e.to_string());
    record("intent", &json!({"versionId":version_id,"documentId":document_id,"owner":probe["owner"],"ownerType":probe["ownerType"],"source":source}))?;
    for (index, mut payload) in std::iter::once(begin).chain(steps).enumerate() {
        for (key, value) in common.as_object().unwrap() {payload[key]=value.clone();}
        let result = execute(&script(&payload)?);
        match result {
            Ok(value) => {
                record(&format!("step-{index:04}"), &value)?;
                if value["ok"] != true {return Err(format!("{} Receipt: {journal}. Aset yang sudah terunggah dipertahankan.",value["error"].as_str().unwrap_or("Studio menolak impor.")));}
                if payload["action"] == "commit" {return Ok(value);}
            }
            Err(error) => {record("interrupted",&json!({"step":index,"error":error}))?;return Err(format!("Impor terhenti: {error} Periksa Studio dan receipt {journal}; upload tidak diulang otomatis."));}
        }
    }
    Err("Receipt impor tidak tersedia.".into())
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn reference_colors_survive_mesh_and_rpc_boundaries_without_tinting() {
        let count=MESH_TRIANGLES+65;
        let positions=vec![0.,0.,0.,2.,0.,0.,0.,2.,0.].repeat(count);
        let normals=vec![0.,0.,1.,0.,0.,1.,0.,0.,1.].repeat(count);
        let colors=vec![0.5;count*9];
        let doc=json!({"recipe":{"parts":[{"id":"a","name":"Reference color","color":"#246bb3","material":"Plastic"}]}});
        let preview=json!({"schemaVersion":1,"meshes":[{"id":"a","positions":positions,"normals":normals,"colors":colors}]});
        let steps=plan(&doc,&preview).unwrap();
        let mut seen=0;
        for step in &steps {
            assert!(script(step).unwrap().len()<=65000);
            if step["action"]=="append" {
                let c=step["colors"].as_array().unwrap();
                assert_eq!(c.len(),step["positions"].as_array().unwrap().len());
                assert!((c[0].as_f64().unwrap()-0.7353569830524495).abs()<1e-8);
                seen+=c.len()/9;
            } else if step["action"]=="finishPart" {assert_eq!(step["color"],json!([255,255,255]));}
        }
        assert_eq!(seen,count);
        for colors in [json!([]),json!(vec![-0.1;9]),json!(vec![2.;9])] {
            let mut corrupt=preview.clone();corrupt["meshes"][0]["colors"]=colors;
            assert!(plan(&doc,&corrupt).is_err());
        }
    }
    #[test]
    fn generated_chunks_preserve_geometry_and_do_not_embed_code_from_names() {
        let doc=json!({"recipe":{"parts":[{"id":"a","name":"]==] os.execute('no')","color":"#246bb3","material":"Plastic"}]}});
        let p=json!({"schemaVersion":1,"meshes":[{"id":"a","positions":[0,0,0,2,0,0,0,2,0],"normals":[0,0,1,0,0,1,0,0,1]}]});
        let steps=plan(&doc,&p).unwrap();assert_eq!(steps[0]["positions"],json!([-1.,-1.,0.,1.,-1.,0.,-1.,1.,0.]));
        assert_eq!(steps[1]["center"],json!([1.,1.,0.]));assert_eq!(steps[2]["triangles"],1);
        assert!(script(&steps[1]).unwrap().contains("JSONDecode"));
        let mut bad=p.clone();bad["meshes"][0]["id"]=json!("other");assert!(plan(&doc,&bad).is_err());
        bad=p.clone();bad["meshes"][0]["normals"]=json!([]);assert!(plan(&doc,&bad).is_err());
    }
    #[test]
    fn import_retains_upload_receipts_and_stops_on_unknown_results() {
        let root=std::env::temp_dir().join(crate::storage::next_id("mesh-import-test"));std::fs::create_dir(&root).unwrap();
        let doc=json!({"recipe":{"name":"Fixture","parts":[{"id":"a","name":"Part","color":"#246bb3","material":"Plastic"}]}});
        let preview=json!({"schemaVersion":1,"meshes":[{"id":"a","positions":[0,0,0,2,0,0,0,2,0],"normals":[0,0,1,0,0,1,0,0,1]}]});
        let mut actions=vec![];
        let error=run(&root,&doc,&preview,"version",|code| {
            let data=code.split("JSONDecode([=[").nth(1).unwrap().split("]=])").next().unwrap();
            let payload:Value=serde_json::from_str(data).unwrap();let action=payload["action"].as_str().unwrap();actions.push(action.to_owned());
            if action=="probe" {return Ok(json!({"ok":true,"documentId":"doc:workspace","placeId":"123","owner":123,"ownerType":"User"}));}
            if action=="finishPart" {return Err("Response lost during upload".into());}
            assert_eq!(payload["documentId"],"doc:workspace");Ok(json!({"ok":true}))
        }).unwrap_err();
        assert!(error.contains("tidak diulang otomatis"));assert_eq!(actions,vec!["probe","begin","append","finishPart"]);
        let attempts:Vec<_>=std::fs::read_dir(root.join("imports/blender")).unwrap().collect();assert_eq!(attempts.len(),1);
        assert!(attempts[0].as_ref().unwrap().path().join("interrupted.json").exists());
        let reused=run(&root,&doc,&preview,"version",|_|Ok(json!({"ok":true,"reused":true,"modelName":"Existing"}))).unwrap();assert_eq!(reused["reused"],true);
        std::fs::remove_dir_all(root).unwrap();
    }
}
