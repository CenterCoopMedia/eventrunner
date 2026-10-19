'use strict';

// Event templates end to end on two in-memory projects (issue #328): a
// past event is initialized and used, its template is exported, and a new
// event is initialized from it. The emulator proof of the same path lives
// in tests/event-template.rules.test.js.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { runInit, runCheck } = require('./init-event.cjs');
const { runExport } = require('./export-event-template.cjs');
const { makeFakeDb } = require('../functions/src/cms/firestoreFake.cjs');
const store = require('../functions/src/cms/store.cjs');
const { parseTemplateFile } = require('./lib/event-template.cjs');
const { pastEventAnswers, nextEventAnswers, operationalRecords, SOURCE, TARGET, ENV_FOR, tierAFor } =
  require('./lib/event-template.fixtures.cjs');

function tmpFile(name, value) {
  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'event-template-')), name);
  if (value !== undefined) fs.writeFileSync(file, typeof value === 'string' ? value : JSON.stringify(value));
  return file;
}

function quietly(fn) {
  const saved = [console.log, console.warn, console.error];
  const output = [];
  console.log = (...a) => output.push(a.join(' '));
  console.warn = (...a) => output.push(a.join(' '));
  console.error = (...a) => output.push(a.join(' '));
  return Promise.resolve()
    .then(fn)
    .then((value) => ({ value, output: output.join('\n') }))
    .finally(() => { [console.log, console.warn, console.error] = saved; });
}

const noBucket = () => { throw new Error('EVENT_STORAGE_BUCKET is not set'); };

/** A past event: initialized, branded, edited, and full of records. */
async function pastEvent() {
  const db = makeFakeDb();
  const { value } = await quietly(() => runInit({
    db, store, bucket: noBucket,
    args: { answers: tmpFile('answers.json', pastEventAnswers()), admin: ['past-ops@example.test'] },
    tierA: tierAFor(SOURCE), env: ENV_FOR(SOURCE), now: () => 0,
  }));
  assert.equal(value, 0);
  // Approved branding: style choices and an uploaded logo.
  const theme = db.read('config', 'theme');
  await db.collection('config').doc('theme').set({
    ...theme,
    radius: 'round',
    navPlacement: 'side',
    logos: { ...theme.logos, primary: 'branding/client-logo.svg' },
    placeholderLogos: theme.placeholderLogos.filter((slot) => slot !== 'primary'),
  });
  // An edited block, and a block that shows a stored file.
  await db.collection('cmsContent').doc('hero__subtitle').set({
    section: 'hero', field: 'subtitle', blockType: 'text', value: 'Reporting together', visible: true, order: 1,
    revision: 3, updatedBy: 'editor@example.test', publishedBy: 'editor@example.test',
  });
  await db.collection('cmsContent').doc('hero__image').set({
    section: 'hero', field: 'image', blockType: 'image', url: 'cms-images/asset-1/crowd.jpg', alt: 'A crowd',
    visible: true, order: 2,
  });
  for (const [docPath, data] of Object.entries(operationalRecords())) {
    const [col, id] = docPath.split('/');
    await db.collection(col).doc(id).set(data);
  }
  return db;
}

async function exportFrom(db, args = {}) {
  const out = tmpFile('template.json');
  const result = await quietly(() => runExport({ db, projectId: SOURCE, args: { out, ...args }, now: () => 0 }));
  return { ...result, out, template: fs.existsSync(out) ? JSON.parse(fs.readFileSync(out, 'utf8')) : null };
}

async function applyTo(db, { template, answers = nextEventAnswers(), extra = {} } = {}) {
  return quietly(() => runInit({
    db, store, bucket: noBucket,
    args: {
      answers: tmpFile('next.json', answers),
      admin: ['next-ops@example.test', 'next-owner@example.test'],
      template,
      ...extra,
    },
    tierA: tierAFor(TARGET), env: ENV_FOR(TARGET), now: () => 1,
  }));
}

test('the dry run prints the inventory and writes no file', async () => {
  const db = await pastEvent();
  const out = tmpFile('dry.json');
  const before = db.writes.length;
  const { value, output } = await quietly(() =>
    runExport({ db, projectId: SOURCE, args: { 'dry-run': true, out }, now: () => 0 }));
  assert.equal(value, 0);
  assert.equal(fs.existsSync(out), false, 'a dry run writes no file');
  assert.equal(db.writes.length, before, 'an export never writes to the source project');
  assert.match(output, /\+ config\/theme/);
  assert.match(output, /\+ cmsPages \(\d+\)/);
  assert.match(output, /- users \(1\): accounts and profiles/);
  assert.match(output, /- tickets \(1\): tickets and orders/);
  assert.match(output, /- session_pitches \(1\): private pitches/);
  assert.match(output, /- config\/bootstrap \(1\): admin allowlist/);
  assert.match(output, /- sent_emails \(1\): email logs/);
  assert.match(output, /- admin_logs \(1\): operational records/);
  assert.match(output, /- cmsSchedule \(1\): prior event records/);
  assert.match(output, /- ticket_sync_queue \(1\): tickets and orders/);
  assert.match(output, /\* config\/theme\.logos\.primary: branding\/client-logo\.svg/);
  assert.match(output, /\* cmsContent\/hero__image: cms-images\/asset-1\/crowd\.jpg/);
});

