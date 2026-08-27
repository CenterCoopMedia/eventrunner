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

let savedTexture = null;
let savedMode = null;
let savedPresetTheme = null;
let savedMotifSet = null;

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
 * @param {{ scope?: Element|null, mode?: 'light'|'dark'|null }} [options]
 *   `scope` confines the candidate to one element (the preview frame).
 *   `mode` renders the frame in that mode whatever the document's policy
 *   says, so the light and dark tabs are two proofs of the same forme.
 */
export function applyThemePreview(themeDoc, { scope = null, mode = null } = {}) {
  let styleEl = document.getElementById(PREVIEW_STYLE_ID);
  if (!styleEl) {
    styleEl = document.createElement('style');
    styleEl.id = PREVIEW_STYLE_ID;
    document.head.appendChild(styleEl);
    savedTexture = document.documentElement.dataset.texture ?? null;
    savedMode = document.documentElement.dataset.mode ?? null;
    savedPresetTheme = document.documentElement.dataset.theme ?? null;
    savedMotifSet = document.documentElement.dataset.motifSet ?? null;
  }
  const css = buildRuntimeThemeCss(themeDoc);
  const shape = resolveShape(themeDoc);
  const { theme, motifSet } = resolveRootAttributes(themeDoc);

  if (scope) {
    scope.id = PREVIEW_SCOPE_ID;
    styleEl.textContent = scopeThemeCss(css, PREVIEW_SCOPE_ID);
    if (shape.texture) scope.dataset.texture = shape.texture;
    if (theme) scope.dataset.theme = theme;
    else delete scope.dataset.theme;
    scope.dataset.motifSet = motifSet;
    // The frame states its own mode. Nothing is written to the document, so
    // the room around it keeps the mode the operator is working in.
    scope.dataset.mode =
      mode ?? resolveMode(themeDoc?.mode, prefersDark());
    return;
  }

  styleEl.textContent = css;
  if (shape.texture) document.documentElement.dataset.texture = shape.texture;
  if (theme) document.documentElement.dataset.theme = theme;
  else delete document.documentElement.dataset.theme;
  document.documentElement.dataset.motifSet = motifSet;
  // The mode policy previews too: picking "Always dark" has to show the dark
  // palette, not just save it.
  if (typeof themeDoc?.mode === 'string' && themeDoc.mode) {
    applyMode(resolveMode(themeDoc.mode, prefersDark()));
  }
}

/** Remove the preview overlay, restoring the saved theme's rendering. */
export function clearThemePreview() {
  document.getElementById(PREVIEW_STYLE_ID)?.remove();
  if (savedTexture !== null) {
    document.documentElement.dataset.texture = savedTexture;
    savedTexture = null;
  }
  if (savedMode !== null) {
    applyMode(savedMode);
    savedMode = null;
  }
  if (savedPresetTheme !== null) {
    document.documentElement.dataset.theme = savedPresetTheme;
    savedPresetTheme = null;
  } else {
    delete document.documentElement.dataset.theme;
  }
  if (savedMotifSet !== null) {
    document.documentElement.dataset.motifSet = savedMotifSet;
    savedMotifSet = null;
  }
}
