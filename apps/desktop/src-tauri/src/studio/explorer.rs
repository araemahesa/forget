use serde::{Deserialize, Serialize};
use serde_json::Value;
#[derive(Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Segment { pub name: String, pub id: String }
#[derive(Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Query { pub action: String, pub path: Vec<Segment>, pub offset: usize, pub search: String, pub epoch: Option<String> }
pub fn code(query: &Query) -> Result<String, String> {
    if !["children", "properties", "search"].contains(&query.action.as_str()) || query.path.len() > 256 || query.offset > 1_000_000 || query.search.len() > 256 || query.path.iter().any(|s| s.name.len() > 512 || s.id.len() > 128 || s.id.is_empty()) { return Err("Requête Explorer tidak sah.".into()); }
    let encoded = serde_json::to_string(query).map_err(|e|e.to_string())?;
    let literal = serde_json::to_string(&encoded).map_err(|e|e.to_string())?;
    Ok(include_str!("../../scripts/luau/explorer.luau").replace("QUERY_JSON", &literal))
}
pub fn decode(value: Value) -> Result<Value, String> {
    if value["isError"] == true { return Err(format!("Explorer Studio: {}", value["content"])); }
    if let Some(content) = value["content"].as_array() { for block in content { if let Some(text) = block["text"].as_str() { if let Ok(parsed) = serde_json::from_str::<Value>(text) { if parsed["epoch"].is_string() && parsed["nodes"].is_array() { return Ok(parsed) } } } } }
    Err("Respons Explorer belum didukung; tidak ada objek yang direka.".into())
}
pub fn read(studio: &str, query: &Query) -> Result<Value,String> { let code = code(query)?; decode(crate::studio::explorer_read(studio, &code)?) }
#[cfg(test)] mod tests { use super::*; use serde_json::json; #[test] fn bounded_query_is_data_not_code() { let mut q = Query{action:"children".into(),path:vec![Segment{name:"a.\"\\n); error('x')".into(),id:"stable".into()}],offset:0,search:"".into(),epoch:None}; let code=code(&q).unwrap(); assert!(code.contains("JSONDecode(\"")); q.action="write".into();assert!(super::code(&q).is_err()); assert!(decode(json!({"content":[{"text":"{\"epoch\":\"x\",\"nodes\":[]}"}]})).is_ok()); assert!(decode(json!({"isError":true})).is_err()); } }

#[cfg(test)]
mod live_acceptance {
    use super::*;
    use serde_json::json;
    #[test]
    #[ignore = "requires only the explicitly named local ForgeKitAcceptance.rbxlx fixture"]
    fn live_explorer_large_deep_map() {
        let report=crate::studio::probe().unwrap();
        let target=report.studios.iter().find(|s|s.name=="ForgeKitAcceptance.rbxlx").expect("Open the isolated ForgeKitAcceptance.rbxlx fixture");
        let mut query=Query {action:"children".into(),path:vec![],offset:0,search:String::new(),epoch:None};
        let root=read(&target.studio_id,&query).unwrap();
        query.epoch=Some(root["epoch"].as_str().unwrap().into());
        let workspace=root["nodes"].as_array().unwrap().iter().find(|n|n["className"]=="Workspace").unwrap();
        query.path=serde_json::from_value(workspace["path"].clone()).unwrap();
        let workspace_children=read(&target.studio_id,&query).unwrap();
        let fixture=workspace_children["nodes"].as_array().unwrap().iter().find(|n|n["name"]=="ForgeKitAcceptance").unwrap();
        query.path=serde_json::from_value(fixture["path"].clone()).unwrap();
        let fixture_path=query.path.clone();
        let mut all=vec![];
        loop {
            let page=read(&target.studio_id,&query).unwrap();
            all.extend(page["nodes"].as_array().unwrap().iter().cloned());
            if page["more"]!=true {assert_eq!(page["total"].as_u64().unwrap() as usize,all.len());break;}
            query.offset=all.len();
        }
        assert!(all.len()>450);
        let twins=all.iter().filter(|n|n["name"]=="Twin").collect::<Vec<_>>();
        assert_eq!(twins.len(),2);assert_ne!(twins[0]["id"],twins[1]["id"]);
        let dotted=all.iter().find(|n|n["name"]=="Dot.Name").unwrap();
        assert_eq!(dotted["path"].as_array().unwrap().last().unwrap()["name"],"Dot.Name");
        query.offset=0;query.path=serde_json::from_value(all.iter().find(|n|n["name"]=="Empty").unwrap()["path"].clone()).unwrap();
        let empty=read(&target.studio_id,&query).unwrap();assert_eq!(empty["total"],0);assert_eq!(empty["more"],false);
        query.action="search".into();query.path=vec![];query.search="HiddenSearchTarget".into();
        let search=read(&target.studio_id,&query).unwrap();
        let hidden=search["nodes"].as_array().unwrap().iter().find(|n|n["name"]=="HiddenSearchTarget").unwrap();
        assert!(hidden["path"].as_array().unwrap().len()>8);
        query.action="properties".into();query.path=serde_json::from_value(hidden["path"].clone()).unwrap();
        let properties=read(&target.studio_id,&query).unwrap();assert_eq!(properties["properties"]["Name"],"HiddenSearchTarget");
        query.action="children".into();query.path=fixture_path;query.epoch=Some("stale-map".into());
        assert!(read(&target.studio_id,&query).is_err());
        let epoch=crate::studio::map_epoch(&target.studio_id).unwrap();
        let evidence=json!({"liveStudio":true,"providerLive":false,"fixture":"/tmp/ForgeKitAcceptance.rbxlx","studioId":target.studio_id,"editEpoch":epoch,"loadedChildren":all.len(),"duplicateIdsDistinct":true,"dottedNamePreserved":true,"emptyFolderVerified":true,"deepSearch":search,"properties":properties,"staleEpochRejected":true});
        std::fs::write("/tmp/forgekit-explorer-live.json",serde_json::to_vec_pretty(&evidence).unwrap()).unwrap();
    }
}
