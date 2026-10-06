'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { isDemoProject, seedDemo } = require('./seed-demo-event.cjs');
const { makeFakeDb } = require('../functions/src/cms/firestoreFake.cjs');
const { demoEvent } = require('./lib/demo-event.cjs');

test('the enabled historical updates retain their visible navigation page and rendered source block', () => {
  const demo = demoEvent();
  assert.equal(demo.config.features.updates, true);
  assert.ok(demo.pages.some((page) => page.id === 'updates' && page.visible !== false));
  const source = demo.updates[0].content.find((block) => block.type === 'button');
  assert.equal(source.href, 'https://www.eventbrite.com/e/2026-nc-news-information-summit-tickets-1676080575119');
  assert.equal(demo.updates[0].links, undefined);
});

/** Run seedDemo with its progress output swallowed. */
async function runSeed(db, args = {}, now = () => Date.parse('2026-01-01T00:00:00Z')) {
  const store = require('../functions/src/cms/store.cjs');
  const log = console.log;
  console.log = () => {};
  try {
    return await seedDemo({ db, store, args, now });
  } finally {
    console.log = log;
  }
}

test('a delimited demo component identifies a demo project', () => {
  for (const id of ['demo-run-of-show', 'run_of_show_demo', 'demo', 'client.demo.site', 'DEMO-Run']) {
    assert.equal(isDemoProject(id), true, `${id} should count as a demo project`);
  }
});

test('a project that merely contains the letters "demo" does not', () => {
  // The guard exists to stop placeholder speakers being published on a
  // live site; a substring test would have waved this one through.
  for (const id of ['democratic-media-prod', 'demography-summit', 'moderndemo1']) {
    assert.equal(isDemoProject(id), false, `${id} must not count as a demo project`);
  }
});

test('an explicitly configured demo project id is matched exactly', () => {
  assert.equal(isDemoProject('showcase-instance', 'showcase-instance'), true);
  assert.equal(isDemoProject('demo-run-of-show', 'showcase-instance'), false,
    'a configured id replaces the heuristic rather than adding to it');
});

test('every seeded speaker gets a matching slug reservation', async () => {
  // The reservation collection is the lock createSpeaker takes to keep
  // slugs unique (functions/src/speakers/profile.cjs). A seeded speaker
  // with no reservation leaves its slug apparently free, so the demo would
  // accept a second speaker claiming the same public URL.
  const db = makeFakeDb();
  await runSeed(db);

  const speakerIds = db.ids('speakers');
  assert.ok(speakerIds.length >= 3);
  for (const id of speakerIds) {
    const { slug } = db.read('speakers', id);
    assert.ok(slug, `${id} has no slug`);
    assert.equal(db.read('speaker_slugs', slug)?.speakerId, id, `no slug reservation for ${id}`);
  }
  assert.equal(db.ids('speaker_slugs').length, speakerIds.length);
  assert.deepEqual(Object.values(db.read('cmsMeta', 'pending').counts), [0, 0, 0, 0, 0, 0]);
});

test('a dry run writes no speakers and no reservations', async () => {
  const db = makeFakeDb();
  await runSeed(db, { 'dry-run': true });
  assert.deepEqual(db.ids('speakers'), []);
  assert.deepEqual(db.ids('speaker_slugs'), []);
});

test('normal and forced demo reseeds leave real bootstrap access unchanged', async (t) => {
  const bootstrap = {
    adminEmails: ['real-operator@example.org'],
    staffEmails: ['real-staff@example.org'],
    permissions: { publish: ['real-operator@example.org'] },
    grants: { 'real-staff@example.org': ['content', 'schedule'] },
    createdAt: new Date('2025-11-01T00:00:00Z'),
    updatedAt: new Date('2025-12-01T00:00:00Z'),
    updatedBy: 'real-operator@example.org',
  };

  for (const [name, args] of [['normal', {}], ['forced', { force: true }]]) {
    await t.test(name, async () => {
      const db = makeFakeDb({ 'config/bootstrap': bootstrap });
      await runSeed(db, args);
      assert.deepEqual(db.read('config', 'bootstrap'), bootstrap);
    });
  }
});

test('normal and forced demo reseeds do not create bootstrap access', async (t) => {
  for (const [name, args] of [['normal', {}], ['forced', { force: true }]]) {
    await t.test(name, async () => {
      const db = makeFakeDb();
      await runSeed(db, args);
      assert.equal(db.read('config', 'bootstrap'), undefined);
    });
  }
});

