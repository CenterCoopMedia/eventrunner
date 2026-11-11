#!/usr/bin/env node
'use strict';

/**
 * Documentation site generator (issue #108).
 *
 * Markdown in this repository is the only source of truth. This script
 * renders the pages listed in scripts/lib/pages-manifest.cjs into the
 * committed `docs/docs/` tree that GitHub Pages serves, wrapped in one
 * shared shell that matches the landing page's visual system (#105).
 *
 * It also writes `docs/tokens.css`: the site's palette, resolved from
 * `design/tokens/` through the same generator that writes
 * `apps/web/src/generated/theme.css`. `docs/styles.css` is the handwritten
 * half — layout, devices, and rhythm — and reads those tokens by name.
 *
 * Every URL it writes follows the site address in scripts/lib/pages-site.cjs
 * (PAGES_BASE_URL overrides it for one run). The hand-written pages in
 * LANDING_PAGES carry that address in their canonical and social card URLs;
 * this script moves them to the configured address too, so one value decides
 * where the whole site says it lives (#514).
 *
 * Usage:
 *   node scripts/build-pages.cjs            # write docs/tokens.css + docs/docs/
 *   node scripts/build-pages.cjs --check    # compare only, write nothing
 *
 * `--check` is the freshness gate, and it mirrors
 * scripts/generate-content.cjs --check: it fails on any file whose
 * committed bytes differ from a fresh render, on any unexpected file left
 * behind in the output directory, on a stale `docs/tokens.css`, and on a
 * landing page that names a different site address. It runs
 * from scripts/build-pages.test.cjs so the credential-free documentation CI
 * tier enforces it without an npm install.
 *
 * No third-party dependencies, by design: that CI tier runs on the runner's
 * Node with no `npm ci`. The workspace link npm writes is missing there too,
 * which is why the token generator is reached through
 * `scripts/lib/shared-theme.cjs` rather than by its bare specifier.
 */

const fs = require('node:fs');
const path = require('node:path');

const { renderMarkdown, escapeHtml, plainText } = require('./lib/markdown-pages.cjs');
const { DEFAULT_PRESET_ID, rgbToHex } = require('./lib/shared-theme.cjs');
const { buildTokenCss, loadTokens, resolveColorTokens } = require('./lib/tokens.cjs');
const {
  REPO_BLOB,
  REPO_URL,
  SECTIONS,
  LEGACY_PAGES,
  pagesInOrder,
  routesBySource,
} = require('./lib/pages-manifest.cjs');
const { GITHUB_PAGES_URL, pagesSite, parsePagesBaseUrl } = require('./lib/pages-site.cjs');
const { LANDING_PAGES } = require('./lib/pages-public-files.cjs');

const ROOT = path.resolve(__dirname, '..');
const OUTPUT_DIR = path.join(ROOT, 'docs', 'docs');
const TOKENS_FILE = 'tokens.css';

const PRODUCT = 'Event Runner';
// The documentation site has its own social card, so a link to a guide is not
// previewed as the product landing page (docs/social-preview.png).
const SOCIAL_IMAGE_FILE = 'og-default.png';
const SOCIAL_IMAGE_ALT = 'Event Runner guides';
const DOCS_DESCRIPTION =
  'Practical guides for setting up an Event Runner site, publishing your program, ' +
  'and taking part in an event.';
// Fonts are self-hosted under docs/fonts and declared by styles.css, so no
// page here reaches a font CDN. See docs/fonts/README.md.
const PRELOADED_FONTS = ['source-sans-3-latin.woff2', 'bricolage-grotesque-latin.woff2'];

const EXTERNAL_SCHEME_RE = /^[a-z][a-z\d+.-]*:/i;

// Running Badger takes the masthead's ink and palette tokens. The link
// already says the name, so this drawing is decorative. Keep it in sync
// with docs/index.html and design/brand/badger-mark.svg.
const MARK = Object.freeze([
  '        <svg class="brand-mark" viewBox="0 0 32 32" aria-hidden="true" focusable="false">',
  '          <g transform="scale(0.4)" stroke-linecap="round" stroke-linejoin="round">',
  '            <path d="M7 44h7 M8 50h4" fill="none" stroke="rgb(var(--color-accent-rgb))" stroke-width="3.5"/>',
  '            <g transform="matrix(1 0 -0.16 1 8 0)">',
  '              <path d="M28 6 40 23 50 6" fill="none" stroke="rgb(var(--color-accent-rgb))" stroke-width="3.5"/>',
  '              <path d="m31 59-7 10-7-3-1 2 M43 59l9 12 5-2 M54 42l8-8" fill="none" stroke="currentColor" stroke-width="2.8"/>',
  '              <rect x="23" y="23" width="32" height="36" rx="5" fill="rgb(var(--color-surface-rgb))" stroke="currentColor" stroke-width="2.5"/>',
  '              <path d="M24.25 28a3.75 3.75 0 0 1 3.75-3.75h22A3.75 3.75 0 0 1 53.75 28v4.75h-29.5Z" fill="rgb(var(--color-accent-rgb))"/>',
  '              <rect x="35" y="18" width="8" height="7" rx="1.5" fill="currentColor"/>',
  '              <circle cx="33" cy="43" r="2.2" fill="currentColor"/>',
  '              <circle cx="45" cy="43" r="2.2" fill="currentColor"/>',
  '              <path d="M34 50q5 4 10 0" fill="none" stroke="currentColor" stroke-width="2.5"/>',
  '            </g>',
  '          </g>',
  '        </svg>',
]);

