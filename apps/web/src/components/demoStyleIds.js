import { PRESET_IDS } from '../lib/themeRuntime.js';

// URL selection needs only IDs; labels and descriptions load with the controls.
export const DEMO_STYLE_IDS = Object.freeze(PRESET_IDS.filter((id) => id !== 'nclocal'));

export function isDemoStyleId(value) {
  return typeof value === 'string' && DEMO_STYLE_IDS.includes(value);
}
