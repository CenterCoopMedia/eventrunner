'use strict';

/**
 * The `apps/web/src/generated/*` emitters (spec §2.4 path 1, §8.6).
 *
 * `generate-content.cjs` reads a deployment (or the in-repo demo fixture)
 * and writes five files: four ES modules and one stylesheet. Everything
 * here is pure string building — no Firestore, no fs — so the exact bytes
 * a deploy would write are unit-testable, which is what the §8.6 hygiene
 * gate depends on: CI regenerates from the demo fixture and fails if the
 * output differs from the committed snapshot.
 *
 * Determinism is the whole contract. Key order comes from explicit
 * projections rather than whatever order Firestore returned, docs are
 * sorted by id/order, and publish bookkeeping (revision, status,
 * publishedAt/By, basedOnRevision, updatedAt/By, seededAt) is stripped —
 * those change on every publish and would make the snapshot churn without
 * a content change. `seeded` is KEPT: it is content-meaningful (§5.4), and
 * the web build shows sample-content chips from it.
 *
 * `config/bootstrap` is never emitted into the bundle (§2.4).
 */

const { CSS_VARIABLE_STEM, FONT_SETS, RADIUS_SCALES, hexToRgb } = require('./theme.cjs');

/** Publish-model and seed bookkeeping stripped from every emitted doc. */
const STRIPPED_FIELDS = Object.freeze([
  'revision', 'status', 'basedOnRevision', 'publishedAt', 'publishedBy',
  'updatedAt', 'updatedBy', 'seededAt',
]);

const IDENTIFIER_RE = /^[A-Za-z_$][A-Za-z0-9_$]*$/;

/**
 * Single-quoted JS string literal.
 *
 * Every line terminator is escaped, not just \n: a CR that reached
 * Firestore through a Windows-authored paste would otherwise sit raw
 * inside a single-quoted literal and the generated module would fail to
 * parse — a build break produced by an editor's newline convention.
 * U+2028/U+2029 are legal in ES2019+ string literals but are escaped too,
 * because the generated files are also read by humans and by tools older
 * than that rule.
 *
 * @param {string} s
 * @returns {string}
 */
function quote(s) {
  return `'${String(s)
    .replace(/\\/g, '\\\\')
    .replace(/'/g, "\\'")
    .replace(/\r/g, '\\r')
    .replace(/\n/g, '\\n')
    .replace(/\u2028/g, '\\u2028')
    .replace(/\u2029/g, '\\u2029')}'`;
}

/**
 * Serialize a JSON-ish value as a JS literal in the repo's generated-file
 * style: two-space indent, single quotes, trailing commas, bare keys where
 * they are valid identifiers.
 *
 * @param {*} value
 * @param {number} [depth]
 * @returns {string}
 */
function jsValue(value, depth = 0) {
  const pad = '  '.repeat(depth + 1);
  const closePad = '  '.repeat(depth);
  if (value === null) return 'null';
  if (typeof value === 'string') return quote(value);
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  if (Array.isArray(value)) {
    if (value.length === 0) return '[]';
    const items = value.map((v) => `${pad}${jsValue(v, depth + 1)},`).join('\n');
    return `[\n${items}\n${closePad}]`;
  }
  if (typeof value === 'object') {
    const entries = Object.entries(value).filter(([, v]) => v !== undefined);
    if (entries.length === 0) return '{}';
    const body = entries
      .map(([k, v]) => `${pad}${IDENTIFIER_RE.test(k) ? k : quote(k)}: ${jsValue(v, depth + 1)},`)
      .join('\n');
    return `{\n${body}\n${closePad}}`;
  }
  throw new TypeError(`Cannot emit value of type ${typeof value}`);
}

/** @param {object} doc @returns {object} doc without STRIPPED_FIELDS */
function stripBookkeeping(doc) {
  const out = {};
  for (const [k, v] of Object.entries(doc)) {
    if (!STRIPPED_FIELDS.includes(k)) out[k] = v;
  }
  return out;
}