/* -------------------------------------------------------------- palette ---

   The site mints no palette. It renders the product's own default look, so
   the values come from the token generator rather than from a copy: the
   design/tokens JSON resolved through the same `resolveColorTokens` that
   writes apps/web/src/generated/theme.css, for the preset a new deployment
   starts on. `docs/tokens.css` is the generated result and is not edited by
   hand; `docs/styles.css` keeps the layout, which is written by hand.

   `SITE_COLOR_TOKENS` is the subset this site actually renders — an unused
   step earns no place (interface guidelines, Colors). A name here that the
   generator does not emit fails the build, and so does a `--…-rgb` a
   stylesheet reads that is not listed (scripts/build-pages.test.cjs). */

/* The scale steps this site sets type and space on. Everything here is a
   straight copy of the product's own value, which is why it is generated.
   What is NOT here is deliberately local and stays in docs/styles.css: the
   font roles (this site serves its own three self-hosted faces, not the
   preset's type map), the device contracts it composes, and the measure. */
const SITE_SCALE_TOKENS = Object.freeze([
  '--er-size-folio-min', '--er-size-folio-max',
  '--er-size-caption-min', '--er-size-caption-max',
  '--er-size-body-min', '--er-size-body-max',
  '--er-size-lead-min', '--er-size-lead-max',
  '--er-size-h3-min', '--er-size-h3-max',
  '--er-size-h2-min', '--er-size-h2-max',
  '--er-size-h1-min', '--er-size-h1-max',
  '--er-space-3xs', '--er-space-2xs', '--er-space-xs', '--er-space-sm', '--er-space-md',
  '--er-space-lg', '--er-space-xl', '--er-space-2xl', '--er-space-3xl',
  '--er-width-hairline', '--er-width-strong', '--er-width-nameplate',
  '--er-weight-regular', '--er-weight-medium', '--er-weight-semibold', '--er-weight-bold',
  '--er-duration-slow', '--er-easing-out',
  '--text-folio', '--text-folio-leading', '--text-folio-tracking',
  '--text-caption', '--text-caption-leading', '--text-caption-tracking',
  '--text-body', '--text-body-leading', '--text-body-tracking',
  '--text-lead', '--text-lead-leading', '--text-lead-tracking',
  '--text-h3', '--text-h3-leading', '--text-h3-tracking',
  '--text-h2', '--text-h2-leading', '--text-h2-tracking',
  '--text-h1', '--text-h1-leading', '--text-h1-tracking',
  '--space-3xs', '--space-2xs', '--space-xs', '--space-sm', '--space-md',
  '--space-lg', '--space-xl', '--space-2xl', '--space-3xl',
  '--rule-hairline-width', '--rule-strong-width', '--rule-nameplate-width',
  '--radius-base', '--radius-large',
  '--motion-slow', '--motion-ease',
  '--weight-regular', '--weight-medium', '--weight-semibold', '--weight-bold',
]);

const SITE_COLOR_TOKENS = Object.freeze([
  '--brand-primary-rgb',
  '--brand-primary-dark-rgb',
  '--brand-surface-rgb',
  '--brand-surface-alt-rgb',
  '--brand-ink-rgb',
  '--brand-ink-muted-rgb',
  '--semantic-success-rgb',
  '--semantic-warning-rgb',
  '--color-surface-rgb',
  '--color-surface-alt-rgb',
  '--color-text-primary-rgb',
  '--color-text-secondary-rgb',
  '--color-accent-rgb',
  '--color-accent-strong-rgb',
  '--rule-hairline-rgb',
  '--rule-strong-rgb',
  '--rule-nameplate-rgb',
  '--color-border-control-rgb',
  '--nameplate-rule-rgb',
  '--nameplate-text-rgb',
  '--section-rule-rgb',
  '--folio-rule-rgb',
  '--folio-text-rgb',
]);

/**
 * The base light and dark palettes, resolved from design/tokens.
 *
 * @returns {{ names: string[], light: Record<string,string>, dark: Record<string,string> }}
 */
function sitePalette() {
  const { names, values } = resolveColorTokens({ preset: DEFAULT_PRESET_ID }, loadTokens());
  const emitted = new Set(names);
  const missing = SITE_COLOR_TOKENS.filter((name) => !emitted.has(name));
  if (missing.length > 0) {
    throw new Error(`build-pages: the token generator emits no ${missing.join(', ')}`);
  }
  // Generator order, not list order: an alias has to follow what it aliases.
  const ordered = names.filter((name) => SITE_COLOR_TOKENS.includes(name));
  return { names: ordered, light: values.light, dark: values.dark };
}

/**
 * The scale steps, read back out of the generated stylesheet's `:root`.
 *
 * Reading the generator's own output is what makes this a copy of the
 * product's values rather than a second opinion about them. A name declared
 * twice — the preset remaps some of what the base block sets — resolves to
 * the last one, exactly as the cascade would.
 *
 * @returns {string[]} `name: value;` pairs in the order the generator writes
 */
function siteScale() {
  const css = buildTokenCss({ preset: DEFAULT_PRESET_ID });
  const block = css.match(/^:root \{\n([\s\S]*?)\n\}/);
  if (!block) throw new Error('build-pages: the token generator wrote no :root block');
  const declared = new Map();
  for (const [, name, value] of block[1].matchAll(/^\s*(--[\w-]+):\s*(.+);$/gm)) {
    if (SITE_SCALE_TOKENS.includes(name)) declared.set(name, value);
  }
  const missing = SITE_SCALE_TOKENS.filter((name) => !declared.has(name));
  if (missing.length > 0) {
    throw new Error(`build-pages: the token generator writes no ${missing.join(', ')}`);
  }
  return [...declared].map(([name, value]) => `${name}: ${value};`);
}

