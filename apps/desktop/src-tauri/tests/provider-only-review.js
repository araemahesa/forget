window.addEventListener('DOMContentLoaded', () => {
  setTimeout(async () => {
    const invoke = (name, args={}) => window.__TAURI_INTERNALS__.invoke(name,args);
    const result = {checkpoint:'review-ready', native:true, liveDataReview:true, account:'ForgeKit primary (redacted)'};
    try {
      const provider=(await invoke('list_ai_providers')).find(p=>p.isDefault);
      const usage=await invoke('get_provider_usage',{profileId:provider.id});
      const {profileId, ...safeUsage}=usage;
      result.usage=safeUsage;
    } catch(error) { result.usageError=error.message||String(error); }
    await window.__TAURI_INTERNALS__.invoke('record_runtime_acceptance', {result});
  }, 3500);
});