function header(lines) {
  return lines.map((l) => (l ? `// ${l}` : '//')).join('\n');
}

/**
 * eventConfig.js — `config/event`, `config/features`, and the non-color
 * part of `config/theme` (colors go to theme.css as RGB triples).
 *
 * @param {{ event: object, features: object, theme: object }} config
 * @returns {string}
 */
function emitEventConfig({ event, features, theme }) {
  const themeProjection = {
    fonts: theme.fonts,
    texture: theme.texture,
    radius: theme.radius,
    logos: theme.logos,
  };
  return [
    header([
      'GENERATED FILE — committed synthetic demo copy (spec §2.4, §5.4, §8.6).',
      '',
      'Regenerate with:  node scripts/generate-content.cjs --demo',
      'At deploy time the same script reads config/event + config/features from',
      'the project and writes out-of-tree (--out / GENERATED_DIR), so this',
      'committed copy — a fictional demo event, never a real organization name,',
      'city, or dates — is what CI builds from. config/bootstrap is never',
      'emitted here (§2.4).',
    ]),
    '',
    `export const eventConfig = ${jsValue(stripBookkeeping(event))};`,
    '',
    `export const features = ${jsValue(features)};`,
    '',
    `export const theme = ${jsValue(themeProjection)};`,
    '',
    'export default eventConfig;',
    '',
  ].join('\n');
}

/**
 * siteContent.js — published cmsContent docs as a `<section>__<field>` map.
 *
 * @param {object[]} contentDocs
 * @returns {string}
 */
function emitSiteContent(contentDocs) {
  const sorted = [...contentDocs].sort((a, b) => a.id.localeCompare(b.id));
  const map = {};
  for (const doc of sorted) {
    const { id, ...rest } = stripBookkeeping(doc);
    map[id] = rest;
  }
  return [
    header([
      'GENERATED FILE — committed synthetic demo copy (spec §2.4, §5.4, §8.6).',
      '',
      'Regenerate with:  node scripts/generate-content.cjs --demo',
      '',
      'Shape mirrors published cmsContent docs: keyed `<section>__<field>`, each',
      'doc carrying { section, field, blockType, ...block fields, visible, order,',
      'seeded }. blockType values come from the code-side BLOCK_TYPES registry',
      '(functions/src/cms/blockTypes.cjs): text, richtext, image, cta, stat,',
      'list_item, faq_item, link_group.',
      '',
      'Copy strategy (spec §5.4): realistic-shaped synthetic text, `[Replace]`',
      'prefixes on anything an operator must rewrite, never a real org copy.',
    ]),
    '',
    `export const siteContent = ${jsValue(map)};`,
    '',
    'export default siteContent;',
    '',
  ].join('\n');
}

/**
 * pagesData.js — published cmsPages docs, ordered by `order`.
 *
 * @param {object[]} pages
 * @returns {string}
 */
function emitPagesData(pages) {
  const sorted = [...pages].sort((a, b) => (a.order ?? 0) - (b.order ?? 0) || a.id.localeCompare(b.id));
  return [
    header([
      'GENERATED FILE — committed synthetic demo copy (spec §2.4, §5.2–5.4, §8.6).',
      '',
      'Regenerate with:  node scripts/generate-content.cjs --demo',
      '',
      'Shape mirrors published cmsPages docs. systemPage: true marks pages with a',
      'dedicated React route (home, schedule, speakers, sponsors); non-system',
      'pages render at their own root-level `path` (e.g. /faq) through the',
      'generic catch-all route (issue #52). Section ids are generic vocabulary',
      '(spec §5.3) and tie to cmsContent docs via each block `section` field;',
      'ids are unique across pages because cmsContent is keyed',
      '`<section>__<field>` globally, not per page.',
    ]),
    '',
    `export const pagesData = ${jsValue(sorted.map(stripBookkeeping))};`,
    '',
    'export default pagesData;',
    '',
  ].join('\n');
}