/**
 * `docs/tokens.css` — the generated half of the site's stylesheet.
 *
 * @returns {string}
 */
function buildTokensCss() {
  const { names, light, dark } = sitePalette();
  const declare = (values, indent) => names.map((name) => `${indent}${name}: ${values[name]};`);
  return [
    '/* GENERATED by scripts/build-pages.cjs — edit design/tokens/, not this file.',
    '',
    `   The base scale and palette of the ${DEFAULT_PRESET_ID} site style: what a new`,
    '   deployment renders, and what this site wears. Same values as',
    '   apps/web/src/generated/theme.css, from the same generator, narrowed to',
    '   the tokens this site uses. docs/styles.css holds the handwritten half.',
    '',
    '   The product switches modes on a data-mode attribute a runtime writes.',
    '   A static site has no runtime, so this one follows the reader\'s own',
    '   setting. Dark is its own palette, never light reversed, and it is',
    '   complete: every color declared once below is declared again after it. */',
    '',
    ':root {',
    ...siteScale().map((line) => `  ${line}`),
    '}',
    '',
    ':root {',
    '  color-scheme: light;',
    '',
    ...declare(light, '  '),
    '}',
    '',
    '@media (prefers-color-scheme: dark) {',
    '  :root {',
    '    color-scheme: dark;',
    '',
    ...declare(dark, '    '),
    '  }',
    '}',
    '',
    '/* Print palette. Paper has no dark mode: a reader who prints a page from',
    '   a dark screen gets the light edition. Every rule on this site reads the',
    '   ink, ground, and rule tokens and nothing else, so re-pointing them here',
    '   is the whole switch and no print rule has to know a mode exists.',
    '',
    '   `prefers-color-scheme` still reports dark while printing, so the block',
    '   above still matches. This one carries the same `:root` specificity and',
    '   comes after it, which is what settles it. The product needs a selector',
    '   list here because a runtime writes its mode onto the element; a static',
    '   site has no runtime, so source order is enough. */',
    '@media print {',
    '  :root {',
    '    color-scheme: light;',
    '',
    ...declare(light, '    '),
    '  }',
    '}',
    '',
  ].join('\n');
}

/**
 * The two `theme-color` tags, built from the palette.
 *
 * Browser chrome cannot read a custom property, so these two grounds are the
 * one place the site states a color as hex. They are `--brand-surface-rgb`
 * in each mode, computed here rather than typed anywhere.
 *
 * @returns {string[]} complete meta tags
 */
function themeColorTags() {
  const { light, dark } = sitePalette();
  const ground = (values) => rgbToHex(values['--brand-surface-rgb'].split(/\s+/).map(Number));
  return [
    `<meta name="theme-color" content="${ground(light)}" media="(prefers-color-scheme: light)">`,
    `<meta name="theme-color" content="${ground(dark)}" media="(prefers-color-scheme: dark)">`,
  ];
}

/**
 * Check the landing page's own `theme-color` tags against the palette.
 *
 * docs/index.html is written by hand, so its two tags are the last colors on
 * this site a person could get wrong. A stale one fails the build with the
 * line to paste in.
 *
 * @param {string} landingHtml
 * @returns {string[]} the problems found
 */
function themeColorProblems(landingHtml) {
  const found = [...landingHtml.matchAll(/<meta\s+name="theme-color"[^>]*>/gi)].map((m) => m[0]);
  if (found.length === 0) return ['docs/index.html declares no theme-color meta tag'];
  const expected = themeColorTags();
  const missing = expected.filter((tag) => !found.includes(tag));
  const extra = found.filter((tag) => !expected.includes(tag));
  return [
    ...missing.map((tag) => `docs/index.html is missing: ${tag}`),
    ...extra.map((tag) => `docs/index.html declares a stale ground: ${tag}`),
  ];
}

/**
 * Resolve one Markdown link target for a given source document.
 *
 * In-manifest documents become site routes. Anything else in the
 * repository becomes an absolute GitHub URL, and is reported so a reviewer
 * can see which links leave the documentation site.
 *
 * A link to the project's github.io address is moved to the configured site
 * address, so a rendered page never sends a reader through the redirect
 * GitHub adds once a custom domain is set.
 *
 * @param {{ source: string, routes: Map<string,string>, departures: Array, errors: Array,
 *           site?: ReturnType<typeof pagesSite> }} context
 * @returns {(href: string) => string}
 */
function linkResolver({ source, routes, departures, errors, site = pagesSite() }) {
  return (href) => {
    const target = String(href).trim();
    if (target === '' || target.startsWith('#')) return target;

    if (EXTERNAL_SCHEME_RE.test(target)) {
      if (target.startsWith(GITHUB_PAGES_URL)) {
        return `${site.url}${target.slice(GITHUB_PAGES_URL.length)}`;
      }
      // A link that already points at a GitHub blob page for a document
      // this site publishes is rewritten to the published route: raw blob
      // pages are no longer the normal reader path.
      if (target.startsWith(REPO_BLOB)) {
        const rest = target.slice(REPO_BLOB.length);
        const [repoPath, fragment = ''] = splitFragment(rest);
        const route = routes.get(repoPath);
        if (route) return fragment ? `${route}#${fragment}` : route;
      }
      return target;
    }
    if (target.startsWith('//') || target.startsWith('/')) return target;

    const [relative, fragment = ''] = splitFragment(target);
    const repoPath = path
      .normalize(path.join(path.dirname(source), relative))
      .replaceAll(path.sep, '/');
    const route = routes.get(repoPath);
    if (route) return fragment ? `${route}#${fragment}` : route;

    const onDisk = path.join(ROOT, repoPath);
    if (!fs.existsSync(onDisk)) {
      errors.push(`${source}: link target does not exist: ${target}`);
      return target;
    }
    const kind = fs.statSync(onDisk).isDirectory() ? 'tree' : 'blob';
    departures.push({ source, target, repoPath });
    const trimmed = repoPath.replace(/\/$/, '');
    return `${REPO_URL}/${kind}/main/${trimmed}${fragment ? `#${fragment}` : ''}`;
  };
}

