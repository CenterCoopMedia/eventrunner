// Bulk material download and coverage (issue 189), driven through the real
// materials page.
//
// A staff account (the tier that runs Materials) signs in through the real
// sign-in page, selects files in the table, and presses "Download as
// archive". The evidence is what the browser saves: the zip is read from
// disk, and its entry names, bytes and CRC-32 values are checked against the
// objects put in Storage. The coverage panel is then read off the page and
// compared with the rule applied to the stores behind it (the live sessions,
// the speakers, and the same materials the table lists), read here with the
// Admin SDK.
//
// Two hidden sessions and one speaker are made for this file, so the
// materials and the coverage change nothing another spec counts; they are
// removed at the end, and config/bootstrap is restored.
import fs from 'node:fs';
import zlib from 'node:zlib';
import { test, expect } from '@playwright/test';
import { getStorage } from 'firebase-admin/storage';
import { PROJECT_ID, adminApp, adminDb, adminIdToken, callFunction, signIn } from './helpers.mjs';

const STAFF_EMAIL = 'e2e-materials-staff@example.test';
const COUNTED = ['pending', 'approved'];

function bucket() {
  return getStorage(adminApp()).bucket(process.env.EVENT_STORAGE_BUCKET || `${PROJECT_ID}.appspot.com`);
}

/** The entries of a zip, read from its central directory: name, CRC-32, method, bytes. */
function readZip(buffer) {
  let eocd = -1;
  for (let offset = buffer.length - 22; offset >= 0; offset -= 1) {
    if (buffer.readUInt32LE(offset) === 0x06054b50) {
      eocd = offset;
      break;
    }
  }
  expect(eocd, 'the file ends with a zip directory').toBeGreaterThanOrEqual(0);
  const count = buffer.readUInt16LE(eocd + 10);
  let cursor = buffer.readUInt32LE(eocd + 16);
  const entries = [];
  for (let index = 0; index < count; index += 1) {
    expect(buffer.readUInt32LE(cursor)).toBe(0x02014b50);
    const method = buffer.readUInt16LE(cursor + 10);
    const crc32 = buffer.readUInt32LE(cursor + 16);
    const size = buffer.readUInt32LE(cursor + 20);
    const nameLength = buffer.readUInt16LE(cursor + 28);
    const extraLength = buffer.readUInt16LE(cursor + 30);
    const commentLength = buffer.readUInt16LE(cursor + 32);
    const local = buffer.readUInt32LE(cursor + 42);
    const name = buffer.subarray(cursor + 46, cursor + 46 + nameLength).toString('utf8');
    const start = local + 30 + buffer.readUInt16LE(local + 26) + buffer.readUInt16LE(local + 28);
    entries.push({ name, method, crc32, data: buffer.subarray(start, start + size) });
    cursor += 46 + nameLength + extraLength + commentLength;
  }
  return entries;
}

/** The coverage rule, written again from the issue's words, over the stores. */
function expectedCoverage({ sessions, speakers, materials }) {
  const speakerById = new Map(speakers.map((speaker) => [speaker.id, speaker]));
  const nameOf = (id) => {
    const record = speakerById.get(id);
    const name = record ? `${record.firstName ?? ''} ${record.lastName ?? ''}`.trim() : '';
    return name || id;
  };
  const counted = new Set(materials.filter((m) => COUNTED.includes(m.reviewStatus)).map((m) => m.sessionId));
  const considered = sessions
    .map((session) => ({
      id: session.id,
      title: typeof session.title === 'string' && session.title.trim() ? session.title : session.id,
      speakerIds: [...new Set(Array.isArray(session.speakerIds) ? session.speakerIds : [])].filter(
        (id) => typeof id === 'string' && id && speakerById.get(id)?.status !== 'removed',
      ),
    }))
    .filter((session) => session.speakerIds.length > 0);
  const uncoveredSessions = considered.filter((session) => !counted.has(session.id));
  const speakerCovered = new Map();
  for (const session of considered) {
    for (const id of session.speakerIds) {
      speakerCovered.set(id, speakerCovered.get(id) === true || counted.has(session.id));
    }
  }
  const uncoveredSpeakers = [...speakerCovered.entries()].filter(([, covered]) => !covered).map(([id]) => nameOf(id));
  return {
    considered: considered.length,
    covered: considered.length - uncoveredSessions.length,
    uncoveredSessions: uncoveredSessions.map((session) => session.title).sort(),
    uncoveredSpeakers: uncoveredSpeakers.sort(),
  };
}

