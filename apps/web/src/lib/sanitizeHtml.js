// Rich-text sanitizer for CMS-authored HTML (spec §5.2 richtext fields).
//
// Editors are trusted-ish, but the published collection is world-readable
// data and rich text reaches the DOM via dangerouslySetInnerHTML, so every
// richtext value passes through this allowlist first. The policy is
// deny-by-default:
//   - allowed tags keep only their allowlisted attributes (href on <a>,
//     nothing anywhere else — no style, no event handlers, no target);
//   - actively dangerous elements are removed with their contents;
//   - any other unknown element is unwrapped so its text survives;
//   - hrefs must be relative or http(s)/mailto/tel — javascript: and
//     friends are dropped.
//
// DOM-based (DOMParser) rather than regex-based: the browser's parser is
// the same one that will interpret the output, so there is no parse
// differential to smuggle markup through.

const ALLOWED_TAGS = new Set([
  'p',
  'br',
  'hr',
  'strong',
  'em',
  'b',
  'i',
  'u',
  's',
  'a',
  'ul',
  'ol',
  'li',
  'h2',
  'h3',
  'h4',
  'blockquote',
  'code',
  'pre',
]);

// Removed entirely, contents included — script bodies and iframe fallbacks
// must not leak into the page as text.
const DROP_WITH_CONTENT = new Set([
  'script',
  'style',
  'iframe',
  'frame',
  'frameset',
  'object',
  'embed',
  'applet',
  'link',
  'meta',
  'base',
  'title',
  'svg',
  'math',
  'template',
  'noscript',
  'form',
  'input',
  'button',
  'textarea',
  'select',
  'option',
  'dialog',
  'canvas',
  'audio',
  'video',
  'source',
  'track',
  'slot',
]);

const SAFE_HREF_PROTOCOL = /^(https?:|mailto:|tel:)/i;

/** True for hrefs we allow on <a>: relative paths, fragments, http(s), mailto, tel. */
export function isSafeHref(value) {
  if (typeof value !== 'string') return false;
  const href = value.trim();
  if (href === '') return false;
  if (/^[#/]/.test(href) || href.startsWith('./') || href.startsWith('../')) {
    return true;
  }
  // Anything else with a scheme-ish prefix must match the allowlist; a bare
  // word without ':' is treated as a relative path and allowed.
  if (!href.includes(':')) return true;
  return SAFE_HREF_PROTOCOL.test(href);
}

function cleanNode(parent) {
  // Snapshot the child list: removal/unwrap mutates childNodes live.
  for (const child of Array.from(parent.childNodes)) {
    if (child.nodeType === Node.TEXT_NODE) continue;
    if (child.nodeType !== Node.ELEMENT_NODE) {
      // Comments, CDATA, processing instructions: gone.
      child.remove();
      continue;
    }
    const tag = child.tagName.toLowerCase();
    if (DROP_WITH_CONTENT.has(tag)) {
      child.remove();
      continue;
    }
    if (!ALLOWED_TAGS.has(tag)) {
      // Unknown-but-harmless wrapper (div, span, font…): keep the children,
      // drop the element, then re-clean them in place.
      while (child.firstChild) parent.insertBefore(child.firstChild, child);
      child.remove();
      cleanNode(parent);
      return;
    }
    // Allowed element: strip every attribute except a safe href on <a>.
    for (const attr of Array.from(child.attributes)) {
      const name = attr.name.toLowerCase();
      if (tag === 'a' && name === 'href' && isSafeHref(attr.value)) continue;
      child.removeAttribute(attr.name);
    }
    if (tag === 'a' && child.hasAttribute('href')) {
      // Links in body copy may point anywhere the CMS allows; sever the
      // opener relationship either way.
      child.setAttribute('rel', 'noopener noreferrer');
    }
    cleanNode(child);
  }
}

/**
 * Sanitize a CMS richtext value to the allowlisted subset. Always returns a
 * string; non-strings and parse failures come back as ''.
 */
export function sanitizeHtml(html) {
  if (typeof html !== 'string' || html === '') return '';
  const doc = new DOMParser().parseFromString(html, 'text/html');
  if (!doc?.body) return '';
  cleanNode(doc.body);
  return doc.body.innerHTML;
}

export default sanitizeHtml;
