import { THEME_PRESET_IDS } from 'shared/theme';

// URL selection needs only IDs; labels and descriptions load with the controls.
export const DEMO_STYLE_IDS = Object.freeze(THEME_PRESET_IDS.filter((id) => id !== 'nclocal'));

export function isDemoStyleId(value) {
  return typeof value === 'string' && DEMO_STYLE_IDS.includes(value);
}