/** The panel's summary sentence for these figures, singular and plural as the page words them. */
function summaryOf({ covered, considered, uncoveredSessions, uncoveredSpeakers }) {
  const none = uncoveredSessions.length;
  const speakers = uncoveredSpeakers.length;
  return `${covered} of ${considered} ${considered === 1 ? 'session' : 'sessions'} with speakers `
    + `${covered === 1 ? 'has' : 'have'} materials. ${none} ${none === 1 ? 'has' : 'have'} none. `
    + `${speakers} ${speakers === 1 ? 'speaker has' : 'speakers have'} no materials on any of their sessions.`;
}

async function readStores() {
  const db = adminDb();
  const [sessions, speakers, materials] = await Promise.all(
    ['cmsSchedule', 'speakers', 'session_materials'].map((name) => db.collection(name).get()),
  );
  const rows = (snap) => snap.docs.map((doc) => ({ id: doc.id, ...doc.data() }));
  return { sessions: rows(sessions), speakers: rows(speakers), materials: rows(materials) };
}

/** The first child of each row of one coverage list, as the page shows it. */
async function coverageList(page, name) {
  const region = page.getByRole('region', { name });
  if ((await region.count()) === 0) return [];
  return region.locator('li').evaluateAll((items) => items.map((item) => item.firstElementChild.textContent));
}

