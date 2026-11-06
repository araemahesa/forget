import { Dropdown } from '../design-system/Dropdown';
import { selectStudioTarget, useStudioDiscovery, useStudioSnapshot } from '../services/studioState';

/** Shown only when several Studio maps are open, so the target is never guessed. */
export function StudioTargetPicker() {
  const discovery = useStudioDiscovery();
  const snapshot = useStudioSnapshot();
  if (discovery.studios.length < 2) return null;
  return <Dropdown className="studio-target-picker" aria-label="Map tujuan" value={snapshot?.studio.studioId ?? ''} onChange={(event) => selectStudioTarget(event.target.value)}>
    <option value="">Pilih map tujuan</option>
    {discovery.studios.map((studio) => <option key={studio.studioId} value={studio.studioId}>{studio.name || studio.studioId}</option>)}
  </Dropdown>;
}
