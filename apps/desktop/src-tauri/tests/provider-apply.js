// Uses existing saved live-provider artifacts and only the isolated acceptance map.
window.addEventListener('DOMContentLoaded', async () => {
 const invoke=(name,args={})=>window.__TAURI_INTERNALS__.invoke(name,args);
 const report={phase:'provider-apply',native:true,providerLive:true,studioLive:true,isolatedData:true,checks:[]};
 try {
  const provider=(await invoke('list_ai_providers')).find(p=>p.isDefault);
  const account=(await invoke('list_connection_profiles')).find(p=>p.id===provider.id);
  const connection=await invoke('test_connection_profile',{profile:account});
  if(!connection.ok) throw Error('Explicit connection test failed');
  let probe;
  for(let attempt=0;attempt<60;attempt++) {
    try {probe=await invoke('probe_studio');break;}
    catch(error) {if(!String(error).includes('masih berjalan') || attempt===59) throw error;await new Promise(resolve=>setTimeout(resolve,500));}
  }
  const target=probe.studios.find(s=>s.name==='ForgeKitAcceptance.rbxlx');
  if(!target || probe.studios.length!==1) throw Error('Requires one isolated ForgeKitAcceptance.rbxlx map');
  for(const kind of ['model3d','interface','npc','cutscene']) {
   try {
    const version=(await invoke('list_creative_versions',{kind}))[0];
    if(!version) throw Error('No saved provider artifact');
    const title='Apply acceptance v2 '+kind+' '+version.id;
    let thread=(await invoke('list_chat_threads')).find(t=>t.title===title);
    let task;
    if(thread) {
      task=await invoke('latest_chat_turn',{threadId:thread.id});
      if(!task || task.status!=='completed') throw Error('Previous apply needs inspection; never replay writes blindly');
    } else {
      thread=await invoke('create_chat_thread',{title,providerId:provider.id,model:provider.model,systemPrompt:null});
      const id=crypto.randomUUID();
      report.checks.push({kind,versionId:version.id,taskId:id,threadId:thread.id});
      const message=await invoke('send_chat_message',{threadId:thread.id,requestId:id,provider,mode:'auto',studioId:target.studioId,creativeVersionId:version.id,userContent:`Terapkan hasil ${kind} tersimpan ke map uji ini. Buat root terpisah sesuai recipe. Jangan ubah atau hapus objek fixture atau hasil sebelumnya. Model gunakan koordinat recipe; untuk cone gunakan tessellasi native bersegi dengan batas ukuran yang sama, aproksimasi ini diizinkan; GUI gunakan StarterGui; NPC buat karakter dialog terpisah di Workspace. Cutscene gunakan StarterPlayerScripts. Baca ulang root dan parent setelah write. Laporkan batas runtime dengan jujur.`});
      task=await invoke('get_creative_task',{id});
      Object.assign(report.checks.find(c=>c.kind===kind),{final:message.content,task});
    }
    if(!report.checks.some(c=>c.kind===kind)) report.checks.push({kind,versionId:version.id,taskId:task.id,task,reused:true});
    if(task.provider.profileId!==provider.id || task.provider.modelId!==provider.model) throw Error('Provider identity changed');
    if(task.status!=='completed') throw Error('Not completed');
    const writes=(task.toolResults||[]).filter(t=>t.readOnly===false && t.status==='completed');
    if(!writes.length) throw Error('No completed Studio write; inspect final question or blocker');
    const check=report.checks.find(c=>c.kind===kind); check.taskCompleted=true; check.ok=false; check.requiresIndependentReadBack=true; check.note='Completed IPC/receipts alone do not prove the artifact was installed; match sourceVersionId and properties independently in Studio.';
   } catch(error) { const item=report.checks.find(c=>c.kind===kind);if(item){item.ok=false;item.error=String(error.message||error);}else report.checks.push({kind,ok:false,error:String(error.message||error)}); }
   await invoke('record_runtime_acceptance',{result:{...report,checkpoint:kind}});
  }
  report.ok=report.checks.every(c=>c.ok);
 } catch(error) {report.ok=false;report.error=String(error.message||error);}
 await invoke('record_runtime_acceptance',{result:report});
});
