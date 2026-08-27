import { PRESET_IDS } from '../lib/themeRuntime.js';

const STYLE_COPY = Object.freeze({
  civic: Object.freeze({
    label: 'Institutional',
    summary:
      'Formal layout with clear hierarchy, restrained decoration, and Public Sans body text.',
  }),
  newsroom: Object.freeze({
    label: 'Newsroom',
    summary:
      'Modern editorial layout with strong section rules, compact data, and restrained color.',
  }),
  broadsheet: Object.freeze({
    label: 'Broadsheet',
    summary:
      'Newspaper layout with large serif headings, strong rules, and dense programme listings.',
  }),
  atlas: Object.freeze({
    label: 'Atlas',
    summary:
      'Navigation-focused layout with map grids, route marks, and compact schedule data.',
  }),
  'field-guide': Object.freeze({
    label: 'Field Guide',
    summary:
      'Natural-history layout with serif type, line drawings, specimen labels, and optional paper texture.',
  }),
  zine: Object.freeze({
    label: 'Zine',
    summary:
      'High-contrast layout with bold display type, monospaced text, and limited accent color.',
  }),
});

export const DEMO_STYLE_OPTIONS = Object.freeze(
  PRESET_IDS.map((id) =>
    Object.freeze({
      id,
      label: STYLE_COPY[id]?.label ?? id,
      summary: STYLE_COPY[id]?.summary ?? '',
    }),
  ),
);

const DEMO_STYLE_ID_SET = new Set(DEMO_STYLE_OPTIONS.map(({ id }) => id));

export function isDemoStyleId(value) {
  return typeof value === 'string' && DEMO_STYLE_ID_SET.has(value);
}

export function getDemoStyleOption(id) {
  return DEMO_STYLE_OPTIONS.find((option) => option.id === id) ?? DEMO_STYLE_OPTIONS[0];
}

export function adjacentDemoStyleId(id, offset) {
  const currentIndex = DEMO_STYLE_OPTIONS.findIndex((option) => option.id === id);
  const startIndex = currentIndex === -1 ? 0 : currentIndex;
  const nextIndex =
    (startIndex + offset + DEMO_STYLE_OPTIONS.length) % DEMO_STYLE_OPTIONS.length;
  return DEMO_STYLE_OPTIONS[nextIndex].id;
}
