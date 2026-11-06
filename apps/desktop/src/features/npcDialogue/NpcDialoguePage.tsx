import { ThreeViewport } from '../create/ThreeViewport';
import { buildReferenceRig, disposeGeometry } from '../create/geometry';
import { StudioApply } from '../create/StudioApply';
import { useEffect, useMemo, useState } from 'react';
import type { DialogueNode, NpcDialogueRecipe } from '@forgekit/contracts';
import { validateNpcDialogueRecipe } from '@forgekit/contracts';
import { Icon } from '../../design-system/Icon';
import { CreativeControls } from '../create/CreativeControls';
import { useCreativeTask } from '../create/useCreativeTask';

const defaultRecipe: NpcDialogueRecipe = {
  npcName: 'Tetua Desa (Elder Sean)',
  initialNodeId: 'node_intro',
  nodes: [
    {
      id: 'node_intro',
      speaker: 'Elder Sean',
      text: 'Selamat datang di Desa Lembah Hijau. Ada yang bisa kubantu, penjelajah muda?',
      choices: [
        { text: 'Saya mencari ramuan penyembuh.', nextNodeId: 'node_quest' },
        { text: 'Hanya melihat-lihat sekeliling.', nextNodeId: 'node_bye' },
      ],
    },
    {
      id: 'node_quest',
      speaker: 'Elder Sean',
      text: 'Pergilah ke Hutan Terlarang dan temukan Bunga Bulan Biru. Bawakan untukku!',
      choices: [
        { text: 'Siap laksanakan!', nextNodeId: 'node_bye' },
      ],
    },
    {
      id: 'node_bye',
      speaker: 'Elder Sean',
      text: 'Hati-hatilah di jalanmu.',
      choices: [],
    },
  ],
};

