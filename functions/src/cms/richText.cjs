'use strict';

const sanitizeHtml = require('sanitize-html');
const {
  RICH_TEXT_ALLOWED_TAGS,
  RICH_TEXT_ALLOWED_ATTRIBUTES,
  RICH_TEXT_DROP_WITH_CONTENT_TAGS,
  RICH_TEXT_ALLOWED_SCHEMES,
  isSafeRichTextHref,
} = require('shared/richText');
const { BLOCK_TYPES } = require('./blockTypes.cjs');

const SANITIZE_OPTIONS = Object.freeze({
  allowedTags: RICH_TEXT_ALLOWED_TAGS,
  allowedAttributes: RICH_TEXT_ALLOWED_ATTRIBUTES,
  allowedSchemes: RICH_TEXT_ALLOWED_SCHEMES,
  allowedSchemesAppliedToAttributes: ['href'],
  allowProtocolRelative: true,
  nonTextTags: RICH_TEXT_DROP_WITH_CONTENT_TAGS,
  transformTags: {
    a(_tagName, attributes) {
      const href = attributes.href;
      return isSafeRichTextHref(href)
        ? { tagName: 'a', attribs: { href: href.trim(), rel: 'noopener noreferrer' } }
        : { tagName: 'a', attribs: {} };
    },
  },
});

/** Authoritative sanitizer for one stored rich-text value. */
function sanitizeRichTextHtml(value) {
  if (typeof value !== 'string' || value === '') return '';
  // Use the browser's HTML5 spelling for void elements. This matches the
  // DOM sanitizer and Quill exporter, so opening an unchanged draft with a
  // divider or line break does not create a slash-only revision.
  return sanitizeHtml(value, SANITIZE_OPTIONS).replace(/<(br|hr) \/>/g, '<$1>');
}

/**
 * Sanitize every rich-text field declared by the result block type. Call
 * this after an update has merged its base and applied deletion sentinels,
 * so the exact object about to be validated and written crosses the seam.
 */
function sanitizeRichTextFields(fields) {
  if (!fields || typeof fields !== 'object') return fields;
  const definition = BLOCK_TYPES[fields.blockType];
  if (!definition) return fields;
  const richTextFields = definition.fields.filter((field) => field.type === 'richtext');
  if (richTextFields.length === 0) return fields;

  const clean = { ...fields };
  for (const field of richTextFields) {
    if (Object.prototype.hasOwnProperty.call(clean, field.id)) {
      clean[field.id] = sanitizeRichTextHtml(clean[field.id]);
    }
  }
  return clean;
}

module.exports = {
  sanitizeRichTextHtml,
  sanitizeRichTextFields,
  internals: { SANITIZE_OPTIONS },
};
