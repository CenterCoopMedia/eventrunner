import { describe, expect, it } from 'vitest';
import { editorialId, lockEditorialId, uniqueEditorialId } from './editorialId.js';

describe('editorialId', () => {
  it('matches the session slug for a title with accents and punctuation', () => {
    expect(editorialId('Café: Opening Session')).toBe('cafe-opening-session');
    expect(editorialId('Opening session')).toBe('opening-session');
  });

  it('uses the fallback when the text has no letters or digits', () => {
    expect(editorialId('!!!', 'section')).toBe('section');
    expect(editorialId('', 'page')).toBe('page');
  });

  it('adds a numeric suffix until the id is free, and stays within 128 characters', () => {
    const long = 'a'.repeat(140);
    const base = editorialId(long);
    expect(base).toHaveLength(128);
    const taken = new Set([base, `${base.slice(0, 126)}-2`]);
    const next = uniqueEditorialId(long, taken);
    expect(next).toBe(`${'a'.repeat(126)}-3`);
    expect(next.length).toBeLessThanOrEqual(128);
    expect(uniqueEditorialId('Intro', new Set(['intro', 'intro-2']))).toBe('intro-3');
  });

  it('keeps an existing id when the label changes, and reuses it after a failed save', () => {
    const taken = new Set(['hero']);
    expect(lockEditorialId('hero', 'Welcome', taken, 'section')).toBe('hero');
    const first = lockEditorialId('', 'Register now', new Set(), 'block');
    expect(first).toBe('register-now');
    expect(lockEditorialId(first, 'Join us', new Set([first]), 'block')).toBe('register-now');
  });
});