function splitFragment(value) {
  const hash = value.indexOf('#');
  if (hash === -1) return [value, ''];
  return [value.slice(0, hash), value.slice(hash + 1)];
}

/**
 * Depth of a route below the documentation root, for nothing but reading
 * clarity in the breadcrumb trail.
 *
 * @param {string} route
 * @returns {number}
 */
function routeDepth(route) {
  return route.split('/').filter(Boolean).length;
}

function head({ site, title, description, canonical, themeTags, ogType, noindex = false }) {
  const socialImage = `${site.url}${SOCIAL_IMAGE_FILE}`;
  const safeTitle = escapeHtml(title);
  const safeDescription = escapeHtml(description);
  return [
    '<!doctype html>',
    '<html lang="en">',
    '<head>',
    '  <meta charset="utf-8">',
    '  <meta name="viewport" content="width=device-width, initial-scale=1">',
    `  <title>${safeTitle}</title>`,
    `  <meta name="description" content="${safeDescription}">`,
    ...(noindex ? ['  <meta name="robots" content="noindex, follow">'] : []),
    `  <link rel="canonical" href="${escapeHtml(canonical)}">`,
    `  <link rel="icon" type="image/svg+xml" href="${site.base}favicon.svg">`,
    `  <link rel="icon" type="image/png" sizes="32x32" href="${site.base}favicon-32.png">`,
    `  <link rel="apple-touch-icon" sizes="180x180" href="${site.base}apple-touch-icon.png">`,
    '',
    `  <meta property="og:type" content="${ogType}">`,
    `  <meta property="og:site_name" content="${PRODUCT}">`,
    `  <meta property="og:title" content="${safeTitle}">`,
    `  <meta property="og:description" content="${safeDescription}">`,
    `  <meta property="og:url" content="${escapeHtml(canonical)}">`,
    `  <meta property="og:image" content="${socialImage}">`,
    '  <meta property="og:image:type" content="image/png">',
    '  <meta property="og:image:width" content="1200">',
    '  <meta property="og:image:height" content="630">',
    `  <meta property="og:image:alt" content="${SOCIAL_IMAGE_ALT}">`,
    '  <meta name="twitter:card" content="summary_large_image">',
    `  <meta name="twitter:title" content="${safeTitle}">`,
    `  <meta name="twitter:description" content="${safeDescription}">`,
    `  <meta name="twitter:image" content="${socialImage}">`,
    `  <meta name="twitter:image:alt" content="${SOCIAL_IMAGE_ALT}">`,
    ...themeTags.map((tag) => `  ${tag}`),
    '',
    ...PRELOADED_FONTS.map((file) => (
      `  <link rel="preload" href="${site.base}fonts/${file}" as="font" type="font/woff2" crossorigin>`
    )),
    `  <link rel="stylesheet" href="${site.base}${TOKENS_FILE}">`,
    `  <link rel="stylesheet" href="${site.base}styles.css">`,
    `  <link rel="stylesheet" href="${site.base}docs.css">`,
    `  <script src="${site.base}scroll-regions.js" defer></script>`,
    `  <script src="${site.base}docs-ui.js" defer></script>`,
    '</head>',
    '<body class="docs-site">',
    '  <a class="skip-link" href="#main">Skip to content</a>',
    '',
    '  <div class="wrap">',
    '    <header class="site-header">',
    `      <a class="brand" href="${site.base}">`,
    ...MARK,
    '        <span class="brand-words">',
    `          <strong>${PRODUCT}</strong>`,
    '          <span class="brand-line">Conference websites</span>',
    '        </span>',
    '      </a>',
    '      <nav aria-label="Site">',
    `        <a href="${site.base}features/">Features</a>`,
    `        <a href="${site.base}how-it-works/">How it works</a>`,
    `        <a href="${site.docsBase}" aria-current="location">Guides</a>`,
    `        <a href="${site.base}project/">About</a>`,
    `        <a class="btn nav-cta" href="${site.demoBase}">Try the demo</a>`,
    '      </nav>',
    '    </header>',
  ].join('\n');
}

function breadcrumbs(trail) {
  const items = trail.map((crumb, index) => {
    const last = index === trail.length - 1;
    const label = escapeHtml(crumb.label);
    return last
      ? `        <li><span aria-current="page">${label}</span></li>`
      : `        <li><a href="${crumb.href}">${label}</a></li>`;
  });
  return [
    '      <nav class="breadcrumbs" aria-label="Breadcrumb">',
    '        <ol>',
    ...items,
    '        </ol>',
    '      </nav>',
  ].join('\n');
}

