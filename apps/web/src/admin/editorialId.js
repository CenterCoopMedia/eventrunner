// Stable technical ids for new pages, sections, blocks, and sessions.
// An id is chosen once, at the first save that passes validation, and then
// kept. A later label change must not mint a second document.

const MAX_ID_LENGTH = 128;

function slugify(text) {
  return String(text ?? '')
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .replace(/-+/g, '-');
}

/** A lowercase id, or the fallback when the text has no letters or digits. */
export function editorialId(text, fallback = 'item') {
  const slug = slugify(text).slice(0, MAX_ID_LENGTH);
  if (slug) return slug;
  return (slugify(fallback) || 'item').slice(0, MAX_ID_LENGTH);
}

/**
 * `base`, or `base-2`, `base-3`, … when `base` is already in `taken`.
 * @param {string} text
 * @param {Iterable<string>} taken
 * @param {string} [fallback]
 */
export function uniqueEditorialId(text, taken, fallback = 'item') {
  const used = taken instanceof Set ? taken : new Set(taken ?? []);
  const base = editorialId(text, fallback);
  if (!used.has(base)) return base;
  let n = 2;
  while (n < 10000) {
    const suffix = `-${n}`;
    const stem = base.slice(0, MAX_ID_LENGTH - suffix.length).replace(/-+$/g, '') || 'item';
    const candidate = `${stem}${suffix}`;
    if (!used.has(candidate)) return candidate;
    n += 1;
  }
  return `${base.slice(0, MAX_ID_LENGTH - 2)}-x`;
}

/**
 * Keep a non-empty id. Allocate only when the record does not have one yet.
 * @param {unknown} current
 * @param {string} text
 * @param {Iterable<string>} taken
 * @param {string} [fallback]
 */
export function lockEditorialId(current, text, taken, fallback = 'item') {
  const existing = String(current ?? '').trim();
  if (existing) return existing;
  return uniqueEditorialId(text, taken, fallback);
}
