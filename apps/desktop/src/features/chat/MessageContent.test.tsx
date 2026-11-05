import { render, screen } from '@testing-library/react';
import { expect, it } from 'vitest';
import { MessageContent } from './MessageContent';
it('formats bot headings, code, lists and tables without remote images or executable HTML', () => {
  const { container } = render(<MessageContent content={'## Rencana\n\n1. Baca map\n2. Tinjau hasil\n\n```lua\nlocal name = "ForgeKit"\n```\n\n| Fitur | Status |\n| --- | --- |\n| Map | Siap |\n\n<img src="x" onerror="alert(1)">\n\n![luar](https://outside.test/image.png)\n\n[aman](https://example.com) [berbahaya](javascript:alert(1))'} />);
  expect(screen.getByRole('heading', { name: 'Rencana' })).toBeVisible();
  expect(container.querySelector('pre code')).toHaveTextContent('local name = "ForgeKit"');
  expect(screen.getByRole('table')).toBeInTheDocument();
  expect(container.querySelector('img, script, [onerror], a[href^="javascript:"]')).toBeNull();
  expect(screen.getByRole('link', { name: 'aman' })).toHaveAttribute('rel', 'noreferrer noopener');
});
it('keeps user prompts literal', () => {
  const { container } = render(<MessageContent content="## Jangan ubah prompt" plain />);
  expect(container.querySelector('h2')).toBeNull();
  expect(screen.getByText('## Jangan ubah prompt')).toBeVisible();
});
