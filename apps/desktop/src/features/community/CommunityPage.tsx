import { useState } from 'react';
import type { CommunityItem } from '@forgekit/contracts';
import { Icon } from '../../design-system/Icon';

const sampleCommunityItems: CommunityItem[] = [
  { id: 'com-1', title: 'Paket Pohon Low-Poly Hutan', description: '6 variasi pohon pinus dan cemara teroptimasi untuk performa game tinggi.', kind: 'model3d', author: 'BuilderProID', downloads: 3420, rating: 4.9, license: 'CC-BY-4.0', tags: ['nature', 'trees', 'lowpoly'], createdAt: '2026-10-24' },
  { id: 'com-2', title: 'Tekstur Dinding Batu Kastil', description: 'PBR Seamless 1024px material batu kastil kuno dengan normal map tajam.', kind: 'texture', author: 'TextureAlchemist', downloads: 2150, rating: 4.8, license: 'MIT', tags: ['castle', 'pbr', 'stone'], createdAt: '2026-10-25' },
  { id: 'com-3', title: 'Efek Suara Langkah Kaki Rumput', description: 'Kompilasi 8 variasi suara tapak kaki di rumput basah berdurasi 0.3 detik.', kind: 'audio', author: 'AudioFoleyStudio', downloads: 1890, rating: 4.7, license: 'CC0', tags: ['footsteps', 'sfx', 'grass'], createdAt: '2026-10-26' },
  { id: 'com-4', title: 'Partikel Semburan Sihir Api', description: 'Preset ParticleEmitter Roblox Studio dengan gradasi warna api menyala.', kind: 'vfx', author: 'VFXWizard', downloads: 4120, rating: 5.0, license: 'CC-BY-4.0', tags: ['fire', 'magic', 'vfx'], createdAt: '2026-10-27' },
];

export function CommunityPage() {
  const [items] = useState<CommunityItem[]>(sampleCommunityItems);
  const [search, setSearch] = useState('');
  const [filterKind, setFilterKind] = useState<string>('all');
  const [importedIds, setImportedIds] = useState<Set<string>>(new Set());

  const filtered = items.filter((item) => {
    const matchKind = filterKind === 'all' || item.kind === filterKind;
    const matchSearch = item.title.toLowerCase().includes(search.toLowerCase()) || item.tags.some((t) => t.includes(search.toLowerCase()));
    return matchKind && matchSearch;
  });

  const handleImport = (id: string) => {
    setImportedIds((prev) => new Set(prev).add(id));
  };

  return (
    <div className="catalog-page">
      <header className="catalog-heading">
        <p className="eyebrow">PUSTAKA KOMUNITAS</p>
        <h1>Jelajahi Karya Kreator Roblox</h1>
        <p>Aset 3D, tekstur, audio, dan efek visual dengan atribusi lisensi yang jelas.</p>
      </header>

      <div className="catalog-filter-row">
        <div className="category-filters" role="group" aria-label="Filter kategori">
          <button type="button" aria-pressed={filterKind === 'all'} onClick={() => setFilterKind('all')}>Semua</button>
          <button type="button" aria-pressed={filterKind === 'model3d'} onClick={() => setFilterKind('model3d')}>Model 3D</button>
          <button type="button" aria-pressed={filterKind === 'texture'} onClick={() => setFilterKind('texture')}>Tekstur</button>
          <button type="button" aria-pressed={filterKind === 'audio'} onClick={() => setFilterKind('audio')}>Audio SFX</button>
          <button type="button" aria-pressed={filterKind === 'vfx'} onClick={() => setFilterKind('vfx')}>VFX</button>
        </div>
        <label className="catalog-search">
          <Icon name="search" />
          <input
            placeholder="Cari aset komunitas..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </label>
      </div>

      <div className="feature-grid">
        {filtered.map((item) => {
          const isImported = importedIds.has(item.id);
          return (
            <div key={item.id} className="feature-card community-card">
              <div className="feature-card-top">
                <span className="feature-icon is-ready">
                  <Icon name={item.kind === 'model3d' ? 'cube' : item.kind === 'texture' ? 'layers' : item.kind === 'audio' ? 'wave' : 'spark'} />
                </span>
                <span className="small-tag">{item.license}</span>
              </div>
              <h2>{item.title}</h2>
              <p>{item.description}</p>
              <div className="community-meta-row">
                <span>Oleh: <strong>{item.author}</strong></span>
                <span>★ {item.rating.toFixed(1)} ({item.downloads.toLocaleString()} unduhan)</span>
              </div>
              <div className="community-action-row">
                <button
                  type="button"
                  className={`button ${isImported ? 'secondary-button' : 'primary-button'} btn-sm btn-full`}
                  onClick={() => handleImport(item.id)}
                  disabled={isImported}
                >
                  <Icon name={isImported ? 'check' : 'download'} />
                  <span>{isImported ? 'Tersimpan di Koleksi' : 'Impor ke Ruang Kerja'}</span>
                </button>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
