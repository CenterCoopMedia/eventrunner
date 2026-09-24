// The version history words and formatters (issue #195). The collection
// list is pinned to the server's PUBLISHABLE_COLLECTIONS, imported from the
// functions source the way blockTypes.test.js pins the block registry, so
// the page can never offer a collection the endpoint refuses or miss one it
// serves.
import { describe, expect, it } from 'vitest';
import * as blockTypesCjs from '../../../../functions/src/cms/blockTypes.cjs';
import {
  COLLECTION_CHOICES,
  collectionChoice,
  formatClock,
  formatPublishedAt,
  pathText,
  recordNameOf,
  toMillis,
  valueText,
} from './versionHistory.js';

const { PUBLISHABLE_COLLECTIONS } = blockTypesCjs.default ?? blockTypesCjs;

// 2:02 PM on Sep 23, 2026 in New York (EDT, UTC-4).
const PUBLISHED = Date.UTC(2026, 8, 23, 18, 2);

describe('the collection choices', () => {
  it('are the server’s publishable collections, no more and no fewer', () => {
    expect(new Set(COLLECTION_CHOICES.map((choice) => choice.id))).toEqual(new Set(PUBLISHABLE_COLLECTIONS));
    expect(COLLECTION_CHOICES).toHaveLength(PUBLISHABLE_COLLECTIONS.length);
  });

  it('name each one in the list, singular and plural', () => {
    expect(COLLECTION_CHOICES.map((choice) => choice.label)).toEqual([
      'Content blocks', 'Pages', 'Sessions', 'Organizations', 'Updates', 'Timeline',
    ]);
    expect(collectionChoice('cmsTimeline')).toMatchObject({ singular: 'timeline entry', plural: 'timeline entries' });
    expect(collectionChoice('cmsContent')).toMatchObject({ singular: 'content block', plural: 'content blocks' });
  });

  it('find nothing for an id they do not hold, a prototype key included', () => {
    expect(collectionChoice('users')).toBeNull();
    expect(collectionChoice('constructor')).toBeNull();
    expect(collectionChoice(undefined)).toBeNull();
  });
});

describe('recordNameOf', () => {
  it('takes the first of title, name, label and question that holds text', () => {
    expect(recordNameOf('cmsPages', { id: 'about', label: 'About', title: 'About the summit' })).toBe('About the summit');
    expect(recordNameOf('cmsSchedule', { id: 's1', title: 'Opening keynote' })).toBe('Opening keynote');
    expect(recordNameOf('cmsOrganizations', { id: 'org', name: 'Example Press' })).toBe('Example Press');
    expect(recordNameOf('cmsUpdates', { id: 'u1', title: '  ', name: 'Doors open' })).toBe('Doors open');
    expect(recordNameOf('cmsTimeline', { id: 't1', title: 'First edition' })).toBe('First edition');
    expect(recordNameOf('cmsContent', { id: 'faq__one', question: 'Where do I park?' })).toBe('Where do I park?');
  });

  it('names a content block by its section and field, then any record by its id', () => {
    expect(recordNameOf('cmsContent', { id: 'hero__subtitle', section: 'hero', field: 'subtitle', value: 'x' })).toBe('hero › subtitle');
    expect(recordNameOf('cmsSchedule', { id: 'session-1' })).toBe('session-1');
    expect(recordNameOf('cmsSchedule', { id: 'session-1', section: 'hero', field: 'x' })).toBe('session-1');
  });

  it('cuts a long name at 80 characters', () => {
    const name = recordNameOf('cmsPages', { id: 'p', title: 'A'.repeat(120) });
    expect(name).toHaveLength(80);
    expect(name.endsWith('…')).toBe(true);
  });
});

describe('formatPublishedAt', () => {
  it('reads the date and time on the event clock, with the zone named', () => {
    expect(formatPublishedAt(PUBLISHED, 'America/New_York')).toBe('Sep 23, 2026, 2:02 PM EDT');
    expect(formatClock(PUBLISHED, 'America/New_York')).toBe('2:02 PM EDT');
  });

  it('takes a Date and a Timestamp-like value too', () => {
    expect(formatPublishedAt(new Date(PUBLISHED), 'America/New_York')).toBe('Sep 23, 2026, 2:02 PM EDT');
    const timestamp = { toMillis: () => PUBLISHED, seconds: PUBLISHED / 1000 };
    expect(toMillis(timestamp)).toBe(PUBLISHED);
    expect(formatPublishedAt(timestamp, 'America/New_York')).toBe('Sep 23, 2026, 2:02 PM EDT');
  });

  it('falls back to the reader’s clock with no zone, or a zone Intl refuses', () => {
    const readers = new Intl.DateTimeFormat('en-US', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(PUBLISHED));
    expect(formatPublishedAt(PUBLISHED)).toContain(readers);
    expect(formatPublishedAt(PUBLISHED, 'Not/AZone')).toContain(readers);
    expect(formatPublishedAt(PUBLISHED, 'Not/AZone')).toBe(formatPublishedAt(PUBLISHED));
  });

  it('answers null for a value that is not an instant', () => {
    expect(formatPublishedAt(null)).toBeNull();
    expect(formatPublishedAt('soon')).toBeNull();
    expect(formatPublishedAt({ _seconds: 1, _nanoseconds: 0 })).toBeNull();
  });
});

describe('valueText', () => {
  it('says each kind of value in words', () => {
    expect(valueText('')).toBe('Empty');
    expect(valueText(null)).toBe('Not set');
    expect(valueText(undefined)).toBe('Not set');
    expect(valueText(true)).toBe('Yes');
    expect(valueText(false)).toBe('No');
    expect(valueText(12)).toBe('12');
    expect(valueText('Hello')).toBe('Hello');
    expect(valueText([])).toBe('None');
    expect(valueText({})).toBe('None');
    expect(valueText(['a', 'b', 3])).toBe('a, b, 3');
    expect(valueText([{ id: 'a' }])).toBe('[{"id":"a"}]');
    expect(valueText({ lat: 1 })).toBe('{"lat":1}');
  });

  it('reads a time change as a date on the event clock', () => {
    expect(valueText(PUBLISHED, { time: true, timeZone: 'America/New_York' })).toBe('Sep 23, 2026, 2:02 PM EDT');
    expect(valueText(null, { time: true, timeZone: 'America/New_York' })).toBe('Not set');
  });

  it('keeps markup as characters: a stored tag is text, never parsed here', () => {
    expect(valueText('<img src=x onerror=alert(1)>')).toBe('<img src=x onerror=alert(1)>');
  });
});

describe('pathText', () => {
  it('joins segments and counts an index from one', () => {
    expect(pathText('value')).toBe('value');
    expect(pathText('layout.header')).toBe('layout › header');
    expect(pathText('sections.1.label')).toBe('sections › item 2 › label');
  });

  it('says what the visibility flag does', () => {
    expect(pathText('visible')).toBe('Shown on the site');
  });
});
