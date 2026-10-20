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
    section: 'hero', field: 'image', blockType: 'image',
    url: 'https://firebasestorage.googleapis.com/v0/b/demo-past-event.appspot.com/o/cms-images%2Fasset-1%2Fcrowd.jpg?alt=media&token=secret-download-token',
    alt: 'A crowd', visible: true, order: 2,
  });
  // Copy that names a person: an address in a block, and a quote.
  await db.collection('cmsContent').doc('faq_items__what_is_this').set({
    section: 'faq_items', field: 'what_is_this', blockType: 'richtext',
    value: '<p>Write to <a href="mailto:old-staffer@example.test">our coordinator</a>.</p>', visible: true, order: 0,
  });
  await db.collection('cmsContent').doc('details__quote').set({
    section: 'details', field: 'quote', blockType: 'quote', text: 'We came back every year.',
    attribution: 'A past attendee', visible: true, order: 1,
  });
  await db.collection('config').doc('features').update({ feedbackInbox: true });
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

async function applyTo(db, {
  template, answers = nextEventAnswers(), extra = {}, store: useStore = store, listAuthUsers,
} = {}) {
  return quietly(() => runInit({
    db, store: useStore, bucket: noBucket, listAuthUsers,
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
  // A new event starts its invoice numbers again at 0001.
  assert.match(output, /- invoices \(1\): invoices and billing/);
  assert.match(output, /- invoice_counters \(1\): invoices and billing/);
  assert.match(output, /- invoice_settings \(1\): invoices and billing/);
  assert.match(output, /\* config\/theme\.logos\.primary: branding\/client-logo\.svg/);
  assert.match(output, /\* cmsContent\/hero__image: cms-images\/asset-1\/crowd\.jpg\n/);
  assert.equal(output.includes('secret-download-token'), false, 'a download token is never printed');
  assert.match(output, /feedbackInbox: on \(public intake: review\)/);
  assert.match(output, /changeRequests: off/);
  assert.match(output, /! cmsContent\/faq_items__what_is_this: names an email address/);
  assert.equal(output.includes('old-staffer@example.test'), false, 'the review line does not repeat the address');
  assert.match(output, /! cmsContent\/details__quote: a quote names a person/);
  assert.match(output, /! config\/event\.legal\.supportEmail: carried contact address/);
});

test('the template carries branding, pages and selected settings, and nothing else', async () => {
  const db = await pastEvent();
  const { value, template } = await exportFrom(db);
  assert.equal(value, 0);
  const text = JSON.stringify(template);
  for (const secret of ['past-ops@example.test', 'attendee@example.test', 'pitch-secret', 'tok_fixture',
    'sent-subject', 'audit-entry', 'acct_fixture', 'Past Session', 'secret-download-token',
    'Attendee One', 'speaker@example.test', 'Billed Sponsor', 'bank-account-secret']) {
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
  assert.match(again.output, /Template reuse\s+UNMET\s+dates are not later than demo-past-event/);
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
      /2026-06-04 is not later than the source event/],
    [{ event: { days: [{ id: 'day-1', label: 'Day 1', date: '2025-06-04', startTime: '09:00', endTime: '17:00' }] } },
      /2025-06-04 is not later than the source event/],
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

// ------------------------------------------------- review fixes (wave 2)

test('settings-built blocks are left out of the export, refused in a file, and built fresh', async () => {
  const source = await pastEvent();
  const { template } = await exportFrom(source);
  const configIds = ['hero__title', 'info__when', 'info__where', 'footer__contact_link'];
  for (const id of configIds) {
    assert.equal(template.content.some((c) => c.id === id), false, `${id} is not exported`);
  }

  const smuggled = structuredClone(template);
  smuggled.content.push({
    id: 'hero__title', section: 'hero', field: 'title', blockType: 'text', visible: true, order: 0,
    value: 'Past Example Summit',
  });
  const refused = parseTemplateFile(JSON.stringify(smuggled));
  assert.equal(refused.ok, false);
  assert.match(refused.errors.join('\n'), /hero__title.*built from the new event's settings/);

  // A template page whose section no longer lists the field still gets it fresh.
  const trimmed = structuredClone(template);
  const home = trimmed.pages.find((p) => p.id === 'home');
  home.sections.find((sec) => sec.id === 'hero').defaultBlocks =
    home.sections.find((sec) => sec.id === 'hero').defaultBlocks.filter((b) => b.field !== 'title');
  const target = makeFakeDb();
  const { value, output } = await applyTo(target, { template: tmpFile('trimmed.json', trimmed) });
  assert.equal(value, 0, output);
  assert.equal(target.read('cmsContent', 'hero__title').value, 'Next Example Summit');
  assert.match(target.read('cmsContent', 'info__when').value, /2027/);
});

test('a template page cannot claim a system route, a reserved path, or a taken id, path or section', async () => {
  const source = await pastEvent();
  const { template } = await exportFrom(source);
  const page = (overrides) => ({
    id: 'extra', label: 'Extra', path: '/extra', icon: null, order: 99, visible: true, systemPage: false,
    sections: [{ id: 'extra_body', label: 'Body', description: 'Body', allowedBlocks: ['text'], maxBlocks: 1,
      reorderable: true, defaultBlocks: [] }],
    ...overrides,
  });
  const cases = [
    [(t) => t.pages.push(page({ id: 'evil', path: '/admin', systemPage: true })), /evil.*systemPage/],
    [(t) => t.pages.push(page({ id: 'evil', path: '/', systemPage: true })), /evil.*systemPage/],
    [(t) => t.pages.push(page({ path: '/pitch' })), /'pitch' is a reserved route/],
    [(t) => t.pages.push(page({ path: '/faq' })), /path \/faq is used by more than one page/],
    [(t) => t.pages.push(page({ id: 'faq', path: '/faq-two' })), /id faq is used by more than one page/],
    [(t) => t.pages.push(page({ sections: [{ ...page().sections[0], id: 'hero' }] })),
      /section hero is used by more than one page/],
    [(t) => { t.pages.find((p) => p.id === 'home').path = '/start'; }, /home.*must stay at \//],
    [(t) => { t.pages.find((p) => p.id === 'faq').systemPage = true; }, /faq.*systemPage/],
  ];
  for (const [mutate, pattern] of cases) {
    const copy = structuredClone(template);
    mutate(copy);
    const verdict = parseTemplateFile(JSON.stringify(copy));
    assert.equal(verdict.ok, false, String(pattern));
    assert.match(verdict.errors.join('\n'), pattern);
  }
});

test('the template file refuses an empty source date list and a malformed inventory', async () => {
  const source = await pastEvent();
  const { template } = await exportFrom(source);
  const noDays = structuredClone(template);
  noDays.source.days = [];
  assert.match(parseTemplateFile(JSON.stringify(noDays)).errors.join('\n'), /source\.days: the source event has no dates/);
  for (const [mutate, pattern] of [
    [(t) => { t.inventory.users = []; }, /inventory\.users: not on the template allowlist/],
    [(t) => { t.inventory.assets = [{ ref: 'x', value: 'y', email: 'a@example.test' }]; }, /inventory\.assets\[0\]/],
    [(t) => { t.inventory.warnings = [{}]; }, /inventory\.warnings\[0\]: must be a string/],
  ]) {
    const copy = structuredClone(template);
    mutate(copy);
    assert.match(parseTemplateFile(JSON.stringify(copy)).errors.join('\n'), pattern);
  }
});

test('a hand-edited template meets the content editor\'s block rules before anything is seeded', async () => {
  const source = await pastEvent();
  const { template } = await exportFrom(source);

  const noText = structuredClone(template);
  delete noText.content.find((block) => block.id === 'details__quote').text;
  assert.match(parseTemplateFile(JSON.stringify(noText)).errors.join('\n'),
    /template\.content\[\d+\] \(details__quote\): text: is required for block type "quote"/);

  const badLimit = structuredClone(template);
  badLimit.content.push({
    id: 'details__gold', section: 'details', field: 'gold', blockType: 'sponsor_package',
    name: 'Gold', benefits: '<p>A booth.</p>', limit: 0, visible: true, order: 5,
  });
  assert.match(parseTemplateFile(JSON.stringify(badLimit)).errors.join('\n'),
    /\(details__gold\): limit: must be a whole number of 1 or more/);

  // Rich text is cleaned as the editor cleans it, on the stored page too.
  const script = structuredClone(template);
  script.content.find((block) => block.id === 'faq_items__what_is_this').value =
    '<p>Doors open at nine.</p><script>alert(1)</script><img src="x" onerror="alert(1)">';
  const out = tmpFile('script.json', script);
  const target = makeFakeDb();
  const { value, output } = await applyTo(target, { template: out });
  assert.equal(value, 0, output);
  assert.equal(target.read('cmsContent', 'faq_items__what_is_this').value, '<p>Doors open at nine.</p>');
});

test('a target that holds speakers, orders, logs, email rows or Auth users is refused', async () => {
  const source = await pastEvent();
  const { out } = await exportFrom(source);
  for (const docPath of ['speakers/s', 'ticket_orders/o', 'admin_logs/l', 'sent_emails/m', 'email_claims/c',
    'email_templates/t', 'cmsSchedule/s1', 'cmsOrganizations/o', 'cmsTimeline/t', 'cmsUpdates/u']) {
    const target = makeFakeDb({ [docPath]: { any: true } });
    const { value, output } = await applyTo(target, { template: out });
    assert.equal(value, 2, docPath);
    assert.match(output, new RegExp(`is not empty \\(${docPath.split('/')[0]}\\)`));
  }
  // A collection no list names yet is found through listCollections().
  const unlisted = makeFakeDb({ 'brandNewRecords/r': { any: true } });
  unlisted.listCollections = async () => [{ id: 'brandNewRecords' }];
  const unlistedRun = await applyTo(unlisted, { template: out });
  assert.equal(unlistedRun.value, 2);
  assert.match(unlistedRun.output, /is not empty \(brandNewRecords\)/);

  const target = makeFakeDb();
  const { value, output } = await applyTo(target, {
    template: out, extra: {}, listAuthUsers: async () => ['someone'],
  });
  assert.equal(value, 2);
  assert.match(output, /already has Firebase Authentication accounts/);
  assert.equal(target.writes.length, 0);
});

test('a failed apply resumes with the same template and finishes', async () => {
  const source = await pastEvent();
  const { out } = await exportFrom(source);
  const target = makeFakeDb();
  let failed = false;
  const flaky = {
    ...store,
    async publishDocs(...a) {
      if (!failed) {
        failed = true;
        throw new Error('network dropped');
      }
      return store.publishDocs(...a);
    },
  };
  await assert.rejects(applyTo(target, { template: out, store: flaky }), /network dropped/);
  assert.equal(target.read('config', 'template').status, 'applying');
  assert.equal(target.read('config', 'template').sourceProjectId, SOURCE);

  // A different template cannot take over the half-applied project.
  const other = JSON.parse(fs.readFileSync(out, 'utf8'));
  other.source.exportedAt = '2030-01-01T00:00:00.000Z';
  const otherRun = await applyTo(target, { template: tmpFile('other.json', other) });
  assert.equal(otherRun.value, 2);
  assert.match(otherRun.output, /a different template/);

  const { value, output } = await applyTo(target, { template: out });
  assert.equal(value, 0, output);
  assert.match(output, /resuming the apply/);
  assert.equal(target.read('config', 'template').status, 'applied');
  assert.equal(target.read('cmsContent', 'hero__subtitle').value, 'Reporting together');

  // Once applied, the same template is not applied again.
  const again = await applyTo(target, { template: out });
  assert.equal(again.value, 2);
  assert.match(again.output, /already applied/);
});

test('a half-applied project that has gained other data is not resumed', async () => {
  const source = await pastEvent();
  const { out } = await exportFrom(source);
  const target = makeFakeDb();
  const failing = { ...store, async publishDocs() { throw new Error('network dropped'); } };
  await assert.rejects(applyTo(target, { template: out, store: failing }), /network dropped/);
  await target.collection('users').doc('someone').set({ email: 'someone@example.test' });
  const { value, output } = await applyTo(target, { template: out });
  assert.equal(value, 2);
  assert.match(output, /is not empty \(users\)/);

  // A schedule entered in the half-made admin is the same: no hybrid event.
  const scheduled = makeFakeDb();
  await assert.rejects(applyTo(scheduled, { template: out, store: failing }), /network dropped/);
  await scheduled.collection('cmsSchedule').doc('s1').set({ title: 'Opening' });
  const resumed = await applyTo(scheduled, { template: out });
  assert.equal(resumed.value, 2);
  assert.match(resumed.output, /is not empty \(cmsSchedule\)/);
});

test('--check fails the template row while an apply is unfinished', async () => {
  const source = await pastEvent();
  const { out } = await exportFrom(source);
  const target = makeFakeDb();
  const failing = { ...store, async publishDocs() { throw new Error('network dropped'); } };
  await assert.rejects(applyTo(target, { template: out, store: failing }), /network dropped/);
  const { output } = await quietly(() => runCheck({ db: target, seededThreshold: 1000 }));
  assert.match(output, /Template reuse\s+UNMET\s+.*apply did not finish/);
});
