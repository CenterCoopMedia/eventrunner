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
 * Usage:
 *   node scripts/build-pages.cjs            # write docs/tokens.css + docs/docs/
 *   node scripts/build-pages.cjs --check    # compare only, write nothing
 *
 * `--check` is the freshness gate, and it mirrors
 * scripts/generate-content.cjs --check: it fails on any file whose
 * committed bytes differ from a fresh render, on any unexpected file left
 * behind in the output directory, and on a stale `docs/tokens.css`. It runs
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
  DOCS_BASE,
  REPO_BLOB,
  REPO_URL,
  SECTIONS,
  SITE_BASE,
  SITE_ORIGIN,
  pagesInOrder,
  routesBySource,
} = require('./lib/pages-manifest.cjs');

const ROOT = path.resolve(__dirname, '..');
const OUTPUT_DIR = path.join(ROOT, 'docs', 'docs');
const LANDING_PAGE = path.join(ROOT, 'docs', 'index.html');
const TOKENS_FILE = 'tokens.css';

const PRODUCT = 'Event Runner';
const SITE_URL = `${SITE_ORIGIN}${SITE_BASE}`;
const DOCS_URL = `${SITE_ORIGIN}${DOCS_BASE}`;
// The documentation site has its own social card, so a link to a guide is not
// previewed as the product landing page (docs/social-preview.png).
const SOCIAL_IMAGE = `${SITE_URL}og-default.png`;
const SOCIAL_IMAGE_ALT = 'Event Runner documentation';
const DOCS_DESCRIPTION =
  'Guides, runbooks, and decision records for Event Runner, the white-label event CMS ' +
  'operated by the Center for Cooperative Media.';
// Fonts are self-hosted under docs/fonts and declared by styles.css, so no
// page here reaches a font CDN. See docs/fonts/README.md.
const PRELOADED_FONTS = ['source-sans-3-latin.woff2', 'bricolage-grotesque-latin.woff2'];

const EXTERNAL_SCHEME_RE = /^[a-z][a-z\d+.-]*:/i;

