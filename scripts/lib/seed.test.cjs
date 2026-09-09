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
const {
  DEMO_ANSWERS, DEMO_ORGANIZATIONS, DEMO_SPEAKERS, DEMO_PAGE_EXTRA_CONTENT,
} = require('./demo-event.cjs');

const TIER_A = { publicUrl: 'https://example.org', ticketingProvider: 'none', emailProvider: 'console' };

/**
 * Generic institutional words that show up inside the demo fixture's own
 * invented names (an event called a "Summit", a sponsor with "Media" in
 * its name, a venue that is a "Hall") but are ordinary English words the
 * real, event-neutral seed is free to use on its own — `recap_media`'s
 * "other event media" is exactly that. Excluding them keeps the derived
 * list below to the fixture's actual invented names, not their generic
 * descriptor words.
 */
const GENERIC_INSTITUTIONAL_WORDS = new Set(['demo', 'hall', 'media']);

/**
 * The demo fixture's own invented proper nouns — event, venue, city,
 * operator, sponsors, and speakers — derived from `demo-event.cjs` rather
 * than copied by hand, so a renamed fixture entity updates this list on
 * its own instead of silently going unchecked.
 */
function demoFixtureProperNouns() {
  const phrases = [
    DEMO_ANSWERS.event.name,
    DEMO_ANSWERS.event.venue.name,
    DEMO_ANSWERS.event.venue.city,
    DEMO_ANSWERS.event.legal.operatorName,
    ...DEMO_ORGANIZATIONS.map((org) => org.name),
    ...DEMO_SPEAKERS.flatMap((speaker) => [speaker.firstName, speaker.lastName, speaker.organization]),
  ];
  const words = new Set();
  for (const phrase of phrases) {
    for (const word of String(phrase).replace(/\[Demo\]/gi, '').split(/[^A-Za-z]+/)) {
      if (word.length < 3) continue;
      const lower = word.toLowerCase();
      if (GENERIC_INSTITUTIONAL_WORDS.has(lower)) continue;
      words.add(lower);
    }
  }
  return [...words];
}

function isNonEmptyDescription(value) {
  return typeof value === 'string' && value.trim().length > 0;
}

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

