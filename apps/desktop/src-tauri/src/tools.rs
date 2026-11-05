use crate::artifacts::sha256_hex;
use crate::context::{ContextNode, ContextSnapshot};
use crate::storage::now_string;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};

pub const MAX_CALLS: usize = 8;
pub const MAX_ROUNDS: usize = 5;

#[derive(Clone)]
pub struct ToolDefinition {
    pub name: String,
    pub wire_name: String,
    pub description: String,
    pub input_schema: Value,
    pub strict: bool,
}

pub fn definitions() -> Vec<ToolDefinition> {
    vec![
        ToolDefinition {
            name: "map.search".into(),
            wire_name: "forgekit_map_search".into(),
            description: "Cari nama/class pada snapshot hierarki yang diizinkan. Bukan pembacaan live; tidak membaca script atau properties.".into(),
            strict: true,
            input_schema: json!({"type":"object","additionalProperties":false,
                "required":["snapshotId","query","className","limit"],
                "properties":{"snapshotId":{"type":"string","minLength":1,"maxLength":128},
                    "query":{"type":"string","minLength":1,"maxLength":128},
                    "className":{"type":["string","null"],"maxLength":128},
                    "limit":{"type":"integer","minimum":1,"maximum":50}}}),
        },
        ToolDefinition {
            name: "map.inspect".into(),
            wire_name: "forgekit_map_inspect".into(),
            description: "Baca satu node dan referensi anak dari snapshot yang diizinkan. Referensi ordinal hanya berlaku pada snapshot ini, bukan identitas objek Studio.".into(),
            strict: true,
            input_schema: json!({"type":"object","additionalProperties":false,
                "required":["snapshotId","reference"],
                "properties":{"snapshotId":{"type":"string","minLength":1,"maxLength":128},
                    "reference":{"type":"string","minLength":1,"maxLength":128}}}),
        },
    ]
}

