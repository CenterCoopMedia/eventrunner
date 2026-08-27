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
 * Usage:
 *   node scripts/build-pages.cjs            # write docs/docs/
 *   node scripts/build-pages.cjs --check    # compare only, write nothing
 *
 * `--check` is the freshness gate, and it mirrors
 * scripts/generate-content.cjs --check: it fails on any file whose
 * committed bytes differ from a fresh render, and on any unexpected file
 * left behind in the output directory. It runs from
 * scripts/build-pages.test.cjs so the credential-free documentation CI
 * tier enforces it without an npm install.
 *
 * No dependencies, by design: the documentation CI tier runs on the
 * runner's Node with no `npm ci`.
 */

const fs = require('node:fs');
const path = require('node:path');

const { renderMarkdown, escapeHtml, plainText } = require('./lib/markdown-pages.cjs');
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

/**
 * Copy the landing page's `theme-color` tags verbatim.
 *
 * A browser-chrome color cannot read a custom property, so the two grounds
 * `docs/styles.css` paints are written out as hex once, in docs/index.html.
 * Copying them from there keeps the documentation shell in step with the
 * landing page and keeps color literals out of this script, where the
 * hex-literal lint ban applies.
 *
 * @param {string} landingHtml
 * @returns {string[]} complete meta tags
 */
function themeColorTags(landingHtml) {
  const tags = [...landingHtml.matchAll(/<meta\s+name="theme-color"[^>]*>/gi)].map((match) => match[0]);
  if (tags.length === 0) {
    throw new Error('docs/index.html has no theme-color meta tag to mirror');
  }
  return tags;
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
    `        <strong>${PRODUCT}</strong>`,
    '        <span>Documentation</span>',
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
 * @returns {{ files: Map<string,string>, departures: Array, errors: string[], headingsByRoute: Map }}
 */
function buildSite({ root = ROOT } = {}) {
  const landing = fs.readFileSync(
    root === ROOT ? LANDING_PAGE : path.join(root, 'docs', 'index.html'),
    'utf8',
  );
  const themeTags = themeColorTags(landing);
  const routes = routesBySource();
  const pages = pagesInOrder();
  const departures = [];
  const errors = [];
  const files = new Map();
  const headingsByRoute = new Map();

  for (const page of pages) {
    const result = renderPage(page, { themeTags, routes, departures, errors, root });
    files.set(result.path, result.contents);
    headingsByRoute.set(page.route, result.headings);
  }
  const index = renderIndex({ themeTags, pages });
  files.set(index.path, index.contents);

  return { files, departures, errors, headingsByRoute };
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
    '  --check   compare docs/docs against a fresh render and exit non-zero',
    '            on any difference; writes nothing',
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
    console.error('build-pages: the source Markdown has broken links:');
    for (const error of site.errors) console.error(`- ${error}`);
    return 1;
  }

  if (argv.includes('--check')) {
    const { differences, unexpected } = compare(site.files, OUTPUT_DIR);
    if (differences.length > 0 || unexpected.length > 0) {
      const lines = [];
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
    console.log(`build-pages --check: ${site.files.size} file(s) match the committed site`);
    return 0;
  }

  writeSite(site.files, OUTPUT_DIR);
  console.log(`build-pages: rebuilt docs/docs from empty, ${site.files.size} file(s)`);
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
  compare,
  linkResolver,
  main,
  themeColorTags,
  internals: { OUTPUT_DIR, PRODUCT, listExisting, plainText, resolveOutputPath, writeSite },
};
