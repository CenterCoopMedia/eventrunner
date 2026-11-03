// The pitch draft in tab storage (ADR 0008 §2).
import { afterEach, describe, expect, it, vi } from 'vitest';
import { blankPitch, clearPitch, restorePitch, savePitch, submissionOf } from './pitchDraft.js';

describe('pitch draft storage', () => {
  afterEach(() => vi.restoreAllMocks());

  it('works with no storage at all, when reading sessionStorage itself throws', () => {
    vi.spyOn(window, 'sessionStorage', 'get').mockImplementation(() => { throw new DOMException('denied', 'SecurityError'); });
    expect(restorePitch().title).toBe('');
    expect(savePitch(blankPitch())).toBe(false);
    expect(() => clearPitch()).not.toThrow();
  });
});

describe('submissionOf', () => {
  const draft = { ...blankPitch(), title: 'T', description: 'D', format: 'Gone', lengthMinutes: 45, track: 'Old',
    presenters: [{ id: 'r1', name: 'Bo', email: 'bo@example.org', organization: '', role: '' }] };

  it('sends no answer for a question the call no longer asks', () => {
    const body = submissionOf(draft, { formats: [], lengths: [], tracks: [], maxCoPresenters: 0 });
    expect(body.lengthMinutes).toBeNull();
    expect(body.track).toBeNull();
    expect(body.presenters).toEqual([]);
    // With no format list, format is free text again, so it stays.
    expect(body.format).toBe('Gone');
  });

  it('keeps the answers while the call asks the questions', () => {
    const body = submissionOf(draft, { formats: ['Gone'], lengths: [45], tracks: ['Old'], maxCoPresenters: 2 });
    expect([body.format, body.lengthMinutes, body.track, body.presenters.length]).toEqual(['Gone', 45, 'Old', 1]);
  });
});
