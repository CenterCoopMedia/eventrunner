'use strict';

/** @param {unknown} v @returns {boolean} */
function isPlainObject(v) {
  return Boolean(v) && typeof v === 'object' && !Array.isArray(v);
}

/**
 * What a style moves, once `shared/presetRemaps` has been loaded
 * (2026-09-10 vocabulary expansion).
 *
 * THE CATALOG CARRIES WHAT EVERY PATH READS; THE REMAPS ARRIVE SEPARATELY.
 * The public site's first paint needs no remap — the generated stylesheet
 * already carries the chosen style with its picks resolved — and the five
 * option groups the expansion added, on top of every style's own remaps
 * and the component defaults a style change resets, would otherwise sit in
 * the chunk every visitor downloads. So they live in `presetRemaps.cjs`,
 * which registers itself here when it is required. The web app loads it
 * lazily on the paths that resolve a style at runtime (a live config/theme
 * overlay, the demo style switcher, the admin, the specimen book); a Node
 * caller requires it once. The catalog keeps the palettes, the type maps
 * and the choice ids, so the validator and the contrast check answer with
 * nothing more loaded.
 *
 * Shape: { componentDefaults: { token → default }, presets: { preset id →
 * { componentFonts?, tokens?, options: { group → choice id → { fonts?,
 * componentFonts?, tokens? } } } } }.
 */
let PRESET_REMAPS = null;

/**
 * @param {{ componentDefaults: object, presets: Record<string, object> }} remaps
 */
function registerPresetRemaps(remaps) {
  if (!isPlainObject(remaps) || !isPlainObject(remaps.componentDefaults) || !isPlainObject(remaps.presets)) {
    throw new TypeError('registerPresetRemaps takes the generated remaps: { componentDefaults, presets }');
  }
  PRESET_REMAPS = remaps;
}

/** Whether the remaps have been loaded, so a style resolves in full. */
function presetRemapsLoaded() {
  return PRESET_REMAPS !== null;
}

/**
 * The registered remaps, or a thrown error naming the module to load.
 *
 * LOUD WHEN THE REMAPS ARE MISSING. A style resolved without them is a
 * half-resolved style — the generated baseline with the style's own remaps
 * and the operator's picks silently dropped — and that is a worse failure
 * than a thrown error naming the module to load. The web's overlay waits
 * for the module before it asks.
 *
 * @param {string} doing what the caller was about to do, for the message
 */
function loadedRemaps(doing) {
  if (PRESET_REMAPS === null) {
    throw new Error(
      `The preset remaps are not loaded: require or import 'shared/presetRemaps' before ${doing}.`,
    );
  }
  return PRESET_REMAPS;
}

module.exports = { registerPresetRemaps, presetRemapsLoaded, loadedRemaps };
