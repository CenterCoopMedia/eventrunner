'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  BLOCK_TYPES,
  isKnownBlockType,
  PUBLISHABLE_COLLECTIONS,
  draftCollectionFor,
  internals,
} = require('./blockTypes.cjs');

const V1_TYPE_IDS = ['text', 'richtext', 'image', 'cta', 'stat', 'list_item', 'faq_item', 'link_group'];

test('registry ships exactly the v1 block types', () => {
  assert.deepEqual(Object.keys(BLOCK_TYPES).sort(), [...V1_TYPE_IDS].sort());
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
  for (const id of V1_TYPE_IDS) assert.equal(isKnownBlockType(id), true);
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
