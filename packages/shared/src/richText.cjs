'use strict';

/**
 * The HTML vocabulary stored in CMS rich-text fields. The browser and the
 * Functions write boundary use this one policy so an editor cannot offer a
 * format that the server removes, and a direct API caller cannot store a
 * format the public renderer would refuse.
 */
const RICH_TEXT_ALLOWED_TAGS = Object.freeze([
  'p',
  'br',
  'hr',
  'strong',
  'em',
  'b',
  'i',
  'u',
  's',
  'a',
  'ul',
  'ol',
  'li',
  'h2',
  'h3',
  'h4',
  'blockquote',
  'code',
  'pre',
]);

const RICH_TEXT_ALLOWED_ATTRIBUTES = Object.freeze({
  a: Object.freeze(['href', 'rel']),
});

// These elements and their fallback contents never become stored copy.
const RICH_TEXT_DROP_WITH_CONTENT_TAGS = Object.freeze([
  'script',
  'style',
  'iframe',
  'frame',
  'frameset',
  'object',
  'embed',
  'applet',
  'link',
  'meta',
  'base',
  'title',
  'svg',
  'math',
  'template',
  'noscript',
  'form',
  'input',
  'button',
  'textarea',
  'select',
  'option',
  'dialog',
  'canvas',
  'audio',
  'video',
  'source',
  'track',
  'slot',
]);

const RICH_TEXT_ALLOWED_SCHEMES = Object.freeze(['http', 'https', 'mailto', 'tel']);
const SAFE_HREF_PROTOCOL = /^(https?:|mailto:|tel:)/i;

/** True for relative paths, fragments, and the allowed absolute schemes. */
function isSafeRichTextHref(value) {
  if (typeof value !== 'string') return false;
  const href = value.trim();
  if (href === '') return false;
  if (/^[#/]/.test(href) || href.startsWith('./') || href.startsWith('../')) return true;
  if (!href.includes(':')) return true;
  return SAFE_HREF_PROTOCOL.test(href);
}

/**
 * Whether sanitized rich text contains readable text or a visible divider.
 * Markup and whitespace alone do not satisfy a required rich-text field.
 */
function hasRichTextContent(value) {
  if (typeof value !== 'string' || value === '') return false;
  if (/<hr(?:\s[^>]*)?>/i.test(value)) return true;
  const text = value
    .replace(/<br\s*\/?>/gi, ' ')
    .replace(/<[^>]*>/g, '')
    .replace(/&(?:nbsp|#0*160|#x0*a0);/gi, ' ')
    // The sanitizer encodes text delimiters. Any remaining entity is one
    // text character for the required-field decision.
    .replace(/&(?:#x[0-9a-f]+|#\d+|[a-z][a-z0-9]+);/gi, 'x')
    .replace(/[\u200b-\u200d\ufeff]/g, '');
  return text.trim().length > 0;
}

module.exports = {
  RICH_TEXT_ALLOWED_TAGS,
  RICH_TEXT_ALLOWED_ATTRIBUTES,
  RICH_TEXT_DROP_WITH_CONTENT_TAGS,
  RICH_TEXT_ALLOWED_SCHEMES,
  isSafeRichTextHref,
  hasRichTextContent,
};
