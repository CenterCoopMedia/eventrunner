// The updates list's rows and the editor's payload (issue #190).
import { describe, expect, it } from 'vitest';
import {
  categoriesIn,
  categoryOf,
  dayInZone,
  dirtyUpdateIds,
  mergeUpdateRevisions,
  placementOf,
  publishAtFor,
  toUpdateForm,
  toUpdatePayload,
} from './updatesDoc.js';
import { publishDateLabel } from '../lib/updateDates.js';

const LIVE = { id: 'live-only', title: 'Live', body: 'b', publishAt: '2026-09-01T12:00:00Z', pinned: false, visible: true, status: undefined, revision: 2 };
const DIRTY_LIVE = { id: 'dirty', title: 'Old', body: 'b', publishAt: '2026-09-02T12:00:00Z', pinned: false, visible: true, revision: 1 };
const DIRTY_DRAFT = { id: 'dirty', title: 'New', body: 'b', publishAt: '2026-09-02T12:00:00Z', pinned: false, visible: true, status: 'dirty' };
const CLEAN_DRAFT = { id: 'live-only', title: 'Live', body: 'b', publishAt: '2026-09-01T12:00:00Z', pinned: false, status: 'clean' };
const DRAFT_ONLY = { id: 'draft-only', title: 'Draft', body: 'b', publishAt: null, pinned: true, status: 'dirty' };

// A seeded update as the demo seed writes it, with every bookkeeping key
// the server would refuse by name.
const SEEDED = {
  id: 'seeded-post',
  title: 'Seeded post',
  body: 'Body text.',
  publishAt: '2026-09-12T13:00:00.000Z',
  pinned: true,
  visible: true,
  featuredImage: { url: 'demo/summit-gathering.webp', alt: 'A scene' },
  content: [{ type: 'button', label: 'Open the schedule', href: '/schedule' }],
  seeded: true,
  seededAt: '2026-09-01T00:00:00.000Z',
  status: 'clean',
  revision: 3,
  basedOnRevision: 3,
  updatedAt: new Date('2026-09-01T00:00:00Z'),
  updatedBy: 'seed',
  publishedAt: new Date('2026-09-01T00:00:00Z'),
  publishedBy: 'seed',
};

describe('mergeUpdateRevisions', () => {
  it('gives one row per update with its state in the admin’s words, in the feed’s order', () => {
    const rows = mergeUpdateRevisions([LIVE, DIRTY_LIVE], [CLEAN_DRAFT, DIRTY_DRAFT, DRAFT_ONLY]);
    // Pinned first, then newest first; the draft is what an editor opens.
    expect(rows.map((row) => row.id)).toEqual(['draft-only', 'dirty', 'live-only']);
    expect(rows.map((row) => row.state.label)).toEqual(['Draft', 'Live with unpublished changes', 'Live']);
    expect(rows.find((row) => row.id === 'dirty').current.title).toBe('New');
  });

  it('breaks a tie in the feed’s order by id, so the order is stable', () => {
    const rows = mergeUpdateRevisions([{ id: 'b', publishAt: null }, { id: 'a', publishAt: null }], []);
    expect(rows.map((row) => row.id)).toEqual(['a', 'b']);
  });

  it('answers an empty list when neither listener has reported, and the live rows alone when only one has', () => {
    expect(mergeUpdateRevisions(null, null)).toEqual([]);
    // With the drafts still out, a row is built from its live doc alone.
    // That is why the editor opens a record only once both listeners have
    // reported (useAdminUpdates `ready`).
    const [row] = mergeUpdateRevisions([DIRTY_LIVE], null);
    expect(row.current.title).toBe('Old');
    expect(row.draft).toBeNull();
  });
});

describe('dirtyUpdateIds', () => {
  it('names only the updates whose draft is dirty, the listDirty predicate', () => {
    const rows = mergeUpdateRevisions([LIVE, DIRTY_LIVE], [CLEAN_DRAFT, DIRTY_DRAFT, DRAFT_ONLY]);
    expect(dirtyUpdateIds(rows)).toEqual(['draft-only', 'dirty']);
  });
});

describe('placementOf', () => {
  it('says where an update sits as a word', () => {
    expect(placementOf({ pinned: true })).toBe('Pinned');
    expect(placementOf({ pinned: false })).toBe('By date');
    expect(placementOf({})).toBe('By date');
  });

  it('names a featured update, pinned or not (issue 191)', () => {
    expect(placementOf({ featured: true })).toBe('Featured');
    expect(placementOf({ featured: true, pinned: true })).toBe('Featured and pinned');
    // Only a real true counts, the rule the public page reads.
    expect(placementOf({ featured: 'yes' })).toBe('By date');
  });
});

describe('the category (issue 191)', () => {
  it('reads a category the public page would show, trimmed, and nothing else', () => {
    expect(categoryOf({ category: ' Travel ' })).toBe('Travel');
    for (const category of [undefined, null, '', '  ', 7, 'x'.repeat(25), 'Two\nlines']) {
      expect(categoryOf({ category }), JSON.stringify(category)).toBeNull();
    }
  });

  it('offers the categories in use once each, in order', () => {
    const rows = mergeUpdateRevisions(
      [{ id: 'a', category: 'Travel' }, { id: 'b', category: 'Program' }, { id: 'c', category: 'Travel ' }, { id: 'd' }],
      [{ id: 'e', category: 'x'.repeat(30), status: 'dirty' }],
    );
    expect(categoriesIn(rows)).toEqual(['Program', 'Travel']);
  });
});

