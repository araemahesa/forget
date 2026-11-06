//! Shared, durable provider execution. The backend owns budgets and receipts.
use crate::{ai::AiProviderProfile, ai::protocol::Turn, artifacts::sha256_hex, routing::now_ms, tools::{ToolCall, ToolDefinition}};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::collections::BTreeMap;

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all="camelCase")]
pub struct Budget {
    pub class: String, pub turns: usize, pub calls: usize, pub reserve_turns: usize,
    pub duration_ms: u64, pub request_seconds: u64, pub context_bytes: usize,
    pub output_tokens: u64, pub total_output_estimate: usize,
}
impl Budget {
    pub fn for_model3d(tools: bool, quality: &str) -> Self {
        let mut budget = Self::for_task(tools, true);
        budget.duration_ms = 1_200_000;
        budget.request_seconds = 600;
        budget.output_tokens = crate::creative::output_tokens("model3d", quality);
        budget
    }
    pub fn for_task(tools: bool, complex: bool) -> Self {
        Self { class: if complex {"complex"} else if tools {"standard"} else {"light"}.into(),
            turns: if complex {24} else if tools {16} else {8}, calls: if complex {40} else {24},
            reserve_turns: 2, duration_ms: if complex {600_000} else if tools {300_000} else {180_000},
            request_seconds: 120, context_bytes: 256*1024, output_tokens:8192, total_output_estimate:131072 }
    }
}
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all="camelCase")]
pub struct Operation { pub call: ToolCall, pub intent_hash: String, pub write: bool, pub output: Option<Value>, pub dispatched: bool }
#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all="camelCase")]
pub struct Checkpoint {
    pub version: u32,
    #[serde(default)]
    pub revision: u64,
    #[serde(default)]
    pub studio_id: Option<String>,
    #[serde(default)]
    pub map_epoch: Option<String>,
    pub adapter: String,
    pub fingerprint: String,
    pub history: Vec<Value>,
    pub budget: Budget,
    pub deadline_ms: u64,
    pub turns: usize,
    pub calls: usize,
    pub output_estimate: usize,
    pub phase: String,
    pub final_only: bool,
    pub no_progress: usize,
    pub segment: usize,
    pub operations: BTreeMap<String, Operation>,
    pub pending: Option<Turn>,
    pub final_text: Option<String>,
    pub error_category: Option<String>,
    pub candidate_hash: Option<String>,
    pub validation: String,
    pub repairs: usize,
    #[serde(default, skip_serializing_if="Option::is_none")]
    pub model_review: Option<crate::model3d::reference_model::ReviewState>,
}
pub fn fingerprint(p:&AiProviderProfile)->String {
    sha256_hex(json!([p.id,p.provider_type,p.model,p.reasoning_effort,p.base_url,p.key_reference,p.updated_at]).to_string().as_bytes())
}
pub fn category(error: &str) -> &'static str {
    if error.contains("CANCELLED") || error.contains("dibatalkan") {
        "cancelled"
    } else if error.contains("[TASK_DEADLINE]") {
        "task_deadline"
    } else if error.contains("[TURN_LIMIT]") {
        "turn_limit"
    } else if error.contains("[CALL_LIMIT]") {
        "call_limit"
    } else if error.contains("[CONTEXT_LIMIT]") {
        "context_limit"
    } else if error.contains("[OUTPUT_LIMIT]") {
        "output_limit"
    } else if error.contains("[NO_PROGRESS]") {
        "no_progress"
    } else if error.contains("[RATE_LIMIT") {
        "provider_rate_limit"
    } else if error.contains("[OUTAGE]") {
        "provider_outage"
    } else if error.contains("[QUOTA]") {
        "provider_quota"
    } else if error.contains("[AUTH]") {
        "authentication"
    } else if error.contains("[BILLING]") {
        "billing"
    } else if error.contains("[SAFETY]") {
        "refusal"
    } else if error.contains("[RESPONSE_INCOMPLETE]") {
        "response_incomplete"
    } else if error.contains("UNKNOWN_RESULT") {
        "unknown_result"
    } else if error.contains("[STORAGE]") {
        "storage"
    } else if error.contains("[TARGET]") || error.contains("[TARGET_CONFLICT]") {
        "target_conflict"
    } else if error.contains("[REQUEST_TIMEOUT]") {
        "request_timeout"
    } else if error.contains("[VALIDATION]") {
        "validation"
    } else {
        "provider_or_protocol"
    }
}
impl Checkpoint {
    pub fn new(profile:&AiProviderProfile, history:&[Value], budget:Budget)->Self {
        Self { version:1, revision:0, studio_id:None, map_epoch:None, adapter:profile.provider_type.clone(), fingerprint:fingerprint(profile),history:history.to_vec(),deadline_ms:now_ms()+budget.duration_ms,
            budget,turns:0,calls:0,output_estimate:0,phase:"preparing".into(),final_only:false,no_progress:0,segment:0,
            operations:BTreeMap::new(),pending:None,final_text:None,error_category:None,candidate_hash:None,validation:"not_checked".into(),repairs:0,model_review:None }
    }
    pub fn can_switch_account(&self) -> bool {
        matches!(self.error_category.as_deref(), Some("provider_rate_limit" | "provider_quota" | "provider_outage"))
            && self.final_text.is_none() && self.pending.is_none() && self.operations.is_empty()
            && self.output_estimate == 0 && self.model_review.is_none()
    }
    pub fn switch_account(&mut self, profile: &AiProviderProfile) -> Result<(), String> {
        // A rejected request has no candidate or tool effects to replay on another account.
        if !self.can_switch_account() {
            return Err("[UNKNOWN_RESULT] Checkpoint sudah memiliki hasil atau operasi; pergantian akun otomatis dihentikan.".into());
        }
        self.fingerprint = fingerprint(profile);
        self.adapter = profile.provider_type.clone();
        self.error_category = None;
        self.phase = "preparing".into();
        Ok(())
    }
    pub fn recovery(&self) -> Value {
        let has_effects = self.operations.values().any(|o| o.write && o.dispatched);
        let unknown = self.operations.values().any(|o| {
            o.write
                && o.dispatched
                && o.output
                    .as_ref()
                    .is_none_or(|v| v["outcomeUnknown"] == true)
        });
        let history = if self.model_review.is_some() {crate::model3d::reference_model::context_history(&self.history)} else {self.history.clone()};
        let room = self.turns < self.budget.turns
            && self.output_estimate < self.budget.total_output_estimate
            && crate::references::context_size(&history)
                .is_ok_and(|size| size <= self.budget.context_bytes);
        let needs_edit = self.operations.values().any(|o| {
            o.write
                && !o.dispatched
                && o.output.as_ref().is_some_and(|v| {
                    v["message"]
                        .as_str()
                        .is_some_and(|m| m.contains("[NEEDS_EDIT]"))
                })
        });
        json!({"canResumeEdit":needs_edit && !unknown && room && self.segment<3 && self.turns+self.budget.reserve_turns+1<self.budget.turns && self.calls+2<self.budget.calls,"canResume":false,"canFinalize":room && self.segment<3 && self.final_text.is_none(),
            "canVerify":room && has_effects && self.validation != "passed" && self.segment<3 && self.calls<self.budget.calls && self.turns+self.budget.reserve_turns+1<self.budget.turns,"hasEffects":has_effects,"hasUnknownEffects":unknown,
            "execution":if unknown {"unknown"} else if has_effects {"partial"} else if self.final_text.is_some(){"completed"}else{"not_completed"},
            "verification":self.validation,"response":if self.final_text.is_some(){"completed"}else{"interrupted"},
            "reason":self.error_category,"phase":self.phase,"turnsUsed":self.turns,"turnsLimit":self.budget.turns,
            "callsUsed":self.calls,"callsLimit":self.budget.calls,"segment":self.segment,"deadlineMs":self.deadline_ms,
            "outputTokensEstimate":self.output_estimate,"budgetClass":self.budget.class})
    }
}

