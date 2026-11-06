import { ObsidianContext } from '../shared/ObsidianContext';
import { ReferenceImages } from '../shared/ReferenceImages';
import type { ReferenceImage } from '../../services/references';
import { TaskRecovery } from '../shared/TaskRecovery';
import { ProviderPicker } from '../shared/ProviderPicker';
import { refreshUsageAfterTask } from '../../services/providerUsage';
import { ModelControls } from '../shared/ModelControls';
import { OrcaUsagePanel } from '../shared/OrcaUsagePanel';
import { useFeatureProviderSelection } from '../../services/featureSelection';
import { useEffect, useRef, useState } from 'react';
import { isTauri } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import type { ChatMessage, ChatThread, ChatTurn } from '@forgekit/contracts';
import { validateSnapshotToolReceipt, type SnapshotToolReceipt } from '@forgekit/contracts';
import type { WorkspacePageProps } from '../../app/featureRegistry';
import { useDiscordAccount } from '../../services/accountState';
import { MessageAvatar } from '../shared/MessageAvatar';
import { BrandMark } from '../../design-system/BrandMark';
import { MessageContent } from './MessageContent';
import { Icon } from '../../design-system/Icon';
import { listChatThreads, createChatThread, deleteChatThread, loadChatThread, latestChatTurn, sendChatMessage, cancelChatStream } from '../../services/ai';
import { useProviders } from '../../services/providerState';
import { acquireStudioTask, refreshStudioContext, useStudioSnapshot } from '../../services/studioState';
import { StudioExplorer } from '../shared/StudioExplorer';
import { TaskAttempts } from '../shared/TaskAttempts';
import { Dropdown } from '../../design-system/Dropdown';
import { safeGetItem, safeSetItem } from '../../services/safeStorage';

export const starterPrompts = [
  'Jelaskan struktur map ini dan script yang mengatur gameplay.',
  'Buat sistem checkpoint di area yang saya pilih.',
  'Buat model gerbang bergaya fantasy untuk pintu masuk ini.',
  'Buat animasi serangan untuk rig yang sedang dipilih.',
];
type Panel = 'history' | 'explorer' | null;
type ChatMode = 'auto' | 'ask' | 'plan';
const chatModes: { value: ChatMode; label: string }[] = [
  { value: 'auto', label: 'Kerjakan · perubahan perlu izin' },
  { value: 'ask', label: 'Tanya · baca saja' },
  { value: 'plan', label: 'Rencanakan · baca saja' },
];
const failureMessage = (error: unknown) => error instanceof Error ? error.message : 'Percakapan gagal. Input dan riwayat tetap tersedia.';

