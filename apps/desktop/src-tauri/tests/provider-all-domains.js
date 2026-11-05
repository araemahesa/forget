// Opt-in live provider acceptance. Isolated DB/artifacts; never publishes or touches user works.
window.addEventListener('DOMContentLoaded', async () => {
  const invoke=(name,args={})=>window.__TAURI_INTERNALS__.invoke(name,args);
  const report={phase:'provider-all-domains',native:true,providerLive:true,studioLive:false,isolatedData:true,checks:[]};
  try {
    const provider=(await invoke('list_ai_providers')).find(p=>p.isDefault);
    if(!provider) throw Error('No selected ForgeKit-owned provider');
    const account=(await invoke('list_connection_profiles')).find(p=>p.id===provider.id);
    if(!account) throw Error('Saved ForgeKit account missing');
    const connection=await invoke('test_connection_profile',{profile:account});
    if(!connection.ok) throw Error('Explicit live connection test failed: '+connection.message);
    const identity={profileId:provider.id,modelId:provider.model,reasoningEffort:provider.reasoningEffort};
    const cases=[
      ['model3d','Buat gerbang fantasy dari parts, lebar bukaan 12 tinggi 16 studs. Dua pilar simetris dan satu lintel, warna batu gelap dengan trim merah. Geometri harus dapat diekspor, bukan klaim mesh AI.'],
      ['animation','Buat animasi R15 mengangkat tangan kanan lalu kembali netral dalam dua detik, keyframe waktu terurut dan rotasi quaternion valid.'],
      ['vfx','Buat efek angin lembut dengan gerak, transparansi fade dan kepadatan rendah. Gunakan recipe VFX valid untuk Roblox, maksimum 24 partikel per detik.'],
      ['material','Buat material batu gelap berurat merah halus, texture tileable dengan ukuran valid. Gunakan parameter engine yang tersedia.'],
      ['interface','Buat GUI inventory dengan judul Persediaan, tiga slot dan tombol Tutup. Hierarki, anchor, bounds dan label jelas.'],
      ['npc','Buat dialog penjaga gerbang: salam, pilihan minta izin dan keluar, transisi valid tanpa loop otomatis. Bahasa Indonesia.'],
      ['cutscene','Buat cutscene kamera empat detik, tiga keyframe menuju gerbang dari jauh ke dekat dengan timing terurut.'],
      ['music','Buat melodi fantasy pelan empat bar, nada dalam rentang aman, tempo 80 BPM dengan gain tanpa clipping. Gunakan sintesis engine, bukan rekaman.'],
      ['sky','Buat langit senja hangat, horizon lebih terang dan zenith ungu gelap. Nilai warna dan intensitas harus valid.'],
      ['gfx','Buat thumbnail 640x360 berjudul ForgeKit Acceptance, subtitle Native, background gelap dan aksen merah.'],
      ['icon','Buat ikon pedang merah dengan background gelap, ukuran dan glyph sesuai schema engine.'],
      ['clothing','Buat pakaian Roblox merah gelap dengan detail garis emas dan schema template yang valid.'],
      ['texture','Buat tekstur batu gelap berurat merah, ukuran yang didukung engine dan parameter tileable valid.'],
      ['sfx','Buat suara pintu magic lembut berdurasi satu detik dengan fade in/out dan gain aman. Gunakan sintesis engine.'],
    ];
    for(const [kind,prompt] of cases) {
      const taskId=crypto.randomUUID();
      try {
        let result;
        if(['gfx','icon','clothing','texture','sfx'].includes(kind)) {
          result=await invoke('generate_editor_recipe',{taskId,kind,prompt,providerId:provider.id,modelId:provider.model,reasoningEffort:provider.reasoningEffort,currentSpec:null});
          if(!result.spec || result.source!=='ai') throw Error('No validated editor spec');
        } else {
          result=await invoke('generate_creative',{request:{taskId,kind,prompt,quality:'high',providerId:provider.id,modelId:provider.model,reasoningEffort:provider.reasoningEffort,parentVersionId:null}});
          if(result.document?.kind!==kind || !result.artifact?.sha256) throw Error('No persisted engine artifact');
        }
        const task=await invoke('get_creative_task',{id:taskId});
        if(task.activity?.type!=='final' || task.status!=='completed' && task.status!=='preview_ready') throw Error('Task is not durably final');
        if(task.provider.profileId!==identity.profileId || task.provider.modelId!==identity.modelId) throw Error('Provider identity changed');
        report.checks.push({kind,taskId,ok:true,result,provider:task.provider,activity:task.activity});
      } catch(error) {report.checks.push({kind,taskId,ok:false,error:String(error.message||error)});}
      await invoke('record_runtime_acceptance',{result:{...report,checkpoint:kind}});
    }
    report.ok=report.checks.every(c=>c.ok);
  } catch(error) {report.ok=false;report.error=String(error.message||error);}
  await invoke('record_runtime_acceptance',{result:report});
});