pub fn run(
    state:&mut Checkpoint, tools:&[ToolDefinition], output_tokens:u64,
    mut request:impl FnMut(&[Value],&[ToolDefinition],u64,u64)->Result<Turn,String>,
    mut execute:impl FnMut(&ToolCall)->Result<Value,String>,
    mut persist:impl FnMut(&Checkpoint)->Result<(),String>,
    cancelled:impl Fn()->bool,
)->Result<String,String> {
    let result: Result<String,String> = (|| {
        if cancelled(){return Err("[CANCELLED] Tugas dibatalkan.".into())}
        if let Some(text)=state.final_text.as_ref(){return Ok(text.clone())}
        // A persisted pending dispatch may have taken effect before a process died. Never replay it.
        if let Some(turn)=state.pending.take(){
            let outputs=turn.calls.iter().map(|call|state.operations.get(&call.id).and_then(|o|o.output.clone()).unwrap_or_else(||json!({"isError":true,"outcomeUnknown":true,"message":"Operasi terputus; efek belum diverifikasi. Jangan ulangi write."}))).collect::<Vec<_>>();
            turn.append_results(&state.adapter,&mut state.history,&outputs);
            state.final_only=true;
        }
        loop {
            if cancelled(){return Err("[CANCELLED] Permintaan dibatalkan; receipt dipertahankan.".into())}
            if state.turns>=state.budget.turns{return Err("[TURN_LIMIT] Anggaran putaran habis; checkpoint tersimpan.".into())}
            let ms=state.deadline_ms.saturating_sub(now_ms());
            if ms<1000{return Err("[TASK_DEADLINE] Waktu tugas habis; checkpoint tersimpan.".into())}
            if crate::references::context_size(&state.history)?>state.budget.context_bytes{return Err("[CONTEXT_LIMIT] Konteks terlalu besar; tidak dipotong atau dikirim ulang.".into())}
            if state.output_estimate>=state.budget.total_output_estimate{return Err("[OUTPUT_LIMIT] Anggaran keluaran kumulatif habis.".into())}
            let finalizing=state.final_only || state.turns>=state.budget.turns-state.budget.reserve_turns || state.calls>=state.budget.calls || ms<30_000 || state.no_progress>=2;
            let request_tools=if finalizing{&[][..]}else{tools};
            if finalizing && state.phase!="finalizing" {
                state.phase="finalizing".into();
                let instruction=if state.model_review.as_ref().is_some_and(|r|r.pending) {"Fase perbandingan visual: balas satu JSON sesuai kontrak decision/differences/unseen/recipe. Gunakan render dan referensi yang ada. Tidak ada tools; jangan mengklaim kemiripan 100%."} else {"Anggaran kerja memasuki cadangan finalisasi. Gunakan hasil/receipt yang ada. Jangan meminta atau menjalankan perubahan tambahan. Nyatakan hasil belum pasti dan pemeriksaan yang belum dilakukan. Untuk generator/editor, jawaban final tetap satu JSON recipe sesuai schema; jangan mengubah laporan parsial menjadi recipe sukses."};
                state.history.push(json!({"role":"system","content":instruction}));
            } else if !finalizing {state.phase="provider_request".into()}
            state.turns+=1; // Reserve before dispatch, including a failed or interrupted request.
            persist(state)?;
            let turn=request(&state.history,request_tools,(ms/1000).min(state.budget.request_seconds),output_tokens.min(state.budget.output_tokens))?;
            if cancelled(){return Err("[CANCELLED] Respons terlambat setelah pembatalan; tidak diterapkan.".into())}
            state.output_estimate+=turn.text.len().div_ceil(4)+turn.calls.iter().map(|c|c.arguments.len().div_ceil(4)).sum::<usize>();
            if turn.calls.is_empty(){
                if turn.text.trim().is_empty(){return Err("[PROTOCOL] Respons final provider kosong.".into())}
                state.error_category=None;state.phase="provider_finalized".into();state.final_text=Some(turn.text.clone());persist(state)?;return Ok(turn.text)
            }
            let new_calls=turn.calls.iter().filter(|c|!state.operations.contains_key(&c.id)).count();
            let reject=finalizing || state.calls+new_calls>state.budget.calls || state.deadline_ms.saturating_sub(now_ms())<30_000;
            // Admit the complete batch before any dispatch. Every call gets a result, including denials.
            state.pending=Some(turn.clone());state.phase="tool_execution".into();persist(state)?;
            let mut outputs=Vec::new();let mut progress=false;
            for call in &turn.calls {
                if cancelled(){return Err("[CANCELLED] Permintaan dibatalkan sebelum operasi berikutnya.".into())}
                if let Some(prior)=state.operations.get(&call.id){
                    if prior.call!=*call{return Err("[PROTOCOL] ID tool dipakai dengan input berbeda.".into())}
                    outputs.push(prior.output.clone().unwrap_or_else(||json!({"isError":true,"outcomeUnknown":true})));
                    continue
                }
                let arguments = serde_json::from_str::<Value>(&call.arguments).map(|v| v.to_string()).unwrap_or_else(|_| call.arguments.clone());
                let intent_hash=sha256_hex(format!("{}:{}",call.name,arguments).as_bytes());
                let repeated=state.operations.values().any(|o|o.intent_hash==intent_hash);
                let write=crate::studio::is_write(&call.name) || crate::mcp::is_write(&call.name);
                let uncertain=state.operations.values().any(|o|o.write && o.dispatched && o.output.as_ref().is_none_or(|v|v["outcomeUnknown"]==true));
                if reject || (uncertain && write) || !tools.iter().any(|t|t.wire_name==call.name) || (write && state.operations.values().any(|o| o.intent_hash == intent_hash && o.dispatched)){
                    outputs.push(json!({"isError":true,"notExecuted":true,"message":"Operasi tidak diterima: batas kerja, fase finalisasi, duplikasi write, atau tool tidak tersedia."}));
                    state.final_only=true;continue
                }
                state.calls+=1;
                state.operations.insert(call.id.clone(),Operation{call:call.clone(),intent_hash,write,output:None,dispatched:true});persist(state)?;
                let output=match execute(call) {
                    Ok(v)=>v,
                    Err(error) if error.contains("[TOOL_NOT_DISPATCHED]") => json!({"isError":true,"notExecuted":true,"message":error}),
                    Err(error)=>json!({"isError":true,"outcomeUnknown":write,"message":error})
                };
                if output["notExecuted"] == true { state.operations.get_mut(&call.id).unwrap().dispatched = false; }
                if output["message"].as_str().is_some_and(|v| v.contains("[NEEDS_EDIT]")) { state.final_only = true; }
                if write && output["outcomeUnknown"]==true {state.final_only=true;}
                if !repeated && output["isError"]!=true {progress=true}
                state.operations.get_mut(&call.id).unwrap().output=Some(output.clone());
                outputs.push(output);persist(state)?;
            }
            turn.append_results(&state.adapter,&mut state.history,&outputs);state.pending=None;
            if progress{state.no_progress=0}else{state.no_progress+=1}
            persist(state)?;
        }
    })();
    if let Err(error)=&result {state.error_category=Some(category(error).into());state.phase="awaiting_continuation".into();persist(state)?}
    result
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::cell::Cell;
    fn profile() -> AiProviderProfile {
        serde_json::from_value(json!({"id":"account-fixture","name":"HTTP fixture","providerType":"openai-compatible","baseUrl":"http://127.0.0.1:43210/v1","model":"selected-model","reasoningEffort":null,"keyReference":"fixture","isDefault":true,"createdAt":"1","updatedAt":"1"})).unwrap()
    }
    fn checkpoint() -> Checkpoint { Checkpoint::new(&profile(), &[json!({"role":"user","content":"inspect then report"})], Budget::for_task(true,false)) }
    fn turn(text: &str, calls: Vec<ToolCall>) -> Turn { serde_json::from_value(json!({"text":text,"calls":calls,"native_output":[]})).unwrap() }
    fn call(id: &str, write: bool, n: usize) -> ToolCall { ToolCall { id:id.into(), name: if write {"forgekit_studio_execute_luau"} else {"forgekit_map_search"}.into(), arguments: json!({"fixture":n}).to_string() } }
    fn definitions() -> Vec<ToolDefinition> {
        let mut defs = crate::tools::definitions();
        defs.push(ToolDefinition {name:"execute_luau".into(),wire_name:"forgekit_studio_execute_luau".into(),description:"fixture write".into(),input_schema:json!({}),strict:false}); defs
    }
    #[test]
    fn model3d_request_uses_longer_bounded_budget_without_replaying_timeouts() {
        let budget = Budget::for_model3d(false, "high");
        assert_eq!(budget.request_seconds, 600);
        assert_eq!(budget.duration_ms, 1_200_000);
        assert_eq!(budget.output_tokens, 24576);
        assert_eq!(Budget::for_task(false, false).request_seconds, 120);
        let mut cp = Checkpoint::new(&profile(), &[], budget);
        let requests = Cell::new(0);
        let result = run(&mut cp, &[], 24576, |_, _, seconds, tokens| {
            requests.set(requests.get() + 1);
            assert_eq!(seconds, 600);
            assert_eq!(tokens, 24576);
            Err("[REQUEST_TIMEOUT] fixture".into())
        }, |_| panic!("No tool should run"), |_| Ok(()), || false);
        assert!(result.is_err());
        assert_eq!(requests.get(), 1);
        assert_eq!(cp.error_category.as_deref(), Some("request_timeout"));
        assert!(cp.final_text.is_none());
    }
    #[test]
    fn account_switch_requires_rejected_request_without_candidate_or_effects() {
        let mut cp = checkpoint();
        cp.error_category = Some("provider_rate_limit".into());
        cp.turns = 1;
        let mut next = profile(); next.id = "next-account".into();
        cp.switch_account(&next).unwrap();
        assert_eq!(cp.fingerprint, fingerprint(&next));
        assert_eq!(cp.turns, 1);
        for category in ["request_timeout", "cancelled", "authentication", "unknown_result"] {
            let mut rejected = checkpoint(); rejected.error_category = Some(category.into());
            assert!(rejected.switch_account(&next).is_err());
        }
        let mut partial = checkpoint(); partial.error_category = Some("provider_rate_limit".into()); partial.output_estimate = 1;
        assert!(partial.switch_account(&next).is_err());
        partial.output_estimate = 0; partial.final_text = Some("candidate".into());
        assert!(partial.switch_account(&next).is_err());
    }

    #[test]
    fn image_bytes_do_not_consume_the_text_context_budget_or_disable_recovery() {
        let mut state=checkpoint();
        state.history=vec![json!({"role":"user","content":[{"type":"input_text","text":"reference"},{"type":"input_image","image_url":format!("data:image/png;base64,{}","A".repeat(300000)),"detail":"high"}]})];
        let mut requested=false;
        run(&mut state,&[],32,|_,_,_,_|{requested=true;Ok(turn("ok",vec![]))},|_|panic!(),|_|Ok(()),||false).unwrap();
        assert!(requested);
    }

    #[test]
    fn five_and_seven_tool_turns_reach_final_without_losing_transcript() {
        for count in [5,7] {
            let mut cp=checkpoint(); let requests=Cell::new(0); let effects=Cell::new(0);
            let text=run(&mut cp,&definitions(),512,|history,_,_,_| {
                let n=requests.get(); requests.set(n+1);
                assert_eq!(history.iter().filter(|m|m["role"]=="tool").count(),n);
                Ok(if n<count {turn("",vec![call(&format!("r{n}"),false,n)])} else {turn("Observed fixture result",vec![])})
            }, |_|{effects.set(effects.get()+1); Ok(json!({"found":true}))}, |_|Ok(()), ||false).unwrap();
            assert_eq!(text,"Observed fixture result"); assert_eq!(cp.turns,count+1); assert_eq!(cp.calls,count); assert_eq!(effects.get(),count);
        }
    }
    #[test]
    fn batch_admission_rejects_entire_oversize_batch_and_accounts_every_result() {
        let mut cp=checkpoint();cp.budget.calls=1;let requests=Cell::new(0);
        run(&mut cp,&definitions(),512,|history,tools,_,_| {
            let n=requests.get();requests.set(n+1);
            if n==0 {Ok(turn("",vec![call("a",false,1),call("b",false,2)]))} else {
                assert!(tools.is_empty());assert_eq!(history.iter().filter(|m|m["role"]=="tool").count(),2);Ok(turn("Batch not executed",vec![]))
            }
        }, |_|panic!("batch must not execute"), |_|Ok(()), ||false).unwrap();
        assert_eq!(cp.calls,0);assert_eq!(cp.turns,2);
    }
    #[test]
    fn completed_writes_then_failed_final_resume_never_writes_again_even_new_ids() {
        let mut cp=checkpoint();let requests=Cell::new(0);let effects=Cell::new(0);
        assert!(run(&mut cp,&definitions(),512,|_,_,_,_| {
            requests.set(requests.get()+1);
            if requests.get()==1 {Ok(turn("",vec![call("w1",true,1),call("w2",true,2)]))} else {Err("[UNKNOWN_RESULT] Final response disconnected".into())}
        }, |_|{effects.set(effects.get()+1);Ok(json!({"completed":true}))}, |_|Ok(()), ||false).is_err());
        assert_eq!(effects.get(),2);assert_eq!(cp.recovery()["hasEffects"],true);
        let mut restored: Checkpoint=serde_json::from_str(&serde_json::to_string(&cp).unwrap()).unwrap();
        restored.final_only=true;let round=Cell::new(0);
        run(&mut restored,&definitions(),512,|_,tools,_,_| {
            assert!(tools.is_empty());round.set(round.get()+1);
            Ok(if round.get()==1 {turn("",vec![call("new-id",true,1)])} else {turn("Two operations recorded, read-back not checked",vec![])})
        }, |_|panic!("resume must never replay writes"), |_|Ok(()), ||false).unwrap();
        assert_eq!(restored.calls,2);assert_eq!(restored.turns,4);assert_eq!(restored.validation,"not_checked");
    }
    #[test]
    fn write_intent_survives_new_call_id_and_json_formatting() {
        let mut cp = checkpoint();
        let requests = Cell::new(0);
        let effects = Cell::new(0);
        run(&mut cp, &definitions(), 512, |_, _, _, _| {
            let n = requests.get(); requests.set(n + 1);
            Ok(if n < 2 {
                let mut c = call(if n == 0 {"first"} else {"new-id"}, true, 1);
                c.arguments = if n == 0 { r#"{"a":1,"b":2}"# } else { "{ \"b\": 2, \"a\": 1 }" }.into();
                turn("", vec![c])
            } else { turn("One write recorded; duplicate rejected", vec![]) })
        }, |_| {effects.set(effects.get()+1); Ok(json!({"completed":true}))}, |_| Ok(()), || false).unwrap();
        assert_eq!(effects.get(), 1);
        assert_eq!(cp.calls, 1);
    }
    #[test]
    fn known_pre_dispatch_failure_has_no_effect_and_same_intent_can_retry() {
        let mut cp = checkpoint();
        let requests = Cell::new(0);
        let attempts = Cell::new(0);
        run(&mut cp, &definitions(), 512,
            |_, _, _, _| {
                let n = requests.get(); requests.set(n + 1);
                Ok(if n < 2 { turn("", vec![call(&format!("retry{n}"), true, 1)]) }
                    else { turn("Write recorded after known non-dispatch", vec![]) })
            },
            |_| {
                attempts.set(attempts.get() + 1);
                if attempts.get() == 1 { Err("[TOOL_NOT_DISPATCHED] busy before dispatch".into()) }
                else { Ok(json!({"completed":true})) }
            },
            |state| {
                if state.operations.len() == 1 && state.operations.values().next().unwrap().output.is_some() {
                    assert_eq!(state.recovery()["hasEffects"], false);
                    assert_eq!(state.recovery()["hasUnknownEffects"], false);
                }
                Ok(())
            }, || false).unwrap();
        assert_eq!(attempts.get(), 2);
        assert_eq!(cp.calls, 2);
        assert_eq!(cp.operations.values().filter(|o| o.dispatched).count(), 1);
        assert_eq!(cp.recovery()["hasEffects"], true);
        assert_eq!(cp.recovery()["hasUnknownEffects"], false);
    }
    #[test]
    fn unknown_write_blocks_later_write_in_same_batch() {
        let mut cp=checkpoint();let requests=Cell::new(0);let effects=Cell::new(0);
        run(&mut cp,&definitions(),512,|_,_,_,_|{ requests.set(requests.get()+1);Ok(if requests.get()==1{turn("",vec![call("a",true,1),call("b",true,2)])}else{turn("Outcome unknown",vec![])})}, |_|{effects.set(effects.get()+1);Err("tool timeout".into())}, |_|Ok(()), ||false).unwrap();
        assert_eq!(effects.get(),1);assert_eq!(cp.recovery()["hasUnknownEffects"],true);assert_eq!(cp.validation,"not_checked");
    }
    #[test]
    fn crash_after_dispatch_reconstructs_pending_results_without_replay() {
        let mut cp=checkpoint();let c=call("unknown",true,1);
        cp.pending=Some(turn("",vec![c.clone()]));cp.operations.insert(c.id.clone(),Operation{call:c,intent_hash:"intent".into(),write:true,output:None,dispatched:true});cp.calls=1;
        run(&mut cp,&definitions(),512,|history,tools,_,_|{assert!(tools.is_empty());assert!(history.iter().any(|v|v["role"]=="tool"&&v["content"].as_str().unwrap().contains("outcomeUnknown")));Ok(turn("Cannot verify",vec![]))}, |_|panic!("no replay"), |_|Ok(()), ||false).unwrap();
        assert_eq!(cp.recovery()["hasUnknownEffects"],true);
    }
    #[test]
    fn limits_have_distinct_reasons_and_no_implicit_reset() {
        for expected in ["task_deadline","turn_limit","context_limit","output_limit"] {
            let mut cp=checkpoint();match expected {"task_deadline"=>cp.deadline_ms=0,"turn_limit"=>cp.turns=cp.budget.turns,"context_limit"=>cp.budget.context_bytes=1,_=>cp.output_estimate=cp.budget.total_output_estimate};
            assert!(run(&mut cp,&[],512,|_,_,_,_|panic!("no request"), |_|panic!("no tool"), |_|Ok(()), ||false).is_err());assert_eq!(cp.error_category.as_deref(),Some(expected));
        }
    }
    #[test]
    fn repeated_unchanged_observations_force_finalization() {
        let mut cp=checkpoint();let requests=Cell::new(0);let effects=Cell::new(0);
        run(&mut cp,&definitions(),512,|_,tools,_,_|{let n=requests.get();requests.set(n+1);Ok(if n<3{turn("",vec![call(&format!("r{n}"),false,1)])}else{assert!(tools.is_empty());turn("No new evidence",vec![])})}, |_|{effects.set(effects.get()+1);Ok(json!({"unchanged":true}))}, |_|Ok(()), ||false).unwrap();
        assert_eq!(requests.get(),4);assert_eq!(cp.no_progress,2);
    }
    #[test]
    fn cancel_during_final_request_and_storage_failure_never_commit_or_dispatch() {
        let mut cp=checkpoint();let cancelled=Cell::new(false);
        assert!(run(&mut cp,&[],512,|_,_,_,_|{cancelled.set(true);Ok(turn("Late result",vec![]))}, |_|panic!("no tool"), |_|Ok(()), ||cancelled.get()).is_err());assert!(cp.final_text.is_none());assert_eq!(cp.error_category.as_deref(),Some("cancelled"));
        let mut cp=checkpoint();
        assert!(run(&mut cp,&[],512,|_,_,_,_|panic!("must persist before request"), |_|panic!("no tool"), |_|Err("[STORAGE] disk full".into()), ||false).is_err());
    }
    #[test]
    fn identity_includes_account_model_effort_and_profile_revision() {
        let p=profile();let hash=fingerprint(&p);
        for field in ["account","model","effort","revision"] { let mut changed=p.clone();match field {"account"=>changed.id="other".into(),"model"=>changed.model="other".into(),"effort"=>changed.reasoning_effort=Some("high".into()),_=>changed.updated_at="2".into()};assert_ne!(hash,fingerprint(&changed)); }
    }
}
