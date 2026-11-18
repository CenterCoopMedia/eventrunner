'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const {
  contentLanguages, languageConfigErrors, variantErrors, collectionVariantErrors, resolveContentVariant,
} = require('./contentLanguages.cjs');
const { languageFromSearch, internalRoutePath, withContentLanguage } = require('./languageUrls.cjs');

const BILINGUAL = { contentLanguages: { default: 'en', available: ['en', 'es'] } };

test('public locale URLs use one canonical language and retain the query and anchor', () => {
  assert.equal(languageFromSearch('?day=two&lang=es'), 'es');
  for (const search of ['?lang=es-MX', '?lang=ES', '?lang=es&lang=es', '?lang=en&lang=es']) {
    assert.equal(languageFromSearch(search), null);
  }
  assert.equal(languageFromSearch('?lang=es', ['en']), null);
  assert.equal(internalRoutePath('/schedule?day=two#morning'), '/schedule');
  assert.equal(withContentLanguage('/schedule?day=two&tag=a&tag=b&lang=en#morning', 'es'),
    '/schedule?day=two&tag=a&tag=b&lang=es#morning');
  for (const href of ['https://example.org/schedule?lang=en#morning', '//example.org/away', 'mailto:team@example.org', 'javascript:void(0)', '/\\example.org/away']) {
    assert.equal(internalRoutePath(href), null);
    assert.equal(withContentLanguage(href, 'es'), href);
  }
});

test('event languages are canonical, English remains available, and absent config needs no migration', () => {
  assert.deepEqual(contentLanguages({}), { default: 'en', available: ['en'] });
  assert.deepEqual(languageConfigErrors(undefined), []);
  for (const value of [null, [], 'es', {}, { default: 'es', available: 4 },
    { default: 'en', available: ['es'] }, { default: 'es', available: ['en'] },
    { default: 'en', available: ['en', 'en'] }, { default: 'en', available: ['en', 'ES'] },
    { default: 'en', available: ['en'], status: 'approved' }]) {
    assert.ok(languageConfigErrors(value).length, JSON.stringify(value));
  }
  assert.deepEqual(languageConfigErrors({ default: 'es', available: ['en', 'es'] }), []);
});

test('a paired variant is public text only and cannot alter identity, structure, links or proper names', () => {
  for (const [kind, record, forbidden] of [
    ['page', {}, ['path', 'id', 'status', 'draft', 'approvedBy']],
    ['section', {}, ['id', 'allowedBlocks']],
    ['session', {}, ['dayId', 'track', 'placeId', 'location', 'speakerIds', 'startTime']],
    ['block', { blockType: 'cta' }, ['url', 'section', 'field', 'blockType']],
    ['block', { blockType: 'quote' }, ['attribution']],
    ['block', { blockType: 'fact' }, ['value']],
  ]) {
    for (const field of forbidden) {
      assert.ok(variantErrors({ ...record, translations: { es: { [field]: 'private' } } }, kind).length);
    }
    for (const translations of [null, [], { en: {} }, { 'es-MX': {} }, { es: [] }, { es: 'text' }]) {
      assert.ok(variantErrors({ ...record, translations }, kind).length);
    }
  }
  assert.ok(variantErrors({ translations: { es: { label: 42 } } }, 'page').length);
  assert.ok(collectionVariantErrors({ translations: { es: {} } }, 'cmsOrganizations').length);
  assert.ok(collectionVariantErrors({ sections: [{ translations: { es: { status: 'draft' } } }] }, 'cmsPages').length);
});

test('full and partial Spanish resolve as coherent units with actual source language', () => {
  const page = { id: 'visit', path: '/visit', label: 'Visit', title: 'Plan your visit',
    translations: { es: { label: 'Visita' } } };
  let result = resolveContentVariant(page, 'page', 'es', BILINGUAL);
  assert.equal(result.value, page);
  assert.equal(result.language, 'en');
  assert.equal(result.fallback, true);
  const paired = { ...page, translations: { es: { label: 'Visita', title: 'Planifica tu visita' } } };
  result = resolveContentVariant(paired, 'page', 'es', BILINGUAL);
  assert.equal(result.language, 'es');
  assert.equal(result.value.title, 'Planifica tu visita');
  assert.equal(result.value.path, '/visit');
  assert.equal(result.value.id, 'visit');
  assert.equal(paired.title, 'Plan your visit');
  assert.equal(resolveContentVariant(paired, 'page', 'en', BILINGUAL).value, paired);
  assert.equal(resolveContentVariant(paired, 'page', 'es', {}).language, 'en');
  assert.equal(resolveContentVariant(paired, 'page', 'es', { contentLanguages: { default: 'en', available: ['en'] } }).language, 'en');
  assert.equal(resolveContentVariant(paired, 'page', undefined, { contentLanguages: { default: 'es', available: ['en', 'es'] } }).language, 'es');
});

test('rich text, session descriptions and section names retain their whole-unit fallback', () => {
  const rich = { blockType: 'richtext', value: '<p>Welcome</p>', translations: { es: { value: '<p><br></p>' } } };
  assert.equal(resolveContentVariant(rich, 'block', 'es', BILINGUAL).language, 'en');
  rich.translations.es.value = '<p>Bienvenidos</p>';
  assert.equal(resolveContentVariant(rich, 'block', 'es', BILINGUAL).language, 'es');
  const session = { id: 'talk', title: 'A talk', description: 'About the talk', location: 'Hall 2',
    translations: { es: { title: 'Una charla', description: 'Sobre la charla' } } };
  assert.equal(resolveContentVariant(session, 'session', 'es', BILINGUAL).value.location, 'Hall 2');
  delete session.translations.es.description;
  assert.equal(resolveContentVariant(session, 'session', 'es', BILINGUAL).value.title, 'A talk');
  const section = { id: 'intro', label: 'Introduction', translations: { es: { label: 'Introducción' } } };
  assert.equal(resolveContentVariant(section, 'section', 'es', BILINGUAL).value.id, 'intro');
});
