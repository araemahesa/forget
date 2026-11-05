use forgekit_desktop_lib::{ai, connections, context::ContextSnapshot, storage, tools};
use serde_json::json;

fn main() -> Result<(), String> {
    let isolated = storage::Storage::open(":memory:").map_err(|e| e.to_string())?;
    let router = isolated
        .get_router_connection()
        .map_err(|e| e.to_string())?;
    let now = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map_err(|_| "Waktu OS tidak sah.")?
        .as_millis()
        .to_string();
    let probe = connections::probe_router(&router)?;
    let selected = std::env::args()
        .nth(1)
        .ok_or("Pilih satu ID ag/ dari katalog instance.")?;
    if !selected.starts_with("ag/") || !probe.models.contains(&selected) {
        return Err("Model tidak ditemukan pada katalog Antigravity instance.".into());
    }
    let profile = ai::AiProviderProfile {
        id: "live-router-probe".into(),
        name: "Otomatis via 9router".into(),
        provider_type: "9router".into(),
        base_url: connections::inference_base(&router),
        model: selected.clone(),
        reasoning_effort: None,
        key_reference: router.inference_credential_ref,
        is_default: false,
        created_at: now.clone(),
        updated_at: now.clone(),
    };
    let text = ai::test_ai_provider(&profile)?;
    let mut report = json!({
        "checkedAt": now, "routerVersion":probe.detected_version,
        "catalogCount":probe.models.len(), "model":selected, "textStreaming":text,
        "upstreamIdentity":"unknown; managed by 9router", "studioLive":false,
        "toolsScope":"Synthetic hierarchy only; no real map data or mutation",
    });
    if text.ok {
        let snapshot: ContextSnapshot = serde_json::from_value(json!({
            "id":"probe-snapshot","studioId":"synthetic","displayName":"Synthetic tool check","scope":"game",
            "depth":1,"observedAt":now,"loadedNodes":1,"truncated":false,
            "nodes":[{"name":"ProbeGate","className":"Model","children":[]}],
            "contentHash":"a".repeat(64),"skillHash":"b".repeat(64),
        })).map_err(|_| "Fixture tidak sah.")?;
        let lease = ai::begin_stream("live-router-tool-probe")?;
        let mut receipts = Vec::new();
        let result = ai::execute_chat_tools_limited(
            &profile,
            &lease,
            &[
                json!({"role":"user","content":"Call forgekit_map_search exactly once with snapshotId probe-snapshot, query ProbeGate, className null, limit 1. After tool result reply only the matching name. Do not call any other tool."}),
            ],
            true,
            45,
            |_| Ok(()),
            |call| {
                if !receipts.is_empty() {
                    return Err("Satu operasi tool cukup untuk probe.".into());
                }
                let receipt = tools::execute(&snapshot, call)?;
                receipts.push(receipt.clone());
                Ok(receipt)
            },
        );
        report["toolRoundTrip"] = json!({
            "ok":result.is_ok() && receipts.len()==1,
            "receiptCount":receipts.len(), "result":result,
        });
    }
    println!(
        "{}",
        serde_json::to_string_pretty(&report).map_err(|_| "Laporan gagal.")?
    );
    Ok(())
}
