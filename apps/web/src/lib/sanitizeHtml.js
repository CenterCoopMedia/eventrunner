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

// Defensive cap on total elements walked. A ~1MB Firestore doc could in
// principle nest far deeper than any legitimate editor content would; this
// keeps a pathological document bounded instead of pegging the main thread.
const MAX_NODES_WALKED = 20000;

// Builds a *fresh* output tree rather than mutating the parsed one in
// place. An earlier version unwrapped disallowed wrappers (div, span,
// font…) by repeatedly doing `parent.insertBefore(child.firstChild, child)`
// — but each such move relocates the *entire remaining nested subtree* in
// one call, and DOM implementations do O(subtree size) bookkeeping per
// move (rooted-document flags etc.), so a chain of n nested wrappers cost
// O(n^2)+ overall even though the node-visitation itself was linear.
// Nested unknown wrappers are exactly what unfiltered rich-text paste
// produces, so that cost was reachable from ordinary CMS content.
//
// Building fresh avoids the problem structurally: every node we append is
// either a brand-new (empty, or previously-appended-and-therefore-small)
// element or a text node, so every appendChild is O(1) — nothing we ever
// move carries an unprocessed subtree with it. Iterative (explicit stack)
// rather than recursive so pathological depth can't blow the JS call stack.
function cleanTree(sourceRoot, doc) {
  const rootFragment = doc.createDocumentFragment();
  const stack = [
    { children: Array.from(sourceRoot.childNodes), index: 0, target: rootFragment },
  ];
  let walked = 0;
  while (stack.length) {
    const frame = stack[stack.length - 1];
    if (frame.index >= frame.children.length) {
      stack.pop();
      continue;
    }
    if (walked++ > MAX_NODES_WALKED) return rootFragment;
    const child = frame.children[frame.index];
    frame.index += 1;

    if (child.nodeType === Node.TEXT_NODE) {
      frame.target.appendChild(doc.createTextNode(child.data));
      continue;
    }
    if (child.nodeType !== Node.ELEMENT_NODE) {
      // Comments, CDATA, processing instructions: gone.
      continue;
    }
    const tag = child.tagName.toLowerCase();
    if (DROP_WITH_CONTENT.has(tag)) {
      // Skip entirely — don't descend, contents go with it.
      continue;
    }
    if (!ALLOWED_TAGS.has(tag)) {
      // Unknown-but-harmless wrapper: keep its children by appending them
      // straight into the current target, dropping the wrapper itself.
      stack.push({ children: Array.from(child.childNodes), index: 0, target: frame.target });
      continue;
    }
    // Allowed element: rebuild it with only the allowlisted attributes.
    const clean = doc.createElement(tag);
    if (tag === 'a') {
      const href = child.getAttribute('href');
      if (href !== null && isSafeHref(href)) {
        clean.setAttribute('href', href);
        // Links in body copy may point anywhere the CMS allows; sever the
        // opener relationship either way.
        clean.setAttribute('rel', 'noopener noreferrer');
      }
    }
    frame.target.appendChild(clean);
    stack.push({ children: Array.from(child.childNodes), index: 0, target: clean });
  }
  return rootFragment;
}

/**
 * Sanitize a CMS richtext value to the allowlisted subset. Always returns a
 * string; non-strings and parse failures come back as ''.
 */
export function sanitizeHtml(html) {
  if (typeof html !== 'string' || html === '') return '';
  try {
    const doc = new DOMParser().parseFromString(html, 'text/html');
    if (!doc?.body) return '';
    const container = doc.createElement('div');
    container.appendChild(cleanTree(doc.body, doc));
    return container.innerHTML;
  } catch {
    // Never let a pathological document take the renderer down with it.
    return '';
  }
}

export default sanitizeHtml;
