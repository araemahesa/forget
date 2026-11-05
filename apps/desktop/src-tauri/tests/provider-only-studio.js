// Explicit isolated new Place1/baseplate acceptance. No published map or other target.
window.addEventListener('DOMContentLoaded', async () => {
  const invoke = (name,args={}) => window.__TAURI_INTERNALS__.invoke(name,args);
  const report={phase:'provider-only-studio',native:true,providerLive:true,studioLive:true,isolatedData:true};
  try {
    const provider=(await invoke('list_ai_providers')).find(p=>p.isDefault);
    const account=(await invoke('list_connection_profiles')).find(p=>p.id===provider.id);
    if(!account) throw Error('Saved ForgeKit account missing');
    const connection=await invoke('test_connection_profile',{profile:account});
    if(!connection.ok) throw Error('Explicit live connection test failed: '+connection.message);
    let probe;
    for(let attempt=0;attempt<15;attempt++) {
      try { probe=await invoke('probe_studio'); break; }
      catch(error) {
        if(attempt===14 || !String(error.message||error).includes('masih berjalan')) throw error;
        await new Promise(resolve=>setTimeout(resolve,1000));
      }
    }
    const target=probe.studios.find(s=>s.name==='Place1');
    if(probe.studios.length!==1 || !target) throw Error('Requires exactly one newly created unpublished Place1 test map');
    report.studioId=target.studioId;
    const priorThread=(await invoke('list_chat_threads')).find(t=>t.title==='Wind test on new unpublished Place1 only');
    if(priorThread) {
      const previous=await invoke('latest_chat_turn',{threadId:priorThread.id});
      if(previous?.recovery?.hasUnknownEffects && previous.recovery.canVerify) {
        const writesBefore=(previous.toolResults||[]).filter(r=>!r.readOnly).length;
        await invoke('resume_ai_task',{id:previous.id,mode:'verify'});
        const after=await invoke('get_creative_task',{id:previous.id});
        const writesAfter=(after.toolResults||[]).filter(r=>!r.readOnly).length;
        if(writesAfter!==writesBefore) throw Error('Read-back continuation dispatched a write');
        report.previousTaskReadBack={taskId:previous.id,writesBefore,writesAfter,turnsBefore:previous.recovery.turnsUsed,turnsAfter:after.recovery.turnsUsed,segment:after.recovery.segment,response:after.candidate};
      }
    }

    const thread=await invoke('create_chat_thread',{title:'Wind test on new unpublished Place1 only',providerId:provider.id,model:provider.model});
    const requestId=crypto.randomUUID(); report.taskId=requestId;
    const prompt='Ini map uji baru Place1 yang belum dipublish (PlaceId 0), dibuat khusus acceptance ForgeKit. Periksa target terlebih dahulu. Buat efek angin berupa garis tipis bergerak halus saat Play, hanya pada map ini. Tambahkan tepat satu LocalScript bernama ForgeKitWindAcceptance pada StarterPlayer.StarterPlayerScripts. Jangan ubah script/objek lain dan jangan publish/upload. Gunakan engine Roblox bawaan tanpa aset/network eksternal. Saat runtime buat satu Folder Workspace bernama ForgeKitWindAcceptanceRuntime, isi maksimum 24 garis tipis/Beam berwarna lembut yang bergerak relatif kamera dengan deltaTime; simpan atribut TickCount yang bertambah tiap frame pada folder itu untuk verifikasi. Efek harus terlihat di dekat kamera/player, bukan jauh di origin. Hindari duplikasi dan gunakan ChangeHistoryService recording untuk penulisan. Baca kembali script dan lokasinya setelah menulis; laporkan batas verifikasi runtime secara jujur karena Anda hanya boleh Edit. Akhiri dengan ringkasan final singkat. Jangan minta saya mengetik ulang prompt. Semua perubahan hanya di map uji ini.';
    const message=await invoke('send_chat_message',{threadId:thread.id,userContent:prompt,provider,requestId,mode:'auto',studioId:target.studioId});
    const task=await invoke('get_creative_task',{id:requestId});
    report.status=task.status; report.recovery=task.recovery; report.response=message.content; report.receipts=task.toolResults;
    report.chatFinalized=task.status==='completed';
    report.runtimeVerified=false;
    if(task.status!=='completed') throw Error('Chat final not completed');
    if(task.recovery?.hasUnknownEffects) throw Error('Studio operation outcome unknown; requires independent read-back');
    if(!task.recovery?.hasEffects) throw Error('No Studio operations recorded; final response alone does not prove wind creation');
    if(task.recovery?.canVerify) {
      const writesBefore=(task.toolResults||[]).filter(r=>!r.readOnly).length;
      await invoke('resume_ai_task',{id:requestId,mode:'verify'});
      const after=await invoke('get_creative_task',{id:requestId});
      const writesAfter=(after.toolResults||[]).filter(r=>!r.readOnly).length;
      if(writesAfter!==writesBefore) throw Error('Post-creation read-back replayed a write');
      report.postCreationReadBack={writesBefore,writesAfter,turnsBefore:task.recovery.turnsUsed,turnsAfter:after.recovery.turnsUsed,segment:after.recovery.segment,response:after.candidate};
    }
    await invoke('record_runtime_acceptance',{result:{ok:true,...report}});
  }catch(error){await invoke('record_runtime_acceptance',{result:{ok:false,...report,error:error.message||String(error)}});}
});