/**
 * scheduleData.js — published cmsSchedule docs plus the speaker list.
 *
 * @param {{ sessions: object[], speakers: object[] }} args
 * @returns {string}
 */
function emitScheduleData({ sessions, speakers }) {
  const sortedSessions = [...sessions].sort(
    (a, b) => String(a.dayId).localeCompare(String(b.dayId)) ||
      (a.order ?? 0) - (b.order ?? 0) ||
      a.id.localeCompare(b.id),
  );
  const sortedSpeakers = [...speakers].sort((a, b) => a.id.localeCompare(b.id));
  return [
    header([
      'GENERATED FILE — committed synthetic demo copy (spec §2.4, §5.4, §8.6).',
      '',
      'Regenerate with:  node scripts/generate-content.cjs --demo',
      '',
      'Shape mirrors published cmsSchedule docs. dayId values are stable keys',
      'from config/event.days (eventConfig.js). All names are fictional; no real',
      'speakers, ever (spec §5.4).',
    ]),
    '',
    `export const scheduleData = ${jsValue(sortedSessions.map(stripBookkeeping))};`,
    '',
    `export const speakers = ${jsValue(sortedSpeakers.map(stripBookkeeping))};`,
    '',
    'export default scheduleData;',
    '',
  ].join('\n');
}

/**
 * organizationsData.js — published cmsOrganizations docs.
 *
 * @param {object[]} organizations
 * @returns {string}
 */
function emitOrganizationsData(organizations) {
  const sorted = [...organizations].sort(
    (a, b) => (a.order ?? 0) - (b.order ?? 0) || a.id.localeCompare(b.id),
  );
  return [
    header([
      'GENERATED FILE — committed synthetic demo copy (spec §2.4, §5.4, §8.6).',
      '',
      'Regenerate with:  node scripts/generate-content.cjs --demo',
      '',
      'Shape mirrors published cmsOrganizations docs. All organizations are',
      'fictional; logos point at the neutral branding placeholders — no real',
      'sponsor logos in seeds, fixtures, tests, or the demo instance (spec §5.4).',
    ]),
    '',
    `export const organizationsData = ${jsValue(sorted.map(stripBookkeeping))};`,
    '',
    'export default organizationsData;',
    '',
  ].join('\n');
}

/**
 * theme.css — `config/theme` as custom properties.
 *
 * Colors are stored hex (that is what `validateTheme` accepts) and emitted
 * as space-separated RGB triples so Tailwind's
 * `rgb(var(--…-rgb) / <alpha-value>)` utilities keep opacity modifiers
 * working (§7.2). This is the ONLY file in apps/web allowed to carry raw
 * color values (§7.6 allowlist).
 *
 * @param {object} theme config/theme
 * @returns {string}
 */
