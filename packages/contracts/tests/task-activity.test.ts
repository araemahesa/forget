import { expect, it } from 'vitest';
import { validateTaskActivity } from '../src/ai';
it('accepts only state events and rejects leaked provider text, malformed revisions and unknown stages', () => {
  const event = { taskId: 'task', revision: 2, type: 'candidate', stage: 'validating' };
  expect(validateTaskActivity(event)).toBe(true);
  expect(validateTaskActivity({ ...event, text: '{"tool":"write"}' })).toBe(false);
  expect(validateTaskActivity({ ...event, revision: -1 })).toBe(false);
  expect(validateTaskActivity({ ...event, stage: 'guessing' })).toBe(false);
  expect(validateTaskActivity({ taskId: 'task', revision: 3, type: 'final', stored: true })).toBe(true);
  expect(validateTaskActivity({ taskId: 'task', revision: 3, type: 'final', stored: false })).toBe(false);
});