function downloadJson(data: unknown, filename: string) {
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

export function NpcDialoguePage() {
  const task = useCreativeTask('npc');
  const rig = useMemo(() => buildReferenceRig('R15'), []);
  useEffect(() => () => disposeGeometry(rig.group), [rig]);
  const [recipe, setRecipe] = useState<NpcDialogueRecipe>(defaultRecipe);
  const [selectedNodeId, setSelectedNodeId] = useState<string>('node_intro');

  useEffect(() => {
    if (task.version?.document.kind === 'npc') {
      setRecipe(task.version.document.recipe);
      setSelectedNodeId(task.version.document.recipe.initialNodeId || task.version.document.recipe.nodes[0]?.id || 'node_intro');
    }
  }, [task.version]);

  const errors = validateNpcDialogueRecipe(recipe);
  const changed = !task.version || JSON.stringify(recipe) !== JSON.stringify(task.version.document.recipe);
  const activeNode = recipe.nodes.find((n) => n.id === selectedNodeId) || recipe.nodes[0];

  const updateNodeText = (text: string) => {
    setRecipe({
      ...recipe,
      nodes: recipe.nodes.map((n) => (n.id === selectedNodeId ? { ...n, text } : n)),
    });
  };

  const addNode = () => {
    const newId = `node_${Date.now()}`;
    const newNode: DialogueNode = {
      id: newId,
      speaker: recipe.npcName,
      text: 'Pesan dialog baru...',
      choices: [],
    };
    setRecipe({ ...recipe, nodes: [...recipe.nodes, newNode] });
    setSelectedNodeId(newId);
  };

  return (
    <section className="procedural-workspace">
      <div className="procedural-heading">
        <div>
          <h1>Karakter & Dialog (NPC)</h1>
          <p>Prompt menjadi graf percakapan bercabang dan skrip dialog interaktif untuk Roblox Studio.</p>
        </div>
        <span className="capability-note">Rig Roblox R15 · Dialog bercabang</span>
      </div>

      <div className="procedural-layout">
        <aside className="generator-inspector" aria-label="Kontrol Dialog NPC">
          <CreativeControls task={task} initialPrompt="Buat percakapan quest dengan tetua desa untuk mencari bunga langka." />

          <details>
            <summary>Editor lanjutan</summary>
            <div className="form-group" style={{ marginTop: '12px' }}>
              <label htmlFor="npc-name">Nama Karakter NPC</label>
              <input
                id="npc-name"
                className="text-input"
                value={recipe.npcName}
                onChange={(e) => setRecipe({ ...recipe, npcName: e.target.value })}
                disabled={task.busy}
              />
            </div>

            <div className="form-group">
              <div className="label-row" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <label>Node Percakapan ({recipe.nodes.length})</label>
                <button className="button secondary-button btn-sm" onClick={addNode} type="button" disabled={task.busy}>
                  + Node
                </button>
              </div>
              <div className="node-list" style={{ display: 'flex', flexDirection: 'column', gap: '4px', marginTop: '6px' }}>
                {recipe.nodes.map((node) => (
                  <button
                    key={node.id}
                    type="button"
                    className={`button secondary-button btn-sm ${node.id === selectedNodeId ? 'active' : ''}`}
                    style={{ textAlign: 'left', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}
                    onClick={() => setSelectedNodeId(node.id)}
                  >
                    <span>{node.speaker}: {node.text.slice(0, 24)}…</span>
                  </button>
                ))}
              </div>
            </div>

            {activeNode && (
              <div className="form-group">
                <label htmlFor="dialogue-text">Teks Percakapan Terpilih</label>
                <textarea
                  id="dialogue-text"
                  rows={3}
                  className="text-input"
                  value={activeNode.text}
                  onChange={(e) => updateNodeText(e.target.value)}
                  disabled={task.busy}
                />
              </div>
            )}

            {errors.length > 0 && (
              <div className="alert alert-error" style={{ margin: '8px 0' }}>
                <Icon name="alert" />
                <span>{errors[0].message}</span>
              </div>
            )}

            <button
              type="button"
              className="button secondary-button"
              style={{ marginTop: '8px', width: '100%' }}
              disabled={!changed || errors.length > 0 || task.busy}
              onClick={() => void task.run('Revisi editor manual', task.version?.id ?? null, { kind: 'npc', recipe })}
            >
              Simpan revisi editor
            </button>
          </details>
        </aside>

        <div className="procedural-canvas">
          <div className="viewport-toolbar">
            <span>{recipe.npcName}</span>
            <span className="small-tag">{recipe.nodes.length} Nodes</span>
          </div>

          <div className="npc-preview-layout"><ThreeViewport object={rig.group} label="Karakter Roblox R15 untuk dialog NPC" />
          <div className="npc-dialogue-preview">
            {activeNode ? (
              <div
                className="dialogue-box-sim"
                style={{
                  width: '100%',
                  maxWidth: '520px',
                  background: '#18141c',
                  border: '1px solid var(--border-control)',
                  borderRadius: '10px',
                  padding: '16px',
                }}
              >
                <div style={{ display: 'flex', gap: '12px', alignItems: 'flex-start' }}>
                  <div
                    style={{
                      width: '40px',
                      height: '40px',
                      borderRadius: '50%',
                      background: 'var(--accent)',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      flexShrink: 0,
                    }}
                  >
                    <Icon name="message" />
                  </div>
                  <div style={{ flex: 1 }}>
                    <strong style={{ color: 'var(--accent)', fontSize: '14px' }}>{activeNode.speaker}</strong>
                    <p style={{ margin: '6px 0 12px', fontSize: '13px', lineHeight: '1.5', color: 'var(--text-primary)' }}>
                      {activeNode.text}
                    </p>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                      {activeNode.choices.map((choice, i) => (
                        <button
                          key={i}
                          type="button"
                          className="button secondary-button btn-sm"
                          style={{ textAlign: 'left', width: '100%' }}
                          onClick={() => choice.nextNodeId && setSelectedNodeId(choice.nextNodeId)}
                        >
                          <Icon name="chevron" /><span>{choice.text}</span>
                        </button>
                      ))}
                    </div>
                  </div>
                </div>
              </div>
            ) : (
              <p className="generator-caption">Tidak ada node percakapan aktif.</p>
            )}
          </div>

          </div>
          <p className="generator-caption" style={{ marginTop: '12px' }}>
            Pratinjau memakai rig standar R15. Pilihan dialog membuka node percakapan berikutnya.
          </p>

          <div className="generator-actions" style={{ marginTop: '16px' }}>
            <button
              type="button"
              className="button secondary-button"
              onClick={() => downloadJson(recipe, `${recipe.npcName.toLowerCase().replace(/[^a-z0-9]+/g, '_')}_dialogue.json`)}
            >
              <Icon name="download" /> Ekspor JSON
            </button>
            <StudioApply task={task} changed={!!changed} />
          </div>
          <details className="preview-runtime-details"><summary>Penerapan & verifikasi Studio</summary><p id="npc-apply-reason" className="generator-caption">Versi tersimpan diterapkan melalui provider pilihan pada map terverifikasi. Target dikunci; hasil diperiksa kembali. Pemasangan di Edit tidak membuktikan perilaku saat Play.</p></details>
        </div>
      </div>
    </section>
  );
}
