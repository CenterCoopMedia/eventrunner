'use strict';

const { contentLanguages, resolveContentVariant } = require('./contentLanguages.cjs');
const { withContentLanguage } = require('./languageUrls.cjs');
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

/** Canonical route paths for the approved page or session versions. */
function publicRouteUrls(path, record, kind, event) {
  // Hosting uses static HTML at the root and attendee directory.
  if (path === '/' || path === '/attendees') return { en: path };
  const config = contentLanguages(event);
  if (!config.available.includes('es')) return { en: path };
  const approvedSpanish = (unit, unitKind) => resolveContentVariant(unit, unitKind, 'es', event).language === 'es';
  const hasSpanish = approvedSpanish(record, kind)
    || (kind === 'page' && Array.isArray(record?.sections)
      && record.sections.some((section) => typeof section?.label === 'string' && section.label.trim()
        && approvedSpanish(section, 'section')));
  if (hasSpanish) {
    return { en: withContentLanguage(path, 'en'), es: withContentLanguage(path, 'es') };
  }
  return { en: config.default === 'es' ? withContentLanguage(path, 'en') : path };
}

module.exports = { metaExcerpt, eventMetaDescription, publicRouteUrls };
