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

function idLimit(maxLength) {
  const limit = Number(maxLength);
  if (!Number.isInteger(limit) || limit < 8) return MAX_ID_LENGTH;
  return Math.min(limit, MAX_ID_LENGTH);
}

/** A lowercase id, or the fallback when the text has no letters or digits. */
export function editorialId(text, fallback = 'item', maxLength = MAX_ID_LENGTH) {
  const limit = idLimit(maxLength);
  const slug = slugify(text).slice(0, limit);
  if (slug) return slug;
  return (slugify(fallback) || 'item').slice(0, limit);
}

/**
 * `base`, or `base-2`, `base-3`, … when `base` is already in `taken`.
 * `reserved` ids are treated as taken so a route such as `new` is never minted.
 * @param {string} text
 * @param {Iterable<string>} taken
 * @param {string} [fallback]
 * @param {{ maxLength?: number, reserved?: Iterable<string> }} [options]
 */
export function uniqueEditorialId(text, taken, fallback = 'item', options = {}) {
  const limit = idLimit(options.maxLength);
  const used = new Set(taken ?? []);
  for (const id of options.reserved ?? []) used.add(id);
  const base = editorialId(text, fallback, limit);
  if (!used.has(base)) return base;
  let n = 2;
  while (n < 10000) {
    const suffix = `-${n}`;
    const stem = base.slice(0, limit - suffix.length).replace(/-+$/g, '') || 'item';
    const candidate = `${stem}${suffix}`;
    if (!used.has(candidate)) return candidate;
    n += 1;
  }
  return `${base.slice(0, limit - 2)}-x`;
}

/**
 * Keep a non-empty id. Allocate only when the record does not have one yet.
 * @param {unknown} current
 * @param {string} text
 * @param {Iterable<string>} taken
 * @param {string} [fallback]
 * @param {{ maxLength?: number, reserved?: Iterable<string> }} [options]
 */
export function lockEditorialId(current, text, taken, fallback = 'item', options = {}) {
  const existing = String(current ?? '').trim();
  if (existing) return existing;
  return uniqueEditorialId(text, taken, fallback, options);
}
