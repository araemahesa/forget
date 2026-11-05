const stages: Record<string, string> = {
  planning: 'Menyiapkan model dan skills', reading_context: 'Membaca konteks',
  preparing: 'Menyiapkan model dan skills', provider_request: 'Model menyusun geometri',
  repairing: 'Model memperbaiki recipe', finalizing: 'Memeriksa recipe model',
  awaiting_continuation: 'Menunggu kelanjutan model', provider_finalized: 'Menyiapkan Blender',
  streaming: 'Model menyusun geometri', requesting: 'Model menyusun geometri',
  building: 'Blender membentuk geometri', previewing: 'Menyiapkan pratinjau Blender',
  rendering: 'Blender menyiapkan render dan file', comparing_reference: 'Model memeriksa kemiripan referensi',
  refining_reference: 'Model memperbaiki bentuk dan detail', reference_checked: 'Pemeriksaan referensi selesai',
  validating: 'Memeriksa hasil', saving: 'Menyimpan model Blender',
};
export function ModelBuildOverlay({ phase, hasModel, stopping, provider, builtParts, totalParts }: {
  phase: string; hasModel: boolean; stopping?: boolean; provider?: string; builtParts?: number; totalParts?: number;
}) {
  const counted = phase === 'building' && Number.isInteger(builtParts) && Number.isInteger(totalParts) && totalParts! > 0 && builtParts! >= 0 && builtParts! <= totalParts!;
  return <div className={`model-build-overlay${hasModel ? ' has-model' : ''}`}>
    {!hasModel && <div className="model-build-orbits" aria-hidden="true"><i /><i /><i /><span /></div>}
    {hasModel && <div className="model-build-scan" aria-hidden="true" />}
    <div className="model-build-status" role="status" aria-live="polite">
      <span className="model-build-dot" aria-hidden="true" />
      <div><strong>{stopping ? 'Menghentikan proses…' : stages[phase] ?? 'Model sedang bekerja'}</strong>
        <small>{hasModel ? 'Kandidat Blender · pemeriksaan belum selesai' : 'Pratinjau muncul setelah geometri Blender tersedia'}{counted ? ` · ${builtParts}/${totalParts} komponen` : ''}</small>
        {provider && <small className="model-build-provider">{provider}</small>}
      </div>
    </div>
  </div>;
}
