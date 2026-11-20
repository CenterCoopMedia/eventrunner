'use strict';

const { isStarterText } = require('./seed.cjs');
const { contentLanguages, resolveContentVariant } = require('./contentLanguages.cjs');
const { withContentLanguage } = require('./languageUrls.cjs');

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

/** Crawler documents from published home hero text and the event defaults. */
function homepageMetadata(event, blocks = []) {
  const hero = (field) => blocks.find((block) => block?.section === 'hero' && block.field === field
    && block.visible === true && block.blockType === 'text' && !isStarterText(block.value));
  const title = hero('title');
  const subtitle = hero('subtitle');
  const config = contentLanguages(event);
  const eventTitle = isStarterText(event?.name) ? 'Event site' : event.name.trim();
  const tags = (name, description) => {
    const titlePart = name && name !== eventTitle ? name : null;
    return { title: titlePart ? `${titlePart} · ${eventTitle}` : eventTitle, titlePart, description };
  };
  const text = {
    en: tags(title?.value.trim(), metaExcerpt(subtitle?.value) || eventMetaDescription(event)),
  };
  const spanishTitle = resolveContentVariant(title, 'block', 'es', event);
  const spanishSubtitle = resolveContentVariant(subtitle, 'block', 'es', event);
  if ((title && (spanishTitle.language !== 'es' || isStarterText(spanishTitle.value.value)))
      || spanishSubtitle.language !== 'es' || isStarterText(spanishSubtitle.value.value)) {
    return { text, urls: { en: config.default === 'es' ? withContentLanguage('/', 'en') : '/' } };
  }
  // With no authored hero title, the proper event name is shared.
  text.es = tags(spanishTitle.value?.value.trim(), metaExcerpt(spanishSubtitle.value.value));
  return {
    text,
    urls: { en: withContentLanguage('/', 'en'), es: withContentLanguage('/', 'es') },
  };
}

module.exports = { metaExcerpt, eventMetaDescription, homepageMetadata };