test('a missing or blank project id is never a demo project', () => {
  assert.equal(isDemoProject(''), false);
  assert.equal(isDemoProject(undefined), false);
});

test('a known slug collision stops all seed writes, including with --force', async () => {
  const { DEMO_SPEAKERS } = require('./lib/demo-event.cjs');
  const slug = DEMO_SPEAKERS[0].slug;
  for (const args of [{}, { force: true }, { 'dry-run': true }]) {
    const db = makeFakeDb({ [`speaker_slugs/${slug}`]: { speakerId: 'existing-speaker' } });
    await assert.rejects(runSeed(db, args), { code: 'demo-speaker-conflict' });
    assert.deepEqual(db.writes, []);
  }
});

test('the real admin update path remains intact after a forced demo reseed', async () => {
  const { DEMO_SPEAKERS } = require('./lib/demo-event.cjs');
  const { applyUpdateSpeaker } = require('../functions/src/speakers/profile.cjs');
  const db = makeFakeDb();
  await runSeed(db);
  const speaker = DEMO_SPEAKERS[0];
  const result = await applyUpdateSpeaker({
    db, speakerId: speaker.id, payload: { bio: 'Keep the operator biography.' },
    actor: { uid: 'demo-operator', email: 'operator@example.test' }, now: () => 2000,
  });
  assert.equal(result.ok, true);
  const before = db.read('speakers', speaker.id);
  await runSeed(db, { force: true });
  assert.deepEqual(db.read('speakers', speaker.id), before);
  assert.equal(db.read('speaker_slugs', speaker.slug).speakerId, speaker.id);
});

test('an active account link and invitation survive the complete seed path', async () => {
  const { DEMO_SPEAKERS } = require('./lib/demo-event.cjs');
  const db = makeFakeDb();
  await runSeed(db);
  const id = DEMO_SPEAKERS[0].id;
  await db.collection('speakers').doc(id).update({
    uid: 'linked-demo-user', inviteToken: 'synthetic-pending-invitation',
  });
  const before = db.read('speakers', id);
  await runSeed(db);
  assert.deepEqual(db.read('speakers', id), before);
});

test('a legacy canonical slug collision is found before config writes', async () => {
  const { DEMO_SPEAKERS } = require('./lib/demo-event.cjs');
  const db = makeFakeDb({ 'speakers/existing-speaker': { slug: DEMO_SPEAKERS[0].slug } });
  await assert.rejects(runSeed(db), { code: 'demo-speaker-conflict' });
  assert.deepEqual(db.writes, []);
});


test('demo announcements are seeded from the same fixture used by the static demo', async () => {
  const updates = require('./lib/demo-updates.json');
  const db = makeFakeDb();
  await runSeed(db);
  assert.equal(db.read('config', 'features').updates, true);
  assert.deepEqual(db.ids('cmsUpdates').sort(), updates.map((update) => update.id).sort());
  for (const { id, ...fields } of updates) {
    const stored = db.read('cmsUpdates', id);
    for (const [key, value] of Object.entries(fields)) assert.deepEqual(stored[key], value);
  }
});

test('a demo dry run writes no announcements', async () => {
  const db = makeFakeDb();
  await runSeed(db, { 'dry-run': true });
  assert.deepEqual(db.ids('cmsUpdates'), []);
});

test('the demo past editions are seeded and published from the same fixture the snapshot uses (issue 194)', async () => {
  const { DEMO_TIMELINE } = require('./lib/demo-event.cjs');
  const db = makeFakeDb();
  await runSeed(db);
  assert.deepEqual(db.ids('cmsTimeline').sort(), DEMO_TIMELINE.map((entry) => entry.id).sort());
  for (const { id, ...fields } of DEMO_TIMELINE) {
    const live = db.read('cmsTimeline', id);
    for (const [key, value] of Object.entries(fields)) assert.deepEqual(live[key], value, `${id}.${key}`);
  }
});

test('a demo dry run writes no past editions', async () => {
  const db = makeFakeDb();
  await runSeed(db, { 'dry-run': true });
  assert.deepEqual(db.ids('cmsTimeline'), []);
  assert.deepEqual(db.ids('cmsTimeline_drafts'), []);
});

