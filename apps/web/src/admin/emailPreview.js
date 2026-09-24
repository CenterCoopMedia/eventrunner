// The stored-mail preview document (issue #183): the ONE way stored email
// HTML reaches the screen. It is only ever handed to an <iframe sandbox="">
// as `srcdoc` (pages/AdminEmailLog.jsx), never to innerHTML. The plain-text
// body is shown separately, as a React text node.
//
// Two barriers, each enough on its own for script:
//
//   1. The frame's empty `sandbox` attribute. The document runs with an
//      opaque origin, no script, no forms, no popups, no top navigation and
//      no plugins. It cannot read the admin's storage or token.
//   2. The content policy below, as the first element of <head>, so the
//      browser applies it before it meets anything in the stored markup.
//      `default-src 'none'` refuses script, frames, objects, fonts, media
//      and every fetch; `img-src data:` lets an inline image draw and no
//      remote one load, so no tracking pixel learns that a mail was opened.
//
// Neither barrier stops the frame from navigating ITSELF: a link that
// targets its own frame sends a real request. So links are turned off here:
// every `a` and `area` (and every MathML element) loses its href and
// xlink:href, and the words stay. The pass also removes what could bring a
// link back or route around the policy:
//
//   - every stored `meta`, `base` and `link` (a refresh, a policy of its
//     own, a re-pointed base, a resource hint);
//   - every `template`, because the frame's parser attaches a declarative
//     shadow root that DOMParser leaves inert, and a query never enters it;
//   - every SVG animation element (`set`, `animate`, `animateMotion`,
//     `animateTransform`, `discard`), because one can write a target or an
//     href onto a link after this pass has run, from inside it or outside;
//   - every `form`, and every nested frame or embedded object, whose
//     `srcdoc` or content this pass never reads.
//
// THE FIXED POINT. Markup can parse into one tree, serialize, and parse
// again into another (nested forms, MathML and style are the classic
// shapes). So the pass parses, strips, and serializes until the output stops
// changing. At that point the tree the frame builds from the output is the
// tree this pass checked, because the frame's parser runs the same
// algorithm as DOMParser, with script off and the doctype in front. Markup
// that does not settle in a few passes, or that still holds something the
// strip removes, is not rendered: the caller shows the plain text instead.
//
// The colour-scheme meta and the style draw the mail on the system's light
// canvas, as a light mail client shows it, in either admin mode. No colour
// literal is written here.

/** The frame's content policy, word for word. */
export const PREVIEW_POLICY =
  "default-src 'none'; img-src data:; style-src 'unsafe-inline'; form-action 'none'; base-uri 'none'";

const CANVAS_STYLE = ':root{background:Canvas;color:CanvasText}';
const DOCTYPE = '<!DOCTYPE html>';
const MATHML_NS = 'http://www.w3.org/1998/Math/MathML';
const MAX_PASSES = 5;

/** Elements removed with everything inside them, compared lowercased. */
const REMOVED = new Set([
  'meta',
  'base',
  'link',
  'template',
  'form',
  'iframe',
  'frame',
  'frameset',
  'object',
  'embed',
  'portal',
  'fencedframe',
  'set',
  'animate',
  'animatemotion',
  'animatetransform',
  'discard',
]);

function parseHtml(html) {
  return new DOMParser().parseFromString(html, 'text/html');
}

/** The whole document as the frame will receive it, doctype first. */
function serialize(doc) {
  return `${DOCTYPE}${doc.documentElement.outerHTML}`;
}

/** Whether an element can carry a link: anchors, image-map areas, and MathML. */
function linkable(element) {
  const name = element.localName.toLowerCase();
  return name === 'a' || name === 'area' || element.namespaceURI === MATHML_NS;
}

/** Every href on an element, in any namespace (href and xlink:href alike). */
const hrefAttributes = (element) =>
  [...element.attributes].filter((attribute) => attribute.localName.toLowerCase() === 'href');

/** Remove what the preview never renders, and every link target. Mutates and returns `doc`. */
function strip(doc) {
  for (const element of [...doc.getElementsByTagName('*')]) {
    if (REMOVED.has(element.localName.toLowerCase())) {
      element.remove();
    } else if (linkable(element)) {
      for (const attribute of hrefAttributes(element)) element.removeAttributeNode(attribute);
    }
  }
  return doc;
}

/** Whether a parsed document holds nothing the strip removes, apart from `ours`. */
function isInert(doc, ours = new Set()) {
  for (const element of doc.getElementsByTagName('*')) {
    if (ours.has(element)) continue;
    if (REMOVED.has(element.localName.toLowerCase())) return false;
    if (linkable(element) && hrefAttributes(element).length > 0) return false;
  }
  return true;
}

/**
 * Parse, strip, and serialize until the output stops changing. Answers the
 * settled document, or null when it does not settle within `maxPasses` or
 * still holds something the strip removes.
 *
 * @param {string} html
 * @param {{ maxPasses?: number }} [options]
 * @returns {string|null}
 */
function settle(html, { maxPasses = MAX_PASSES } = {}) {
  let current = html;
  for (let pass = 0; pass < maxPasses; pass += 1) {
    const next = serialize(strip(parseHtml(current)));
    if (next === current) return isInert(parseHtml(next)) ? next : null;
    current = next;
  }
  return null;
}

/**
 * Build the `srcdoc` for a stored html body, or null when the body cannot
 * be shown safely and the caller should show the plain text instead.
 *
 * @param {string|null|undefined} html the stored body
 * @returns {string|null} a whole document, doctype first, or null
 */
export function buildPreviewDoc(html) {
  const settled = settle(typeof html === 'string' ? html : '');
  if (settled === null) return null;
  const doc = parseHtml(settled);

  const policy = doc.createElement('meta');
  policy.setAttribute('http-equiv', 'Content-Security-Policy');
  policy.setAttribute('content', PREVIEW_POLICY);

  const scheme = doc.createElement('meta');
  scheme.setAttribute('name', 'color-scheme');
  scheme.setAttribute('content', 'light');

  const base = doc.createElement('base');
  base.setAttribute('target', '_blank');

  const style = doc.createElement('style');
  style.textContent = CANVAS_STYLE;

  doc.head.prepend(policy, scheme, base, style);
  const output = serialize(doc);

  // The last check reads the output the way the frame will: it must parse
  // back to itself, open with our three head elements, and hold nothing else
  // the strip removes.
  const framed = parseHtml(output);
  const [first, second, third] = framed.head.children;
  const oursFirst =
    first?.localName === 'meta' && first.getAttribute('content') === PREVIEW_POLICY &&
    second?.localName === 'meta' && second.getAttribute('name') === 'color-scheme' &&
    third?.localName === 'base' && !third.hasAttribute('href');
  if (!oursFirst || serialize(framed) !== output || !isInert(framed, new Set([first, second, third]))) {
    return null;
  }
  return output;
}

export const internals = { settle, strip, serialize, isInert, REMOVED, MAX_PASSES };
