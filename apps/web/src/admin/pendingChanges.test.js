// The Unpublished changes page's helpers (issue #196).
//
// The state word and the row set are checked against documents the real
// server writer produces (functions/src/cms/store.cjs writeDraft, on the
// in-memory Firestore fake), and the rows against the server's own reader
// of unpublished work (listDirty, the set cmsPublish { all: true } takes),
// so the page cannot count a different set from the one that publishes.
import { describe, expect, it } from 'vitest';
import { makeFakeDb } from '../../../../functions/src/cms/firestoreFake.cjs';
import * as storeCjs from '../../../../functions/src/cms/store.cjs';
import {
  draftStateOf,
  editorPathFor,
  formatPublishedAt,
  groupPending,
  mergeRuns,
  recordNameOf,
  runSummary,
  summarizeAll,
  toMillis,
} from './pendingChanges.js';

const ACTOR = { uid: 'admin-1', email: 'admin@example.org' };
const NOW = Date.UTC(2026, 8, 23, 18, 2);

/** What the browser's listener sees: the seam's query on the same fake. */
async function dirtyDocs(db, collection) {
  const snap = await db.collection(`${collection}_drafts`).where('status', '==', 'dirty').get();
  return snap.docs.map((doc) => ({ id: doc.id, ...doc.data() }));
}

describe('draftStateOf, on drafts the real writer writes', () => {
  it('reads a never-published draft as Draft and a draft forked from a live doc as Live with unpublished changes', async () => {
    const db = makeFakeDb({ 'cmsContent/hero__title': { value: 'live', visible: true, revision: 3 } });
    await storeCjs.writeDraft({
      db, collection: 'cmsContent', docId: 'hero__subtitle',
      fields: { value: 'new', section: 'hero', field: 'subtitle' }, actor: ACTOR, now: () => NOW,
    });
    await storeCjs.writeDraft({
      db, collection: 'cmsContent', docId: 'hero__title',
      fields: { value: 'edited', section: 'hero', field: 'title' }, actor: ACTOR, now: () => NOW,
    });
    const drafts = await dirtyDocs(db, 'cmsContent');
    const byId = Object.fromEntries(drafts.map((draft) => [draft.id, draftStateOf(draft)]));
    expect(byId['hero__subtitle']).toEqual({ id: 'draft', label: 'Draft' });
    expect(byId['hero__title']).toEqual({ id: 'dirty', label: 'Live with unpublished changes' });
  });

  it('reads a draft published and then edited again as Live with unpublished changes', async () => {
    const db = makeFakeDb();
    const args = { db, collection: 'cmsPages', docId: 'home', actor: ACTOR, now: () => NOW };
    await storeCjs.writeDraft({ ...args, fields: { label: 'Home' } });
    await storeCjs.publishDocs({ db, collection: 'cmsPages', docIds: ['home'], actor: ACTOR, now: () => NOW });
    expect(await dirtyDocs(db, 'cmsPages')).toEqual([]);
    await storeCjs.writeDraft({ ...args, fields: { label: 'Home, again' } });
    const [draft] = await dirtyDocs(db, 'cmsPages');
    expect(draftStateOf(draft).label).toBe('Live with unpublished changes');
  });
});

describe('groupPending', () => {
  it('lists exactly the drafts listDirty publishes, per collection', async () => {
    const db = makeFakeDb({
      'cmsContent_drafts/a__one': { value: '1', status: 'dirty', section: 'a', field: 'one' },
      'cmsContent_drafts/a__two': { value: '2', status: 'clean', basedOnRevision: 1 },
      'cmsContent_drafts/a__three': { value: '3' },
      'cmsContent_drafts/a__four': { value: '4', status: 'DIRTY' },
      'cmsPages_drafts/home': { label: 'Home', status: 'dirty', basedOnRevision: 2 },
      'cmsSchedule_drafts/opening': { title: 'Opening', status: 'clean' },
    });
    const docsByCollection = {};
    for (const collection of ['cmsContent', 'cmsPages', 'cmsSchedule', 'cmsOrganizations', 'cmsUpdates', 'cmsTimeline']) {
      docsByCollection[collection] = await dirtyDocs(db, collection);
    }
    const groups = groupPending(docsByCollection);
    for (const { choice, rows } of groups) {
      expect(rows.map((row) => row.id).sort(), choice.id).toEqual(
        (await storeCjs.listDirty({ db, collection: choice.id })).sort(),
      );
    }
    expect(groups.map((group) => group.choice.id)).toEqual([
      'cmsContent', 'cmsPages', 'cmsSchedule', 'cmsOrganizations', 'cmsUpdates', 'cmsTimeline',
    ]);
    expect(groups[0].rows.map((row) => row.id)).toEqual(['a__one']);
  });

  it('orders by the newest save, then by id, and reads a Timestamp', () => {
    const stamp = (ms) => ({ toMillis: () => ms, toDate: () => new Date(ms) });
    const [content] = groupPending({
      cmsContent: [
        { id: 'b', updatedAt: stamp(1000) },
        { id: 'c', updatedAt: new Date(3000) },
        { id: 'a', updatedAt: stamp(1000) },
        { id: 'z' },
        { id: 'd', updatedAt: 2000 },
      ],
    });
    expect(content.rows.map((row) => row.id)).toEqual(['c', 'd', 'a', 'b', 'z']);
    expect(content.rows[0].savedAt).toBe(3000);
    expect(content.rows[2].savedAt).toBe(1000);
    expect(content.rows[4].savedAt).toBeNull();
  });

  it('carries the name, the state, the hidden flag, the section and field, and who saved it', () => {
    const [content] = groupPending({
      cmsContent: [{
        id: 'a__b__c', section: 'a__b', field: 'c', visible: false,
        basedOnRevision: null, updatedBy: 'staff@example.org', updatedAt: new Date(NOW),
      }],
    });
    expect(content.rows[0]).toEqual({
      id: 'a__b__c',
      name: 'a__b › c',
      fullName: 'a__b › c',
      state: { id: 'draft', label: 'Draft' },
      hidden: true,
      section: 'a__b',
      field: 'c',
      savedAt: NOW,
      savedBy: 'staff@example.org',
    });
  });
});

