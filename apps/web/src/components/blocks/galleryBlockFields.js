import { isSafeHref } from '../../lib/sanitizeHtml.js';

export const GALLERY_LAYOUTS = Object.freeze(['grid', 'carousel', 'slideshow']);

/** The pictures a gallery may draw: a safe path with alt text, nothing else. */
export function galleryImages(block) {
  if (!Array.isArray(block?.images)) return [];
  return block.images.filter(
    (image) =>
      typeof image?.url === 'string' &&
      image.url.trim() &&
      isSafeHref(image.url) &&
      typeof image.alt === 'string' &&
      image.alt.trim(),
  );
}

/** The stored layout when it is one the page has, else grid. */
export function galleryLayout(block) {
  return GALLERY_LAYOUTS.includes(block?.layout) ? block.layout : 'grid';
}
