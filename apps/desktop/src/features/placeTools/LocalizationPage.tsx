import { Dropdown } from '../../design-system/Dropdown';
import { useState } from 'react';
import type { LocalizationRecipe } from '@forgekit/contracts';
import { validateLocalizationRecipe } from '@forgekit/contracts';
import { Icon } from '../../design-system/Icon';

const initialRecipe: LocalizationRecipe = {
  tableName: 'TabelUtamaGame',
  sourceLocale: 'id',
  targetLocales: ['en', 'es', 'ja'],
  entries: [
    { key: 'UI_WELCOME', context: 'Main Menu', sourceText: 'Selamat datang di petualangan!', translations: { en: 'Welcome to the adventure!', es: '¡Bienvenido a la aventura!', ja: '冒険へようこそ！' } },
    { key: 'UI_PLAY', context: 'Button', sourceText: 'Mulai Bermain', translations: { en: 'Play Now', es: 'Jugar Ahora', ja: '今すぐプレイ' } },
    { key: 'UI_SHOP', context: 'Button', sourceText: 'Toko Perlengkapan', translations: { en: 'Item Shop', es: 'Tienda de Objetos', ja: 'アイテムショップ' } },
  ],
};

export function LocalizationPage() {
  const [recipe, setRecipe] = useState<LocalizationRecipe>(initialRecipe);
  const [newKey, setNewKey] = useState('');
  const [newSource, setNewSource] = useState('');

  const errors = validateLocalizationRecipe(recipe);

  const addEntry = () => {
    if (!newKey.trim() || !newSource.trim()) return;
    setRecipe({
      ...recipe,
      entries: [
        ...recipe.entries,
        { key: newKey.trim(), context: 'General', sourceText: newSource.trim(), translations: {} },
      ],
    });
    setNewKey('');
    setNewSource('');
  };

  const removeEntry = (idx: number) => {
    setRecipe({
      ...recipe,
      entries: recipe.entries.filter((_, i) => i !== idx),
    });
  };

  return (
    <div className="creator-layout">
      <div className="creator-sidebar">
        <div className="section-title">
          <Icon name="world" />
          <h2>Lokalisasi Bahasa</h2>
        </div>
        <p className="section-desc">Kelola tabel terjemahan Roblox LocalizationTable untuk menjangkau pemain global.</p>

        <div className="form-group">
          <label htmlFor="loc-table-name">Nama Tabel</label>
          <input
            id="loc-table-name"
            className="text-input"
            value={recipe.tableName}
            onChange={(e) => setRecipe({ ...recipe, tableName: e.target.value })}
          />
        </div>

        <div className="form-group">
          <label htmlFor="loc-source-locale">Bahasa Sumber</label>
          <Dropdown
            id="loc-source-locale"
            className="select-input"
            value={recipe.sourceLocale}
            onChange={(e) => setRecipe({ ...recipe, sourceLocale: e.target.value })}
          >
            <option value="id">Bahasa Indonesia (id)</option>
            <option value="en">English (en)</option>
          </Dropdown>
        </div>

        <div className="form-group">
          <label>Tambah String Baru</label>
          <input
            className="text-input"
            placeholder="Key (contoh: UI_QUEST_TITLE)"
            value={newKey}
            onChange={(e) => setNewKey(e.target.value)}
          />
          <input
            className="text-input"
            style={{ marginTop: '8px' }}
            placeholder="Teks Bahasa Sumber"
            value={newSource}
            onChange={(e) => setNewSource(e.target.value)}
          />
          <button
            className="button secondary-button btn-full"
            style={{ marginTop: '8px' }}
            onClick={addEntry}
            type="button"
          >
            <Icon name="plus" />
            <span>Tambah String</span>
          </button>
        </div>

        {errors.length > 0 && (
          <div className="alert alert-error">
            <Icon name="alert" />
            <span>{errors[0].message}</span>
          </div>
        )}
      </div>

      <div className="creator-preview-pane">
        <div className="preview-card">
          <div className="preview-header">
            <span className="preview-title">Tabel Terjemahan ({recipe.entries.length} entri)</span>
            <span className="small-tag">{recipe.targetLocales.join(', ').toUpperCase()}</span>
          </div>

          <div className="table-container">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Key</th>
                  <th>Sumber ({recipe.sourceLocale})</th>
                  <th>English (en)</th>
                  <th>Aksi</th>
                </tr>
              </thead>
              <tbody>
                {recipe.entries.map((entry, idx) => (
                  <tr key={entry.key}>
                    <td><code>{entry.key}</code></td>
                    <td>{entry.sourceText}</td>
                    <td>{entry.translations.en || <span className="text-muted">Belum ada terjemahan</span>}</td>
                    <td>
                      <button className="button-icon-subtle" onClick={() => removeEntry(idx)} type="button" aria-label="Hapus entri">
                        <Icon name="close" />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  );
}
