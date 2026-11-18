'use strict';

const { hasRichTextContent } = require('./richText.cjs');
const { LANGUAGES } = require('./languageUrls.cjs');

const ENGLISH_ONLY = Object.freeze({ default: 'en', available: Object.freeze(['en']) });
// Identifiers, URLs, prices, figures, attributions and proper names are shared.
const BLOCK_FIELDS = Object.freeze({
  text: ['value'], richtext: ['value'], image: ['alt', 'caption'], cta: ['label'],
  stat: ['label', 'takeaway', 'description', 'alt'], fact: ['label', 'note'],
  quote: ['text'], list_item: ['text'], faq_item: ['question', 'answer'],
  link_group: ['label'], sponsor_package: ['benefits'],
});
const RICH_FIELDS = Object.freeze({ richtext: ['value'], faq_item: ['answer'], sponsor_package: ['benefits'] });

function plainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    && [Object.prototype, null].includes(Object.getPrototypeOf(value));
}

function variantFields(kind, record = {}) {
  if (kind === 'page') return record?.systemPage === true ? ['label'] : ['label', 'title'];
  if (kind === 'section') return ['label', 'description'];
  if (kind === 'session') return ['title', 'description'];
  if (kind === 'block') return Object.hasOwn(BLOCK_FIELDS, record?.blockType) ? BLOCK_FIELDS[record.blockType] : [];
  return [];
}

function richVariantFields(record = {}) {
  return Object.hasOwn(RICH_FIELDS, record?.blockType) ? RICH_FIELDS[record.blockType] : [];
}

function languageConfigErrors(value) {
  if (value === undefined) return [];
  if (!plainObject(value)) return ['contentLanguages: must be an object'];
  const errors = Object.keys(value).filter((key) => !['default', 'available'].includes(key))
    .map((key) => `contentLanguages.${key}: unknown field`);
  if (!Array.isArray(value.available) || value.available.length === 0
      || value.available.some((language) => !LANGUAGES.includes(language))
      || new Set(value.available).size !== value.available.length || !value.available.includes('en')) {
    errors.push('contentLanguages.available: must list unique en/es languages including en');
  }
  if (!LANGUAGES.includes(value.default) || !Array.isArray(value.available) || !value.available.includes(value.default)) {
    errors.push('contentLanguages.default: must name an available language');
  }
  return errors;
}

function contentLanguages(event = {}) {
  const value = event?.contentLanguages;
  return value && languageConfigErrors(value).length === 0 ? value : ENGLISH_ONLY;
}

function selectContentLanguage(event, requested) {
  const config = contentLanguages(event);
  return config.available.includes(requested) ? requested : config.default;
}

function variantErrors(record, kind, prefix = 'translations') {
  if (!record || !Object.hasOwn(record, 'translations')) return [];
  const translations = record.translations;
  if (!plainObject(translations)) return [`${prefix}: must be an object`];
  const errors = [];
  const fields = variantFields(kind, record);
  for (const [language, variant] of Object.entries(translations)) {
    if (language !== 'es') {
      errors.push(`${prefix}.${language}: only es is stored here; source fields are en`);
      continue;
    }
    if (!plainObject(variant)) {
      errors.push(`${prefix}.es: must be an object`);
      continue;
    }
    for (const [field, value] of Object.entries(variant)) {
      if (!fields.includes(field)) errors.push(`${prefix}.es.${field}: not a translatable field`);
      else if (typeof value !== 'string') errors.push(`${prefix}.es.${field}: must be a string`);
    }
  }
  return errors;
}

function collectionVariantErrors(record, collection) {
  const kind = { cmsPages: 'page', cmsContent: 'block', cmsSchedule: 'session' }[collection];
  if (!['page', 'block', 'session'].includes(kind) && record && Object.hasOwn(record, 'translations')) {
    return ['translations: not supported for this collection'];
  }
  const errors = variantErrors(record, kind);
  if (collection === 'cmsPages' && Array.isArray(record?.sections)) {
    record.sections.forEach((section, index) => errors.push(...variantErrors(section, 'section', `sections[${index}].translations`)));
  }
  return errors;
}

/** Resolve one coherent text unit, never fill its holes with another language.
 * A page name, section heading, block, or session title/description is one unit.
 * Partial variants remain editable/publishable; a reader gets the whole English
 * unit until each nonempty source field has a nonempty Spanish counterpart.
 */
function resolveContentVariant(record, kind, requestedLanguage, event = {}) {
  const config = contentLanguages(event);
  const requested = requestedLanguage ?? config.default;
  const fields = variantFields(kind, record);
  const variant = record?.translations?.es;
  const rich = kind === 'block' ? richVariantFields(record) : [];
  const filled = (field, value) => typeof value === 'string'
    && (rich.includes(field) ? hasRichTextContent(value) : value.trim().length > 0);
  const sourceFields = fields.filter((field) => filled(field, record?.[field]));
  const spanish = requested === 'es' && config.available.includes('es')
    && variantErrors(record, kind).length === 0 && plainObject(variant)
    && sourceFields.length > 0 && sourceFields.every((field) => filled(field, variant[field]));
  const value = spanish ? { ...record, ...variant } : record;
  return { value, language: spanish ? 'es' : 'en', requestedLanguage: requested, fallback: requested !== (spanish ? 'es' : 'en') };
}

module.exports = {
  LANGUAGES, contentLanguages, languageConfigErrors, variantFields, richVariantFields,
  variantErrors, collectionVariantErrors, resolveContentVariant, selectContentLanguage,
};
