import { resolveMotifSet, themePresetId } from 'shared/themeAppearance';

export function resolveRootAttributes(themeDoc) {
  return {
    theme: themePresetId(themeDoc),
    motifSet: resolveMotifSet(themeDoc),
  };
}
