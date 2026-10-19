// A cta or link_group block that points at a system page whose feature is
// off leads a reader to "This event doesn't have a public schedule". The
// launch rehearsal saved "Explore the program → /schedule" with the schedule
// off, and the home page drew it.
import { describe, expect, it } from 'vitest';
import { switchedOffSectionFor, withoutSwitchedOffLinks } from './linkTargets.js';

const OFF = { schedule: false, speakers: false, sponsors: false, updates: false, attendeeDirectory: false };
const ON = { schedule: true, speakers: true, sponsors: true, updates: true, attendeeDirectory: true };

describe('switchedOffSectionFor', () => {
  it('names the feature of a system page that is off', () => {
    expect(switchedOffSectionFor('/schedule', OFF)).toBe('schedule');
    expect(switchedOffSectionFor('/speakers', OFF)).toBe('speakers');
    expect(switchedOffSectionFor('/sponsors', OFF)).toBe('sponsors');
    expect(switchedOffSectionFor('/updates', OFF)).toBe('updates');
    expect(switchedOffSectionFor('/attendees', OFF)).toBe('attendeeDirectory');
  });

  it('covers a detail route, a trailing slash, a query, and a fragment', () => {
    expect(switchedOffSectionFor('/schedule/abc', OFF)).toBe('schedule');
    expect(switchedOffSectionFor('/schedule/', OFF)).toBe('schedule');
    expect(switchedOffSectionFor('/schedule?day=1', OFF)).toBe('schedule');
    expect(switchedOffSectionFor('/speakers#keynote', OFF)).toBe('speakers');
  });

  it('says nothing when the feature is on', () => {
    expect(switchedOffSectionFor('/schedule', ON)).toBeNull();
    expect(switchedOffSectionFor('/schedule/abc', ON)).toBeNull();
  });

  it('says nothing for the home page, a generic page, or a link off the site', () => {
    expect(switchedOffSectionFor('/', OFF)).toBeNull();
    expect(switchedOffSectionFor('/travel', OFF)).toBeNull();
    expect(switchedOffSectionFor('/tickets', OFF)).toBeNull();
    expect(switchedOffSectionFor('https://example.org/schedule', OFF)).toBeNull();
    expect(switchedOffSectionFor('//example.org/schedule', OFF)).toBeNull();
    expect(switchedOffSectionFor('mailto:help@example.org', OFF)).toBeNull();
    expect(switchedOffSectionFor(undefined, OFF)).toBeNull();
  });

  it('keeps the link while the feature flags are not known', () => {
    expect(switchedOffSectionFor('/schedule', null)).toBeNull();
    expect(switchedOffSectionFor('/schedule', undefined)).toBeNull();
  });
});

describe('withoutSwitchedOffLinks', () => {
  const blocks = [
    { field: 'a', blockType: 'cta', label: 'Explore the program', url: '/schedule' },
    { field: 'b', blockType: 'link_group', label: 'Speakers', url: '/speakers' },
    { field: 'c', blockType: 'cta', label: 'Get tickets', url: '/tickets' },
    { field: 'd', blockType: 'richtext', value: '<p><a href="/schedule">x</a></p>' },
    { field: 'e', blockType: 'link_group', label: 'Contact', url: 'mailto:help@example.org' },
  ];

  it('drops only the cta and link_group blocks that lead to a section that is off', () => {
    expect(withoutSwitchedOffLinks(blocks, OFF).map((block) => block.field)).toEqual(['c', 'd', 'e']);
  });

  it('keeps every block when the features are on', () => {
    expect(withoutSwitchedOffLinks(blocks, ON)).toEqual(blocks);
  });

  it('meets a missing list', () => {
    expect(withoutSwitchedOffLinks(undefined, OFF)).toEqual([]);
  });
});