function emitThemeCss(theme) {
  const lines = [];
  lines.push('/*');
  lines.push(' * GENERATED FILE — committed synthetic demo copy (spec §2.4, §7.2, §8.6).');
  lines.push(' *');
  lines.push(' * Regenerate with:  node scripts/generate-content.cjs --demo');
  lines.push(' *');
  lines.push(' * At deploy time the same script reads config/theme and writes out-of-tree');
  lines.push(' * (GENERATED_DIR); this committed copy is the synthetic demo event that keeps');
  lines.push(' * CI builds credential-free. It is the ONLY file in apps/web allowed to carry');
  lines.push(' * raw color values (spec §7.6 allowlist), and values are space-separated RGB');
  lines.push(' * triples so Tailwind rgb(var(--…-rgb) / <alpha-value>) utilities keep opacity');
  lines.push(' * modifiers working (spec §7.2).');
  lines.push(' *');
  lines.push(' * EventConfigProvider overrides these same properties at runtime via');
  lines.push(' * <style id="event-theme-runtime">.');
  lines.push(' */');
  lines.push('');
  lines.push(':root {');
  lines.push('  /* Brand palette from config/theme.colors, hex converted to RGB triples. */');
  let semanticHeaderWritten = false;
  for (const [key, hex] of Object.entries(theme.colors || {})) {
    const stem = CSS_VARIABLE_STEM[key];
    const rgb = hexToRgb(hex);
    if (!stem || !rgb) continue;
    // Role-named semantic tokens get their own labelled group; a wall of
    // thirteen undifferentiated custom properties is hard to scan.
    if (!semanticHeaderWritten && stem.startsWith('semantic-')) {
      semanticHeaderWritten = true;
      lines.push('');
      lines.push('  /* Semantic tokens — role-named (interface guidelines: Colors). */');
    }
    lines.push(`  --${stem}-rgb: ${rgb.join(' ')};`);
  }
  lines.push('');
  const fonts = theme.fonts || {};
  lines.push('  /* Font sets (spec §7.4): config/theme.fonts names a set id; the generator');
  lines.push(`     emitted the matching stacks. heading=${fonts.heading}, body=${fonts.body},`);
  lines.push(`     accent=${fonts.accent}. */`);
  for (const [role, setId] of [['heading', fonts.heading], ['body', fonts.body], ['accent', fonts.accent]]) {
    const set = FONT_SETS[setId];
    if (set) lines.push(`  --font-${role}: ${set.stack};`);
  }
  lines.push('');
  const radius = RADIUS_SCALES[theme.radius] || RADIUS_SCALES.soft;
  lines.push(`  /* Radius scale: config/theme.radius = '${theme.radius}'.`);
  lines.push("     ('sharp' → 0 / 2px, 'soft' → 8px / 16px, 'round' → 16px / 28px.) */");
  lines.push(`  --radius-base: ${radius.base};`);
  lines.push(`  --radius-large: ${radius.large};`);
  lines.push('');
  lines.push("  /* Texture treatment: config/theme.texture = 'paper' | 'flat'. Components");
  lines.push('     read this via the bg-paper utility layer in index.css. */');
  lines.push(`  --texture: ${theme.texture};`);
  lines.push('}');
  lines.push('');
  lines.push('/* Self-hosted font faces (spec §7.4): woff2 only, no font CDN at runtime.');
  lines.push('   Files live in apps/web/public/fonts/. */');
  const seen = new Set();
  for (const setId of [fonts.heading, fonts.body, fonts.accent]) {
    const set = FONT_SETS[setId];
    if (!set || !set.fileBase || seen.has(set.family)) continue;
    seen.add(set.family);
    lines.push('@font-face {');
    lines.push(`  font-family: '${set.family}';`);
    lines.push('  font-style: normal;');
    lines.push('  font-weight: 400 700;');
    lines.push('  font-display: swap;');
    lines.push(`  src: url('/fonts/${set.fileBase}.woff2') format('woff2');`);
    lines.push('}');
  }
  return `${lines.join('\n')}\n`;
}

/**
 * Every generated file, keyed by its filename.
 *
 * @param {{ event: object, features: object, theme: object, pages: object[],
 *           content: object[], sessions: object[], speakers: object[],
 *           organizations: object[] }} snapshot
 * @returns {Record<string, string>}
 */
function emitAll(snapshot) {
  return {
    'eventConfig.js': emitEventConfig(snapshot),
    'siteContent.js': emitSiteContent(snapshot.content),
    'pagesData.js': emitPagesData(snapshot.pages),
    'scheduleData.js': emitScheduleData(snapshot),
    'organizationsData.js': emitOrganizationsData(snapshot.organizations),
    'theme.css': emitThemeCss(snapshot.theme),
  };
}

module.exports = {
  emitAll,
  emitEventConfig,
  emitSiteContent,
  emitPagesData,
  emitScheduleData,
  emitOrganizationsData,
  emitThemeCss,
  STRIPPED_FIELDS,
  internals: { jsValue, quote, stripBookkeeping },
};
