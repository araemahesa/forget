import { useStudioSnapshot } from '../../services/studioState';
import { Icon } from '../../design-system/Icon';
import type { useCreativeTask } from './useCreativeTask';

export function StudioApply({ task, changed = false, blockedReason }: { task: ReturnType<typeof useCreativeTask>; changed?: boolean; blockedReason?: string }) {
  const studio = useStudioSnapshot();
  const reason = blockedReason || (changed ? 'Simpan revisi sebelum menerapkan hasil.' : !task.version ? 'Buat dan simpan karya terlebih dahulu.' : !studio ? 'Buka map di Roblox Studio dan verifikasi koneksinya.' : !task.provider ? 'Pilih provider dan model untuk penerapan.' : '');
  return <button type="button" className="button secondary-button" disabled={task.busy || !!reason} title={reason || `Terapkan versi tersimpan ke ${studio?.studio.name ?? 'map tujuan'}`} onClick={() => void task.apply()}><Icon name="link" />Terapkan ke Studio</button>;
}
