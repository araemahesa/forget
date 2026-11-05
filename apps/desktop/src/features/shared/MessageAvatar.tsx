import { useState } from 'react';
import type { DiscordProfile } from '../../services/accountState';
import { BrandMark } from '../../design-system/BrandMark';
import { Icon } from '../../design-system/Icon';
export function MessageAvatar({ user = false, profile = null }: { user?: boolean; profile?: DiscordProfile | null }) {
  const [failed, setFailed] = useState<string | null>(null);
  const src = profile?.avatarUrl;
  const trusted = src?.startsWith('https://cdn.discordapp.com/avatars/') || src?.startsWith('https://cdn.discordapp.com/embed/avatars/');
  return <span className={`message-avatar${user ? ' is-user' : ''}`} aria-hidden="true">{!user ? <BrandMark /> : trusted && src !== failed ? <img src={src!} alt="" referrerPolicy="no-referrer" draggable={false} onError={() => setFailed(src!)} /> : <Icon name="account" />}</span>;
}