function sidebar(site, currentRoute) {
  const lines = [
    '      <details class="docs-disclosure" data-docs-navigation open>',
    '        <summary>Browse all guides</summary>',
    '        <div class="docs-nav-scroll" data-scroll-region data-scroll-label="Guide navigation">',
    '          <nav class="docs-nav" aria-label="Documentation">',
  ];
  for (const section of SECTIONS) {
    lines.push(`            <p class="docs-nav-section">${escapeHtml(section.title)}</p>`);
    lines.push('            <ul>');
    for (const page of section.pages) {
      const href = `${site.docsBase}${page.route}`;
      const current = page.route === currentRoute
        ? ' aria-current="page" class="is-current"'
        : '';
      lines.push(`              <li><a href="${href}"${current}>${escapeHtml(page.title)}</a></li>`);
    }
    lines.push('            </ul>');
  }
  lines.push('          </nav>', '        </div>', '      </details>');
  return lines.join('\n');
}

function pagination(site, previous, next) {
  if (!previous && !next) return '';
  const lines = ['        <nav class="page-nav" aria-label="Documentation pages">'];
  if (previous) {
    lines.push(
      `          <a class="page-nav-link" rel="prev" href="${site.docsBase}${previous.route}">` +
      `<span>Previous</span>${escapeHtml(previous.title)}</a>`,
    );
  }
  if (next) {
    lines.push(
      `          <a class="page-nav-link page-nav-next" rel="next" href="${site.docsBase}${next.route}">` +
      `<span>Next</span>${escapeHtml(next.title)}</a>`,
    );
  }
  lines.push('        </nav>');
  return lines.join('\n');
}

function footer(site) {
  return [
    '    <footer class="site-footer">',
    '      <div>',
    `        <a class="footer-brand" href="${site.base}"><strong>Event Runner</strong></a>`,
    '        <p>Built and supported by the Center for Cooperative Media at Montclair State University.</p>',
    '      </div>',
    '      <nav class="footer-links" aria-label="Footer">',
    `        <a href="${site.base}support/">Support</a>`,
    `        <a href="${site.base}privacy/">Privacy</a>`,
    `        <a href="${site.base}terms-of-service/">Terms</a>`,
    `        <a href="${site.base}project/">About the project</a>`,
    '      </nav>',
    '    </footer>',
    '  </div>',
    '</body>',
    '</html>',
    '',
  ].join('\n');
}

/**
 * Short "on this page" list, built from the document's own `h2` headings.
 * Only worth showing on a document long enough to need it.
 *
 * @param {Array<{level:number,text:string,slug:string}>} headings
 * @returns {string}
 */
function contents(headings) {
  const sections = headings.filter((heading) => heading.level === 2);
  if (sections.length < 3) return '';
  const items = sections
    .map((heading) => `              <li><a href="#${escapeHtml(heading.slug)}">${escapeHtml(heading.text)}</a></li>`)
    .join('\n');
  return [
    '          <nav class="contents" aria-labelledby="contents-title">',
    '            <p class="contents-title" id="contents-title">On this page</p>',
    '            <ul>',
    items,
    '            </ul>',
    '          </nav>',
  ].join('\n');
}

/**
 * Render one manifest page.
 *
 * @returns {{ path: string, contents: string, headings: Array, links: Array }}
 */
function renderPage(page, { site, themeTags, routes, departures, errors, root }) {
  const sourcePath = path.join(root, page.source);
  const markdown = fs.readFileSync(sourcePath, 'utf8');
  const rendered = renderMarkdown(markdown, {
    resolveLink: linkResolver({ source: page.source, routes, departures, errors, site }),
  });
  const title = page.title;
  const description = page.summary;
  const canonical = `${site.docsUrl}${page.route}`;
  const trail = [
    { label: 'Home', href: site.base },
    { label: 'Guides', href: site.docsBase },
  ];
  if (routeDepth(page.route) > 1) {
    trail.push({ label: page.section.title, href: `${site.docsBase}#${page.section.id}` });
  }
  trail.push({ label: title });

  const body = [
    breadcrumbs(trail),
    '',
    '    <div class="docs-layout">',
    sidebar(site, page.route),
    '',
    '      <main class="docs-main" id="main">',
    '        <article class="prose">',
    `          <h1>${escapeHtml(rendered.title || title)}</h1>`,
    contents(rendered.headings),
    indent(rendered.html, 10),
    '        </article>',
    '',
    '        <div class="source-note">' +
    `<a href="${site.base}support/">Ask for help</a>` +
    `<a href="${REPO_BLOB}${page.source}">Improve this guide on GitHub</a></div>`,
    pagination(site, page.previous, page.next),
    '      </main>',
    '    </div>',
    '',
  ].filter((part) => part !== '').join('\n');

  const html = [
    head({
      site,
      title: `${title} — ${PRODUCT} guides`,
      description,
      canonical,
      themeTags,
      ogType: 'article',
    }),
    body,
    footer(site),
  ].join('\n');

  return { path: `${page.route}index.html`, contents: html, headings: rendered.headings };
}

/**
 * Render the documentation home page from the manifest itself.
 *
 * @returns {{ path: string, contents: string }}
 */
