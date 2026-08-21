// Live theme preview for the Branding tab (spec §7.3: "edits config/theme
// with live preview — the runtime style element updates on change").
//
// EventConfigProvider owns <style id="event-theme-runtime">, which mirrors the
// SAVED config/theme doc. Preview must not fight it for that element, so the
// candidate values go into a second style element appended after it: same
// :root properties, same specificity, later in the document, so it wins until
// it is removed. Discarding a preview is therefore a DOM removal, not a
// recompute — and a save is picked up by the provider's listener as usual.
//
// The texture treatment is gated on documentElement.dataset.texture (index.css
// cannot compare a custom property in a selector), so preview mirrors that
// attribute too and restores the previous value when it clears.
import { buildRuntimeThemeCss } from '../lib/themeRuntime.js';

export const PREVIEW_STYLE_ID = 'admin-theme-preview';

let savedTexture = null;

/**
 * Apply a candidate config/theme document to the live page.
 *
 * @param {object} themeDoc
 */
export function applyThemePreview(themeDoc) {
  let styleEl = document.getElementById(PREVIEW_STYLE_ID);
  if (!styleEl) {
    styleEl = document.createElement('style');
    styleEl.id = PREVIEW_STYLE_ID;
    document.head.appendChild(styleEl);
    savedTexture = document.documentElement.dataset.texture ?? null;
  }
  styleEl.textContent = buildRuntimeThemeCss(themeDoc);
  if (typeof themeDoc?.texture === 'string' && themeDoc.texture) {
    document.documentElement.dataset.texture = themeDoc.texture;
  }
}

/** Remove the preview overlay, restoring the saved theme's rendering. */
export function clearThemePreview() {
  document.getElementById(PREVIEW_STYLE_ID)?.remove();
  if (savedTexture !== null) {
    document.documentElement.dataset.texture = savedTexture;
    savedTexture = null;
  }
}
