import { ObsidianContext } from '../shared/ObsidianContext';
import { ReferenceImages } from '../shared/ReferenceImages';
import { MessageContent } from '../chat/MessageContent';
import { TaskRecovery } from '../shared/TaskRecovery';
import { ModelControls } from '../shared/ModelControls';
import { useEffect, useRef, useState } from 'react';
import type { CreativeSpecification } from '@forgekit/contracts';
import type { useCreativeTask } from './useCreativeTask';
import { Icon } from '../../design-system/Icon';
import { MessageAvatar } from '../shared/MessageAvatar';
import { useDiscordAccount } from '../../services/accountState';
import { TaskAttempts } from '../shared/TaskAttempts';
import { ProviderPicker } from '../shared/ProviderPicker';
import { OrcaUsagePanel } from '../shared/OrcaUsagePanel';
import { taskError } from '../shared/taskError';
import { safeGetItem, safeSetItem } from '../../services/safeStorage';

export function getRecipeName(doc: CreativeSpecification): string {
  switch (doc.kind) {
    case 'model3d':
    case 'animation':
    case 'vfx':
    case 'sky':
      return doc.recipe.name;
    case 'interface':
      return doc.recipe.screenName;
    case 'npc':
      return doc.recipe.npcName;
    case 'cutscene':
    case 'music':
      return doc.recipe.title;
    case 'material':
      return doc.recipe.modelName;
    default:
      return 'Karya';
  }
}