test('the Harborlight migration removes every superseded seed in both CMS revisions', async () => {
  const obsolete = require('./lib/superseded-demo-ids.json');
  const initial = {};
  for (const [collection, ids] of Object.entries(obsolete)) {
    for (const id of ids) {
      initial[`${collection}/${id}`] = collection === 'speakers'
        ? { seeded: true, status: 'approved', slug: id }
        : { seeded: true };
      if (collection === 'speakers') initial[`speaker_slugs/${id}`] = { speakerId: id };
      else initial[`${collection}_drafts/${id}`] = { seeded: true, status: 'clean' };
    }
  }
  initial['cmsSchedule/operator-session'] = { seeded: true };
  const db = makeFakeDb(initial);
  await runSeed(db);
  for (const [collection, ids] of Object.entries(obsolete)) {
    for (const id of ids) {
      assert.equal(db.read(collection, id), undefined, `${collection}/${id}`);
      assert.equal(db.read(collection === 'speakers' ? 'speaker_slugs' : `${collection}_drafts`, id), undefined);
    }
  }
  assert.deepEqual(db.read('cmsSchedule', 'operator-session'), { seeded: true });
  await runSeed(db); // A second migration is harmless.
});

test('the migration preserves edited live docs and unpublished edits even with --force', async () => {
  const initial = {
    'cmsSchedule/session-welcome': { seeded: false, title: 'Operator welcome' },
    'cmsOrganizations/org-placeholder-1': { seeded: true, updatedBy: 'operator@example.test' },
    'cmsUpdates/demo-program-ready': { seeded: true },
    'cmsUpdates_drafts/demo-program-ready': { seeded: true, updatedBy: 'operator@example.test', status: 'dirty' },
    'cmsTimeline_drafts/demo-edition-2024': { seeded: false, status: 'dirty' },
  };
  const db = makeFakeDb(initial);
  await runSeed(db, { force: true });
  for (const [path, value] of Object.entries(initial)) {
    const [collection, id] = path.split('/');
    assert.deepEqual(db.read(collection, id), value, path);
  }
});

test('dry-run migration reports removals and protections without writing', async () => {
  const db = makeFakeDb({
    'cmsSchedule/session-welcome': { seeded: true },
    'cmsSchedule/session-opening': { seeded: false },
    'speakers/speaker-placeholder-1': { seeded: true, status: 'approved', slug: 'old-speaker' },
    'speaker_slugs/old-speaker': { speakerId: 'speaker-placeholder-1' },
  });
  const output = [];
  const log = console.log;
  console.log = (line) => output.push(line);
  try {
    await seedDemo({ db, store: require('../functions/src/cms/store.cjs'), args: { 'dry-run': true } });
  } finally {
    console.log = log;
  }
  assert.deepEqual(db.writes, []);
  assert.ok(output.some((line) => /cmsSchedule\s+1 planned removals, 1 protected/.test(line)));
  assert.ok(output.some((line) => /speakers\s+1 planned removals, 0 protected/.test(line)));
  assert.ok(output.some((line) => line.includes('kept session-opening: client-edited')));
});

test('NC Local uses deployment overrides while the reusable Newsroom identity stays intact', () => {
  const { getPreset, resolveThemePalettes, resolveFontRoles, resolveShape } = require('shared/theme');
  const { validateTheme } = require('shared/config');
  const preset = getPreset('newsroom');
  assert.equal(require('../design/tokens/presets/newsroom.json').label, 'Newsroom');
  assert.deepEqual(preset.palette.light.primary, [178, 30, 50]);
  assert.deepEqual(preset.palette.dark.surface, [23, 25, 30]);
  assert.deepEqual(resolveFontRoles({ preset: 'newsroom' }), {
    heading: 'fraunces', body: 'newsreader', data: 'plex-sans', mono: 'plex-mono',
  });
  assert.equal(resolveShape({ preset: 'newsroom' }).radius, 'small');
  const { theme } = demoEvent().config;
  assert.equal(validateTheme(theme).ok, true);
  const palettes = resolveThemePalettes(theme);
  assert.deepEqual(palettes.light.primary, [9, 58, 70]);
  assert.deepEqual(palettes.light.surface, [255, 255, 255]);
  assert.deepEqual(palettes.dark.surface, [0, 28, 40]);
  assert.deepEqual(palettes.dark.primary, [193, 196, 220]);
  assert.deepEqual(resolveFontRoles(theme), {
    heading: 'merriweather', body: 'merriweather', data: 'cabin', mono: 'plex-mono',
  });
  assert.equal(resolveShape(theme).radius, 'editorial');
});

test('the deployed demo receives its historical account gate through writeConfigDocs', async () => {
  const db = makeFakeDb();
  await runSeed(db);
  assert.equal(db.read('config', 'event').historicalDemo, true);
  const { validateEventConfig } = require('shared/config');
  assert.equal(validateEventConfig(db.read('config', 'event')).ok, true);
});
