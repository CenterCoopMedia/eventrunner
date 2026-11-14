import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { clearLocalDrafts, openLocalDraft } from './localDraft.js';

beforeEach(() => { localStorage.clear(); vi.useFakeTimers(); vi.setSystemTime(new Date('2026-11-13T12:00:00Z')); });
afterEach(() => vi.useRealTimers());

describe('local admin draft storage', () => {
  it('isolates accounts, document paths and versions, keeping the exact text', () => {
    const text = JSON.stringify({ description: '<p>Line one\n“Line two” 🦊</p>' });
    openLocalDraft('alice', 'cmsPages/faq', 'v1').write(text, 'saved');
    expect(openLocalDraft('bob', 'cmsPages/faq', 'v1').read()).toBeNull();
    expect(openLocalDraft('alice', 'cmsPages/home', 'v1').read()).toBeNull();
    const copy = openLocalDraft('alice', 'cmsPages/faq', 'v2').read();
    expect(copy).toMatchObject({ value: text, version: 'v1' });
    vi.advanceTimersByTime(1);
    openLocalDraft('alice', 'cmsPages/faq', 'v2').write('newer', 'saved');
    const reopened = openLocalDraft('alice', 'cmsPages/faq', 'v2');
    expect(reopened.read().value).toBe('newer');
    reopened.clear();
    expect(reopened.read()).toBeNull();
  });

  it('expires copies at seven days and removes malformed entries', () => {
    openLocalDraft('alice', 'cmsPages/faq', 'v1').write('text', 'saved');
    const key = Object.keys(localStorage)[0];
    vi.advanceTimersByTime(7 * 24 * 60 * 60 * 1000 - 1);
    expect(openLocalDraft('alice', 'cmsPages/faq', 'v1').read()).not.toBeNull();
    vi.advanceTimersByTime(1);
    expect(openLocalDraft('alice', 'cmsPages/faq', 'v1').read()).toBeNull();
    expect(localStorage.getItem(key)).toBeNull();
    localStorage.setItem(key, '{broken');
    expect(openLocalDraft('alice', 'cmsPages/faq', 'v1').read()).toBeNull();
    expect(localStorage.getItem(key)).toBeNull();
  });

  it('clears only the signing-out account and revokes even a session with no write yet', () => {
    const pending = openLocalDraft('alice', 'cmsPages/faq', 'v1');
    openLocalDraft('alice', 'cmsPages/home', 'v2').write('Alice', 'saved');
    openLocalDraft('bob', 'cmsPages/faq', 'v1').write('Bob', 'saved');
    clearLocalDrafts('alice');
    expect(pending.write('must not return', 'saved')).toBe(false);
    expect(openLocalDraft('alice', 'cmsPages/home', 'v2').read()).toBeNull();
    expect(openLocalDraft('bob', 'cmsPages/faq', 'v1').read().value).toBe('Bob');
  });

  it('does not delete newer text from another tab when an older copy is saved/discarded', () => {
    const first = openLocalDraft('alice', 'cmsPages/faq', 'v1');
    first.write('first', 'saved');
    const second = openLocalDraft('alice', 'cmsPages/faq', 'v1');
    second.write('second', 'saved');
    first.clear();
    expect(second.read().value).toBe('second');
    second.clear();
    expect(second.read()).toBeNull();
  });

  it('tolerates storage access failures', () => {
    const failed = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('quota'); });
    expect(openLocalDraft('alice', 'cmsPages/faq', 'v1').write('text', 'saved')).toBe(false);
    expect(() => clearLocalDrafts('alice')).not.toThrow();
    failed.mockRestore();
  });

  it('still clears copies when quota initially prevents the sign-out marker', () => {
    const draft = openLocalDraft('alice', 'cmsPages/faq', 'v1');
    draft.write('private text', 'saved');
    const set = vi.spyOn(Storage.prototype, 'setItem').mockImplementationOnce(() => { throw new Error('quota'); });
    clearLocalDrafts('alice');
    expect(draft.read()).toBeNull();
    expect(localStorage.getItem('eventrunner:admin-draft-signout:alice')).not.toBeNull();
    expect(draft.write('late', 'saved')).toBe(false);
    set.mockRestore();
  });
});
