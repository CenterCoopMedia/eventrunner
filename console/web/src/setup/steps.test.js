import { describe, expect, it } from 'vitest';
import { lockedReason, openStepIds } from './steps.js';

describe('Agreement availability', () => {
  it.each([
    ['complete answers', {}, [], ''],
    ['answers needing attention', { errors: { 'event.name': 'Enter the event name.' } }, [], 'Finish the answers that need attention first.'],
    ['a refused save', {}, ['webAddress'], 'Save the answers that have not been saved first.'],
    ['closed sign-ups', { signups: { open: false } }, [], 'This site is not taking sign-ups right now. Try again later.'],
    ['a request outside setup', { status: 'approved' }, [], 'Setup is closed for this request.'],
  ])('explains %s and keeps its reason consistent with openness', (_name, overrides, refused, reason) => {
    const app = { status: 'draft', errors: {}, signups: { open: true }, ...overrides };
    expect(lockedReason(app, refused)).toBe(reason);
    expect(openStepIds(app, refused).includes('agreement')).toBe(reason === '');
    expect(openStepIds(app, refused)).toContain('team');
  });
});
