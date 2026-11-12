// Query contract for removed-record discovery (#879). Uses the browser SDK,
// the real query seam and the Firestore emulator; only the connection changes.
import { readFileSync } from 'node:fs';
import { afterAll, beforeAll, expect, it, vi } from 'vitest';
import { initializeTestEnvironment } from '@firebase/rules-unit-testing';
import { doc, writeBatch } from 'firebase/firestore';

const connection = vi.hoisted(() => ({ db: null, reads: [] }));
vi.mock('../apps/web/src/firebase.js', () => ({ get db() { return connection.db; } }));
vi.mock('firebase/firestore', async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    getDocs: async (request) => {
      const snapshot = await actual.getDocs(request);
      connection.reads.push(snapshot.size);
      return snapshot;
    },
  };
});

import { readAdminVersions } from '../apps/web/src/admin/adminSource.js';
import { removedVersionRecords } from '../apps/web/src/admin/versionHistory.js';

let testEnv;

beforeAll(async () => {
  testEnv = await initializeTestEnvironment({
    projectId: 'demo-version-records',
    firestore: { rules: readFileSync('firestore.rules', 'utf8') },
  });
  await testEnv.clearFirestore();
  await testEnv.withSecurityRulesDisabled(async (context) => {
    const db = context.firestore();
    const batch = writeBatch(db);
    batch.set(doc(db, 'config/bootstrap'), { adminEmails: ['history@example.test'] });
    batch.set(doc(db, 'cmsPages/a-current'), { title: 'Current page' });
    batch.set(doc(db, 'cmsPages_drafts/d-draft'), { title: 'Draft page' });
    for (const [id, revisions] of [['a-current', 101], ['b-removed', 30], ['c-removed', 2], ['d-draft', 1]]) {
      for (let revision = 1; revision <= revisions; revision += 1) {
        batch.set(doc(db, `cmsVersionHistory/${id}-${revision}`), {
          docPath: `cmsPages/${id}`, revision,
          fields: { title: `${id} version ${revision}` },
        });
      }
    }
    batch.set(doc(db, 'cmsVersionHistory/other'), { docPath: 'cmsSchedule/other', revision: 1, fields: { title: 'Other collection' } });
    await batch.commit();
  });
  connection.db = testEnv.authenticatedContext('history-editor', {
    email: 'history@example.test', email_verified: true,
  }).firestore();
});

afterAll(async () => {
  await testEnv?.clearFirestore();
  await testEnv?.cleanup();
});

it('reaches later removed records without paging through the earlier records’ revisions', async () => {
  const pages = [];
  let cursor = null;
  let firstRemovedPage = null;
  // Six pages exhaust this fixture even with a full revision cursor. This
  // bounded measurement does not add automatic paging to the application.
  for (let page = 1; page <= 6; page += 1) {
    const answer = await readAdminVersions('cmsPages', cursor);
    pages.push(answer);
    if (firstRemovedPage === null && answer.entries.some((entry) => entry.docPath === 'cmsPages/b-removed')) firstRemovedPage = page;
    cursor = answer.nextCursor;
    if (!cursor) break;
  }
  const removed = removedVersionRecords('cmsPages', pages.flatMap((page) => page.entries), [
    { id: 'a-current', current: { title: 'Current page' } },
    { id: 'd-draft', current: { title: 'Draft page' } },
  ]);
  expect(removed.map(({ id, revision, fields }) => ({ id, revision, title: fields.title }))).toEqual([
    { id: 'b-removed', revision: 30, title: 'b-removed version 30' },
    { id: 'c-removed', revision: 2, title: 'c-removed version 2' },
  ]);
  expect(firstRemovedPage, `Documents returned per query: ${JSON.stringify(connection.reads)}`).toBe(2);
  expect(connection.reads).toEqual([26, 26, 3]);
  expect(pages[0].entries).toHaveLength(25);
  expect(pages[1].entries).toHaveLength(25);
  expect(cursor).toBeNull();
});
