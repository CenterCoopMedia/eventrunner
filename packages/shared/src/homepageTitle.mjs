import { isStarterText } from './seed.mjs';

export function publishedHeroText(block, field) {
  return block?.section === 'hero' && block.field === field && block.visible === true
    && block.blockType === 'text' && !isStarterText(block.value) ? block.value.trim() : '';
}

export function homepageEventTitle(event) {
  return typeof event?.name === 'string' && event.name.trim() ? event.name.trim() : 'Event site';
}

export function homepageTitlePart(name, eventTitle) {
  return name && name !== eventTitle ? name : null;
}
