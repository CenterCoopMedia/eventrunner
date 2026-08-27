'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const { defaultPages, buildSeedContent, placeholderBlock, LEGAL_PAGE_IDS } = require('./seed.cjs');
const { buildConfigDocs } = require('./answers.cjs');
const { validatePageDoc } = require('../../functions/src/cms/pages.cjs');
const { BLOCK_TYPES } = require('../../functions/src/cms/blockTypes.cjs');
const { RESERVED_PATH_SEGMENTS } = require('shared/routing');

const TIER_A = { publicUrl: 'https://example.org', ticketingProvider: 'none', emailProvider: 'console' };

function configDocs(overrides = {}) {
  const built = buildConfigDocs({
    answers: {
      adminEmails: ['ops@example.org'],
      event: {
        name: 'Test Gathering',
        shortName: 'TEST',
        timezone: 'UTC',
        sender: { email: 'hello@example.org' },
        legal: {
          operatorName: 'Test Operator',
          supportEmail: 'support@example.org',
          conductEmail: 'conduct@example.org',
        },
        venue: { name: 'Test Hall', addressLine1: '1 Test Way', city: 'Testville', region: 'TS', postalCode: '00000', country: 'US' },
        ...overrides.event,
      },
    },
    tierA: { ...TIER_A, ...overrides.tierA },
    now: () => 0,
  });
  assert.equal(built.ok, true, built.errors.join('; '));
  return built.docs;
}

test('the twelve §5.3 pages are seeded, with the six system pages marked', () => {
  const pages = defaultPages();
  assert.deepEqual(
    pages.map((p) => p.id),
    [
      'home', 'schedule', 'speakers', 'sponsors', 'travel', 'faq', 'conduct', 'contact',
      'privacy', 'terms', 'attendees', 'updates',
    ],
  );
  assert.deepEqual(
    pages.filter((p) => p.systemPage).map((p) => p.id),
    ['home', 'schedule', 'speakers', 'sponsors', 'attendees', 'updates'],
  );
});

