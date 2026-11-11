// Everything the picture shows about the event is read here: the fictional
// Harborlight fixture, the product's own style presets, and the official mark.
// The canvas code holds no event names, dates or people, and no brand colours.
// What it does hold is illustration copy for the interface, such as "Publish".
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createRequire} from 'node:module';
import {publicExperience} from '../trailer/assembly/experience.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
export const REPO = path.resolve(HERE, '../..');

// Family names used on the render page, and the files they load.
export const FONTS = [
  ['Bricolage', 'docs/fonts/bricolage-grotesque-latin.woff2', '700 800'],
  ['Source', 'docs/fonts/source-sans-3-latin.woff2', '400 700'],
  ['Mono', 'docs/fonts/ibm-plex-mono-400-latin.woff2', '400'],
  ['Mono', 'docs/fonts/ibm-plex-mono-500-latin.woff2', '500'],
  ['Merriweather', 'apps/web/public/fonts/merriweather-700-latin.woff2', '700'],
  ['CaslonDisplay', 'apps/web/public/fonts/libre-caslon-display-latin.woff2', '400'],
  ['Fraunces', 'apps/web/public/fonts/fraunces-latin.woff2', '400 700'],
  ['Karrik', 'apps/web/public/fonts/karrik-latin.woff2', '400'],
  ['Besley', 'apps/web/public/fonts/besley-latin.woff2', '400 700'],
  ['Overpass', 'apps/web/public/fonts/overpass-latin.woff2', '400 700'],
];

// The six general styles, in picker order. The seventh style belongs to one
// client and stays out of this public piece.
const STYLES = [
  ['civic', 'Merriweather', 700, 'Merriweather'],
  ['broadsheet', 'CaslonDisplay', 400, 'Libre Caslon Display'],
  ['newsroom', 'Fraunces', 700, 'Fraunces'],
  ['zine', 'Karrik', 400, 'Karrik'],
  ['field-guide', 'Besley', 700, 'Besley'],
  ['atlas', 'Overpass', 700, 'Overpass'],
];
const KEYS = ['surface', 'surfaceAlt', 'ink', 'inkMuted', 'primary', 'accent', 'highlight'];

export function styles() {
  return STYLES.map(([id, font, weight, face]) => {
    const preset = JSON.parse(fs.readFileSync(path.join(REPO, 'design/tokens/presets', `${id}.json`), 'utf8'));
    const pick = mode => Object.fromEntries(KEYS.map(key => [key, preset.palette[mode][key]]));
    return {id, label: preset.label, font, weight, face, radius: preset.shape.radius, light: pick('light'), dark: pick('dark')};
  });
}

/** Everything the page needs. `format` picks the landscape or the vertical composition. */
export async function project(format = 'landscape') {
  if (!['landscape', 'vertical'].includes(format)) throw new Error(`Unknown format: ${format}`);
  const {timeline} = await import('./timeline.ts');
  const all = styles();
  const {fixture, answers} = createRequire(import.meta.url)('../capture/fixture.cjs');
  const subtitle = fixture().content.find(item => item.id === 'hero__subtitle').value;
  const experience = publicExperience(), [first] = answers.event.days;
  const date = new Intl.DateTimeFormat('en-US', {month: 'short', day: 'numeric', timeZone: 'UTC'}).format(new Date(`${first.date}T00:00:00Z`));
  // The address on the end card is the one the brand's own share card prints.
  const site = fs.readFileSync(path.join(REPO, 'design/brand/social-preview.svg'), 'utf8').match(/>\s*(eventrunner\.org)\s*</)?.[1];
  if (!site) throw new Error('design/brand/social-preview.svg no longer prints the site address');
  const copy = {sample: `${experience.name} · Sample event`, day: `${first.label} · ${date}`, days: answers.event.days.length, site};
  return {format, clock: timeline, experience: {...experience, subtitle}, copy, styles: all, brand: {light: all[0].light, dark: all[0].dark}};
}

export const markSvg = () => fs.readFileSync(path.join(REPO, 'design/brand/badger-mark.svg'), 'utf8');