test('the template carries branding, pages and selected settings, and nothing else', async () => {
  const db = await pastEvent();
  const { value, template } = await exportFrom(db);
  assert.equal(value, 0);
  const text = JSON.stringify({ ...template, inventory: undefined });
  for (const secret of ['past-ops@example.test', 'attendee@example.test', 'pitch-secret', 'tok_fixture',
    'sent-subject', 'audit-entry', 'acct_fixture', 'Past Session']) {
    assert.equal(text.includes(secret), false, `${secret} must stay in the source project`);
  }
  assert.deepEqual(Object.keys(template.answers).sort(), ['badges', 'event', 'features', 'theme']);
  assert.equal(template.answers.event.legal.operatorName, 'Example Newsroom Network');
  assert.equal(template.answers.event.name, undefined, 'the new event names itself');
  assert.equal(template.answers.event.days, undefined, 'the new event dates itself');
  assert.equal(template.answers.event.sender, undefined, 'the sender is checked again in the new project');
  assert.equal(template.answers.theme.logos, undefined, 'logo files stay in the source bucket');
  assert.ok(template.pages.some((p) => p.id === 'home'));
  const tagline = template.content.find((c) => c.id === 'hero__subtitle');
  assert.deepEqual(tagline, {
    id: 'hero__subtitle', section: 'hero', field: 'subtitle', blockType: 'text', visible: true, order: 1,
    value: 'Reporting together',
  }, 'publish bookkeeping is stripped');
  assert.equal(template.content.some((c) => c.id === 'hero__image'), false, 'a stored file is left out');
  assert.equal(template.content.some((c) => c.section.startsWith('privacy') || c.section.startsWith('terms')), false);
  assert.equal(parseTemplateFile(JSON.stringify(template)).ok, true);
});

test('--page narrows the export to the named pages', async () => {
  const db = await pastEvent();
  const { template } = await exportFrom(db, { page: ['faq'] });
  assert.deepEqual(template.pages.map((p) => p.id), ['faq']);
  assert.ok(template.content.every((c) => template.pages[0].sections.some((s) => s.id === c.section)));
});

test('an export refuses an existing output file', async () => {
  const db = await pastEvent();
  const out = tmpFile('taken.json', '{}');
  const { value } = await quietly(() => runExport({ db, projectId: SOURCE, args: { out }, now: () => 0 }));
  assert.equal(value, 2);
  assert.equal(fs.readFileSync(out, 'utf8'), '{}');
});

test('a new event made from the template keeps its own project, records and checks', async () => {
  const source = await pastEvent();
  const { out } = await exportFrom(source);
  const target = makeFakeDb();
  const { value, output } = await applyTo(target, { template: out });
  assert.equal(value, 0, output);

  const event = target.read('config', 'event');
  assert.equal(event.name, 'Next Example Summit');
  assert.equal(event.legal.operatorName, 'Example Newsroom Network', 'a static setting is reused');
  assert.deepEqual(event.days.map((d) => d.date), ['2027-06-03']);
  assert.equal(event.sender.domainVerified, false, 'the sender domain is verified again');
  assert.equal(event.legal.reviewRequired, true, 'legal review starts again');
  assert.equal(target.read('config', 'theme').radius, 'round', 'approved branding is reused');
  assert.equal(target.read('config', 'theme').navPlacement, 'side');
  assert.ok(target.read('config', 'theme').placeholderLogos.includes('primary'), 'the logo file is not carried');
  assert.deepEqual(target.read('config', 'bootstrap').adminEmails, ['next-ops@example.test', 'next-owner@example.test']);
  assert.deepEqual(target.read('config', 'template').owner, { name: 'Next Owner', email: 'next-owner@example.test' });
  assert.equal(target.read('config', 'template').sourceProjectId, SOURCE);

  assert.equal(target.read('cmsContent', 'hero__subtitle').value, 'Reporting together');
  assert.equal(target.read('cmsContent', 'hero__subtitle').seeded, true, 'a reused block counts until reviewed');
  assert.equal(target.read('cmsContent', 'hero__title').value, 'Next Example Summit',
    'a configuration block is built from the new event');
  for (const col of ['users', 'tickets', 'session_pitches', 'sent_emails', 'admin_logs', 'ticket_sync_queue',
    'cmsSchedule', 'auth_rate_limits', 'speakers']) {
    assert.equal((await target.collection(col).get()).size, 0, `${col} stays empty in the new project`);
  }
  assert.match(output, /confirm its billing account/);
  assert.match(output, /Template reuse/);

  // The source project is untouched by the apply.
  assert.equal(source.read('config', 'event').name, 'Past Example Summit');
  assert.equal(source.read('config', 'template'), undefined);
});