export function CreativeControls({ task, initialPrompt, promptLabel = 'Apa yang ingin dibuat?', promptPlaceholder = 'Jelaskan yang ingin dibuat…', children }: { task: ReturnType<typeof useCreativeTask>; initialPrompt: string; promptLabel?: string; promptPlaceholder?: string; children?: import('react').ReactNode }) {
  const { account } = useDiscordAccount();
  const draftKey = task.storageKey ?? task.kind;
  const [prompt, setPrompt] = useState(() => safeGetItem(`forgekit:prompt:${draftKey}`) ?? initialPrompt); const [refine, setRefine] = useState(() => safeGetItem(`forgekit:refine:${draftKey}`) ?? '');
  const draftTouched = useRef(safeGetItem(`forgekit:prompt:${draftKey}`) !== null);
  useEffect(() => { if (!draftTouched.current && task.submittedPrompt) setPrompt(task.submittedPrompt); }, [task.submittedPrompt]);
  const [usageOpen, setUsageOpen] = useState(false);
  useEffect(() => { safeSetItem(`forgekit:prompt:${draftKey}`, prompt); safeSetItem(`forgekit:refine:${draftKey}`, refine); }, [prompt, refine, draftKey]);
  const [imageOnly, setImageOnly] = useState(task.kind === 'model3d');
  const hasImage = task.referenceImages?.length === 1 && task.referenceImages.some(image => !!image.dataUrl && (!image.kind || image.kind === 'image'));
  const ready = !!task.provider && !!task.modelSelection.modelId;
  return <>
    {task.applicationResult && <section className="application-result" aria-label="Hasil penerapan"><h3>Hasil penerapan</h3><MessageContent content={task.applicationResult} /></section>}
    <div className="generator-brief prompt-composer">
      <header className="prompt-heading"><span className="prompt-heading-icon" aria-hidden="true"><Icon name="spark" /></span><div><h2>{task.kind === 'model3d' && imageOnly ? 'Gambar ke 3D' : 'Brief kreatif'}</h2><p>{task.kind === 'model3d' && imageOnly ? 'Satu gambar menjadi model 3D lengkap.' : 'Mulai dari ide, lanjutkan menjadi karya.'}</p></div></header>
      {task.kind === 'model3d' && <div className="model-input-mode" role="group" aria-label="Sumber model 3D">
        <button type="button" aria-pressed={imageOnly} disabled={task.busy} onClick={() => setImageOnly(true)}>Dari gambar</button>
        <button type="button" aria-pressed={!imageOnly} disabled={task.busy} onClick={() => setImageOnly(false)}>Dengan prompt</button>
      </div>}
      {!imageOnly && <><label className="prompt-label" htmlFor={`${draftKey}-prompt`}>{promptLabel}</label>
      <textarea className="prompt-input" id={`${draftKey}-prompt`} placeholder={promptPlaceholder} value={prompt} onChange={(e) => { draftTouched.current = true; setPrompt(e.target.value); }} rows={3} maxLength={16000} disabled={task.busy} /></>}
        {children}
        <ObsidianContext />
      <ReferenceImages maxFiles={imageOnly ? 1 : 3} imagesOnly={imageOnly} value={task.referenceImages ?? []} onChange={task.setReferenceImages} disabled={task.busy} onBusyChange={task.setAttachmentsBusy} />
      {task.kind === 'model3d' && <p className="generator-caption">Belakang dan sisi yang tidak terlihat dilengkapi secara interpretatif.</p>}
      {imageOnly && (task.referenceImages?.length ?? 0) > 1 && <p role="status" className="generator-caption">Sisakan satu gambar atau gunakan Dengan prompt.</p>}
      <div className="prompt-toolbar">
        <div className="prompt-options">
          <ProviderPicker label="Provider generator" profiles={task.profiles} connections={task.connectionProfiles} value={task.providerChoice} onChange={task.setProviderChoice} disabled={task.busy} primaryProfile={task.defaultProvider} isCustomOverride={task.isCustomOverride} onOpenUsage={() => setUsageOpen(true)} />
          <ModelControls selection={task.modelSelection} disabled={task.busy} />
        </div>
        <div className="prompt-actions">
          <a className="theme-button" href="#settings?section=providers" aria-label="Atur provider" title="Atur provider"><Icon name="settings" /></a>
          {task.busy ? <button type="button" className="button secondary-button" disabled={task.cancelling} onClick={() => void task.stop()}>{task.cancelling ? 'Menghentikan…' : 'Stop'}</button>
            : <button type="button" className="button primary-button" disabled={task.attachmentsBusy || (imageOnly ? !hasImage : !prompt.trim()) || !ready} aria-describedby={!ready ? `${draftKey}-provider-reason` : undefined} onClick={() => void task.run(imageOnly ? '' : prompt, null)}><Icon name="spark" />{imageOnly ? 'Buat 3D' : 'Generate'}</button>}
        </div>
      </div>
      {!ready && <p className="generator-caption" id={`${draftKey}-provider-reason`}>Pilih akun dan model.</p>}
      {task.submittedPrompt && (task.kind === 'model3d' ? <details className="model-submitted-prompt"><summary>{imageOnly ? 'Detail permintaan' : 'Prompt dikirim'}</summary><p>{task.submittedPrompt}</p></details> : <div className="generator-conversation">
        <article className="chat-message-row is-user"><MessageAvatar user profile={account.profile} /><div className="chat-message-body"><strong>{account.profile?.displayName ?? 'Kamu'}</strong><p>{task.submittedPrompt}</p></div></article>
      </div>)}
      <TaskRecovery taskId={task.attemptTaskId} compact={task.kind === 'model3d'} disabled={task.generating} onBusyChange={busy => { if (busy) task.setError(''); task.setRecovering(busy); }} onRecovered={task.recovered} />
      <TaskAttempts taskId={task.attemptTaskId} running={task.busy} visual={task.kind === 'model3d'} />
      <div aria-live="polite">

        {task.error && <p role="alert" className="generator-error">{taskError(task.error)}</p>}
        {task.notice && <p role="status" className="generator-caption">{task.notice}</p>}
      </div>
    </div>
    {task.version && <div className="generator-refine prompt-composer">
      <label className="prompt-label" htmlFor={`${draftKey}-refine`}>Revisi</label>
      <textarea className="prompt-input" id={`${draftKey}-refine`} placeholder="Jelaskan perubahan…" rows={2} value={refine} maxLength={16000} onChange={(e) => setRefine(e.target.value)} disabled={task.busy} />
      <button type="button" className="button secondary-button" disabled={task.busy || task.attachmentsBusy || !refine.trim() || !ready} onClick={() => void task.run(refine, task.version!.id)}>Simpan revisi</button>
    </div>}
    {task.kind !== 'model3d' && <details className="generator-versions"><summary>Versi tersimpan ({task.versions.length})</summary>
      {task.versions.map((version, index) => <button className="generator-version" key={version.id} type="button" disabled={task.busy} aria-pressed={task.version?.id === version.id} onClick={() => void task.open(version.id)}>
        {getRecipeName(version.document)} · revisi {task.versions.length - index}{version.parentVersionId ? ' · turunan' : ''}
      </button>)}
    </details>}
    <OrcaUsagePanel
      isOpen={usageOpen}
      onClose={() => setUsageOpen(false)}
      profiles={task.profiles}
      connections={task.connectionProfiles}
      defaultSelectedId={task.provider?.id}
    />
  </>;
}