test('the fifteen default pages are seeded, with the six system pages marked', () => {
  const pages = defaultPages();
  assert.deepEqual(
    pages.map((p) => p.id),
    [
      'home', 'schedule', 'speakers', 'sponsors', 'travel', 'faq', 'conduct', 'contact',
      'privacy', 'terms', 'attendees', 'updates', 'recap', 'guidelines', 'city_guide',
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

test('page ids, paths, orders, and section ids are unique — cmsContent is keyed section__field globally', () => {
  const pages = defaultPages();
  const ids = pages.map((p) => p.id);
  const paths = pages.map((p) => p.path);
  const orders = pages.map((p) => p.order);
  assert.equal(new Set(ids).size, ids.length);
  assert.equal(new Set(paths).size, paths.length);
  assert.equal(
    new Set(orders).size,
    orders.length,
    'two pages sharing an order would collide in the admin Pages list — a sibling page seeded at the same base order is a real risk here',
  );
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

test('the recap and guidelines pages seed no default blocks (issue: seed a recap page and a guidelines page)', () => {
  // Same shape as the travel page's variable-length lists (§5.3): every
  // section carries a description that instructs the operator, and NO
  // seeded content, so the page renders the site's empty state until an
  // operator adds something. Neither page may carry event-specific copy.
  const pages = defaultPages();
  for (const id of ['recap', 'guidelines']) {
    const page = pages.find((p) => p.id === id);
    assert.ok(page, `${id} page missing from defaultPages()`);
    assert.equal(page.systemPage, false, `${id} is a generic content page, not a system route`);
    assert.ok(page.sections.length > 0, `${id} should describe at least one section`);
    for (const section of page.sections) {
      assert.deepEqual(section.defaultBlocks, [], `${id}.${section.id} must seed empty so it renders nothing`);
      assert.ok(isNonEmptyDescription(section.description), `${id}.${section.id} needs a placeholder description`);
    }
  }
});

test('no content doc is seeded for the recap or guidelines pages', () => {
  const docs = configDocs();
  const content = buildSeedContent({ pages: defaultPages(), docs, tierA: TIER_A });
  for (const doc of content) {
    assert.ok(
      !doc.section.startsWith('recap_') && !doc.section.startsWith('guidelines_'),
      `${doc.id} would render placeholder copy on a page that must ship empty`,
    );
  }
});

test('the city guide page has an intro section, then three empty variable-length sections (issue: seed a city guide page)', () => {
  // Same shape as the travel page's variable-length lists (§5.3), and the
  // same shape recap and guidelines already established: every section
  // carries a description that instructs the operator, and NO seeded
  // content, so the page renders the site's empty state until an operator
  // adds something. The page may not carry copy about any city.
  const page = defaultPages().find((p) => p.id === 'city_guide');
  assert.ok(page, 'city_guide page missing from defaultPages()');
  assert.equal(page.systemPage, false, 'city_guide is a generic content page, not a system route');
  assert.deepEqual(
    page.sections.map((s) => s.id),
    ['city_guide_intro', 'city_guide_eat', 'city_guide_see', 'city_guide_around'],
  );
  for (const section of page.sections) {
    assert.deepEqual(section.defaultBlocks, [], `city_guide.${section.id} must seed empty so it renders nothing`);
    assert.ok(isNonEmptyDescription(section.description), `city_guide.${section.id} needs a placeholder description`);
  }
  const [intro, ...contentSections] = page.sections;
  for (const section of contentSections) {
    assert.ok(section.maxBlocks >= 20, `city_guide.${section.id} must accept a variable number of entries`);
    assert.deepEqual(
      section.allowedBlocks,
      ['list_item', 'richtext'],
      `city_guide.${section.id} should allow only list_item and richtext blocks`,
    );
  }
  assert.deepEqual(intro.allowedBlocks, ['richtext'], 'city_guide_intro should allow only richtext');
});

test('the city guide page\'s first section is the intro, ahead of its three content sections', () => {
  // ContentPage.jsx renders a page's own first section (`baseSections[0]`,
  // independent of any active filter) with an sr-only heading and leaves it
  // out of the section index, on the assumption that it repeats the page
  // title (faq_intro, conduct_intro, contact_intro, and guidelines_intro
  // already rely on this). Without a leading intro section here, "Places to
  // eat" — real content, not a repeated title — would silently lose its
  // visible heading and its section-index entry.
  const page = defaultPages().find((p) => p.id === 'city_guide');
  assert.equal(page.sections[0].id, 'city_guide_intro', 'city_guide_intro must be the first section');
  assert.deepEqual(
    page.sections.slice(1).map((s) => s.id),
    ['city_guide_eat', 'city_guide_see', 'city_guide_around'],
    'the three content sections must follow the intro, in this order',
  );
});

test('no content doc is seeded for the city guide page', () => {
  const docs = configDocs();
  const content = buildSeedContent({ pages: defaultPages(), docs, tierA: TIER_A });
  for (const doc of content) {
    assert.equal(
      doc.section.startsWith('city_guide_'),
      false,
      `${doc.id} would render placeholder copy on a page that must ship empty`,
    );
  }
});

test('no demo fixture copy leaks into the shared seed', () => {
  // The shared seed (defaultPages() and what buildSeedContent() renders
  // from it) ships to every real deployment, so none of it may carry the
  // demo fixture's own invented event, venue, city, operator, sponsor, or
  // speaker names — the same way it may never carry a real one. This is
  // checked against the derived list (demoFixtureProperNouns above), not a
  // hand-typed one, so a renamed or added fixture entity is covered
  // automatically rather than needing this test updated by hand.
  const docs = configDocs();
  const content = buildSeedContent({ pages: defaultPages(), docs, tierA: TIER_A });
  const haystack = `${JSON.stringify(defaultPages())} ${JSON.stringify(content)}`.toLowerCase();
  for (const word of demoFixtureProperNouns()) {
    const re = new RegExp(`\\b${word}\\b`);
    assert.equal(re.test(haystack), false, `the shared seed mentions the demo fixture's "${word}"`);
  }
});

test('every DEMO_PAGE_EXTRA_CONTENT entry targets a real section, an allowed block type, and stays within maxBlocks', () => {
  const sectionsById = new Map();
  for (const page of defaultPages()) {
    for (const section of page.sections) {
      sectionsById.set(section.id, section);
    }
  }
  const countBySection = new Map();
  for (const doc of DEMO_PAGE_EXTRA_CONTENT) {
    const section = sectionsById.get(doc.section);
    assert.ok(section, `${doc.id}: section "${doc.section}" does not exist in defaultPages()`);
    assert.ok(
      section.allowedBlocks.includes(doc.blockType),
      `${doc.id}: blockType "${doc.blockType}" is not allowed on section "${doc.section}" (allows ${section.allowedBlocks.join(', ')})`,
    );
    countBySection.set(doc.section, (countBySection.get(doc.section) ?? 0) + 1);
  }
  for (const [sectionId, count] of countBySection) {
    const section = sectionsById.get(sectionId);
    assert.ok(
      count <= section.maxBlocks,
      `section "${sectionId}" has ${count} DEMO_PAGE_EXTRA_CONTENT entries, over its maxBlocks of ${section.maxBlocks}`,
    );
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

// M7 issue 8: the registration action is configuration, not content. A
// seeded cta block had to invent a destination to be a valid block, and the
// one it invented pointed at example.org — the dead button the issue exists
// to remove. The hero still ALLOWS a cta, so an editor can add their own.
test('the hero seeds no registration action of its own (M7 issue 8)', () => {
  const home = defaultPages().find((page) => page.id === 'home');
  const hero = home.sections.find((section) => section.id === 'hero');
  assert.ok(hero.allowedBlocks.includes('cta'), 'an editor can still add an action');
  assert.deepEqual(
    hero.defaultBlocks.filter((def) => def.blockType === 'cta'),
    [],
  );
  const content = buildSeedContent({ pages: defaultPages(), docs: configDocs(), tierA: TIER_A });
  assert.equal(content.some((doc) => doc.section === 'hero' && doc.blockType === 'cta'), false);
});

// M7 issue 9: the key facts group. The seed supplies the section and its
// placeholder blocks, using the two block types that already exist — a
// stat opens a card and the list items after it are that card's lines.
//
// ONE STAT, THREE LINES. A stat is six [Replace] instructions (the stat
// contract), so three of them would put fifteen of them under the hero of a
// site nobody has edited yet. One figure and three lines is one short card
// an operator can finish, and the section takes twelve blocks.
test('the home page seeds a key facts section built from stat and list_item blocks', () => {
  const home = defaultPages().find((page) => page.id === 'home');
  const info = home.sections.find((section) => section.id === 'info');
  assert.ok(info, 'the home page seeds an info section');
  assert.deepEqual(info.allowedBlocks, ['stat', 'list_item'], 'no new block type');
  assert.deepEqual(
    info.defaultBlocks.map((def) => [def.field, def.blockType]),
    [
      ['when', 'stat'],
      ['where_venue', 'list_item'],
      ['where_address', 'list_item'],
      ['where_transit', 'list_item'],
    ],
    'one stat opens the card and its lines follow it',
  );
  assert.equal(
    info.defaultBlocks.filter((def) => def.blockType === 'stat').length,
    1,
    'a fresh site opens one short card, not one per fact',
  );
  const content = new Map(
    buildSeedContent({ pages: defaultPages(), docs: configDocs(), tierA: TIER_A }).map((d) => [d.id, d]),
  );
  // Seeded in the order the card reads in, so the positional grouping the
  // renderer applies is the one an editor sees in the admin.
  assert.deepEqual(
    info.defaultBlocks.map((def) => content.get(`info__${def.field}`).order),
    [0, 1, 2, 3],
  );
  // The seeded stat carries the six-part contract, so the section can be
  // published without an editor first filling in four more fields.
  for (const part of ['value', 'label', 'takeaway', 'description', 'source', 'alt']) {
    assert.ok(content.get('info__when')[part], `info__when.${part} is seeded`);
  }
});

test('placeholder copy is a [Replace] instruction, never another event copy', () => {
  const docs = configDocs();
  const content = buildSeedContent({ pages: defaultPages(), docs, tierA: TIER_A });
  const placeholderish = content.filter(
    // Config-derived blocks are correct as seeded, so they carry no
    // [Replace] marker by design (§5.4).
    (d) => !['hero__title', 'stats__attendees', 'stats__sessions'].includes(d.id) &&
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