test('--check on the new event keeps the sender, provider, Auth and template rows of its own', async () => {
  const source = await pastEvent();
  const { out } = await exportFrom(source);
  const target = makeFakeDb();
  await applyTo(target, { template: out });
  const { value, output } = await quietly(() => runCheck({ db: target, seededThreshold: 1000 }));
  assert.equal(value, 1);
  assert.match(output, /Sender domain\s+UNMET/);
  assert.match(output, /Auth\s+UNMET/);
  assert.match(output, /Template reuse\s+ ok .*owner Next Owner <next-owner@example.test>/);

  // Moving the dates back onto the source event's dates fails the row.
  const event = target.read('config', 'event');
  await target.collection('config').doc('event').set({ ...event, days: [{ ...event.days[0], date: '2026-06-04' }] });
  const again = await quietly(() => runCheck({ db: target, seededThreshold: 1000 }));
  assert.match(again.output, /Template reuse\s+UNMET\s+dates repeat demo-past-event/);
});

test('a template refuses the same project, a used project and --force', async () => {
  const source = await pastEvent();
  const { out } = await exportFrom(source);

  const same = await quietly(() => runInit({
    db: makeFakeDb(), store, bucket: noBucket,
    args: { answers: tmpFile('a.json', nextEventAnswers()), admin: ['next-owner@example.test'], template: out },
    tierA: tierAFor(SOURCE), env: ENV_FOR(SOURCE), now: () => 1,
  }));
  assert.equal(same.value, 2);
  assert.match(same.output, /Each event needs its own project/);

  const used = makeFakeDb({ 'users/someone': { email: 'someone@example.test' } });
  const usedRun = await applyTo(used, { template: out });
  assert.equal(usedRun.value, 2);
  assert.match(usedRun.output, /is not empty \(users\)/);
  assert.equal(used.read('config', 'event'), undefined);

  const forced = makeFakeDb();
  const forcedRun = await applyTo(forced, { template: out, extra: { force: true } });
  assert.equal(forcedRun.value, 2);
  assert.match(forcedRun.output, /cannot be combined with --force/);
});

test('a template refuses the source dates, missing dates and a missing or non-operator owner', async () => {
  const source = await pastEvent();
  const { out } = await exportFrom(source);
  const cases = [
    [{ event: { days: [{ id: 'day-1', label: 'Day 1', date: '2026-06-04', startTime: '09:00', endTime: '17:00' }] } },
      /2026-06-04 is a date of the source event/],
    [{ event: { days: [] } }, /needs the new event's own dates/],
    [{ owner: undefined }, /owner.name: a template needs a named owner/],
    [{ owner: { name: 'Someone Else', email: 'not-an-operator@example.test' } }, /must also be an operator/],
  ];
  for (const [patch, pattern] of cases) {
    const answers = nextEventAnswers();
    if (patch.event) answers.event = { ...answers.event, ...patch.event };
    if ('owner' in patch) answers.owner = patch.owner;
    const target = makeFakeDb();
    const { value, output } = await applyTo(target, { template: out, answers });
    assert.equal(value, 2, output);
    assert.match(output, pattern);
    assert.equal(target.writes.length, 0, 'nothing is written');
  }
});

test('a hand-edited template that carries the admin allowlist or a sender is refused', async () => {
  const source = await pastEvent();
  const { template } = await exportFrom(source);
  for (const [mutate, pattern] of [
    [(t) => { t.answers.bootstrap = { adminEmails: ['intruder@example.test'] }; }, /answers\.bootstrap: not on the template allowlist/],
    [(t) => { t.answers.event.sender = { email: 'x@example.test' }; }, /answers\.event\.sender\.email: not on the template allowlist/],
    [(t) => { t.content[0].updatedBy = 'x'; }, /updatedBy: not on the template allowlist/],
    [(t) => { t.users = [{ email: 'a@example.test' }]; }, /template\.users: not on the template allowlist/],
  ]) {
    const copy = structuredClone(template);
    mutate(copy);
    const target = makeFakeDb();
    const { value, output } = await applyTo(target, { template: tmpFile('t.json', copy) });
    assert.equal(value, 2);
    assert.match(output, pattern);
    assert.equal(target.writes.length, 0);
  }
});

test('a template dry run reports the apply and writes nothing', async () => {
  const source = await pastEvent();
  const { out } = await exportFrom(source);
  const target = makeFakeDb();
  const { value, output } = await applyTo(target, { template: out, extra: { 'dry-run': true } });
  assert.equal(value, 0, output);
  assert.equal(target.writes.length, 0);
  assert.match(output, /config\/template\s+create/);
});
