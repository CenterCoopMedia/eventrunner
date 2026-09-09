// The plain-text a reader would search a content block by (issue #14 spec
// M7-14, the section-index-and-filter feature for a long content page).
//
// Every block type keeps its readable copy in a different field
// (registry.jsx), so a keyword filter needs one place that knows how to read
// each shape rather than teaching that mapping to every caller. Richtext and
// FAQ answers are CMS-authored HTML (sanitizeHtml's allowlist) — tags are
// stripped before matching, so a search matches the words a reader sees, not
// the markup around them.
const HTML_TAG = /<[^>]*>/g;

function plain(value) {
  return typeof value === 'string' ? value.replace(HTML_TAG, ' ') : '';
}

function joined(...parts) {
  return parts.filter((part) => typeof part === 'string' && part.trim()).join(' ');
}

/** The type-specific half of a block's searchable text. */
function typeSearchText(block) {
  switch (block.blockType) {
    case 'text':
      return plain(block.value);
    case 'richtext':
      return plain(block.value);
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
      return plain(block.text);
    case 'faq_item':
      return joined(plain(block.question), plain(block.answer));
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
