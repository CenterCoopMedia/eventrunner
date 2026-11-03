import { describe, expect, it } from 'vitest';
import { conversionMessage, splitName } from './pitchConversion.js';

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
