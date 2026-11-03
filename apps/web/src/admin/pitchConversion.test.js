import { describe, expect, it } from 'vitest';
import { conversionMessage, presentersKey, splitName } from './pitchConversion.js';

describe('splitName', () => {
  it('keeps the last word as the last name', () => {
    expect(splitName('Mary Ann Smith')).toEqual(['Mary Ann', 'Smith']);
    expect(splitName('  Ada ')).toEqual(['Ada', '']);
    expect(splitName(null)).toEqual(['', '']);
  });
});

describe('conversionMessage', () => {
  it('names who was invited and counts who was not', () => {
    expect(conversionMessage({ invites: [
      { speakerId: 'a', email: 'a@example.org', sent: true },
      { speakerId: 'b', sent: false, message: 'x' },
    ] })).toBe('Private drafts created. Review the session and each speaker before publication. Invite sent to a@example.org. One invite was not sent. Resend from the speaker\'s page.');
  });
  it('says no email went out when nobody was invited', () => {
    expect(conversionMessage({ invites: [] })).toMatch(/No invite or email was sent\.$/);
    expect(conversionMessage({})).toMatch(/No invite or email was sent\.$/);
  });
});

describe('presentersKey', () => {
  const lead = { name: 'Ada', email: 'ada@example.org', lead: true };
  const bo = { name: 'Bo', email: 'bo@example.org', lead: false };
  it('changes when a presenter is replaced, renamed or removed', () => {
    const before = presentersKey({ presenters: [lead, bo] });
    expect(presentersKey({ presenters: [lead, bo] })).toBe(before);
    expect(presentersKey({ presenters: [lead, { ...bo, email: 'dee@example.org' }] })).not.toBe(before);
    expect(presentersKey({ presenters: [lead, { ...bo, name: 'Bo Writer' }] })).not.toBe(before);
    expect(presentersKey({ presenters: [lead] })).not.toBe(before);
  });
});