#[derive(Debug, Clone, Deserialize, Serialize, PartialEq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ToolCall {
    pub id: String,
    pub name: String,
    pub arguments: String,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct NodeReference {
    pub reference: String,
    pub name: String,
    pub class_name: String,
    pub child_count: usize,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ToolReceipt {
    pub call_id: String,
    pub name: String,
    pub implementation_version: String,
    pub snapshot_id: String,
    pub content_hash: String,
    pub request_hash: String,
    pub observed_at: String,
    pub completed_at: String,
    pub read_only: bool,
    pub truncated: bool,
    pub matches: Vec<NodeReference>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct SearchInput {
    snapshot_id: String,
    query: String,
    class_name: Option<String>,
    limit: usize,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct InspectInput {
    snapshot_id: String,
    reference: String,
}

fn bounded(value: &str, max: usize) -> bool {
    !value.trim().is_empty() && value.len() <= max && !value.chars().any(char::is_control)
}

fn flatten(nodes: &[ContextNode], prefix: &str, output: &mut Vec<NodeReference>) {
    for (index, node) in nodes.iter().enumerate() {
        let reference = format!("{prefix}/{index}");
        output.push(NodeReference {
            reference: reference.clone(),
            name: node.name.clone(),
            class_name: node.class_name.clone(),
            child_count: node.children.len(),
        });
        flatten(&node.children, &reference, output);
    }
}

pub fn execute(snapshot: &ContextSnapshot, call: &ToolCall) -> Result<ToolReceipt, String> {
    crate::context::validate_age(snapshot)?;
    if !bounded(&call.id, 128) || call.arguments.len() > 4096 {
        return Err("ID atau ukuran input tool tidak sah.".into());
    }
    let mut nodes = Vec::new();
    flatten(&snapshot.nodes, "node", &mut nodes);
    let (name, matches, truncated) = match call.name.as_str() {
        "forgekit_map_search" => {
            let input: SearchInput =
                serde_json::from_str(&call.arguments).map_err(|_| "Input map.search tidak sah.")?;
            if input.snapshot_id != snapshot.id
                || !bounded(&input.query, 128)
                || !(1..=50).contains(&input.limit)
                || input.class_name.as_ref().is_some_and(|v| !bounded(v, 128))
            {
                return Err("Scope atau batas map.search tidak sah.".into());
            }
            let query = input.query.to_lowercase();
            let found: Vec<_> = nodes
                .into_iter()
                .filter(|node| {
                    (node.name.to_lowercase().contains(&query)
                        || node.class_name.to_lowercase().contains(&query))
                        && input
                            .class_name
                            .as_ref()
                            .is_none_or(|class| node.class_name == *class)
                })
                .collect();
            let truncated = snapshot.truncated || found.len() > input.limit;
            (
                "map.search",
                found.into_iter().take(input.limit).collect(),
                truncated,
            )
        }
        "forgekit_map_inspect" => {
            let input: InspectInput = serde_json::from_str(&call.arguments)
                .map_err(|_| "Input map.inspect tidak sah.")?;
            if input.snapshot_id != snapshot.id || !bounded(&input.reference, 128) {
                return Err("Scope map.inspect tidak sah.".into());
            }
            if !nodes.iter().any(|node| node.reference == input.reference) {
                return Err("Referensi tidak ditemukan pada snapshot yang diizinkan.".into());
            }
            let prefix = format!("{}/", input.reference);
            let matches = nodes
                .into_iter()
                .filter(|node| {
                    node.reference == input.reference
                        || node
                            .reference
                            .strip_prefix(&prefix)
                            .is_some_and(|s| !s.contains('/'))
                })
                .collect();
            ("map.inspect", matches, snapshot.truncated)
        }
        _ => return Err("Tool tidak terdaftar atau tidak diizinkan.".into()),
    };
    Ok(ToolReceipt {
        call_id: call.id.clone(),
        name: name.into(),
        implementation_version: "1.0.0".into(),
        snapshot_id: snapshot.id.clone(),
        content_hash: snapshot.content_hash.clone(),
        request_hash: sha256_hex(
            serde_json::to_string(call)
                .map_err(|_| "Input tool tidak sah.")?
                .as_bytes(),
        ),
        observed_at: snapshot.observed_at.clone(),
        completed_at: now_string(),
        read_only: true,
        truncated,
        matches,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn gateway_enforces_scope_schema_expiry_and_unambiguous_snapshot_references() {
        let mut snapshot = ContextSnapshot { target: None,
            id: "snapshot".into(),
            studio_id: "studio".into(),
            display_name: "Place".into(),
            scope: "game".into(),
            depth: 2,
            observed_at: now_string(),
            loaded_nodes: 3,
            truncated: false,
            content_hash: "a".repeat(64),
            skill_hash: "b".repeat(64),
            nodes: vec![ContextNode {
                name: "Workspace".into(),
                class_name: "Workspace".into(),
                children: vec![
                    ContextNode {
                        name: "Gate".into(),
                        class_name: "Model".into(),
                        children: vec![]
                    };
                    2
                ],
            }],
        };
        let mut call = ToolCall {
            id: "call".into(),
            name: "forgekit_map_search".into(),
            arguments: json!({"snapshotId":"snapshot","query":"gate","className":null,"limit":1})
                .to_string(),
        };
        let result = execute(&snapshot, &call).unwrap();
        assert_eq!(result.matches[0].reference, "node/0/0");
        assert!(result.truncated);
        call.name = "forgekit_map_inspect".into();
        call.arguments = json!({"snapshotId":"snapshot","reference":"node/0"}).to_string();
        assert_eq!(execute(&snapshot, &call).unwrap().matches.len(), 3);
        for input in [
            json!({"snapshotId":"other","reference":"node/0"}),
            json!({"snapshotId":"snapshot","reference":"Workspace.Gate"}),
            json!({"snapshotId":"snapshot","reference":"node/0","execute":"secret"}),
        ] {
            call.arguments = input.to_string();
            assert!(execute(&snapshot, &call).is_err());
        }
        call.arguments = json!({"snapshotId":"snapshot","reference":"node/0"}).to_string();
        call.name = "scene.remove".into();
        assert!(execute(&snapshot, &call).is_err());
        call.name = "forgekit_map_inspect".into();
        snapshot.observed_at = "1".into();
        assert!(execute(&snapshot, &call).is_err());
    }
}
