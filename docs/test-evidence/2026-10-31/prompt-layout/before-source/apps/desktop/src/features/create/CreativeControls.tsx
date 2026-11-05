import { MessageContent } from '../chat/MessageContent';
import { TaskRecovery } from '../shared/TaskRecovery';
import { Dropdown } from '../../design-system/Dropdown';
import { ModelControls } from '../shared/ModelControls';
import { useEffect, useState } from 'react';
import { qualityProfiles, type CreativeSpecification } from '@forgekit/contracts';
import type { useCreativeTask } from './useCreativeTask';
import { Icon } from '../../design-system/Icon';
import { MessageAvatar } from '../shared/MessageAvatar';
import { useDiscordAccount } from '../../services/accountState';
import { TaskAttempts } from '../shared/TaskAttempts';
import { ProviderPicker } from '../shared/ProviderPicker';
import { OrcaUsagePanel } from '../shared/OrcaUsagePanel';

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

function getLimitCaption(kind: string, quality: 'fast' | 'balanced' | 'high'): string {
  const profile = qualityProfiles[quality];
  switch (kind) {
    case 'model3d': return `${profile.maxParts} komponen`;
    case 'animation': return `${profile.maxKeyframes} pose`;
    case 'vfx': return 'laju 1-500 partikel';
    case 'interface': return 'elemen layout responsif';
    case 'npc': return 'node graf dialog & branching';
    case 'cutscene': return 'keyframe kamera & easing';
    case 'material': return 'layer material PBR';
    case 'music': return 'track instrumen & BPM';
    case 'sky': return '6 sisi SVG, resolusi 512/1024';
    default: return `${profile.maxParts} komponen`;
  }
}

export function CreativeControls({ task, initialPrompt }: { task: ReturnType<typeof useCreativeTask>; initialPrompt: string }) {
  const { account } = useDiscordAccount();
  const [prompt, setPrompt] = useState(() => localStorage.getItem(`forgekit:prompt:${task.kind}`) ?? initialPrompt); const [refine, setRefine] = useState(() => localStorage.getItem(`forgekit:refine:${task.kind}`) ?? '');
  const [usageOpen, setUsageOpen] = useState(false);
  useEffect(() => { localStorage.setItem(`forgekit:prompt:${task.kind}`, prompt); localStorage.setItem(`forgekit:refine:${task.kind}`, refine); }, [prompt, refine, task.kind]);
  const ready = !!task.provider && !!task.modelSelection.modelId;
  return <>
    {task.applicationResult && <section className="application-result" aria-label="Hasil penerapan"><h3>Hasil penerapan</h3><MessageContent content={task.applicationResult} /></section>}
    <div className="generator-brief prompt-composer">
      <label className="prompt-label" htmlFor={`${task.kind}-prompt`}>Prompt</label>
      <textarea className="prompt-input" id={`${task.kind}-prompt`} placeholder="Jelaskan yang ingin dibuat…" value={prompt} onChange={(e) => setPrompt(e.target.value)} rows={3} maxLength={16000} disabled={task.busy} />
      <div className="prompt-toolbar">
        <div className="prompt-options">
          <ProviderPicker label="Provider generator" profiles={task.profiles} connections={task.connectionProfiles} value={task.providerChoice} onChange={task.setProviderChoice} disabled={task.busy} primaryProfile={task.defaultProvider} isCustomOverride={task.isCustomOverride} onPromotePrimary={task.promoteToPrimary} onOpenUsage={() => setUsageOpen(true)} />
          <ModelControls selection={task.modelSelection} disabled={task.busy} />
        </div>
        <div className="prompt-actions">
          <a className="theme-button" href="#settings?section=providers" aria-label="Atur provider" title="Atur provider"><Icon name="settings" /></a>
          {task.busy ? <button type="button" className="button secondary-button" disabled={task.cancelling} onClick={() => void task.stop()}>{task.cancelling ? 'Menghentikan…' : 'Stop'}</button>
            : <button type="button" className="button primary-button" disabled={!prompt.trim() || !ready} aria-describedby={!ready ? `${task.kind}-provider-reason` : undefined} onClick={() => void task.run(prompt, null)}><Icon name="spark" />Generate</button>}
        </div>
      </div>
      {!ready && <p className="generator-caption" id={`${task.kind}-provider-reason`}>Pilih akun dan model.</p>}
      <details className="prompt-output-settings">
        <summary><Icon name="settings" />Output</summary>
        <label>Kualitas<Dropdown aria-label="Kualitas generator" value={task.quality} onChange={(e) => task.setQuality(e.target.value as typeof task.quality)} disabled={task.busy}>
          {Object.entries(qualityProfiles).map(([id, profile]) => <option value={id} key={id}>{profile.label}</option>)}
        </Dropdown></label>
        <div className="generator-budget"><span><Icon name="layers" />{getLimitCaption(task.kind, task.quality)}</span><span><Icon name="clock" />{task.quality === 'high' ? 600 : 180} detik</span></div>
      </details>
      {task.submittedPrompt && <div className="generator-conversation">
        <article className="chat-message-row is-user"><MessageAvatar user profile={account.profile} /><div className="chat-message-body"><strong>{account.profile?.displayName ?? 'Kamu'}</strong><p>{task.submittedPrompt}</p></div></article>
      </div>}
      <TaskRecovery taskId={task.attemptTaskId} disabled={task.generating} onBusyChange={task.setRecovering} onRecovered={task.recovered} />
      <TaskAttempts taskId={task.attemptTaskId} running={task.busy} />
      <div aria-live="polite">

        {task.error && <p role="alert" className="generator-error">{task.error}</p>}
        {task.notice && <p role="status" className="generator-caption">{task.notice}</p>}
      </div>
    </div>
    {task.version && <div className="generator-refine prompt-composer">
      <label className="prompt-label" htmlFor={`${task.kind}-refine`}>Revisi</label>
      <textarea className="prompt-input" id={`${task.kind}-refine`} placeholder="Jelaskan perubahan…" rows={2} value={refine} maxLength={16000} onChange={(e) => setRefine(e.target.value)} disabled={task.busy} />
      <button type="button" className="button secondary-button" disabled={task.busy || !refine.trim() || !ready} onClick={() => void task.run(refine, task.version!.id)}>Simpan revisi</button>
    </div>}
    <details className="generator-versions"><summary>Versi tersimpan ({task.versions.length})</summary>
      {task.versions.map((version, index) => <button className="generator-version" key={version.id} type="button" disabled={task.busy} aria-pressed={task.version?.id === version.id} onClick={() => void task.open(version.id)}>
        {getRecipeName(version.document)} · revisi {task.versions.length - index}{version.parentVersionId ? ' · turunan' : ''}
      </button>)}
    </details>
    <OrcaUsagePanel
      isOpen={usageOpen}
      onClose={() => setUsageOpen(false)}
      profiles={task.profiles}
      connections={task.connectionProfiles}
      defaultSelectedId={task.provider?.id}
    />
  </>;
}
