// The version history words and formatters (issue #195). The collection
// list is pinned to the server's PUBLISHABLE_COLLECTIONS, imported from the
// functions source the way blockTypes.test.js pins the block registry, so
// the page can never offer a collection the endpoint refuses or miss one it
// serves.
import { describe, expect, it } from 'vitest';
import * as blockTypesCjs from '../../../../functions/src/cms/blockTypes.cjs';
import * as storeCjs from '../../../../functions/src/cms/store.cjs';
import * as timelineCjs from '../../../../functions/src/cms/timeline.cjs';
import { DELETE_FIELD_SENTINEL } from './contentDoc.js';
import {
  COLLECTION_CHOICES,
  collectionChoice,
  formatClock,
  formatPublishedAt,
  pageIdForSection,
  restoreRequestFor,
  toMillis,
} from './versionHistory.js';

const { PUBLISHABLE_COLLECTIONS } = blockTypesCjs.default ?? blockTypesCjs;
const { internals: storeInternals } = storeCjs.default ?? storeCjs;
const { validateTimelineFields } = timelineCjs.default ?? timelineCjs;

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

describe('restoreRequestFor', () => {
  const entry = (fields, visible = true) => ({ revision: 3, fields, visible });

  it('restores a content block through its editor endpoint and clears a field the version did not have', () => {
    const request = restoreRequestFor(
      'cmsContent',
      'hero__subtitle',
      entry({ section: 'hero', field: 'subtitle', blockType: 'text', value: 'Old', seeded: true, seededAt: 'x' }),
      { id: 'hero__subtitle', section: 'hero', field: 'subtitle', blockType: 'text', value: 'New', order: 2, status: 'clean' },
    );
    expect(request).toEqual({
      endpoint: 'cmsUpdateContent',
      body: {
        collection: 'cmsContent',
        section: 'hero',
        field: 'subtitle',
        fields: {
          section: 'hero', field: 'subtitle', blockType: 'text', value: 'Old', order: DELETE_FIELD_SENTINEL,
        },
        visible: true,
      },
    });
  });

  it('routes restored rich text through the authoritative content write endpoint', () => {
    const answer = '<p onclick="bad()"><strong>Earlier answer</strong></p><img src="x">';
    const request = restoreRequestFor(
      'cmsContent',
      'faq_items__earlier',
      entry({ section: 'faq_items', field: 'earlier', blockType: 'faq_item', question: 'Earlier?', answer }),
      { id: 'faq_items__earlier', section: 'faq_items', field: 'earlier', blockType: 'faq_item', question: 'Now?', answer: '<p>Now.</p>' },
    );
    expect(request.endpoint).toBe('cmsUpdateContent');
    // The request keeps the historical value intact. cmsUpdateContent owns
    // the shared sanitizer and cleans the merged record before storage.
    expect(request.body.fields.answer).toBe(answer);
  });

  it('never clears publish-model bookkeeping', () => {
    const current = { id: 's1', title: 'Now', materialCount: 2 };
    for (const key of storeInternals.RESERVED_FIELDS) current[key] = current[key] ?? 'x';
    const { body } = restoreRequestFor('cmsSchedule', 's1', entry({ title: 'Then' }, false), current);
    expect(body).toEqual({ collection: 'cmsSchedule', docId: 's1', fields: { title: 'Then' }, visible: false });
  });

  it('creates a deleted content block with its owning page id', () => {
    const version = entry({ section: 'hero', field: 'subtitle', blockType: 'text', value: 'Old' });
    expect(restoreRequestFor('cmsContent', 'hero__subtitle', version, null, { pageId: 'home' })).toEqual({
      endpoint: 'cmsCreateContent',
      body: {
        collection: 'cmsContent',
        pageId: 'home',
        section: 'hero',
        field: 'subtitle',
        fields: version.fields,
        visible: true,
      },
    });
    expect(restoreRequestFor('cmsContent', 'hero__subtitle', version, null)).toBeNull();
  });

  it('creates another deleted record again', () => {
    expect(restoreRequestFor('cmsTimeline', 't1', entry({ year: 2020, title: 'First' }), null)).toEqual({
      endpoint: 'cmsCreateContent',
      body: { collection: 'cmsTimeline', docId: 't1', fields: { year: 2020, title: 'First' }, visible: true },
    });
  });

  it('restores timeline fields without sending stored-only legacy keys', () => {
    const current = { id: 't1', year: 2025, title: 'Now', description: 'Remove this', legacyColor: 'blue' };
    const request = restoreRequestFor('cmsTimeline', 't1', entry({ year: 2020, title: 'Then', oldLink: 'legacy' }), current);
    expect(request.body.fields).toEqual({ year: 2020, title: 'Then', description: DELETE_FIELD_SENTINEL });
    const merged = { ...current, ...request.body.fields };
    delete merged.description;
    const checked = validateTimelineFields(merged, request.body.fields);
    expect(checked).toEqual({ ok: true, fields: { year: 2020, title: 'Then', description: null } });
  });

  it('sends a page and update through their whole-record save endpoints', () => {
    expect(restoreRequestFor('cmsPages', 'about', entry({ id: 'about', label: 'About', seeded: true }, false), { id: 'about' })).toEqual({
      endpoint: 'cmsSavePage',
      body: { page: { id: 'about', label: 'About', visible: false } },
    });
    expect(restoreRequestFor('cmsUpdates', 'u1', entry({ title: 'T', publishAt: '2026-09-23T18:02:00.000Z' }), null)).toEqual({
      endpoint: 'cmsSaveUpdate',
      body: { id: 'u1', update: { title: 'T', publishAt: '2026-09-23T18:02:00.000Z' }, visible: true, restore: true },
    });
    expect(restoreRequestFor('cmsUpdates', 'u1', entry({ title: 'T', publishAt: '2026-09-23T18:02:00.000Z' }), { id: 'u1' })).toEqual({
      endpoint: 'cmsSaveUpdate',
      body: { id: 'u1', update: { title: 'T', publishAt: '2026-09-23T18:02:00.000Z' }, visible: true },
    });
  });

  it('refuses a content version that cannot name its record', () => {
    expect(restoreRequestFor('cmsContent', 'hero__subtitle', entry({ value: 'x' }), null, { pageId: 'home' })).toBeNull();
    expect(restoreRequestFor('cmsContent', 'hero__subtitle', entry({ section: 'hero', field: 'title' }), null, { pageId: 'home' })).toBeNull();
  });
});

describe('pageIdForSection', () => {
  it('finds the current page that owns a section', () => {
    const pages = [
      { id: 'faq', current: { sections: [{ id: 'faq_items' }] } },
      { id: 'home', current: { sections: [{ id: 'hero' }] } },
    ];
    expect(pageIdForSection(pages, 'hero')).toBe('home');
    expect(pageIdForSection(pages, 'removed')).toBeNull();
  });
});
