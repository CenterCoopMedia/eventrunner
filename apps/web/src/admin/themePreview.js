// Live theme preview for the Branding tab (spec §7.3, design brief §5.2:
// "Keep the existing preview mechanism. applyThemePreview and
// buildRuntimeThemeCss stay the one path from a candidate document to
// rendered CSS.").
//
// EventConfigProvider owns <style id="event-theme-runtime">, which mirrors the
// SAVED config/theme doc. Preview must not fight it for that element, so the
// candidate values go into a second style element appended after it.
// Discarding a preview is therefore a DOM removal, not a recompute — and a
// save is picked up by the provider's listener as usual.
//
// SCOPE. The preview is now framed: the client's real pages render inside a
// chase on the admin ground, and the room around the frame never adopts the
// client's theme (admin story moment 2). So the candidate lands on ONE
// element rather than on the document:
//
//   • the CSS text is the same buildRuntimeThemeCss output, with its `:root`
//     selectors rewritten to the frame's id — one string substitution, not a
//     second builder;
//   • data-theme, data-mode, and data-motif-set go on the frame, and the
//     generated stylesheet's palette blocks match a scoped element as well as
//     the root (scripts/lib/tokens.cjs scopedSelector), so the frame resolves
//     the whole set — tier-2 aliases and tier-3 contracts included — without
//     duplicating a single token name here;
//   • the texture attribute rides along, because index.css gates the paper
//     overlay on an attribute rather than on a custom property.
//
// A caller that passes no scope element still gets the document-wide
// behaviour, which is what the theme editor's own chrome-free surfaces use.
import { buildRuntimeThemeCss, resolveRootAttributes } from '../lib/themeRuntime.js';
import { applyMode, prefersDark } from '../lib/modeRuntime.js';
import { resolveMode, resolveShape } from 'shared/theme';

export const PREVIEW_STYLE_ID = 'admin-theme-preview';

/** The id the scoped preview writes its selectors against. */
export const PREVIEW_SCOPE_ID = 'admin-theme-proof';

/**
 * The second frame's id, used by the preview's light-and-dark comparison
 * (owner review, 2026-08-27). Two frames need two ids, because the scoped
 * CSS is written against an id and an id may appear once in a document.
 */
export const PREVIEW_COMPARE_SCOPE_ID = 'admin-theme-proof-compare';

let savedTexture = null;
let savedDensity = null;
let savedMode = null;
let savedPresetTheme = null;
let savedMotifSet = null;
const previewDocuments = new Set();
const previewTargets = new Set();

function clearPreviewAttributes(element) {
  for (const attribute of ['texture', 'density', 'theme', 'motifSet', 'mode']) {
    delete element.dataset[attribute];
  }
}

function previewStyle(doc) {
  let styleEl = doc.getElementById(PREVIEW_STYLE_ID);
  if (!styleEl) {
    styleEl = doc.createElement('style');
    styleEl.id = PREVIEW_STYLE_ID;
    doc.head.appendChild(styleEl);
  }
  previewDocuments.add(doc);
  return styleEl;
}

/**
 * Rewrite the runtime CSS to land on one element instead of the document.
 *
 * Every selector the builder writes starts at `:root`, so the rewrite is a
 * prefix swap: `:root[data-mode='dark']` becomes
 * `#admin-theme-proof[data-mode='dark']`. An id beats the generated
 * stylesheet's `:root[…]` blocks on specificity, which is what makes the
 * deployment's own overrides win inside the frame.
 *
 * @param {string} css
 * @param {string} scopeId
 * @returns {string}
 */
export function scopeThemeCss(css, scopeId) {
  return css.replace(/:root/g, `#${scopeId}`);
}

/**
 * Apply a candidate config/theme document.
 *
 * @param {object} themeDoc
 * @param {{ scope?: Element|null, mode?: 'light'|'dark'|null,
 *           scopes?: Array<{ element: Element, id: string,
 *                            mode?: 'light'|'dark'|null }>|null }} [options]
 *   `scope` confines the candidate to one element (the preview frame).
 *   `mode` renders the frame in that mode whatever the document's policy
 *   says, so the light and dark tabs are two proofs of the same forme.
 *   `scopes` is the same thing for more than one frame at once, which is
 *   what the comparison state renders: one candidate, two grounds, side by
 *   side. One style element carries a block per frame.
 */
