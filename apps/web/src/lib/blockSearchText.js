// The plain-text a reader would search a content block by (issue #14 spec
// M7-14, the section-index-and-filter feature for a long content page).
//
// Every block type keeps its readable copy in a different field
// (registry.jsx), so a keyword filter needs one place that knows how to read
// each shape rather than teaching that mapping to every caller.
//
// Two kinds of field, two treatments. Richtext and a FAQ answer are
// CMS-authored HTML (sanitizeHtml's allowlist): tags are stripped so a
// search matches the words a reader sees, not the markup around them, and
// the HTML entities that survive that strip (an author typing through a
// rich-text toolbar produces "AT&amp;T", never a literal "&") are decoded
// afterward so a search for "AT&T" still finds it. Every other field —
// text.value, list_item.text, a FAQ question, a label, a stat's own value —
// is plain CMS input, never markup, and is indexed VERBATIM: running it
// through the tag-shaped regex would treat a literal "<VIP>" in a plain
// field as a tag and silently delete it, taking "VIP" out of the index for
// a reason no editor typed.
const HTML_TAG = /<[^>]*>/g;

// A small, deliberately non-exhaustive set: the entities a CMS rich-text
// toolbar actually produces (ampersand, angle brackets, quotes, smart
// punctuation, non-breaking space), not the full HTML5 named-entity table.
// Unrecognized named entities are left as-is rather than guessed at.
const NAMED_ENTITIES = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  nbsp: ' ',
  hellip: '…',
  mdash: '—',
  ndash: '–',
  lsquo: '‘',
  rsquo: '’',
  ldquo: '“',
  rdquo: '”',
};

// Named ("&amp;") and numeric, decimal or hex ("&#38;", "&#x26;") entities.
const ENTITY = /&(#x[0-9a-fA-F]+|#[0-9]+|[a-zA-Z]+);/g;

/** Decode the entities a sanitized rich-text value can carry, without ever
 * building DOM (no innerHTML) — a plain string-in, string-out table lookup
 * plus a numeric-codepoint parse. An entity this table doesn't recognize
 * passes through unchanged rather than being guessed at or dropped. */
function decodeEntities(value) {
  return value.replace(ENTITY, (match, body) => {
    if (body[0] === '#') {
      const isHex = body[1] === 'x' || body[1] === 'X';
      const codePoint = parseInt(body.slice(isHex ? 2 : 1), isHex ? 16 : 10);
      return Number.isFinite(codePoint) ? String.fromCodePoint(codePoint) : match;
    }
    const decoded = NAMED_ENTITIES[body];
    return decoded !== undefined ? decoded : match;
  });
}

/** An HTML-backed field: strip real tags first (so an escaped "&lt;" already
 * reads as text and is never re-exposed to the tag regex by decoding first),
 * then decode what the strip left behind. */
function stripHtml(value) {
  return typeof value === 'string' ? decodeEntities(value.replace(HTML_TAG, ' ')) : '';
}

/** A plain CMS field: never markup, so it is indexed exactly as stored. */
function verbatim(value) {
  return typeof value === 'string' ? value : '';
}

function joined(...parts) {
  return parts.filter((part) => typeof part === 'string' && part.trim()).join(' ');
}

/** The type-specific half of a block's searchable text. */
function typeSearchText(block) {
  switch (block.blockType) {
    case 'text':
      return verbatim(block.value);
    case 'richtext':
      return stripHtml(block.value);
    case 'image':
      return joined(block.alt, block.caption);
    case 'cta':
      return joined(block.label);
    case 'stat':
      // The figure itself (block.value, e.g. "1,200") is as much a fact a
      // reader searches by as its label or takeaway — a query for the
      // number should find the stat that states it.
      return joined(block.value, block.takeaway, block.label, block.description, block.source, block.alt);
    case 'list_item':
      return verbatim(block.text);
    case 'faq_item':
      return joined(verbatim(block.question), stripHtml(block.answer));
    case 'link_group':
      return joined(block.label, block.group);
    default:
      return '';
  }
}

/** The searchable text for one cmsContent block, blank for a type with none.
 * `sectionLabel`, when given, is appended so a query for the section's own
 * name (e.g. "Venue") matches every block filed under it, not only a block
 * that happens to repeat the word. */
export function blockSearchText(block, { sectionLabel } = {}) {
  if (!block || typeof block !== 'object') return '';
  return joined(typeSearchText(block), sectionLabel);
}

/** Whether a block's own text (plus its section's label, via `options.
 * sectionLabel`) contains the query, case-insensitive. An empty or
 * whitespace-only query matches everything, so "no filter yet" and "every
 * block matches" are the same state. */
export function blockMatchesQuery(block, query, options) {
  const trimmed = (query ?? '').trim().toLowerCase();
  if (!trimmed) return true;
  return blockSearchText(block, options).toLowerCase().includes(trimmed);
}
