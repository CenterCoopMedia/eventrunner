import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { assertFails, assertSucceeds, initializeTestEnvironment } from '@firebase/rules-unit-testing';
import { collection, doc, getDoc, getDocs, query, setDoc, where } from 'firebase/firestore';

const require = createRequire(import.meta.url);
const { getEventPhase } = require('../packages/shared/src/config/lifecycle.cjs');
let environment;

beforeAll(async () => {
  environment = await initializeTestEnvironment({
    projectId: 'demo-past-event-hosting', firestore: { rules: readFileSync('firestore.rules', 'utf8') },
  });
  await environment.clearFirestore();
});

afterAll(async () => {
  await environment?.clearFirestore();
  await environment?.cleanup();
});

for (const daysAfter of [31, 366]) {
  for (const archived of [false, true]) {
    it(`keeps published content public ${daysAfter} days after the event (${archived ? 'archived' : 'ended'})`, async () => {
      const date = new Date(Date.now() - daysAfter * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
      const event = {
        name: 'Past Example Event', timezone: 'UTC', announcedAt: `${date}T00:00`,
        archivedAt: archived ? `${date}T18:00` : null, historicalDemo: archived,
        days: [{ id: 'past-day', date, startTime: '09:00', endTime: '17:00' }],
      };
      expect(getEventPhase(event)).toBe(archived ? 'archived' : 'ended');
      await environment.withSecurityRulesDisabled(async (context) => {
        const db = context.firestore();
        await setDoc(doc(db, 'config/event'), event);
        for (const name of ['cmsPages', 'cmsSchedule', 'cmsContent']) {
          await setDoc(doc(db, `${name}/published`), { body: 'Past event content', visible: true, revision: 1 });
          await setDoc(doc(db, `${name}/hidden`), { body: 'Private content', visible: false, revision: 1 });
          await setDoc(doc(db, `${name}_drafts/published`), { body: 'Unpublished edit', visible: true, status: 'dirty', basedOnRevision: 1 });
        }
      });
      const client = environment.unauthenticatedContext().firestore();
      await assertSucceeds(getDoc(doc(client, 'config/event')));
      for (const name of ['cmsPages', 'cmsSchedule', 'cmsContent']) {
        const page = await assertSucceeds(getDoc(doc(client, `${name}/published`)));
        expect(page.data().body).toBe('Past event content');
        const listed = await assertSucceeds(getDocs(query(collection(client, name), where('visible', '==', true))));
        expect(listed.docs.map((row) => row.id)).toEqual(['published']);
        await assertFails(getDoc(doc(client, `${name}/hidden`)));
        await assertFails(getDoc(doc(client, `${name}_drafts/published`)));
      }
    });
  }
}
