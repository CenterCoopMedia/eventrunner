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
// Four things are attributes on the root element rather than custom
// properties, so preview mirrors all four and restores them when it clears:
// the texture treatment (index.css cannot compare a custom property in a
// selector), the mode (design brief §3.3), the preset (§3.4), and the motif
// set (§3.8). The last two decide which generated block wins, and a custom
// property cannot do that job.
import { buildRuntimeThemeCss, resolveRootAttributes } from '../lib/themeRuntime.js';
import { applyMode, prefersDark } from '../lib/modeRuntime.js';
import { resolveMode, resolveShape } from 'shared/theme';

export const PREVIEW_STYLE_ID = 'admin-theme-preview';

let savedTexture = null;
let savedMode = null;
let savedPresetTheme = null;
let savedMotifSet = null;

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
    savedMode = document.documentElement.dataset.mode ?? null;
    savedPresetTheme = document.documentElement.dataset.theme ?? null;
    savedMotifSet = document.documentElement.dataset.motifSet ?? null;
  }
  styleEl.textContent = buildRuntimeThemeCss(themeDoc);
  const shape = resolveShape(themeDoc);
  if (shape.texture) document.documentElement.dataset.texture = shape.texture;
  const { theme, motifSet } = resolveRootAttributes(themeDoc);
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