describe('recordNameOf', () => {
  it('takes the title, name, label or question, then section and field for a block, then the id', () => {
    expect(recordNameOf('cmsSchedule', { id: 's1', title: 'Opening' })).toBe('Opening');
    expect(recordNameOf('cmsOrganizations', { id: 'o1', name: 'Acme' })).toBe('Acme');
    expect(recordNameOf('cmsPages', { id: 'home', label: 'Home' })).toBe('Home');
    expect(recordNameOf('cmsContent', { id: 'faq__q1', question: 'Where?', section: 'faq', field: 'q1' })).toBe('Where?');
    expect(recordNameOf('cmsContent', { id: 'hero__subtitle', section: 'hero', field: 'subtitle' })).toBe('hero › subtitle');
    expect(recordNameOf('cmsUpdates', { id: 'u1', title: '   ' })).toBe('u1');
  });

  it('cuts a long name at 80 characters', () => {
    const name = recordNameOf('cmsSchedule', { id: 's', title: 'x'.repeat(200) });
    expect(name).toHaveLength(80);
    expect(name.endsWith('…')).toBe(true);
  });

  it('keeps the whole name beside the cut one on each row', () => {
    const title = `An update whose title runs long ${'and longer '.repeat(10)}to the end`;
    const [, , , , updates] = groupPending({ cmsUpdates: [{ id: 'u1', title }] });
    expect(updates.rows[0].name).toHaveLength(80);
    expect(updates.rows[0].fullName).toBe(title);
  });
});

describe('formatPublishedAt', () => {
  it('writes the event clock with its zone', () => {
    expect(formatPublishedAt(NOW, 'America/New_York')).toBe('Sep 23, 2026, 2:02 PM EDT');
  });

  it('falls back to the reader’s clock with no zone or an unknown one', () => {
    // Whatever zone the machine runs in: the reader's own clock, as Intl
    // writes it, then that zone's label.
    const reader = formatPublishedAt(NOW);
    const clock = new Intl.DateTimeFormat('en-US', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(NOW));
    expect(reader.startsWith(`${clock} `)).toBe(true);
    expect(reader.length).toBeGreaterThan(clock.length + 1);
    expect(formatPublishedAt(NOW, 'Not/AZone')).toBe(reader);
    expect(formatPublishedAt(null, 'America/New_York')).toBeNull();
  });

  it('takes a Timestamp through toMillis', () => {
    expect(formatPublishedAt(toMillis({ toMillis: () => NOW }), 'America/New_York')).toBe('Sep 23, 2026, 2:02 PM EDT');
  });
});

describe('editorPathFor', () => {
  const pages = [
    { id: 'home', current: { sections: [{ id: 'hero' }, { id: 'a__b' }] } },
    { id: 'about page', current: { sections: [{ id: 'story' }] } },
  ];

  it('links pages and sessions to their editors', () => {
    expect(editorPathFor('cmsPages', { id: 'home' }, pages)).toBe('/admin/pages/home');
    expect(editorPathFor('cmsSchedule', { id: 'opening' }, pages)).toBe('/admin/sessions/opening');
  });

  it('links a content block to its block editor through the page that lists its section', () => {
    expect(
      editorPathFor('cmsContent', { id: 'hero__subtitle', section: 'hero', field: 'subtitle' }, pages),
    ).toBe('/admin/content/home/hero/subtitle');
    // The section comes from the draft, never from splitting the id.
    expect(editorPathFor('cmsContent', { id: 'a__b__c', section: 'a__b', field: 'c' }, pages)).toBe(
      '/admin/content/home/a__b/c',
    );
    expect(editorPathFor('cmsContent', { id: 'story__lead', section: 'story', field: 'lead' }, pages)).toBe(
      '/admin/content/about%20page/story/lead',
    );
  });

  it('sends a content block no page lists to the content index', () => {
    expect(editorPathFor('cmsContent', { id: 'gone__x', section: 'gone', field: 'x' }, pages)).toBe('/admin/content');
    expect(editorPathFor('cmsContent', { id: 'hero__x', section: 'hero', field: 'x' }, [])).toBe('/admin/content');
    expect(editorPathFor('cmsContent', { id: 'odd' }, pages)).toBe('/admin/content');
  });

  it('encodes every segment, and gives no link where a segment would leave its section', () => {
    expect(editorPathFor('cmsPages', { id: 'a b#c?d' }, pages)).toBe('/admin/pages/a%20b%23c%3Fd');
    // Firestore ids never hold a slash; one that did could not route, so
    // it gets no link rather than a path into another section.
    expect(editorPathFor('cmsPages', { id: '../branding' }, pages)).toBeNull();
    expect(editorPathFor('cmsSchedule', { id: 'a/b' }, pages)).toBeNull();
  });

  it('gives no link to an editor the docket does not own yet', () => {
    expect(editorPathFor('cmsUpdates', { id: 'u1' }, pages)).toBeNull();
    expect(editorPathFor('cmsOrganizations', { id: 'o1' }, pages)).toBeNull();
    expect(editorPathFor('cmsTimeline', { id: 't1' }, pages)).toBeNull();
    expect(editorPathFor('cmsUnknown', { id: 'x' }, pages)).toBeNull();
  });
});