function renderIndex({ site, themeTags }) {
  const sections = SECTIONS.map((section) => {
    const items = section.pages
      .map((page) => [
        `            <li data-guide-entry data-guide-search="${escapeHtml(`${page.title} ${page.summary}`)}">`,
        `              <a${page.route === SECTIONS[0].pages[0].route ? ' rel="next"' : ''} href="${site.docsBase}${page.route}">${escapeHtml(page.title)}<span aria-hidden="true">→</span></a>`,
        `              <p>${escapeHtml(page.summary)}</p>`,
        '            </li>',
      ].join('\n'))
      .join('\n');
    return [
      `        <section class="docs-section" id="${section.id}" data-guide-section>`,
      `          <h2>${escapeHtml(section.title)}</h2>`,
      `          <p class="docs-section-summary">${escapeHtml(section.summary)}</p>`,
      '          <ul class="docs-index-list">',
      items,
      '          </ul>',
      '        </section>',
    ].join('\n');
  }).join('\n');

  const body = [
    breadcrumbs([{ label: 'Home', href: site.base }, { label: 'Guides' }]),
    '    <main class="docs-home" id="main">',
    '      <header class="docs-intro">',
    '        <div>',
    '          <h1>Find your next step</h1>',
    '          <p class="lede">Set up your site, publish your program, or plan your day. Start with the guide for the work you need to do.</p>',
    '        </div>',
    '        <form class="guide-search" role="search" aria-label="Find a guide" data-guide-search-form hidden>',
    '          <label for="guide-query">Find a guide</label>',
    '          <div class="guide-search-control">',
    '            <input id="guide-query" name="q" type="search" placeholder="Try sessions, sign-in, or hosting" aria-describedby="guide-search-help" autocomplete="off">',
    '            <button type="reset" hidden>Clear</button>',
    '          </div>',
    '          <p id="guide-search-help">Search guide titles and descriptions.</p>',
    '          <p class="guide-search-status" role="status" aria-live="polite" aria-atomic="true" data-guide-search-status></p>',
    '        </form>',
    '      </header>',
    '      <nav class="guide-starts" aria-label="Documentation" data-guide-starts>',
    `        <a href="${site.docsBase}handbook/for-clients/"><strong>I’m organizing an event <span aria-hidden="true">→</span></strong><span>Get a site, prepare your content, and know who does what.</span></a>`,
    `        <a href="${site.docsBase}handbook/for-event-staff/"><strong>I’m running the site <span aria-hidden="true">→</span></strong><span>Edit pages, manage speakers, and keep the program current.</span></a>`,
    `        <a href="${site.docsBase}handbook/for-attendees/"><strong>I’m attending an event <span aria-hidden="true">→</span></strong><span>Sign in, save sessions, and get ready for the day.</span></a>`,
    '      </nav>',
    '      <div class="guide-directory" data-guide-directory>',
    sections,
    '      </div>',
    '      <section class="guides-help">',
    '        <h2>Ask for help</h2>',
    '        <p>Tell us what you’re trying to do and where you got stuck.</p>',
    `        <a class="btn btn-ghost" href="${site.base}support/">Get help</a>`,
    '      </section>',
    '    </main>',
    '',
  ].join('\n');

  const html = [
    head({
      site,
      title: `Guides — ${PRODUCT}`,
      description: DOCS_DESCRIPTION,
      canonical: site.docsUrl,
      themeTags,
      ogType: 'website',
    }),
    body,
    footer(site),
  ].join('\n');

  return { path: 'index.html', contents: html };
}

/** Keep existing engineering bookmarks useful without indexing them as user guides. */
function renderLegacyPage(page, { site, themeTags }) {
  const source = `${REPO_BLOB}${page.source}`;
  const body = [
    breadcrumbs([{ label: 'Home', href: site.base }, { label: page.title }]),
    '    <main class="docs-handoff prose" id="main">',
    `      <h1>${escapeHtml(page.title)}</h1>`,
    '      <p class="lede">This technical document is maintained with the source code on GitHub.</p>',
    '      <p>Architecture decisions, deployment instructions, and contributor records stay with the source code. Event organizers and attendees can use the guides on this site.</p>',
    '      <div class="handoff-actions">',
    `        <a class="btn" href="${escapeHtml(source)}">Read this document on GitHub</a>`,
    `        <a class="btn btn-ghost" href="${site.docsBase}">Browse the guides</a>`,
    '      </div>',
    '    </main>',
  ].join('\n');
  return {
    path: `${page.route}index.html`,
    contents: [
      head({
        site,
        title: `${page.title} — ${PRODUCT}`,
        description: `Read ${page.title} in the Event Runner repository on GitHub.`,
        canonical: `${site.docsUrl}${page.route}`,
        themeTags,
        ogType: 'website',
        noindex: true,
      }),
      body,
      footer(site),
    ].join('\n'),
  };
}

function indent(html, spaces) {
  const pad = ' '.repeat(spaces);
  return html
    .split('\n')
    .map((line) => (line === '' ? line : pad + line))
    .join('\n');
}

/**
 * The site address the hand-written pages state: the landing page's
 * canonical URL, or null when it has none that parses.
 *
 * @param {string} landingHtml
 * @returns {string|null}
 */