test.describe.serial('bulk material download and coverage', () => {
  const stamp = Date.now();
  const covered = { id: `e2e-materials-a-${stamp}`, title: `Archive check A ${stamp}` };
  const uncovered = { id: `e2e-materials-b-${stamp}`, title: `Archive check B ${stamp}` };
  const speaker = { id: `e2e-materials-speaker-${stamp}`, firstName: 'Noor', lastName: `Haddad ${stamp}` };
  const files = {
    'slides.pdf': Buffer.from(`%PDF-1.4 slides for ${stamp}\n`),
    'notes.txt': Buffer.from(`speaker notes ${stamp}\n`.repeat(40)),
  };
  const materialIds = {};
  let seededBootstrap;
  let context;
  let page;

  test.beforeAll(async ({ browser }) => {
    const db = adminDb();
    const config = db.collection('config');
    seededBootstrap = (await config.doc('bootstrap').get()).data();
    await config.doc('bootstrap').set({
      ...seededBootstrap,
      staffEmails: [...(seededBootstrap.staffEmails ?? []), STAFF_EMAIL],
    });

    // Hidden, so no public count moves; the admin page still lists them.
    await db.collection('speakers').doc(speaker.id).set({
      firstName: speaker.firstName, lastName: speaker.lastName, status: 'accepted',
      createdAt: new Date(), updatedAt: new Date(),
    });
    const base = { dayId: 'day-3', startTime: '15:00', endTime: '15:30', visible: false, description: '', location: '' };
    await db.collection('cmsSchedule').doc(covered.id).set({ ...base, title: covered.title, speakerIds: ['speaker-lucia-bennett'] });
    await db.collection('cmsSchedule').doc(uncovered.id).set({ ...base, title: uncovered.title, speakerIds: [speaker.id] });

    // The bytes go to Storage and the records through the real endpoints,
    // the way the media library and a speaker would register them.
    const token = await adminIdToken();
    for (const [filename, bytes] of Object.entries(files)) {
      const storagePath = `session-materials/${covered.id}/${filename}`;
      await bucket().file(storagePath).save(bytes, { contentType: 'application/octet-stream' });
      const created = await callFunction('uploadSessionMaterial', { sessionId: covered.id, storagePath, filename }, token);
      expect(created.status).toBe(200);
      materialIds[filename] = created.body.id;
    }
    const linked = await callFunction(
      'addSessionMaterialLink',
      { sessionId: uncovered.id, url: 'https://example.org/reading-list', label: 'Reading list' },
      token,
    );
    expect(linked.status).toBe(200);
    materialIds.link = linked.body.id;
    const rejected = await callFunction('setMaterialReviewStatus', { materialId: linked.body.id, reviewStatus: 'rejected' }, token);
    expect(rejected.status).toBe(200);

    context = await browser.newContext({ acceptDownloads: true });
    page = await context.newPage();
    await signIn(page, STAFF_EMAIL);
  });

  test.afterAll(async () => {
    await context?.close();
    const db = adminDb();
    for (const id of Object.values(materialIds)) await db.collection('session_materials').doc(id).delete();
    for (const filename of Object.keys(files)) {
      await bucket().file(`session-materials/${covered.id}/${filename}`).delete({ ignoreNotFound: true });
    }
    await db.collection('cmsSchedule').doc(covered.id).delete();
    await db.collection('cmsSchedule').doc(uncovered.id).delete();
    await db.collection('speakers').doc(speaker.id).delete();
    if (seededBootstrap) await db.collection('config').doc('bootstrap').set(seededBootstrap);
  });

  test('an archive downloads the selected files', async () => {
    const logsBefore = (await adminDb().collection('admin_logs').where('action', '==', 'downloadSessionMaterialsArchive').get()).size;

    await page.goto('/admin/materials');
    await expect(page.getByRole('heading', { level: 1, name: 'Materials' })).toBeVisible();
    await page.getByLabel('Session', { exact: true }).selectOption({ label: covered.title });
    const table = page.getByRole('region', { name: 'Materials' });
    await expect(table.getByRole('checkbox', { name: 'Select slides.pdf' })).toBeVisible();

    await table.getByRole('checkbox', { name: 'Select slides.pdf' }).check();
    await table.getByRole('checkbox', { name: 'Select notes.txt' }).check();
    await expect(page.getByRole('status').filter({ hasText: /files? selected$/ })).toHaveText('2 files selected');

    const button = page.getByRole('button', { name: 'Download as archive' });
    const [download] = await Promise.all([page.waitForEvent('download'), button.click()]);
    expect(download.suggestedFilename()).toBe('session-materials.zip');
    await expect(page.getByText('Downloaded an archive of 2 files.')).toBeVisible();

    // The file on disk: one entry per selected file, in table order, stored,
    // each holding exactly the bytes put in Storage.
    const entries = readZip(fs.readFileSync(await download.path()));
    expect(entries.map((entry) => entry.name)).toEqual([`${covered.id}/notes.txt`, `${covered.id}/slides.pdf`]);
    for (const entry of entries) {
      const bytes = files[entry.name.split('/')[1]];
      expect(entry.method).toBe(0);
      expect(entry.crc32).toBe(zlib.crc32(bytes));
      expect(Buffer.compare(entry.data, bytes)).toBe(0);
    }

    // One audit row per file, naming the staff account.
    const logs = await adminDb().collection('admin_logs').where('action', '==', 'downloadSessionMaterialsArchive').get();
    expect(logs.size).toBe(logsBefore + 2);
    const rows = logs.docs.map((doc) => doc.data()).filter((row) => row.email === STAFF_EMAIL);
    expect(rows.map((row) => row.docPath).sort()).toEqual(
      [materialIds['notes.txt'], materialIds['slides.pdf']].map((id) => `session_materials/${id}`).sort(),
    );
  });

  test('the coverage panel matches the material list', async () => {
    await page.goto('/admin/materials');
    const table = page.getByRole('region', { name: 'Materials' });
    await expect(table.getByText('slides.pdf', { exact: true })).toBeVisible();

    // The table lists exactly the stored materials.
    const stores = await readStores();
    const listed = await table.locator('tbody tr td:nth-child(2) p:first-child').allTextContents();
    expect(listed.sort()).toEqual(stores.materials.map((material) => material.filename).sort());

    // The panel states the rule applied to that list.
    const expected = expectedCoverage(stores);
    expect(expected.uncoveredSessions).toContain(uncovered.title);
    expect(expected.uncoveredSessions).not.toContain(covered.title);
    expect(expected.uncoveredSpeakers).toContain(`${speaker.firstName} ${speaker.lastName}`);

    const panel = page.locator('section').filter({ has: page.getByRole('heading', { name: 'Coverage', exact: true }) });
    await expect(panel).toContainText(summaryOf(expected));
    expect((await coverageList(page, 'Sessions with no materials')).sort()).toEqual(expected.uncoveredSessions);
    expect((await coverageList(page, 'Speakers with no materials')).sort()).toEqual(expected.uncoveredSpeakers);

    // It follows the list: approving the rejected link covers the session and its speaker.
    await page.getByLabel('Session', { exact: true }).selectOption({ label: uncovered.title });
    await table.getByRole('button', { name: 'Approve' }).click();
    const sessions = page.getByRole('region', { name: 'Sessions with no materials' });
    await expect(sessions.getByRole('link', { name: uncovered.title })).toHaveCount(0);
    await expect(page.getByRole('link', { name: `${speaker.firstName} ${speaker.lastName}` })).toHaveCount(0);

    const after = expectedCoverage(await readStores());
    expect(after.covered).toBe(expected.covered + 1);
    await expect(panel).toContainText(summaryOf(after));
    expect((await coverageList(page, 'Sessions with no materials')).sort()).toEqual(after.uncoveredSessions);
    expect((await coverageList(page, 'Speakers with no materials')).sort()).toEqual(after.uncoveredSpeakers);
  });
});
