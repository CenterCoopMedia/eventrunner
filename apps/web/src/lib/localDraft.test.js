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

  it('expires unopened accounts, documents and versions at seven days without offering their text', () => {
    const pending = openLocalDraft('alice', 'cmsPages/faq', 'v1');
    pending.write('Alice first', 'saved');
    openLocalDraft('alice', 'cmsPages/faq', 'v2').write('Alice second', 'saved');
    openLocalDraft('bob', 'cmsPages/home', 'v1').write('Bob old', 'saved');
    const old = new Map(Object.keys(localStorage).map((key) => [key, localStorage.getItem(key)]));
    vi.advanceTimersByTime(7 * 24 * 60 * 60 * 1000 - 1);
    expect(openLocalDraft('charlie', 'cmsPages/new', 'v1').read()).toBeNull();
    for (const [key, raw] of old) expect(localStorage.getItem(key)).toBe(raw);
    openLocalDraft('bob', 'cmsPages/fresh', 'v1').write('Bob fresh', 'saved');
    const freshKey = Object.keys(localStorage).find((key) => !old.has(key));
    const freshRaw = localStorage.getItem(freshKey);
    const signOutKey = 'eventrunner:admin-draft-signout:alice';
    localStorage.setItem(signOutKey, 'signed out in another tab');
    localStorage.setItem('another-app', 'untouched');
    vi.advanceTimersByTime(1);
    expect(openLocalDraft('charlie', 'cmsPages/new', 'v1').read()).toBeNull();
    for (const key of old.keys()) expect(localStorage.getItem(key)).toBeNull();
    expect(localStorage.getItem(freshKey)).toBe(freshRaw);
    expect(localStorage.getItem(signOutKey)).toBe('signed out in another tab');
    expect(localStorage.getItem('another-app')).toBe('untouched');
    expect(pending.write('late typing after sign-out', 'saved')).toBe(false);
  });

  it.each(['getItem', 'removeItem'])('continues expiry after malformed copies and a %s failure', (method) => {
    openLocalDraft('charlie', 'cmsPages/current', 'v1').write('current', 'saved');
    const expired = JSON.stringify({ value: 'old', baseline: 'saved', version: 'v1', savedAt: Date.now() - 7 * 24 * 60 * 60 * 1000 });
    const blockedKey = 'eventrunner:admin-draft:alice:unopened:v1';
    const removableKey = 'eventrunner:admin-draft:bob:unopened:v1';
    localStorage.setItem('eventrunner:admin-draft:broken', '{broken');
    localStorage.setItem(blockedKey, expired);
    localStorage.setItem(removableKey, expired);
    const original = Storage.prototype[method];
    const failed = vi.spyOn(Storage.prototype, method).mockImplementation(function (key) {
      if (key === blockedKey) throw new Error('storage unavailable');
      return original.call(this, key);
    });
    try {
      expect(openLocalDraft('charlie', 'cmsPages/current', 'v1').read().value).toBe('current');
    } finally { failed.mockRestore(); }
    expect(localStorage.getItem(blockedKey)).toBe(expired);
    expect(localStorage.getItem(removableKey)).toBeNull();
  });

  it('preserves a copy refreshed by another tab during the expiry check', () => {
    openLocalDraft('alice', 'cmsPages/faq', 'v1').write('old', 'saved');
    const key = Object.keys(localStorage)[0];
    vi.advanceTimersByTime(7 * 24 * 60 * 60 * 1000);
    const fresh = JSON.stringify({ value: 'new typing', baseline: 'saved', version: 'v1', savedAt: Date.now() });
    const get = Storage.prototype.getItem;
    const refreshed = vi.spyOn(Storage.prototype, 'getItem').mockImplementation(function (requested) {
      const raw = get.call(this, requested);
      if (requested === key) this.setItem(key, fresh);
      return raw;
    });
    try { expect(openLocalDraft('bob', 'cmsPages/home', 'v1').read()).toBeNull(); }
    finally { refreshed.mockRestore(); }
    expect(localStorage.getItem(key)).toBe(fresh);
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