export function ChatPage(_props: Pick<WorkspacePageProps, 'onOpenVersion'>) {
  const { account } = useDiscordAccount();
  const [threads, setThreads] = useState<ChatThread[]>([]);
  const [activeThreadId, setActiveThreadId] = useState<string | null>(() => localStorage.getItem('forgekit:active-chat'));
  useEffect(() => { if (activeThreadId) localStorage.setItem('forgekit:active-chat', activeThreadId); else localStorage.removeItem('forgekit:active-chat'); }, [activeThreadId]);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [lastTurn, setLastTurn] = useState<ChatTurn | null>(null);
  const [attemptTaskId, setAttemptTaskId] = useState<string | null>(null);
  const [input, setInput] = useState(() => localStorage.getItem('forgekit:chat-draft') ?? '');
  useEffect(() => { localStorage.setItem('forgekit:chat-draft', input); }, [input]);
  const [referenceImages, setReferenceImages] = useState<ReferenceImage[]>([]);
  const [attachmentsBusy, setAttachmentsBusy] = useState(false);
  const [recovering, setRecovering] = useState(false);
  const [running, setRunning] = useState(false);
  const [stopping, setStopping] = useState(false);
  const [panel, setPanel] = useState<Panel>(null);
  const [search, setSearch] = useState('');
  const [usageOpen, setUsageOpen] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [nearBottom, setNearBottom] = useState(true);
  const [toolReceipts, setToolReceipts] = useState<SnapshotToolReceipt[]>([]);
  const [chatMode, setChatMode] = useState<ChatMode>(() => { const saved = safeGetItem('forgekit:chat-mode'); return saved === 'ask' || saved === 'plan' ? saved : 'auto'; });
  useEffect(() => { safeSetItem('forgekit:chat-mode', chatMode); }, [chatMode]);
  const [streamText, setStreamText] = useState('');
  const selection = useFeatureProviderSelection('chat');
  const { profiles, defaultProvider, connectionProfiles, modelSelection, choice: providerId } = selection;
  const provider = modelSelection.provider;
  const studio = useStudioSnapshot();
  const context = studio?.context;
  const activeRequest = useRef<{ threadId: string | null; requestId: string; cancelled: boolean } | null>(null);
  const composer = useRef<HTMLTextAreaElement>(null);
  const log = useRef<HTMLDivElement>(null);
  const follow = useRef(true);
  const alive = useRef(true);

  useEffect(() => {
    alive.current = true;
    let current = true;
    void listChatThreads().then((items) => { if (current) setThreads(items); }).catch((error: unknown) => { if (current) setNotice(failureMessage(error)); });
    return () => { current = false; alive.current = false; };
  }, []);
  useEffect(() => {
    if (!isTauri()) return;
    let disposed = false;
    let unlisten: (() => void) | undefined;
    void listen<{ threadId: string; requestId: string; receipt: unknown }>('forgekit:ai-tool', ({ payload }) => {
      const request = activeRequest.current;
      if (!alive.current || !request || request.cancelled || payload.threadId !== request.threadId || payload.requestId !== request.requestId
        || !validateSnapshotToolReceipt(payload.receipt)) return;
      const receipt = payload.receipt;
      setToolReceipts((items) => items.some((item) => item.callId === receipt.callId) ? items : [...items, receipt]);
    }).then((stop) => { if (disposed) stop(); else unlisten = stop; }).catch((error: unknown) => { if (!disposed) setError(failureMessage(error)); });
    return () => { disposed = true; unlisten?.(); };
  }, []);
  useEffect(() => {
    if (!isTauri()) return;
    let disposed = false;
    let unlisten: (() => void) | undefined;
    // Live draft only. The task completes when the persisted native response arrives, never on `done`.
    void listen<{ threadId: string; requestId: string; chunk: string; done: boolean; reset?: boolean }>('forgekit:ai-chunk', ({ payload }) => {
      const request = activeRequest.current;
      if (!alive.current || !request || request.cancelled || payload.threadId !== request.threadId || payload.requestId !== request.requestId) return;
      if (payload.reset) setStreamText('');
      else if (payload.chunk) setStreamText((text) => text + payload.chunk);
    }).then((stop) => { if (disposed) stop(); else unlisten = stop; }).catch((error: unknown) => { if (!disposed) setError(failureMessage(error)); });
    return () => { disposed = true; unlisten?.(); };
  }, []);

  function renderReceipts(items: unknown[]) {
    return items.filter(validateSnapshotToolReceipt).map((receipt) => <details className="chat-tool-receipt" key={receipt.callId}>
      <summary>{receipt.name} · {receipt.matches.length} referensi snapshot{receipt.truncated ? ' · cakupan terbatas' : ''}</summary>
      <small>{receipt.snapshotId} · hanya baca · {new Date(Number(receipt.observedAt)).toLocaleTimeString('id-ID')}</small>
      <ul>{receipt.matches.map((node) => <li key={node.reference}><button type="button" className="theme-button"
        disabled={context?.id !== receipt.snapshotId} title={context?.id !== receipt.snapshotId ? 'Snapshot sumber berbeda dari Explorer saat ini.' : 'Buka Explorer live; referensi ini berasal dari snapshot'}
        onClick={() => setPanel('explorer')}>
        {node.name} · {node.className} · {node.reference}
      </button></li>)}</ul>
      <small>Referensi berlaku pada snapshot ini; bukan selection Studio atau bukti script dibaca.</small>
    </details>);
  }
  useEffect(() => {
    if (!activeThreadId || activeRequest.current?.threadId === activeThreadId) return;
    let current = true;
    let timer: ReturnType<typeof setTimeout>;
    let release: (() => void) | undefined;
    const threadId = activeThreadId;
    async function restore() {
      try {
        const [items, turn] = await Promise.all([loadChatThread(threadId), latestChatTurn(threadId)]);
        if (!current || activeRequest.current) return;
        setMessages(items); setLastTurn(turn);
        const working = !!turn && ['queued', 'planning', 'reading_context', 'streaming', 'tool_running'].includes(turn.status);
        setRunning(working); setAttemptTaskId(turn?.id ?? null);
        if (working) {
          release ??= acquireStudioTask();
          timer = setTimeout(() => void restore(), 600);
        } else { release?.(); release = undefined; setStopping(false); }
      } catch (error) { if (current) { setRunning(false); setError(failureMessage(error)); release?.(); release = undefined; } }
    }
    setMessages([]); setLastTurn(null); setError('');
    void restore();
    return () => { current = false; clearTimeout(timer); release?.(); };
  }, [activeThreadId]);
  useEffect(() => {
    if (!log.current) return;
    if (!messages.length) log.current.scrollTop = 0;
    else if (follow.current) log.current.scrollTop = log.current.scrollHeight;
  }, [messages, streamText]);

  function toggle(next: Panel) { setPanel((value) => value === next ? null : next); }
  function newConversation() { if (activeRequest.current || running || recovering) return; setActiveThreadId(null); setMessages([]); setInput(''); setPanel(null); setError(''); composer.current?.focus(); }
  async function removeThread(thread: ChatThread) {
    if (activeRequest.current || recovering || !window.confirm(`Hapus percakapan "${thread.title}" beserta pesannya?`)) return;
    try {
      await deleteChatThread(thread.id);
      setThreads((items) => items.filter((item) => item.id !== thread.id));
      if (activeThreadId === thread.id) newConversation();
    } catch (error) { setError(failureMessage(error)); }
  }
  async function send() {
    const text = input.trim();
    if (!text || activeRequest.current || running || recovering || attachmentsBusy) return;
    if (!provider) { window.location.hash = 'settings?section=providers'; return; }
    const capturedProvider = { ...provider };
    const contextId = context?.id;
    // Ask/Plan never receive write tools; the backend enforces this, not only the UI.
    const mode = chatMode;
    const retry = false;
    const request = { threadId: activeThreadId, requestId: crypto.randomUUID(), cancelled: false };
    activeRequest.current = request;
    const releaseStudio = acquireStudioTask();
    setMessages((items) => retry ? items : [...items, { id: `pending-${request.requestId}`, threadId: request.threadId ?? '', sequence: items.length + 1, role: 'user', content: text, createdAt: String(Date.now()) }]);
    setInput('');
    setAttemptTaskId(request.requestId);
    setRunning(true); setStopping(false); setError(''); setNotice(''); setToolReceipts([]); setStreamText('');
    try {
      if (!request.threadId) {
        const thread = await createChatThread(text.slice(0, 80), capturedProvider.model, capturedProvider.id);
        request.threadId = thread.id;
        localStorage.setItem('forgekit:active-chat', thread.id);
        if (alive.current) { setThreads((items) => [thread, ...items]); setActiveThreadId(thread.id); }
      }
      if (request.cancelled) return;
      const freshContext = retry ? studio : await refreshStudioContext();
      if (request.cancelled) return;
      // A Studio target is only usable with a verified map snapshot; without one this is a plain chat.
      const mapContext = freshContext?.context ? freshContext : null;
      const result = await sendChatMessage(request.threadId, text, capturedProvider, request.requestId, mode, mapContext?.context?.id, mapContext?.studio.studioId, referenceImages);
      // Only a persisted native response completes the task; stream termination alone cannot.
      if (alive.current && !request.cancelled) {
        const saved = await loadChatThread(request.threadId);
        if (!alive.current) return;
        setMessages(saved.length ? saved : [result]);
        setReferenceImages([]);
        setInput((value) => value === text ? '' : value);
      }
    } catch (error) { if (alive.current && !request.cancelled) { setError(failureMessage(error)); setInput((value) => value || text); } }
    finally {
      if (alive.current && request.threadId) {
        try {
          const [saved, turn] = await Promise.all([loadChatThread(request.threadId), latestChatTurn(request.threadId)]);
          if (alive.current) { if (saved.length) setMessages(saved); setLastTurn(turn); }
        } catch (error) { if (alive.current) setError(failureMessage(error)); }
      }
      releaseStudio();
      void refreshUsageAfterTask(profiles, request.requestId, capturedProvider);
      activeRequest.current = null;
      if (alive.current) {
        setStreamText('');
        if (request.cancelled) setNotice('Stop diterima. Riwayat menampilkan pesan yang sudah tersimpan; respons parsial bukan hasil selesai.');
        setRunning(false); setStopping(false);
      }
    }
  }
  async function stop() {
    const request = activeRequest.current;
    if (stopping || (!request && !activeThreadId)) return;
    setStopping(true);
    try {
      const target = request?.threadId ?? activeThreadId;
      if (target) await cancelChatStream(target);
      if (request) request.cancelled = true;
    } catch (error) { setError(failureMessage(error)); setStopping(false); }
  }

  return <div className={`chat-container${panel ? ' has-panel' : ''}`}>
    <section className="chat-main" aria-label="Percakapan aktif">
      <header className="chat-header"><div className="chat-header-info"><h1>AI Chat</h1><span>{threads.find((thread) => thread.id === activeThreadId)?.title ?? 'Ruang untuk ide berikutnya'}</span></div>
        <div className="chat-header-actions">
          <button className="theme-button" type="button" title="Percakapan baru" aria-label="Percakapan baru" disabled={running} onClick={newConversation}><Icon name="plus" /></button>
          {([['explorer', 'Explorer map', 'workspace'], ['history', 'Riwayat percakapan', 'clock']] as const).map(([id, label, icon]) => <button className="theme-button" type="button" key={id} title={label} aria-label={label} aria-expanded={panel === id} aria-controls="chat-context-panel" onClick={() => toggle(id)}><Icon name={icon} /></button>)}
        </div>
      </header>
      <div className="chat-messages" ref={log} role="log" aria-label="Pesan percakapan" aria-live="polite" onScroll={() => {
        const element = log.current!;
        follow.current = element.scrollHeight - element.scrollTop - element.clientHeight < 60;
        setNearBottom(follow.current);
      }}>
        {!messages.length && !running && <div className="chat-empty-state"><div className="chat-welcome-intro"><span className="chat-empty-mark"><BrandMark /></span><p className="eyebrow">RUANG KREASI FORGEKIT</p><h2>Apa yang ingin kamu buat<br />atau ubah di map ini?</h2><p>Tulis tujuanmu. ForgeKit membaca konteks, memilih tools, lalu mengerjakannya.</p>
          <div className="chat-prerequisites">{!provider && <a className="button secondary-button" href="#settings?section=providers"><Icon name="settings" />Pilih provider</a>}</div></div>
          <div className="chat-starters">{starterPrompts.map((prompt, index) => <button type="button" key={prompt} onClick={() => { setInput(prompt); composer.current?.focus(); }}><span>0{index + 1}</span><span>{prompt}</span><Icon name="arrow" /></button>)}</div>
        </div>}
        {messages.filter((message) => message.role === 'user' || message.role === 'assistant').map((message) => <article className={`chat-message-row${message.role === 'user' ? ' is-user' : ''}`} key={message.id}>
          <MessageAvatar user={message.role === 'user'} profile={account.profile} /><div className="chat-message-body"><header className="chat-message-author"><strong>{message.role === 'user' ? account.profile?.displayName ?? 'Kamu' : 'ForgeKit AI'}</strong><span>{message.role === 'user' ? account.profile ? 'Discord' : 'Pengguna' : message.role === 'assistant' ? 'Asisten' : 'Aktivitas'}</span></header><MessageContent content={message.content} plain={message.role === 'user'} />
          </div>
        </article>)}
        {running && streamText.trim() && <article className="chat-message-row is-streaming" aria-busy="true">
          <MessageAvatar user={false} profile={account.profile} /><div className="chat-message-body"><header className="chat-message-author"><strong>ForgeKit AI</strong><span>Sedang menulis · draf belum tersimpan</span></header><MessageContent content={streamText} />
          </div>
        </article>}
        {!!toolReceipts.length && <details className="prompt-process"><summary>Diagnostik pembacaan</summary>{renderReceipts(toolReceipts)}</details>}
        <TaskAttempts taskId={running ? attemptTaskId : lastTurn?.id ?? null} running={running} />
      </div>
      {!nearBottom && (messages.length > 0 || running) && <button className="chat-latest button secondary-button" type="button" onClick={() => { follow.current = true; setNearBottom(true); if (log.current) log.current.scrollTop = log.current.scrollHeight; }}>Pesan terbaru</button>}
      <footer className="chat-composer">
        {error && <p role="alert" className="status-error">{error}</p>}
        {notice && <p role="status" className="chat-notice">{notice}</p>}
        <TaskRecovery taskId={running ? null : lastTurn?.id ?? null} disabled={running} onBusyChange={setRecovering} onRecovered={async () => {
          if (activeThreadId && alive.current) { const messages = await loadChatThread(activeThreadId); const turn = await latestChatTurn(activeThreadId); if (alive.current) { setMessages(messages); setLastTurn(turn); setError(''); } }
        }} />
        <ObsidianContext />
        <div className="chat-composer-box prompt-composer"><ReferenceImages compact value={referenceImages} onChange={setReferenceImages} disabled={running || recovering} onBusyChange={setAttachmentsBusy}><textarea className="prompt-input" ref={composer} rows={3} maxLength={32000} value={input} onChange={(event) => setInput(event.target.value)} aria-label="Input pesan chat" placeholder="Tulis ide atau pertanyaan…"
          onKeyDown={(event) => { if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) { event.preventDefault(); void send(); } }} /></ReferenceImages>
          <div className="chat-composer-actions prompt-toolbar"><div className="chat-composer-options prompt-options">
            <ProviderPicker
              label="Provider percakapan"
              profiles={profiles}
              connections={connectionProfiles}
              value={providerId}
              disabled={running}
              onChange={selection.setChoice}
              primaryProfile={defaultProvider}
              isCustomOverride={selection.isCustomOverride}
              onOpenUsage={() => setUsageOpen(true)}
            />
            <ModelControls selection={modelSelection} disabled={running} />
            <Dropdown aria-label="Mode kerja" value={chatMode} disabled={running} onChange={(event) => setChatMode(event.target.value as ChatMode)}>{chatModes.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}</Dropdown>
          </div>
            {running ? <button className="button secondary-button" type="button" disabled={stopping} onClick={() => void stop()}><Icon name="close" />{stopping ? 'Menghentikan...' : 'Stop'}</button> : <button className="button primary-button" type="button" disabled={attachmentsBusy || recovering || !input.trim() || !provider || !modelSelection.modelId} onClick={() => void send()}>Kirim<Icon name="arrow" /></button>}
          </div>
        </div>

      </footer>
    </section>
    {panel && <aside className="chat-context-panel" id="chat-context-panel" aria-label={panel === 'explorer' ? 'Explorer map' : 'Riwayat percakapan'}>
      <div className="chat-panel-header"><h2>{panel === 'explorer' ? 'Explorer map' : 'Riwayat percakapan'}</h2><button className="theme-button" type="button" aria-label="Tutup panel konteks" onClick={() => setPanel(null)}><Icon name="close" /></button></div>
      {panel === 'explorer' && <StudioExplorer inline />}
      {panel === 'history' && <><label className="chat-search-label">Cari percakapan<input aria-label="Cari percakapan" value={search} onChange={(event) => setSearch(event.target.value)} /></label><div className="chat-threads-list">{threads.filter((thread) => thread.title.toLocaleLowerCase('id').includes(search.toLocaleLowerCase('id'))).map((thread) => <div className="chat-thread-item" key={thread.id}><button className="chat-thread-btn" type="button" disabled={running} aria-pressed={thread.id === activeThreadId} onClick={() => { setActiveThreadId(thread.id); setPanel(null); }}>{thread.title}</button><button className="theme-button" type="button" disabled={running} aria-label={`Hapus ${thread.title}`} onClick={() => void removeThread(thread)}><Icon name="close" /></button></div>)}{!threads.length && <p>Belum ada percakapan tersimpan.</p>}</div></>}
    </aside>}
    <OrcaUsagePanel
      isOpen={usageOpen}
      onClose={() => setUsageOpen(false)}
      profiles={profiles}
      connections={connectionProfiles}
      defaultSelectedId={provider?.id}
    />
  </div>;
}
