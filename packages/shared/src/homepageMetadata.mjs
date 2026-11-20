import { contentLanguages, resolveContentVariant } from './contentLanguages.mjs';
import { withContentLanguage } from './languageUrls.mjs';
import { metaExcerpt, eventMetaDescription } from './pageMetadata.mjs';
import { isStarterText } from './seed.mjs';

/** Crawler documents from published home hero text and the event defaults. */
export function homepageMetadata(event, blocks = []) {
  const hero = (field) => blocks.find((block) => block?.section === 'hero' && block.field === field
    && block.visible === true && block.blockType === 'text' && !isStarterText(block.value));
  const title = hero('title');
  const subtitle = hero('subtitle');
  const config = contentLanguages(event);
  const eventTitle = typeof event?.name === 'string' && event.name.trim() ? event.name.trim() : 'Event site';
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