// The Event Runner mark, inline so it takes the masthead's own ink. Four
// strokes: a stem, then the three rule weights the system ships. The link
// already says the name, so the drawing is decorative. Same markup as
// docs/index.html, and the same geometry as docs/favicon.svg.
const MARK = Object.freeze([
  '        <svg class="brand-mark" viewBox="0 0 24 24" aria-hidden="true" focusable="false">',
  '          <rect x="2.5" y="2" width="3" height="20"/>',
  '          <rect x="5.5" y="2" width="16" height="3"/>',
  '          <rect x="5.5" y="11" width="9.5" height="2"/>',
  '          <rect x="5.5" y="19.5" width="13" height="2.5"/>',
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
 * @param {{ source: string, routes: Map<string,string>, departures: Array, errors: Array }} context
 * @returns {(href: string) => string}
 */
function linkResolver({ source, routes, departures, errors }) {
  return (href) => {
    const target = String(href).trim();
    if (target === '' || target.startsWith('#')) return target;

    if (EXTERNAL_SCHEME_RE.test(target)) {
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

function head({ title, description, canonical, themeTags, ogType }) {
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
    `  <link rel="canonical" href="${escapeHtml(canonical)}">`,
    `  <link rel="icon" type="image/svg+xml" href="${SITE_BASE}favicon.svg">`,
    '',
    `  <meta property="og:type" content="${ogType}">`,
    `  <meta property="og:site_name" content="${PRODUCT}">`,
    `  <meta property="og:title" content="${safeTitle}">`,
    `  <meta property="og:description" content="${safeDescription}">`,
    `  <meta property="og:url" content="${escapeHtml(canonical)}">`,
    `  <meta property="og:image" content="${SOCIAL_IMAGE}">`,
    '  <meta property="og:image:type" content="image/png">',
    '  <meta property="og:image:width" content="1200">',
    '  <meta property="og:image:height" content="630">',
    `  <meta property="og:image:alt" content="${SOCIAL_IMAGE_ALT}">`,
    '  <meta name="twitter:card" content="summary_large_image">',
    `  <meta name="twitter:title" content="${safeTitle}">`,
    `  <meta name="twitter:description" content="${safeDescription}">`,
    `  <meta name="twitter:image" content="${SOCIAL_IMAGE}">`,
    `  <meta name="twitter:image:alt" content="${SOCIAL_IMAGE_ALT}">`,
    ...themeTags.map((tag) => `  ${tag}`),
    '',
    ...PRELOADED_FONTS.map((file) => (
      `  <link rel="preload" href="${SITE_BASE}fonts/${file}" as="font" type="font/woff2" crossorigin>`
    )),
    `  <link rel="stylesheet" href="${SITE_BASE}${TOKENS_FILE}">`,
    `  <link rel="stylesheet" href="${SITE_BASE}styles.css">`,
    `  <link rel="stylesheet" href="${SITE_BASE}docs.css">`,
    '</head>',
    '<body>',
    '  <a class="skip-link" href="#main">Skip to content</a>',
    '',
    '  <div class="wrap">',
    // The masthead is the same device the landing page carries: a
    // rule-bounded title block in type and rules only, at the compact size
    // (design brief §2.1). The line under the name states which surface of
    // the site the reader is on.
    '    <header class="site-header">',
    `      <a class="brand" href="${SITE_BASE}">`,
    ...MARK,
    '        <span class="brand-words">',
    `          <strong>${PRODUCT}</strong>`,
    '          <span class="brand-line">Documentation</span>',
    '        </span>',
    '      </a>',
    '      <nav aria-label="Site">',
    `        <a href="${SITE_BASE}">Home</a>`,
    `        <a href="${DOCS_BASE}">Documentation</a>`,
    `        <a href="${SITE_BASE}demo/">Demo</a>`,
    `        <a href="${REPO_URL}">Repo</a>`,
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

function sidebar(currentRoute) {
  const lines = ['      <nav class="docs-nav" aria-label="Documentation">'];
  for (const section of SECTIONS) {
    lines.push(`        <p class="docs-nav-section">${escapeHtml(section.title)}</p>`);
    lines.push('        <ul>');
    for (const page of section.pages) {
      const href = `${DOCS_BASE}${page.route}`;
      const current = page.route === currentRoute
        ? ' aria-current="page" class="is-current"'
        : '';
      lines.push(`          <li><a href="${href}"${current}>${escapeHtml(page.title)}</a></li>`);
    }
    lines.push('        </ul>');
  }
  lines.push('      </nav>');
  return lines.join('\n');
}

function pagination(previous, next) {
  if (!previous && !next) return '';
  const lines = ['        <nav class="page-nav" aria-label="Documentation pages">'];
  if (previous) {
    lines.push(
      `          <a class="page-nav-link" rel="prev" href="${DOCS_BASE}${previous.route}">` +
      `<span>Previous</span>${escapeHtml(previous.title)}</a>`,
    );
  }
  if (next) {
    lines.push(
      `          <a class="page-nav-link page-nav-next" rel="next" href="${DOCS_BASE}${next.route}">` +
      `<span>Next</span>${escapeHtml(next.title)}</a>`,
    );
  }
  lines.push('        </nav>');
  return lines.join('\n');
}

function footer() {
  return [
    '    <footer class="site-footer">',
    '      <div>An initiative of the Center for Cooperative Media at Montclair State University.</div>',
    '      <div>',
    '        <a href="https://centerforcooperativemedia.org">CCM</a>',
    '        ·',
    `        <a href="${REPO_URL}/blob/main/LICENSE">Apache-2.0</a>`,
    '        ·',
    `        <a href="${DOCS_BASE}security/">Security</a>`,
    '      </div>',
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
function renderPage(page, { themeTags, routes, departures, errors, root }) {
  const sourcePath = path.join(root, page.source);
  const markdown = fs.readFileSync(sourcePath, 'utf8');
  const rendered = renderMarkdown(markdown, {
    resolveLink: linkResolver({ source: page.source, routes, departures, errors }),
  });
  const title = page.title;
  const description = page.summary;
  const canonical = `${DOCS_URL}${page.route}`;
  const trail = [
    { label: 'Home', href: SITE_BASE },
    { label: 'Documentation', href: DOCS_BASE },
  ];
  if (routeDepth(page.route) > 1) {
    trail.push({ label: page.section.title, href: `${DOCS_BASE}#${page.section.id}` });
  }
  trail.push({ label: title });

  const body = [
    breadcrumbs(trail),
    '',
    '    <div class="docs-layout">',
    sidebar(page.route),
    '',
    '      <main class="docs-main" id="main">',
    '        <article class="prose">',
    `          <h1>${escapeHtml(rendered.title || title)}</h1>`,
    contents(rendered.headings),
    indent(rendered.html, 10),
    '        </article>',
    '',
    '        <p class="source-note">This page is generated from ' +
    `<a href="${REPO_BLOB}${page.source}"><code>${escapeHtml(page.source)}</code></a>. ` +
    'Edit the Markdown, not the HTML.</p>',
    pagination(page.previous, page.next),
    '      </main>',
    '    </div>',
    '',
  ].filter((part) => part !== '').join('\n');

  const html = [
    head({
      title: `${title} — ${PRODUCT} documentation`,
      description,
      canonical,
      themeTags,
      ogType: 'article',
    }),
    body,
    footer(),
  ].join('\n');

  return { path: `${page.route}index.html`, contents: html, headings: rendered.headings };
}

/**
 * Render the documentation home page from the manifest itself.
 *
 * @returns {{ path: string, contents: string }}
 */
function renderIndex({ themeTags, pages }) {
  const sections = SECTIONS.map((section) => {
    const items = section.pages
      .map((page) => [
        '            <li>',
        `              <a href="${DOCS_BASE}${page.route}">${escapeHtml(page.title)}</a>`,
        `              <span>${escapeHtml(page.summary)}</span>`,
        '            </li>',
      ].join('\n'))
      .join('\n');
    return [
      `        <section class="docs-section" id="${section.id}">`,
      `          <h2>${escapeHtml(section.title)}</h2>`,
      `          <p>${escapeHtml(section.summary)}</p>`,
      '          <ul class="docs-index-list">',
      items,
      '          </ul>',
      '        </section>',
    ].join('\n');
  }).join('\n');

  const body = [
    breadcrumbs([{ label: 'Home', href: SITE_BASE }, { label: 'Documentation' }]),
    '',
    '    <div class="docs-layout">',
    sidebar(''),
    '',
    '      <main class="docs-main" id="main">',
    '        <article class="prose">',
    '          <h1>Documentation</h1>',
    `          <p class="lede">${escapeHtml(DOCS_DESCRIPTION)}</p>`,
    '          <p>Every page here is rendered from the Markdown in the repository. ' +
    `The <a href="${SITE_BASE}demo/">demo site</a> shows what attendees see; ` +
    'the guides below cover running one.</p>',
    sections,
    '        </article>',
    pagination(null, pages[0]),
    '      </main>',
    '    </div>',
    '',
  ].join('\n');

  const html = [
    head({
      title: `Documentation — ${PRODUCT}`,
      description: DOCS_DESCRIPTION,
      canonical: DOCS_URL,
      themeTags,
      ogType: 'website',
    }),
    body,
    footer(),
  ].join('\n');

  return { path: 'index.html', contents: html };
}

function indent(html, spaces) {
  const pad = ' '.repeat(spaces);
  return html
    .split('\n')
    .map((line) => (line === '' ? line : pad + line))
    .join('\n');
}

/**
 * Render the whole site into memory.
 *
 * @param {{ root?: string }} [options]
 * @returns {{ files: Map<string,string>, tokensCss: string, departures: Array,
 *             errors: string[], headingsByRoute: Map }}
 */
function buildSite({ root = ROOT } = {}) {
  const landing = fs.readFileSync(
    root === ROOT ? LANDING_PAGE : path.join(root, 'docs', 'index.html'),
    'utf8',
  );
  const themeTags = themeColorTags();
  const routes = routesBySource();
  const pages = pagesInOrder();
  const departures = [];
  const errors = themeColorProblems(landing);
  const files = new Map();
  const headingsByRoute = new Map();

  for (const page of pages) {
    const result = renderPage(page, { themeTags, routes, departures, errors, root });
    files.set(result.path, result.contents);
    headingsByRoute.set(page.route, result.headings);
  }
  const index = renderIndex({ themeTags, pages });
  files.set(index.path, index.contents);

  return { files, tokensCss: buildTokensCss(), departures, errors, headingsByRoute };
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
    `  --check   compare docs/docs and docs/${TOKENS_FILE} against a fresh`,
    '            render and exit non-zero on any difference; writes nothing',
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

  const site = buildSite();
  if (site.errors.length > 0) {
    console.error('build-pages: the sources this site is built from do not hold together:');
    for (const error of site.errors) console.error(`- ${error}`);
    return 1;
  }

  const tokensPath = path.join(ROOT, 'docs', TOKENS_FILE);

  if (argv.includes('--check')) {
    const { differences, unexpected } = compare(site.files, OUTPUT_DIR);
    const tokensStale = !fs.existsSync(tokensPath)
      || fs.readFileSync(tokensPath, 'utf8').replace(/\r\n/g, '\n') !== site.tokensCss;
    if (differences.length > 0 || unexpected.length > 0 || tokensStale) {
      const lines = [];
      if (tokensStale) {
        lines.push(`docs/${TOKENS_FILE} does not match the tokens in design/tokens/`);
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
      `build-pages --check: ${site.files.size} file(s) and docs/${TOKENS_FILE} ` +
      'match the committed site',
    );
    return 0;
  }

  fs.writeFileSync(tokensPath, site.tokensCss);
  writeSite(site.files, OUTPUT_DIR);
  console.log(
    `build-pages: rebuilt docs/${TOKENS_FILE} and docs/docs from empty, ` +
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
  linkResolver,
  main,
  themeColorTags,
  themeColorProblems,
  internals: {
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
