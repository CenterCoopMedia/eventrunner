'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  BLOCK_TYPES,
  isKnownBlockType,
  requiredBlockErrors,
  statContractErrors,
  PUBLISHABLE_COLLECTIONS,
  draftCollectionFor,
  internals,
} = require('./blockTypes.cjs');

const TYPE_IDS = [
  'text', 'richtext', 'image', 'cta', 'stat', 'fact', 'quote', 'list_item', 'faq_item', 'link_group',
  'sponsor_package', 'map',
];

test('registry ships exactly the supported block types', () => {
  assert.deepEqual(Object.keys(BLOCK_TYPES).sort(), [...TYPE_IDS].sort());
});

test('a map stores an embed URL and a text label, with an optional text address', () => {
  const embedUrl = 'https://www.google.com/maps/embed?pb=!1m2';
  const map = { blockType: 'map', embedUrl, label: 'Map of the convention center' };
  assert.deepEqual(requiredBlockErrors(map), []);
  assert.deepEqual(requiredBlockErrors({ ...map, address: '100 Main Street' }), []);
  assert.match(requiredBlockErrors({ ...map, embedUrl: `<iframe src="${embedUrl}"></iframe>` })[0], /^embedUrl:/);
  assert.match(requiredBlockErrors({ ...map, label: '  ' })[0], /^label:/);
  assert.match(requiredBlockErrors({ ...map, label: 123 })[0], /^label:/);
  assert.match(requiredBlockErrors({ ...map, address: ['100 Main Street'] })[0], /^address:/);
});

test('a venue map stores a source choice with no copied URL', () => {
  const block = { blockType: 'map', useEventVenue: true, label: 'Map of Test Hall' };
  assert.deepEqual(requiredBlockErrors(block), []);
  assert.match(requiredBlockErrors({ ...block, embedUrl: 'https://www.google.com/maps/embed?pb=fixture' })[0], /^embedUrl:/);
  assert.match(requiredBlockErrors({ ...block, useEventVenue: 'true' })[0], /^useEventVenue:/);
  assert.match(requiredBlockErrors({ ...block, useEventVenue: false })[0], /^embedUrl:/);
});

test('image blocks may set a supported width and alignment', () => {
  const image = { blockType: 'image', url: '/media/photo.webp', alt: 'Photo' };
  assert.deepEqual(requiredBlockErrors(image), []);
  assert.deepEqual(requiredBlockErrors({ ...image, size: 'small', alignment: 'center' }), []);
  const errors = requiredBlockErrors({ ...image, size: 320, alignment: 'justify' });
  assert.match(errors[0], /^size:/);
  assert.match(errors[1], /^alignment:/);
});

// #234: a fact is a term and a description, never a stat block. The whole
// point of the type is that an operator can write a venue name without
// inventing a source line, so the registry must ask for none.
test('a fact block carries no evidence field, and the stat contract is unchanged', () => {
  const factFields = BLOCK_TYPES.fact.fields.map((f) => f.id);
  assert.deepEqual(factFields, ['label', 'value', 'note', 'order']);
  for (const evidence of ['takeaway', 'description', 'source', 'alt']) {
    assert.equal(factFields.includes(evidence), false, `fact carries no ${evidence}`);
  }
  assert.equal(BLOCK_TYPES.fact.fields.find((f) => f.id === 'note').required, false);
  assert.deepEqual(
    BLOCK_TYPES.stat.fields.filter((f) => f.required).map((f) => f.id),
    ['value', 'label', 'takeaway', 'description', 'source', 'alt'],
  );
  // The write-time contract is a stat rule and a no-op for a fact.
  assert.deepEqual(statContractErrors({ blockType: 'fact', label: 'Where', value: 'The hall' }), []);
  assert.equal(statContractErrors({ blockType: 'stat', value: '3' }).length > 0, true);
});

// #193: a package is a name and what it includes; its price, its limit and
// its place in the run are optional, and the write carries no contract
// beyond the registry, like a fact.
test('a sponsor package names its parts, and only the name and the benefits are required', () => {
  assert.deepEqual(
    BLOCK_TYPES.sponsor_package.fields.map((f) => [f.id, f.type, f.required]),
    [
      ['name', 'string', true],
      ['price', 'string', false],
      ['limit', 'number', false],
      ['benefits', 'richtext', true],
      ['order', 'number', false],
    ],
  );
  assert.equal(BLOCK_TYPES.sponsor_package.label, 'Sponsor package');
  assert.deepEqual(statContractErrors({ blockType: 'sponsor_package', name: 'Presenting' }), []);
});

test('every block type is a well-formed contract', () => {
  for (const [key, def] of Object.entries(BLOCK_TYPES)) {
    assert.equal(def.id, key, `${key}: id must match its registry key`);
    assert.equal(typeof def.label, 'string');
    assert.ok(def.label.length > 0);
    assert.equal(typeof def.description, 'string');
    assert.ok(Array.isArray(def.fields) && def.fields.length > 0, `${key}: needs fields`);
    const fieldIds = def.fields.map((f) => f.id);
    assert.equal(new Set(fieldIds).size, fieldIds.length, `${key}: duplicate field ids`);
    for (const f of def.fields) {
      assert.equal(typeof f.id, 'string');
      assert.ok(internals.FIELD_TYPES.includes(f.type), `${key}.${f.id}: bad field type ${f.type}`);
      assert.equal(typeof f.required, 'boolean');
    }
    assert.ok(def.fields.some((f) => f.required), `${key}: at least one required field`);
  }
});

test('registry is deeply frozen — validators can rely on it never mutating', () => {
  assert.ok(Object.isFrozen(BLOCK_TYPES));
  assert.ok(Object.isFrozen(BLOCK_TYPES.text));
  assert.ok(Object.isFrozen(BLOCK_TYPES.text.fields));
  assert.ok(Object.isFrozen(BLOCK_TYPES.text.fields[0]));
  assert.throws(() => {
    BLOCK_TYPES.text.label = 'hacked';
  }, TypeError);
});

test('isKnownBlockType: known ids only, never prototype names or non-strings', () => {
  for (const id of TYPE_IDS) assert.equal(isKnownBlockType(id), true);
  assert.equal(isKnownBlockType('hero'), false);
  assert.equal(isKnownBlockType('toString'), false);
  assert.equal(isKnownBlockType('constructor'), false);
  assert.equal(isKnownBlockType(''), false);
  assert.equal(isKnownBlockType(null), false);
  assert.equal(isKnownBlockType(undefined), false);
  assert.equal(isKnownBlockType(42), false);
});

test('PUBLISHABLE_COLLECTIONS is the fixed §8.4 set, frozen', () => {
  assert.deepEqual(PUBLISHABLE_COLLECTIONS, [
    'cmsContent',
    'cmsSchedule',
    'cmsOrganizations',
    'cmsTimeline',
    'cmsUpdates',
    'cmsPages',
  ]);
  assert.ok(Object.isFrozen(PUBLISHABLE_COLLECTIONS));
});

test('draftCollectionFor maps every publishable collection to its _drafts sibling', () => {
  for (const name of PUBLISHABLE_COLLECTIONS) {
    assert.equal(draftCollectionFor(name), `${name}_drafts`);
  }
});

test('draftCollectionFor throws on anything outside the set', () => {
  for (const bad of ['cmsVersionHistory', 'cmsContent_drafts', 'users', '', undefined, null]) {
    assert.throws(() => draftCollectionFor(bad), /Not a publishable collection/);
  }
});
