// The preset remaps, loaded when a style has to be resolved at runtime.
//
// `shared/presetRemaps` carries what every site style MOVES: its own token
// and component-font remaps, what each curated choice of each option group
// moves, and the component defaults a style change resets (design/tokens/
// presets/*.json and components.json, mirrored by scripts/build-preset-
// catalog.cjs). The public site's first paint needs none of it, because the
// generated stylesheet already carries the chosen style with its picks
// resolved, and it would otherwise sit in the chunk every visitor downloads.
// So the module is its own lazy chunk, fetched on the paths that resolve a
// style at runtime: the overlay a live config/theme document asks for
// (contexts/EventConfigContext.jsx), the demo's style switcher, the admin,
// and the specimen book.
//
// REQUIRING THE MODULE REGISTERS IT with the one resolver (shared/theme),
// whose token and pick resolvers refuse to answer until it has. The register
// call here repeats that, so a caller never depends on the module's side
// effect alone. The promise is kept, so the chunk is fetched once and every
// caller waits on the same load; a failed load is forgotten, so the next
// caller tries again rather than inheriting the failure for the life of the
// page.
import { presetRemapsLoaded, registerPresetRemaps } from 'shared/theme';

let loading = null;

/**
 * Resolve once the remaps are registered.
 *
 * @returns {Promise<void>}
 */
export function loadPresetRemaps() {
  if (presetRemapsLoaded()) return Promise.resolve();
  if (!loading) {
    loading = import('shared/presetRemaps')
      .then((module) => {
        if (!presetRemapsLoaded()) registerPresetRemaps(module.PRESET_REMAPS);
      })
      .catch((error) => {
        loading = null;
        throw error;
      });
  }
  return loading;
}

export { presetRemapsLoaded };