export function applyThemePreview(themeDoc, { scope = null, mode = null, scopes = null } = {}) {
  const css = buildRuntimeThemeCss(themeDoc);
  const shape = resolveShape(themeDoc);
  const { theme, motifSet } = resolveRootAttributes(themeDoc);

  const targets =
    scopes ?? (scope ? [{ element: scope, id: PREVIEW_SCOPE_ID, mode }] : null);
  if (targets) {
    // A proof frame owns its own document. Group the targets by that
    // document so the candidate stylesheet lands beside the public CSS it
    // overrides instead of staying in the admin document where it cannot
    // cross the iframe boundary.
    const byDocument = new Map();
    for (const target of targets) {
      const doc = target.element.ownerDocument;
      if (!byDocument.has(doc)) byDocument.set(doc, []);
      byDocument.get(doc).push(target);
    }
    for (const [doc, documentTargets] of byDocument) {
      previewStyle(doc).textContent = documentTargets
        .map((target) => scopeThemeCss(css, target.id))
        .join('\n');
    }
    for (const target of targets) {
      const { element } = target;
      previewTargets.add(element);
      element.id = target.id;
      if (shape.texture) element.dataset.texture = shape.texture;
      else delete element.dataset.texture;
      if (shape.density) element.dataset.density = shape.density;
      else delete element.dataset.density;
      if (theme) element.dataset.theme = theme;
      else delete element.dataset.theme;
      element.dataset.motifSet = motifSet;
      // Each frame states its own mode. Nothing is written to the document,
      // so the room around them keeps the mode the operator is working in.
      element.dataset.mode =
        target.mode ?? resolveMode(themeDoc?.mode, prefersDark(element.ownerDocument.defaultView));
    }
    return;
  }

  const styleEl = previewStyle(document);
  if (savedTexture === null) {
    savedTexture = document.documentElement.dataset.texture ?? '';
    savedDensity = document.documentElement.dataset.density ?? '';
    savedMode = document.documentElement.dataset.mode ?? '';
    savedPresetTheme = document.documentElement.dataset.theme ?? '';
    savedMotifSet = document.documentElement.dataset.motifSet ?? '';
  }
  styleEl.textContent = css;
  if (shape.texture) document.documentElement.dataset.texture = shape.texture;
  else delete document.documentElement.dataset.texture;
  if (shape.density) document.documentElement.dataset.density = shape.density;
  else delete document.documentElement.dataset.density;
  if (theme) document.documentElement.dataset.theme = theme;
  else delete document.documentElement.dataset.theme;
  document.documentElement.dataset.motifSet = motifSet;
  // The mode policy previews too: picking "Always dark" has to show the dark
  // palette, not just save it.
  if (typeof themeDoc?.mode === 'string' && themeDoc.mode) {
    applyMode(resolveMode(themeDoc.mode, prefersDark()));
  }
}

/** Release one framed preview without disturbing any frames that remain mounted. */
export function releaseThemePreviewTarget(element) {
  if (!element) return;
  previewTargets.delete(element);
  clearPreviewAttributes(element);

  const doc = element.ownerDocument;
  const documentStillInUse = [...previewTargets].some(
    (target) => target.ownerDocument === doc,
  );
  if (!documentStillInUse) {
    doc.getElementById(PREVIEW_STYLE_ID)?.remove();
    previewDocuments.delete(doc);
  }
}

/** Remove the preview overlay, restoring the saved theme's rendering. */
export function clearThemePreview() {
  for (const doc of previewDocuments) doc.getElementById(PREVIEW_STYLE_ID)?.remove();
  previewDocuments.clear();
  for (const element of previewTargets) clearPreviewAttributes(element);
  previewTargets.clear();
  if (savedTexture !== null) {
    if (savedTexture) document.documentElement.dataset.texture = savedTexture;
    else delete document.documentElement.dataset.texture;
    savedTexture = null;
  }
  if (savedDensity !== null) {
    if (savedDensity) document.documentElement.dataset.density = savedDensity;
    else delete document.documentElement.dataset.density;
    savedDensity = null;
  }
  if (savedMode !== null) {
    if (savedMode) applyMode(savedMode);
    else delete document.documentElement.dataset.mode;
    savedMode = null;
  }
  if (savedPresetTheme !== null) {
    if (savedPresetTheme) document.documentElement.dataset.theme = savedPresetTheme;
    else delete document.documentElement.dataset.theme;
    savedPresetTheme = null;
  }
  if (savedMotifSet !== null) {
    if (savedMotifSet) document.documentElement.dataset.motifSet = savedMotifSet;
    else delete document.documentElement.dataset.motifSet;
    savedMotifSet = null;
  }
}
