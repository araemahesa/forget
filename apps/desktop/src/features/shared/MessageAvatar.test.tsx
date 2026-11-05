import { fireEvent, render } from '@testing-library/react';
import { expect, it } from 'vitest';
import { MessageAvatar } from './MessageAvatar';
it('uses Discord only for users, falls back on image failure, and brands bot activity', () => {
  const profile = { id:'123456789012345678',username:'ari',displayName:'Ari',avatarUrl:'https://cdn.discordapp.com/avatars/123456789012345678/abc.png' };
  const view = render(<MessageAvatar user profile={profile} />);
  expect(view.container.querySelector('img')).toHaveAttribute('src',profile.avatarUrl);
  fireEvent.error(view.container.querySelector('img')!);
  expect(view.container.querySelector('img')).toBeNull();
  view.rerender(<MessageAvatar profile={profile} />);
  expect(view.container.querySelector('img')).toHaveAttribute('src','/branding/app-icon.svg');
  view.rerender(<MessageAvatar user profile={{...profile, avatarUrl:'https://evil.test/avatars/x'}} />);
  expect(view.container.querySelector('img')).toBeNull();
});
