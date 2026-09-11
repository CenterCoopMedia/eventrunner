import { IS_DEMO } from './demoMode.js';

const HERO_ART = {
  civic: ['civic.webp', 'A sunlit civic hall beside the harbor.'],
  newsroom: ['newsroom.webp', 'An editorial illustration of local journalists working together.'],
  broadsheet: ['broadsheet.webp', 'An engraved lighthouse overlooking a working harbor.'],
  atlas: ['atlas.webp', 'A waterfront transit platform looking toward the city.'],
  'field-guide': ['field-guide.webp', 'A coastal heron among reeds beside the harbor.'],
  zine: ['zine.webp', 'A bold print collage of a microphone and community voices.'],
};

export function demoHero(theme) {
  if (!IS_DEMO) return null;
  const [file, alt] = HERO_ART[theme?.preset] ?? HERO_ART.newsroom;
  return {
    url: `${import.meta.env.BASE_URL}hero/${theme?.preset === 'atlas' && theme?.mode === 'dark' ? 'atlas-night.webp' : file}`,
    alt,
    demoTransitSign: theme?.preset === 'atlas',
    focalX: { civic: 80, broadsheet: 85, 'field-guide': 75, atlas: 50 }[theme?.preset] ?? 70,
    focalY: theme?.preset === 'field-guide' ? 45 : 50,
  };
}
