import { beforeEach, describe, expect, it, vi } from 'vitest';
import { accountViews, readSessionView, saveSessionView, viewForPath } from './accountViews.js';

beforeEach(() => sessionStorage.clear());

describe('held account views (issue 340)', () => {
  it.each([
    ['signed out', false, 'approved', true, true, []],
    ['attendee only', true, 'approved', false, false, ['attendee']],
    ['pending attendee', true, 'pending', false, false, ['attendee']],
    ['speaker only', true, 'pending', true, false, ['speaker']],
    ['admin only', true, 'pending', false, true, ['admin']],
    ['attendee and speaker', true, 'approved', true, false, ['attendee', 'speaker']],
    ['attendee and admin', true, 'approved', false, true, ['attendee', 'admin']],
    ['speaker and admin', true, 'pending', true, true, ['speaker', 'admin']],
    ['all three roles', true, 'approved', true, true, ['attendee', 'speaker', 'admin']],
    ['ticketed attendee and admin', true, 'ticketed', false, true, ['attendee', 'admin']],
  ])('%s', (_name, signedIn, registrationStatus, speakerEligible, admin, expected) => {
    expect(accountViews({signedIn, profile: {registrationStatus}, speakerEligible, admin}).map(v => v.id)).toEqual(expected);
  });

  it('does not treat a linked draft or a profile role as a grant', () => {
    expect(accountViews({signedIn:true, profile:{speakerId:'draft',role:'admin'}, speakerEligible:false, admin:false}).map(v => v.id)).toEqual(['attendee']);
  });
});

describe('session and deep links', () => {
  it('keeps choices per user in session storage', () => {
    saveSessionView('alice', 'speaker');
    saveSessionView('bob', 'attendee');
    expect(readSessionView('alice')).toBe('speaker');
    expect(readSessionView('bob')).toBe('attendee');
    expect(readSessionView('charlie')).toBeNull();
    expect(readSessionView(null)).toBeNull();
  });
  it.each([
    ['/dashboard', 'attendee'], ['/dashboard/settings', 'attendee'], ['/profile', 'attendee'],
    ['/speaker/dashboard', 'speaker'], ['/speaker/profile', 'speaker'], ['/admin/content/home', 'admin'],
    ['/Admin/pages', 'admin'], ['/administer', null], ['/schedule', null],
  ])('recognizes %s without changing its destination', (path, expected) => {
    expect(viewForPath(path)).toBe(expected);
  });
  it('allows navigation when storage refuses access', () => {
    const read = vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new Error('blocked'); });
    const write = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('blocked'); });
    expect(readSessionView('alice')).toBeNull();
    expect(() => saveSessionView('alice','admin')).not.toThrow();
    read.mockRestore(); write.mockRestore();
  });
});