test('every page a SystemPage route asks for is actually seeded', () => {
  // The gap this test exists to close: attendees and updates render through
  // SystemPage — which reads the page's template, layout, and section slots
  // — but had no seeded document, so they were the only system pages an
  // operator could not open in the admin Pages list and shape. A route that
  // names a page id and finds nothing renders the default layout forever,
  // silently, with no way to change it.
  const webPages = path.resolve(__dirname, '..', '..', 'apps', 'web', 'src', 'pages');
  const asked = new Set();
  for (const file of fs.readdirSync(webPages)) {
    if (!file.endsWith('.jsx') || file.includes('.test.')) continue;
    const source = fs.readFileSync(path.join(webPages, file), 'utf8');
    for (const match of source.matchAll(/<SystemPage\s+pageId=(?:"([^"]+)"|\{\[([^\]]+)\]\})/g)) {
      // A page may offer several keys to try in order (Home tries 'home'
      // then '/'); the FIRST is the document id a seed has to provide.
      const key = match[1] ?? match[2].split(',')[0].trim().replace(/^['"]|['"]$/g, '');
      if (key.startsWith('/')) continue;
      asked.add(key);
    }
  }
  assert.ok(asked.size >= 6, `expected to find the SystemPage routes, found ${[...asked]}`);
  const seeded = new Set(defaultPages().map((page) => page.id));
  for (const id of [...asked].sort()) {
    assert.ok(seeded.has(id), `apps/web renders <SystemPage pageId="${id}"> but no seed creates it`);
  }
});

test('a seeded system page sits at the path its React route is mounted at', () => {
  const routes = fs.readFileSync(
    path.resolve(__dirname, '..', '..', 'apps', 'web', 'src', 'App.jsx'),
    'utf8',
  );
  for (const page of defaultPages()) {
    if (!page.systemPage || page.path === '/') continue;
    assert.match(
      routes,
      new RegExp(`path="${page.path.slice(1)}"`),
      `${page.id} seeds ${page.path} but App.jsx mounts no such route`,
    );
  }
});

test('every seeded page passes the REAL validatePageDoc from the admin endpoint', () => {
  for (const page of defaultPages()) {
    const verdict = validatePageDoc(page);
    assert.equal(verdict.ok, true, `${page.id}: ${verdict.errors.join('; ')}`);
  }
});

test('generic pages sit at root-level paths that are not reserved (issue #52)', () => {
  for (const page of defaultPages()) {
    if (page.systemPage) continue;
    const segments = page.path.slice(1).split('/');
    assert.equal(segments.length, 1, `${page.id} should be one root-level segment`);
    assert.equal(
      RESERVED_PATH_SEGMENTS.includes(segments[0]),
      false,
      `${page.id} claims the reserved segment ${segments[0]}`,
    );
  }
});

test('page ids, paths, and section ids are unique — cmsContent is keyed section__field globally', () => {
  const pages = defaultPages();
  const ids = pages.map((p) => p.id);
  const paths = pages.map((p) => p.path);
  assert.equal(new Set(ids).size, ids.length);
  assert.equal(new Set(paths).size, paths.length);
  const sectionIds = pages.flatMap((p) => p.sections.map((s) => s.id));
  assert.equal(
    new Set(sectionIds).size,
    sectionIds.length,
    'two pages sharing a section id would share their content docs',
  );
});

test('the travel page seeds variable-length lists with no items (§5.3)', () => {
  const travel = defaultPages().find((p) => p.id === 'travel');
  for (const id of ['travel_lodging', 'travel_transit', 'travel_shuttle', 'travel_local']) {
    const section = travel.sections.find((s) => s.id === id);
    assert.ok(section, `${id} missing`);
    assert.deepEqual(section.defaultBlocks, [], `${id} must seed empty so it renders nothing`);
    assert.ok(section.maxBlocks >= 20, `${id} must accept a variable number of entries`);
  }
});

test('no content doc is seeded for an empty travel list section', () => {
  const docs = configDocs();
  const content = buildSeedContent({ pages: defaultPages(), docs, tierA: TIER_A });
  const listSections = ['travel_lodging', 'travel_transit', 'travel_shuttle', 'travel_local'];
  for (const doc of content) {
    assert.equal(listSections.includes(doc.section), false, `${doc.id} would render a placeholder hotel`);
  }
});

test('every seeded block carries seeded + seededAt and a unique id', () => {
  const docs = configDocs();
  const content = buildSeedContent({ pages: defaultPages(), docs, tierA: TIER_A, seededAt: 'T0' });
  assert.ok(content.length > 0);
  const ids = content.map((d) => d.id);
  assert.equal(new Set(ids).size, ids.length);
  for (const doc of content) {
    assert.equal(doc.seeded, true, `${doc.id} missing the seeded flag`);
    assert.equal(doc.seededAt, 'T0');
    assert.equal(doc.id, `${doc.section}__${doc.field}`);
    assert.ok(BLOCK_TYPES[doc.blockType], `${doc.id} has unknown block type ${doc.blockType}`);
  }
});

test('a seeded block exists for every defaultBlocks entry on a non-legal page', () => {
  const docs = configDocs();
  const pages = defaultPages();
  const content = new Map(buildSeedContent({ pages, docs, tierA: TIER_A }).map((d) => [d.id, d]));
  for (const page of pages) {
    if (LEGAL_PAGE_IDS.includes(page.id)) continue;
    for (const section of page.sections) {
      for (const def of section.defaultBlocks) {
        assert.ok(content.has(`${section.id}__${def.field}`), `${section.id}__${def.field} not seeded`);
      }
    }
  }
});

test('dates and venue come from config, so they are right the moment init runs (§5.4)', () => {
  const docs = configDocs();
  const content = new Map(buildSeedContent({ pages: defaultPages(), docs, tierA: TIER_A }).map((d) => [d.id, d]));
  assert.equal(content.get('hero__title').value, 'Test Gathering');
  assert.equal(content.get('travel_venue__venue_name').value, 'Test Hall');
  assert.match(content.get('travel_venue__venue_address').value, /1 Test Way, Testville, TS 00000 US/);
  assert.equal(content.get('stats__attendees').value, '0', 'stats seed as zeros with real labels');
  assert.equal(content.get('footer__contact_link').url, 'mailto:support@example.org');
});

test('placeholder copy is a [Replace] instruction, never another event copy', () => {
  const docs = configDocs();
  const content = buildSeedContent({ pages: defaultPages(), docs, tierA: TIER_A });
  const placeholderish = content.filter(
    // Config-derived blocks are correct as seeded, so they carry no
    // [Replace] marker by design (§5.4).
    (d) => !['hero__title', 'hero__register_cta', 'stats__attendees', 'stats__sessions'].includes(d.id) &&
      !d.section.startsWith('privacy_') && !d.section.startsWith('terms_') &&
      !d.id.startsWith('travel_venue__venue_name') && !d.id.startsWith('travel_venue__venue_address') &&
      !d.id.startsWith('footer__') && !d.id.startsWith('contact_channels__'),
  );
  assert.ok(placeholderish.length > 0);
  for (const doc of placeholderish) {
    const text = JSON.stringify(doc);
    assert.match(text, /\[Replace\]/, `${doc.id} carries no [Replace] marker`);
  }
});

test('placeholderBlock covers every block type in the registry', () => {
  for (const [id, def] of Object.entries(BLOCK_TYPES)) {
    const fields = placeholderBlock(id, 'A description.');
    for (const field of def.fields) {
      if (!field.required) continue;
      assert.ok(field.id in fields, `${id} placeholder is missing required field ${field.id}`);
    }
  }
});