describe('runSummary', () => {
  const request = { cmsContent: ['a', 'b', 'c'], cmsPages: ['home'] };

  it('reads a done run, with any skipped changes', () => {
    expect(runSummary({
      id: 'q1', status: 'done', request,
      progress: { cmsContent: { published: ['a', 'b', 'c'], skipped: [] }, cmsPages: { published: ['home'], skipped: [] } },
    })).toEqual({ id: 'q1', word: 'Done', tone: 'done', sentence: '4 of 4 published.' });
    expect(runSummary({
      id: 'q2', status: 'done', request,
      progress: { cmsContent: { published: ['a', 'b'], skipped: [{ docId: 'c', reason: 'conflict' }] }, cmsPages: { published: ['home'] } },
    }).sentence).toBe('3 of 4 published. 1 skipped.');
  });

  it('reads a running run and a failed one', () => {
    const progress = { cmsContent: { published: ['a'], skipped: [] } };
    expect(runSummary({ id: 'q3', status: 'running', request, progress })).toEqual({
      id: 'q3', word: 'Running', tone: 'info', sentence: '1 of 4 published so far.',
    });
    expect(runSummary({
      id: 'q4', status: 'failed', request, progress, error: 'Boom.', note: 'Marked by hand.',
    })).toEqual({ id: 'q4', word: 'Failed', tone: 'error', sentence: '1 of 4 published before it stopped.' });
    expect(runSummary({ id: 'q5', status: 'failed', request: { cmsContent: ['a'] } }).sentence).toBe(
      '0 of 1 published before it stopped.',
    );
  });

  it('says Unknown for any other status', () => {
    expect(runSummary({ id: 'q6', status: 'complete' })).toEqual({ id: 'q6', word: 'Unknown', tone: 'neutral', sentence: null });
    expect(runSummary({ id: 'q7' }).word).toBe('Unknown');
  });
});

describe('mergeRuns', () => {
  it('keeps each run once, newest request first', () => {
    const at = (ms) => ({ toMillis: () => ms });
    const recent = [
      { id: 'r3', status: 'done', requestedAt: at(3000) },
      { id: 'f1', status: 'failed', requestedAt: at(2000) },
    ];
    const failed = [
      { id: 'f1', status: 'failed', requestedAt: at(2000) },
      { id: 'f0', status: 'failed', requestedAt: new Date(500) },
    ];
    expect(mergeRuns(recent, failed).map((row) => row.id)).toEqual(['r3', 'f1', 'f0']);
    expect(mergeRuns(null, failed).map((row) => row.id)).toEqual(['f1', 'f0']);
    expect(mergeRuns(null, null)).toEqual([]);
  });
});

describe('summarizeAll', () => {
  it('says so when nothing was waiting', () => {
    expect(summarizeAll({ queueId: null, status: 'done', results: {} })).toEqual({
      ok: true, message: 'Nothing was waiting to be published.',
    });
  });

  it('counts every change published', () => {
    expect(summarizeAll({
      results: {
        cmsContent: { published: ['a', 'b'], skipped: [] },
        cmsPages: { published: ['home', 'about', 'faq'], skipped: [] },
      },
    })).toEqual({ ok: true, message: 'Published 5 changes. The public site picks them up live.' });
    expect(summarizeAll({ results: { cmsContent: { published: ['a'], skipped: [] } } }).message).toBe(
      'Published 1 change. The public site picks it up live.',
    );
  });

  it('names a change edited while publishing', () => {
    const verdict = summarizeAll({
      results: {
        cmsContent: { published: ['a'], skipped: [{ docId: 'b', reason: 'conflict' }] },
        cmsPages: { published: ['home'], skipped: [] },
      },
    });
    expect(verdict.ok).toBe(false);
    expect(verdict.message).toBe(
      'Published 1 of 2 content blocks. Not published: b was edited while publishing, so its newer draft stayed unpublished.',
    );
  });
});
