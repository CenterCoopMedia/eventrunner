import { IS_DEMO } from './demoMode.js';

const HERO_ART = {
  civic: ['civic.webp', 'A sunlit civic hall beside the harbor.'],
  newsroom: ['nclocal-summit.jpg', 'The historical NC News & Information Summit keynote panel. Photo: Elon University.'],
  broadsheet: ['broadsheet.webp', 'An engraved lighthouse overlooking a working harbor.'],
  atlas: ['atlas.webp', 'A waterfront transit platform looking toward the city.'],
  'field-guide': ['field-guide.webp', 'A coastal heron among reeds beside the harbor.'],
  zine: ['zine.webp', 'A bold print collage of a microphone and community voices.'],
};

export function demoHero(theme, { compact = false } = {}) {
  if (!IS_DEMO) return null;
  const [file, alt] = HERO_ART[theme?.preset] ?? HERO_ART.newsroom;
  return {
    url: `${import.meta.env.BASE_URL}hero/${theme?.preset === 'atlas' && theme?.mode === 'dark' ? 'atlas-night.webp' : file}`,
    alt,
    caption: theme?.preset === 'newsroom' ? 'Historical 2026 summit · Photo: Elon University' : null,
    demoTransitSign: theme?.preset === 'atlas',
    focalX: { civic: 80, broadsheet: 85, 'field-guide': 75, atlas: 50 }[theme?.preset] ?? 70,
    // The shallow Program strip needs its own authored crop: keep the
    // panelists' faces and the heron's head, without altering Home's art.
    focalY: compact && theme?.preset === 'newsroom' ? 25
      : compact && theme?.preset === 'field-guide' ? 5
        : theme?.preset === 'field-guide' ? 45 : 50,
  };
}
