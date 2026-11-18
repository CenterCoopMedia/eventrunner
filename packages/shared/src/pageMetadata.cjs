'use strict';

const { isStarterText } = require('./seed.cjs');

/** Plain text for an HTML description, cut at a word boundary. */
function metaExcerpt(text, maxLen = 200) {
  if (typeof text !== 'string') return '';
  const trimmed = text.trim();
  if (trimmed.length <= maxLen) return trimmed;
  const cut = trimmed.slice(0, maxLen);
  const lastSpace = cut.lastIndexOf(' ');
  return `${(lastSpace > 40 ? cut.slice(0, lastSpace) : cut).trim()}…`;
}

function eventMetaDescription(event) {
  if (!isStarterText(event?.seo?.description)) return event.seo.description.trim();
  return typeof event?.tagline === 'string' ? event.tagline.trim() : '';
}

module.exports = { metaExcerpt, eventMetaDescription };
