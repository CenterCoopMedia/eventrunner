// The stored-mail preview document (issue #183): the ONE way a stored email
// body reaches the screen. It is only ever handed to an <iframe sandbox="">
// as `srcdoc` (pages/AdminEmailLog.jsx), never to innerHTML.
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
// The DOMParser pass removes what could route around the policy before the
// frame ever parses it: a stored `meta[http-equiv]` (a refresh, or a policy
// of its own), a `base` (it would re-point every relative link), and every
// `link` (resource hints such as preconnect or dns-prefetch are not reliably
// governed by a policy). Every link and image-map area is sent to a new tab,
// and the empty sandbox refuses a new tab, so a click does nothing rather
// than navigating the frame. DOMParser builds an inert document: nothing in
// it loads and nothing runs while this code reads it.
//
// The colour-scheme meta and the style draw the mail on the system's light
// canvas, as a light mail client shows it, in either admin mode. No colour
// literal is written here.

/** The frame's content policy, word for word. */
export const PREVIEW_POLICY =
  "default-src 'none'; img-src data:; style-src 'unsafe-inline'; form-action 'none'; base-uri 'none'";

const CANVAS_STYLE = ':root{background:Canvas;color:CanvasText}';

/**
 * Build the `srcdoc` for a stored html body.
 *
 * @param {string|null|undefined} html the stored body
 * @returns {string} a whole document, doctype first
 */
export function buildPreviewDoc(html) {
  const doc = new DOMParser().parseFromString(typeof html === 'string' ? html : '', 'text/html');

  for (const element of doc.querySelectorAll('meta[http-equiv], base, link')) element.remove();
  // Every anchor, SVG ones included, whether its target is href or
  // xlink:href: a link that kept its own target could navigate the frame.
  for (const element of doc.querySelectorAll('a, area')) element.setAttribute('target', '_blank');

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
  return `<!DOCTYPE html>${doc.documentElement.outerHTML}`;
}