function landingSiteUrl(landingHtml) {
  const match = landingHtml.match(/<link\b(?=[^>]*\brel=["']canonical["'])[^>]*\bhref=["']([^"']+)["'][^>]*>/i);
  if (!match) return null;
  try {
    return parsePagesBaseUrl(match[1]).url;
  } catch {
    return null;
  }
}

/**
 * Move one hand-written page from one site address to another.
 *
 * Only quoted attribute values that start with the old address change. The
 * landing pages link to each other with relative paths, so those need
 * nothing.
 *
 * @param {string} html
 * @param {string} fromUrl
 * @param {string} toUrl
 * @returns {string}
 */
function rebaseLandingPage(html, fromUrl, toUrl) {
  if (fromUrl === toUrl) return html;
  return html.replaceAll(`"${fromUrl}`, `"${toUrl}`).replaceAll(`'${fromUrl}`, `'${toUrl}`);
}

/**
 * Who clients reach for help, from settings rather than source, so a person's
 * name and address stay out of the repository. The committed pages name the
 * shared address until both values are set.
 *
 * @returns {{ contact: {name: string, email: string}|null, errors: string[] }}
 */
function supportContact(env = process.env) {
  const name = (env.PAGES_SUPPORT_NAME || '').trim();
  const email = (env.PAGES_SUPPORT_EMAIL || '').trim();
  if (!name && !email) return { contact: null, errors: [] };
  if (!name || !/^[^\s@<>"'&]+@[^\s@<>"'&]+\.[^\s@<>"'&]+$/.test(email)) {
    return { contact: null, errors: ['PAGES_SUPPORT_NAME and PAGES_SUPPORT_EMAIL must be a name and an email address, together'] };
  }
  return { contact: { name, email }, errors: [] };
}

/** One hand-written page with its support name and address filled in. */
function withSupportContact(html, contact) {
  if (!contact) return html;
  return html
    .replace(/(<span\b(?=[^>]*\bdata-support-name\b)[^>]*>)[^<]*(<\/span>)/g, (_, open, close) => `${open}${escapeHtml(contact.name)}${close}`)
    .replace(/(<a\b(?=[^>]*\bdata-support-email\b)[^>]*>)([^<]*)(<\/a>)/g, (_, open, label, close) => {
      const email = escapeHtml(contact.email);
      const linked = open.replace(/\bhref=("|')[^"']*\1/, `href="mailto:${email}"`);
      const prefix = /^Email\s/i.test(label) ? 'Email ' : '';
      return `${linked}${prefix}${email}${close}`;
    });
}

/**
 * Each hand-written page in LANDING_PAGES as it reads for `site`.
 *
 * @returns {{ landingPages: Map<string,string>, errors: string[] }}
 */
function landingPagesFor(site, root, landing, contact = null) {
  const fromUrl = landingSiteUrl(landing);
  if (!fromUrl) {
    return { landingPages: new Map(), errors: ['docs/index.html has no canonical link with an https site address'] };
  }
  const landingPages = new Map();
  for (const name of LANDING_PAGES) {
    const file = path.join(root, 'docs', name);
    if (!fs.existsSync(file)) continue;
    landingPages.set(name, withSupportContact(rebaseLandingPage(fs.readFileSync(file, 'utf8'), fromUrl, site.url), contact));
  }
  return { landingPages, errors: [] };
}

/**
 * Render the whole site into memory.
 *
 * @param {{ root?: string, site?: ReturnType<typeof pagesSite> }} [options]
 * @returns {{ files: Map<string,string>, landingPages: Map<string,string>, tokensCss: string,
 *             departures: Array, errors: string[], headingsByRoute: Map, site: object }}
 */
function buildSite({ root = ROOT, site = pagesSite(), env = process.env } = {}) {
  const landing = fs.readFileSync(path.join(root, 'docs', 'index.html'), 'utf8');
  const themeTags = themeColorTags();
  const routes = routesBySource(site.docsBase);
  const pages = pagesInOrder();
  const departures = [];
  const { contact, errors: contactErrors } = supportContact(env);
  const { landingPages, errors: landingErrors } = landingPagesFor(site, root, landing, contact);
  const errors = [...themeColorProblems(landing), ...landingErrors, ...contactErrors];
  const files = new Map();
  const headingsByRoute = new Map();

  for (const page of pages) {
    const result = renderPage(page, { site, themeTags, routes, departures, errors, root });
    files.set(result.path, result.contents);
    headingsByRoute.set(page.route, result.headings);
  }
  for (const page of LEGACY_PAGES) {
    const result = renderLegacyPage(page, { site, themeTags });
    files.set(result.path, result.contents);
  }
  const index = renderIndex({ site, themeTags });
  files.set(index.path, index.contents);

  return { files, landingPages, tokensCss: buildTokensCss(), departures, errors, headingsByRoute, site };
}

/**
 * The hand-written pages whose committed text differs from the text for the
 * built site address.
 *
 * @param {Map<string,string>} landingPages
 * @param {string} docsDir
 * @returns {string[]} names relative to docs/
 */
function compareLandingPages(landingPages, docsDir) {
  const normalize = (text) => text.replace(/\r\n/g, '\n');
  return [...landingPages]
    .filter(([name, contents]) => normalize(fs.readFileSync(path.join(docsDir, name), 'utf8')) !== normalize(contents))
    .map(([name]) => name);
}

/**
 * Absolute path for one generated file, refusing anything that would land
 * outside the output directory.
 *
 * The names come from the manifest's own routes, so this is a guard against a
 * bad manifest edit rather than untrusted input — but the write path below
 * deletes the whole output tree first, and a `..` route would then aim that
 * write at the rest of the repository.
 *
 * @param {string} outputDir
 * @param {string} name
 * @returns {string}
 */
function resolveOutputPath(outputDir, name) {
  const target = path.resolve(outputDir, name);
  const relative = path.relative(outputDir, target);
  if (relative === '' || relative.startsWith('..') || path.isAbsolute(relative)) {
    throw new Error(`build-pages: route escapes docs/docs: ${name}`);
  }
  return target;
}

/**
 * Write the whole site, rebuilding the output directory from empty.
 *
 * Writing over the tree in place would leave the output of a route that has
 * since been renamed sitting on the published site — exactly what `--check`'s
 * "unexpected file" report keeps catching by hand. Deleting first makes the
 * directory a pure function of the manifest.
 *
 * @param {Map<string,string>} files
 * @param {string} outputDir
 */
function writeSite(files, outputDir) {
  // Resolve every destination BEFORE deleting anything: a route that escapes
  // the output directory must fail with the existing site still intact.
  const writes = [...files].map(([name, contents]) => [resolveOutputPath(outputDir, name), contents]);
  fs.rmSync(outputDir, { recursive: true, force: true });
  for (const [target, contents] of writes) {
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, contents);
  }
}

function listExisting(directory) {
  if (!fs.existsSync(directory)) return [];
  const found = [];
  const walk = (current) => {
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const full = path.join(current, entry.name);
      if (entry.isDirectory()) walk(full);
      else found.push(path.relative(directory, full).replaceAll(path.sep, '/'));
    }
  };
  walk(directory);
  return found.sort();
}

function usage() {
  return [
    'Usage: node scripts/build-pages.cjs [--check]',
    '',
    `  --check   compare docs/docs, docs/${TOKENS_FILE}, and the landing pages`,
    '            against a fresh render and exit non-zero on any difference;',
    '            writes nothing',
    '',
    'PAGES_BASE_URL sets the public site address (scripts/lib/pages-site.cjs).',
  ].join('\n');
}

/**
 * Compare the committed output against a fresh render.
 *
 * @param {Map<string,string>} files
 * @param {string} outputDir
 * @returns {{ differences: string[], unexpected: string[] }}
 */
function compare(files, outputDir) {
  const normalize = (text) => (text === null ? null : text.replace(/\r\n/g, '\n'));
  const differences = [];
  for (const [name, contents] of files) {
    const target = path.join(outputDir, name);
    const existing = fs.existsSync(target) ? fs.readFileSync(target, 'utf8') : null;
    if (normalize(existing) !== normalize(contents)) differences.push(name);
  }
  const unexpected = listExisting(outputDir).filter((name) => !files.has(name));
  return { differences, unexpected };
}

function main(argv = []) {
  if (argv.includes('--help')) {
    console.log(usage());
    return 0;
  }
  const unknown = argv.filter((argument) => argument !== '--check');
  if (unknown.length > 0) {
    console.error(`Unknown argument(s): ${unknown.join(', ')}\n\n${usage()}`);
    return 2;
  }

  let address;
  try {
    address = pagesSite();
  } catch (error) {
    console.error(`build-pages: ${error.message}`);
    return 2;
  }
  const site = buildSite({ site: address });
  if (site.errors.length > 0) {
    console.error('build-pages: the sources this site is built from do not hold together:');
    for (const error of site.errors) console.error(`- ${error}`);
    return 1;
  }

  const tokensPath = path.join(ROOT, 'docs', TOKENS_FILE);
  const docsDir = path.join(ROOT, 'docs');

  if (argv.includes('--check')) {
    const { differences, unexpected } = compare(site.files, OUTPUT_DIR);
    const staleLanding = compareLandingPages(site.landingPages, docsDir);
    const tokensStale = !fs.existsSync(tokensPath)
      || fs.readFileSync(tokensPath, 'utf8').replace(/\r\n/g, '\n') !== site.tokensCss;
    if (differences.length > 0 || unexpected.length > 0 || tokensStale || staleLanding.length > 0) {
      const lines = [`site address: ${address.url}`];
      if (tokensStale) {
        lines.push(`docs/${TOKENS_FILE} does not match the tokens in design/tokens/`);
      }
      if (staleLanding.length > 0) {
        lines.push(
          `${staleLanding.length} landing page(s) name a different site address:`,
          ...staleLanding.map((name) => `  - docs/${name}`),
        );
      }
      if (differences.length > 0) {
        lines.push(
          `${differences.length} file(s) differ from docs/docs:`,
          ...differences.map((name) => `  - ${name}`),
        );
      }
      if (unexpected.length > 0) {
        lines.push(
          `${unexpected.length} unexpected file(s) present in docs/docs:`,
          ...unexpected.map((name) => `  - ${name}`),
        );
      }
      console.error(
        `build-pages --check:\n${lines.join('\n')}\n\n` +
        'Regenerate with: node scripts/build-pages.cjs\n' +
        '(an unexpected file must be removed by hand — regenerating does not delete it).',
      );
      return 1;
    }
    console.log(
      `build-pages --check: ${site.files.size} file(s), docs/${TOKENS_FILE}, and ` +
      `${site.landingPages.size} landing page(s) match the committed site for ${address.url}`,
    );
    return 0;
  }

  fs.writeFileSync(tokensPath, site.tokensCss);
  writeSite(site.files, OUTPUT_DIR);
  for (const name of compareLandingPages(site.landingPages, docsDir)) {
    fs.writeFileSync(path.join(docsDir, name), site.landingPages.get(name));
    console.log(`build-pages: moved docs/${name} to ${address.url}`);
  }
  console.log(
    `build-pages: rebuilt docs/${TOKENS_FILE} and docs/docs from empty for ${address.url}, ` +
    `${site.files.size} file(s)`,
  );
  if (site.departures.length > 0) {
    const unique = [...new Set(site.departures.map((departure) => departure.repoPath))].sort();
    console.log(
      `build-pages: ${site.departures.length} link(s) leave the documentation site, ` +
      `pointing at ${unique.length} repository path(s):`,
    );
    for (const repoPath of unique) console.log(`  - ${repoPath}`);
  }
  return 0;
}

if (require.main === module) process.exitCode = main(process.argv.slice(2));

module.exports = {
  buildSite,
  buildTokensCss,
  compare,
  compareLandingPages,
  landingSiteUrl,
  linkResolver,
  main,
  rebaseLandingPage,
  supportContact,
  withSupportContact,
  themeColorTags,
  themeColorProblems,
  internals: {
    LANDING_PAGES,
    OUTPUT_DIR,
    PRODUCT,
    SITE_COLOR_TOKENS,
    SITE_SCALE_TOKENS,
    TOKENS_FILE,
    listExisting,
    plainText,
    resolveOutputPath,
    sitePalette,
    writeSite,
  },
};