describe('the editor’s date, on the event’s clock', () => {
  it('shows a stored instant as its day in the event’s zone', () => {
    // 02:30 UTC on 1 October is still 30 September on the west coast.
    expect(dayInZone('2026-10-01T02:30:00Z', 'America/Los_Angeles')).toBe('2026-09-30');
    expect(dayInZone('2026-10-01T02:30:00Z', 'Pacific/Auckland')).toBe('2026-10-01');
    expect(dayInZone(null, 'America/Los_Angeles')).toBe('');
    expect(dayInZone({ toDate: () => new Date('2026-10-01T12:00:00Z') }, 'UTC')).toBe('2026-10-01');
  });

  it('sends null for a blank day', () => {
    expect(publishAtFor('', '2026-10-01T02:30:00Z', 'America/Los_Angeles')).toBeNull();
  });

  it('sends the stored instant back when the day did not change', () => {
    expect(publishAtFor('2026-09-30', '2026-10-01T02:30:00Z', 'America/Los_Angeles')).toBe('2026-10-01T02:30:00.000Z');
    // A Firestore Timestamp is read too.
    const stamp = { toDate: () => new Date('2026-10-01T02:30:00Z') };
    expect(publishAtFor('2026-09-30', stamp, 'America/Los_Angeles')).toBe('2026-10-01T02:30:00.000Z');
  });

  it('stores a changed day at noon on the event’s clock, which reads back as the same day', () => {
    for (const zone of ['Pacific/Auckland', 'America/Los_Angeles']) {
      const sent = publishAtFor('2026-10-20', '2026-10-01T02:30:00Z', zone);
      expect(dayInZone(sent, zone)).toBe('2026-10-20');
      expect(publishDateLabel(sent, zone)).toBe('October 20, 2026');
    }
    expect(publishAtFor('2026-10-20', null, 'America/Los_Angeles')).toBe('2026-10-20T19:00:00.000Z');
    expect(publishAtFor('2026-10-20', null, 'Pacific/Auckland')).toBe('2026-10-19T23:00:00.000Z');
  });

  it('stores noon UTC when the event has no zone or one the runtime does not know', () => {
    expect(publishAtFor('2026-10-20', null, undefined)).toBe('2026-10-20T12:00:00.000Z');
    expect(publishAtFor('2026-10-20', null, 'Not/AZone')).toBe('2026-10-20T12:00:00.000Z');
  });
});

describe('toUpdateForm and toUpdatePayload', () => {
  it('opens a stored update as a form', () => {
    const row = mergeUpdateRevisions([SEEDED], [])[0];
    expect(toUpdateForm(row, 'America/Los_Angeles')).toEqual({
      title: 'Seeded post',
      body: 'Body text.',
      date: '2026-09-12',
      category: '',
      pinned: true,
      featured: false,
      visible: true,
    });
    const tagged = mergeUpdateRevisions([{ ...SEEDED, category: 'Program', featured: true }], [])[0];
    expect(toUpdateForm(tagged)).toMatchObject({ category: 'Program', featured: true });
    expect(toUpdateForm(mergeUpdateRevisions([], [{ id: 'h', visible: false }])[0]).visible).toBe(false);
  });

  it('builds the payload from named keys: it keeps the picture and blocks and drops the bookkeeping', () => {
    const row = mergeUpdateRevisions([SEEDED], [])[0];
    const form = { ...toUpdateForm(row, 'America/Los_Angeles'), title: '  Seeded post, edited  ' };
    const payload = toUpdatePayload(form, row, 'America/Los_Angeles');
    expect(payload).toEqual({
      title: 'Seeded post, edited',
      body: 'Body text.',
      // The day did not change, so the stored instant goes back as it was.
      publishAt: '2026-09-12T13:00:00.000Z',
      pinned: true,
      category: null,
      featured: false,
      featuredImage: SEEDED.featuredImage,
      content: SEEDED.content,
    });
    for (const key of ['id', 'visible', 'status', 'revision', 'basedOnRevision', 'updatedAt', 'updatedBy', 'publishedAt', 'publishedBy', 'seeded', 'seededAt']) {
      expect(payload, key).not.toHaveProperty(key);
    }
  });

  it('sends null for a blank date and leaves out a picture and blocks the record never had', () => {
    const payload = toUpdatePayload({ title: 'T', body: 'B', date: '', pinned: false }, null, 'UTC');
    expect(payload).toEqual({ title: 'T', body: 'B', publishAt: null, pinned: false, category: null, featured: false });
  });

  it('sends the category trimmed, or null when blank, and featured as a boolean (issue 191)', () => {
    const base = { title: 'T', body: 'B', date: '', pinned: false };
    expect(toUpdatePayload({ ...base, category: '  Travel  ', featured: true }, null)).toMatchObject({ category: 'Travel', featured: true });
    expect(toUpdatePayload({ ...base, category: '   ', featured: false }, null)).toMatchObject({ category: null, featured: false });
  });
});
