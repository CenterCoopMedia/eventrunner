#!/usr/bin/env node
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { marked } = require('marked');

const SITE_ORIGIN = 'https://centercoopmedia.github.io';
const DOCS_HOME = '/eventrunner/docs/';
const ASSET_PATH = '/eventrunner/docs/assets/';
const OUTPUT_DIRECTORY = path.join('docs', 'docs');

function rgbToHex(rgb) {
  return `#${rgb.map((channel) => channel.toString(16).padStart(2, '0')).join('')}`;
}

const DOCS_COLORS = Object.freeze({
  navy: rgbToHex([17, 75, 139]),
  ink: rgbToHex([23, 33, 46]),
  paper: rgbToHex([248, 250, 252]),
  link: rgbToHex([13, 77, 145]),
  linkHover: rgbToHex([8, 59, 112]),
  focus: rgbToHex([17, 75, 139]),
  white: rgbToHex([255, 255, 255]),
  line: rgbToHex([201, 212, 224]),
  lineSoft: rgbToHex([219, 227, 235]),
  muted: rgbToHex([93, 104, 117]),
  heading: rgbToHex([16, 43, 75]),
  table: rgbToHex([234, 240, 246]),
  tableLine: rgbToHex([185, 199, 213]),
  quoteLine: rgbToHex([138, 166, 195]),
  quoteText: rgbToHex([65, 82, 99]),
  code: rgbToHex([245, 248, 251]),
  inlineCode: rgbToHex([231, 238, 245]),
});
const THEME_COLOR = DOCS_COLORS.navy;

const DOCS_MANIFEST = Object.freeze([
  { source: 'README.md', route: '/eventrunner/docs/overview/', title: 'Eventrunner overview', section: 'Product' },
  { source: 'docs/ROADMAP.md', route: '/eventrunner/docs/roadmap/', title: 'Roadmap', section: 'Product' },
  { source: 'docs/interface-guidelines.md', route: '/eventrunner/docs/interface-guidelines/', title: 'Interface guidelines', section: 'Product' },
  { source: 'docs/adr/0001-event-platform-v1.md', route: '/eventrunner/docs/architecture/', title: 'Architecture decision record', section: 'Product' },
  { source: 'docs/ADMIN_GUIDE.md', route: '/eventrunner/docs/admin-guide/', title: 'Admin guide', section: 'Operators' },
  { source: 'docs/CLIENT_ONBOARDING.md', route: '/eventrunner/docs/client-onboarding/', title: 'Client onboarding', section: 'Operators' },
  { source: 'docs/DEPLOY_RUNBOOK.md', route: '/eventrunner/docs/deploy-runbook/', title: 'Deploy runbook', section: 'Operators' },
  { source: 'docs/POSTMARK_PROVISIONING.md', route: '/eventrunner/docs/postmark-provisioning/', title: 'Postmark provisioning', section: 'Operators' },
  { source: 'docs/handbook/README.md', route: '/eventrunner/docs/handbook/', title: 'Handbook', section: 'Handbook' },
  { source: 'docs/handbook/for-attendees.md', route: '/eventrunner/docs/handbook/for-attendees/', title: 'For attendees', section: 'Handbook' },
  { source: 'docs/handbook/for-clients.md', route: '/eventrunner/docs/handbook/for-clients/', title: 'For clients', section: 'Handbook' },
  { source: 'docs/handbook/for-event-staff.md', route: '/eventrunner/docs/handbook/for-event-staff/', title: 'For event staff', section: 'Handbook' },
  { source: 'docs/handbook/getting-help.md', route: '/eventrunner/docs/handbook/getting-help/', title: 'Getting help', section: 'Handbook' },
  { source: 'docs/handbook/faq.md', route: '/eventrunner/docs/handbook/faq/', title: 'FAQ', section: 'Handbook' },
  { source: 'docs/handbook/glossary.md', route: '/eventrunner/docs/handbook/glossary/', title: 'Glossary', section: 'Handbook' },
  { source: 'CONTRIBUTING.md', route: '/eventrunner/docs/contributing/', title: 'Contributing', section: 'Project' },
  { source: 'CODE_OF_CONDUCT.md', route: '/eventrunner/docs/code-of-conduct/', title: 'Code of conduct', section: 'Project' },
  { source: 'GOVERNANCE.md', route: '/eventrunner/docs/governance/', title: 'Governance', section: 'Project' },
  { source: 'SUPPORT.md', route: '/eventrunner/docs/support/', title: 'Support', section: 'Project' },
  { source: 'SECURITY.md', route: '/eventrunner/docs/security/', title: 'Security', section: 'Project' },
  { source: 'RELEASING.md', route: '/eventrunner/docs/releasing/', title: 'Releasing', section: 'Project' },
  { source: 'CHANGELOG.md', route: '/eventrunner/docs/changelog/', title: 'Changelog', section: 'Project' },
]);

function escapeHtml(value) {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function stripMarkdown(value) {
  return String(value)
    .replace(/`([^`]+)`/g, '$1')
    .replace(/!?(?:\[([^\]]*)\]\([^)]*\))/g, '$1')
    .replace(/[~*_]/g, '')
    .replace(/<[^>]*>/g, '')
    .trim();
}

function slugify(value, usedSlugs = new Map()) {
  const base = stripMarkdown(value)
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^\w\s-]/g, '')
    .trim()
    .replace(/[\s_-]+/g, '-') || 'section';
  const count = usedSlugs.get(base) || 0;
  usedSlugs.set(base, count + 1);
  return count ? `${base}-${count}` : base;
}

function documentHeadings(markdown) {
  const usedSlugs = new Map();
  return marked.lexer(markdown)
    .filter((token) => token.type === 'heading')
    .map((token) => ({ depth: token.depth, text: stripMarkdown(token.text), id: slugify(token.text, usedSlugs) }));
}

function truncateDescription(value, maximumLength = 160) {
  const normalized = String(value).replace(/\s+/g, ' ').trim();
  if (normalized.length <= maximumLength) return normalized;
  const boundary = normalized.lastIndexOf(' ', maximumLength);
  return boundary > 0 ? normalized.slice(0, boundary).trimEnd() : '';
}

function descriptionFromMarkdown(markdown, fallback) {
  const paragraph = marked.lexer(markdown).find((token) => token.type === 'paragraph');
  const description = paragraph ? stripMarkdown(paragraph.text) : fallback;
  return truncateDescription(description) || truncateDescription(fallback);
}

function contrastRatio(first, second) {
  const luminance = (color) => {
    const channels = color.slice(1).match(/.{2}/g).map((channel) => Number.parseInt(channel, 16) / 255);
    const linear = channels.map((channel) => (channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4));
    return (0.2126 * linear[0]) + (0.7152 * linear[1]) + (0.0722 * linear[2]);
  };
  const [lighter, darker] = [luminance(first), luminance(second)].sort((left, right) => right - left);
  return (lighter + 0.05) / (darker + 0.05);
}

function validateManifest(manifest) {
  if (!Array.isArray(manifest) || manifest.length === 0) {
    throw new Error('Documentation manifest must contain at least one document.');
  }

  const sources = new Set();
  const routes = new Set();
  const outputFiles = new Set();
  for (const document of manifest) {
    if (!document || typeof document.source !== 'string' || !document.source.endsWith('.md')) {
      throw new Error('Every documentation manifest entry needs a Markdown source.');
    }
    if (path.isAbsolute(document.source) || document.source.includes('\\') || document.source.split('/').includes('..')) {
      throw new Error(`Documentation source escapes the repository: ${document.source}`);
    }
    if (sources.has(document.source)) {
      throw new Error(`Documentation manifest has a duplicate source: ${document.source}`);
    }
    sources.add(document.source);

    if (typeof document.route !== 'string'
      || !document.route.startsWith(DOCS_HOME)
      || !document.route.endsWith('/')
      || document.route.includes('\\')
      || document.route.split('/').includes('..')
      || !/^\/eventrunner\/docs\/[a-z0-9/-]+\/$/.test(document.route)) {
      throw new Error(`Documentation manifest has an invalid route: ${document.route}`);
    }
    if (routes.has(document.route)) {
      throw new Error(`Documentation manifest has a duplicate route: ${document.route}`);
    }
    routes.add(document.route);
    const outputFile = outputFileForRoute(document.route);
    if (outputFiles.has(outputFile)) {
      throw new Error(`Documentation manifest has duplicate normalized output: ${outputFile}`);
    }
    outputFiles.add(outputFile);

    if (typeof document.title !== 'string' || !document.title || typeof document.section !== 'string' || !document.section) {
      throw new Error(`Documentation manifest entry is missing a title or section: ${document.source}`);
    }
  }
}

function validateMarkdown(markdown, source) {
  const headings = documentHeadings(markdown);
  if (headings.filter((heading) => heading.depth === 1).length !== 1) {
    throw new Error(`${source} must contain exactly one h1.`);
  }
  let previousDepth = 0;
  for (const heading of headings) {
    if (heading.depth > previousDepth + 1) {
      throw new Error(`${source} skips from h${previousDepth} to h${heading.depth}.`);
    }
    previousDepth = heading.depth;
  }
}

function outputFileForRoute(route) {
  return path.posix.join(route.slice(DOCS_HOME.length, -1), 'index.html');
}

function resolveManifestSource(href, source, manifest) {
  const sourceByPath = new Map(manifest.map((document) => [document.source, document]));
  const [pathname, fragment = ''] = href.split('#', 2);
  if (!pathname) return `#${slugify(fragment)}`;

  const blobMatch = pathname.match(/^https:\/\/github\.com\/CenterCoopMedia\/(?:eventrunner|run-of-show)\/blob\/[^/]+\/(.+)$/i);
  const sourcePath = blobMatch
    ? blobMatch[1]
    : pathname.startsWith('/')
      ? pathname.slice(1)
      : path.posix.normalize(path.posix.join(path.posix.dirname(source), pathname));
  const linkedDocument = sourceByPath.get(sourcePath);
  if (!linkedDocument) return null;
  return `${linkedDocument.route}${fragment ? `#${slugify(fragment)}` : ''}`;
}

function safeHref(href, source, manifest) {
  const value = String(href || '').trim();
  if (!value || /^(?:javascript|data|vbscript):/i.test(value) || value.startsWith('//')) return null;

  const rewritten = resolveManifestSource(value, source, manifest);
  if (rewritten) return rewritten;
  if (/^https:\/\/centercoopmedia\.github\.io\/run-of-show\//i.test(value)) {
    return value.replace(/\/run-of-show\//i, '/eventrunner/');
  }
  if (/^(?:https?:|mailto:|tel:|\/|#|\.\/|\.\.\/)/i.test(value)) return value;
  return null;
}

function renderSectionNavigation(document, manifest) {
  const links = manifest
    .filter((candidate) => candidate.section === document.section)
    .map((candidate) => `<li><a${candidate.source === document.source ? ' aria-current="page"' : ''} href="${candidate.route}">${escapeHtml(candidate.title)}</a></li>`)
    .join('');
  return `<aside class="section-nav"><nav aria-label="${escapeHtml(document.section)} documentation"><h2>${escapeHtml(document.section)}</h2><ul>${links}</ul></nav></aside>`;
}

function renderTableOfContents(headings) {
  const links = headings
    .filter((heading) => heading.depth >= 2 && heading.depth <= 3)
    .map((heading) => `<li class="toc-level-${heading.depth}"><a href="#${heading.id}">${escapeHtml(heading.text)}</a></li>`)
    .join('');
  return links ? `<nav class="page-toc" aria-label="On this page"><h2>On this page</h2><ol>${links}</ol></nav>` : '';
}

function renderHead({ title, description, route }) {
  const canonical = `${SITE_ORIGIN}${route}`;
  return `<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${escapeHtml(title)} | Eventrunner</title>
  <meta name="description" content="${escapeHtml(description)}">
  <meta name="theme-color" content="${THEME_COLOR}">
  <link rel="canonical" href="${canonical}">
  <link rel="icon" type="image/svg+xml" href="${ASSET_PATH}favicon.svg">
  <meta property="og:type" content="website">
  <meta property="og:title" content="${escapeHtml(title)} | Eventrunner">
  <meta property="og:description" content="${escapeHtml(description)}">
  <meta property="og:url" content="${canonical}">
  <meta property="og:image" content="${SITE_ORIGIN}${ASSET_PATH}og-default.png">
  <meta property="og:image:type" content="image/png">
  <meta property="og:image:width" content="1200">
  <meta property="og:image:height" content="630">
  <meta property="og:image:alt" content="Eventrunner documentation">
  <meta name="twitter:card" content="summary_large_image">
  <meta name="twitter:title" content="${escapeHtml(title)} | Eventrunner">
  <meta name="twitter:description" content="${escapeHtml(description)}">
  <meta name="twitter:image" content="${SITE_ORIGIN}${ASSET_PATH}og-default.png">
  <meta name="twitter:image:alt" content="Eventrunner documentation">
  <link rel="stylesheet" href="${ASSET_PATH}docs.css">
</head>`;
}

function renderSiteHeader() {
  return `<header class="site-header"><a class="site-name" href="/eventrunner/">Eventrunner</a><nav aria-label="Site"><a href="${DOCS_HOME}">Documentation</a><a href="/eventrunner/demo/">Demo</a><a href="https://github.com/CenterCoopMedia/eventrunner">Repository</a></nav></header>`;
}

function renderDocument({ document, markdown, manifest = DOCS_MANIFEST, previous, next }) {
  validateMarkdown(markdown, document.source);
  const headings = documentHeadings(markdown);
  const description = descriptionFromMarkdown(markdown, document.title);
  const headingIds = headings.map((heading) => heading.id);
  const renderer = new marked.Renderer();
  renderer.html = ({ text }) => escapeHtml(text);
  renderer.heading = function heading({ tokens, depth }) {
    const id = headingIds.shift() || 'section';
    return `<h${depth} id="${id}">${this.parser.parseInline(tokens)}</h${depth}>\n`;
  };
  renderer.link = function link({ href, title, tokens }) {
    const safe = safeHref(href, document.source, manifest);
    const text = this.parser.parseInline(tokens);
    if (!safe) return text;
    const titleAttribute = title ? ` title="${escapeHtml(title)}"` : '';
    return `<a href="${escapeHtml(safe)}"${titleAttribute}>${text}</a>`;
  };
  renderer.image = function image({ href, title, text }) {
    const safe = safeHref(href, document.source, manifest);
    if (!safe) return '';
    const titleAttribute = title ? ` title="${escapeHtml(title)}"` : '';
    return `<img src="${escapeHtml(safe)}" alt="${escapeHtml(text)}"${titleAttribute}>`;
  };

  const content = marked.parse(markdown, { gfm: true, renderer });
  const previousLink = previous ? `<a rel="prev" href="${previous.route}">${escapeHtml(previous.title)}</a>` : '';
  const nextLink = next ? `<a rel="next" href="${next.route}">${escapeHtml(next.title)}</a>` : '';

  return `<!doctype html>
<html lang="en">
${renderHead({ title: document.title, description, route: document.route })}
<body>
  <a class="skip-link" href="#main">Skip to content</a>
  ${renderSiteHeader()}
  <div class="page-layout">
    ${renderSectionNavigation(document, manifest)}
    <main id="main"><nav class="breadcrumbs" aria-label="Breadcrumb"><ol><li><a href="${DOCS_HOME}">Documentation</a></li><li>${escapeHtml(document.section)}</li><li aria-current="page">${escapeHtml(document.title)}</li></ol></nav>${renderTableOfContents(headings)}<article class="document-content">${content}</article><nav class="document-pagination" aria-label="Document navigation">${previousLink}${nextLink}</nav></main>
  </div>
</body>
</html>`;
}

function renderHub(manifest) {
  const sections = [...new Set(manifest.map((document) => document.section))];
  const sectionNavigation = sections
    .map((section) => `<li><a href="#${slugify(section)}">${escapeHtml(section)}</a></li>`)
    .join('');
  const groups = sections.map((section) => {
    const links = manifest
      .filter((document) => document.section === section)
      .map((document) => `<li><a href="${document.route}">${escapeHtml(document.title)}</a></li>`)
      .join('');
    return `<section aria-labelledby="${slugify(section)}"><h2 id="${slugify(section)}">${escapeHtml(section)}</h2><ul>${links}</ul></section>`;
  }).join('');
  const title = 'Eventrunner documentation';
  const description = 'Guides for Eventrunner operators, contributors, and event staff.';

  return `<!doctype html>
<html lang="en">
${renderHead({ title, description, route: DOCS_HOME })}
<body>
  <a class="skip-link" href="#main">Skip to content</a>
  ${renderSiteHeader()}
  <div class="page-layout">
    <aside class="section-nav"><nav aria-label="Documentation sections"><h2>Browse documentation</h2><ul>${sectionNavigation}</ul></nav></aside>
    <main id="main"><nav class="breadcrumbs" aria-label="Breadcrumb"><ol><li aria-current="page">Documentation</li></ol></nav><article class="document-content"><h1>Eventrunner documentation</h1><p>Documentation for people who operate, configure, contribute to, and use Eventrunner.</p>${groups}</article></main>
  </div>
</body>
</html>`;
}

function renderStylesheet() {
  return `@font-face {
  font-family: "Source Sans 3";
  src: url("source-sans-3-latin.woff2") format("woff2");
  font-display: swap;
  font-style: normal;
  font-weight: 200 900;
}

:root {
  --docs-navy: ${DOCS_COLORS.navy};
  --docs-ink: ${DOCS_COLORS.ink};
  --docs-paper: ${DOCS_COLORS.paper};
  --docs-link: ${DOCS_COLORS.link};
  --docs-link-hover: ${DOCS_COLORS.linkHover};
  --docs-focus: ${DOCS_COLORS.focus};
  --docs-white: ${DOCS_COLORS.white};
  --docs-line: ${DOCS_COLORS.line};
  --docs-line-soft: ${DOCS_COLORS.lineSoft};
  --docs-muted: ${DOCS_COLORS.muted};
  --docs-heading: ${DOCS_COLORS.heading};
  --docs-table: ${DOCS_COLORS.table};
  --docs-table-line: ${DOCS_COLORS.tableLine};
  --docs-quote-line: ${DOCS_COLORS.quoteLine};
  --docs-quote-text: ${DOCS_COLORS.quoteText};
  --docs-code: ${DOCS_COLORS.code};
  --docs-inline-code: ${DOCS_COLORS.inlineCode};
  color: var(--docs-ink);
  background: var(--docs-paper);
  font-family: "Source Sans 3", Arial, sans-serif;
  font-synthesis: none;
}

* { box-sizing: border-box; }

body {
  margin: 0;
  background: var(--docs-paper);
  color: var(--docs-ink);
  font-size: 1.0625rem;
  line-height: 1.6;
}

a { color: var(--docs-link); text-decoration-thickness: 0.08em; text-underline-offset: 0.14em; }
a:hover { color: var(--docs-link-hover); }
a:focus-visible { outline: 3px solid var(--docs-focus); outline-offset: 3px; }

.skip-link {
  left: 1rem;
  position: absolute;
  top: -4rem;
  z-index: 2;
  background: var(--docs-ink);
  color: var(--docs-white);
  padding: 0.45rem 0.75rem;
}
.skip-link:focus { top: 1rem; }

.site-header {
  align-items: baseline;
  border-bottom: 1px solid var(--docs-line);
  display: flex;
  gap: 2rem;
  justify-content: space-between;
  margin: 0 auto;
  max-width: 76rem;
  padding: 1rem 1.5rem;
}
.site-name { color: var(--docs-ink); font-size: 1.25rem; font-weight: 700; text-decoration: none; }
.site-header nav { display: flex; flex-wrap: wrap; gap: 1rem; }

.page-layout {
  display: grid;
  gap: 3rem;
  grid-template-columns: minmax(12rem, 15rem) minmax(0, 48rem);
  margin: 0 auto;
  max-width: 76rem;
  padding: 2.5rem 1.5rem 4rem;
}

.section-nav { border-top: 3px solid var(--docs-navy); font-size: 0.98rem; }
.section-nav h2, .page-toc h2 { font-size: 1rem; letter-spacing: 0.03em; margin: 0.75rem 0 0.35rem; }
.section-nav ul, .page-toc ol { list-style: none; margin: 0; padding: 0; }
.section-nav li { border-bottom: 1px solid var(--docs-line-soft); padding: 0.35rem 0; }
.section-nav a[aria-current="page"] { color: var(--docs-ink); font-weight: 700; text-decoration: none; }

.breadcrumbs { color: var(--docs-muted); font-size: 0.9rem; margin-bottom: 2rem; }
.breadcrumbs ol { display: flex; flex-wrap: wrap; gap: 0.4rem; list-style: none; margin: 0; padding: 0; }
.breadcrumbs li + li::before { content: "/"; margin-right: 0.4rem; }

.document-content { max-width: 48rem; min-width: 0; }
.document-content h1, .document-content h2, .document-content h3, .document-content h4, .document-content h5, .document-content h6 {
  color: var(--docs-heading);
  font-family: "Source Sans 3", Arial, sans-serif;
  line-height: 1.15;
}
.document-content h1 { font-size: clamp(2.25rem, 7vw, 3.5rem); letter-spacing: -0.035em; margin: 0 0 1.5rem; }
.document-content h2 { border-top: 1px solid var(--docs-line); font-size: 1.7rem; margin: 2.75rem 0 0.9rem; padding-top: 1rem; }
.document-content h3 { font-size: 1.3rem; margin: 2rem 0 0.65rem; }
.document-content p, .document-content ul, .document-content ol, .document-content pre, .document-content blockquote, .document-content table { margin: 0 0 1.15rem; }
.document-content li + li { margin-top: 0.35rem; }
.document-content table { border-collapse: collapse; display: block; max-width: 100%; overflow-x: auto; }
.document-content th, .document-content td { border: 1px solid var(--docs-table-line); padding: 0.45rem 0.6rem; text-align: left; vertical-align: top; }
.document-content th { background: var(--docs-table); color: var(--docs-heading); }
.document-content blockquote { border-left: 4px solid var(--docs-quote-line); color: var(--docs-quote-text); margin-left: 0; padding-left: 1rem; }
.document-content pre { background: var(--docs-ink); color: var(--docs-code); max-width: 100%; overflow-x: auto; padding: 1rem; }
.document-content code, .document-content pre { font-family: ui-monospace, SFMono-Regular, Consolas, "Liberation Mono", monospace; font-size: 0.9em; }
.document-content a, .document-content :not(pre) > code { overflow-wrap: anywhere; }
.document-content :not(pre) > code { background: var(--docs-inline-code); padding: 0.1em 0.3em; }
.document-content img { height: auto; max-width: 100%; }

.page-toc { border-bottom: 1px solid var(--docs-line); border-top: 1px solid var(--docs-line); margin: 0 0 2rem; padding: 0.6rem 0; }
.page-toc li { margin: 0.2rem 0; }
.page-toc .toc-level-3 { margin-left: 1rem; }

.document-pagination { border-top: 1px solid var(--docs-line); display: flex; gap: 1rem; justify-content: space-between; margin-top: 3rem; padding-top: 1rem; }

@media (max-width: 48rem) {
  .site-header { align-items: flex-start; flex-direction: column; gap: 0.5rem; }
  .page-layout { display: block; padding-top: 1.5rem; }
  .section-nav { margin-bottom: 2rem; }
}
`;
}

function renderFavicon() {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" role="img" aria-label="Eventrunner">
  <rect width="64" height="64" fill="${DOCS_COLORS.navy}"/>
  <path d="M15 15h34v8H24v7h20v8H24v11h25v8H15z" fill="${DOCS_COLORS.paper}"/>
</svg>`;
}

function outputRoot(root) {
  const resolvedRoot = path.resolve(root);
  const resolvedOutput = path.resolve(resolvedRoot, OUTPUT_DIRECTORY);
  const resolvedDocs = path.resolve(resolvedRoot, 'docs');
  if (!resolvedOutput.startsWith(`${resolvedDocs}${path.sep}`)) {
    throw new Error('Documentation output must remain inside docs/docs/.');
  }
  return resolvedOutput;
}

function buildPages({ root, manifest = DOCS_MANIFEST }) {
  const resolvedRoot = path.resolve(root);
  validateManifest(manifest);
  const pages = new Map();
  pages.set('index.html', renderHub(manifest));

  for (const [index, document] of manifest.entries()) {
    const sourceFile = path.resolve(resolvedRoot, document.source);
    if (!sourceFile.startsWith(`${resolvedRoot}${path.sep}`) || !fs.existsSync(sourceFile)) {
      throw new Error(`Documentation source file is missing: ${document.source}`);
    }
    const markdown = fs.readFileSync(sourceFile, 'utf8');
    const previous = manifest[index - 1] || null;
    const next = manifest[index + 1] || null;
    pages.set(outputFileForRoute(document.route), renderDocument({ document, markdown, manifest, previous, next }));
  }

  const sourceFont = path.join(resolvedRoot, 'docs', 'demo', 'fonts', 'source-sans-3-latin.woff2');
  if (!fs.existsSync(sourceFont)) {
    throw new Error('Documentation font asset is missing: docs/demo/fonts/source-sans-3-latin.woff2');
  }
  const sourcePreview = path.join(resolvedRoot, 'scripts', 'assets', 'documentation-og.png');
  if (!fs.existsSync(sourcePreview)) {
    throw new Error('Documentation social preview is missing: scripts/assets/documentation-og.png');
  }
  pages.set('assets/docs.css', renderStylesheet());
  pages.set('assets/favicon.svg', renderFavicon());
  pages.set('assets/og-default.png', fs.readFileSync(sourcePreview));
  pages.set('assets/source-sans-3-latin.woff2', fs.readFileSync(sourceFont));
  validateGeneratedPages(pages, manifest);
  return pages;
}

function validateGeneratedPages(pages, manifest = DOCS_MANIFEST) {
  const requiredAssets = ['assets/docs.css', 'assets/favicon.svg', 'assets/og-default.png', 'assets/source-sans-3-latin.woff2'];
  for (const asset of requiredAssets) {
    if (!pages.has(asset)) throw new Error(`Generated documentation is missing ${asset}.`);
  }
  if (!Buffer.isBuffer(pages.get('assets/source-sans-3-latin.woff2'))) {
    throw new Error('Generated documentation font asset must be binary.');
  }
  const preview = pages.get('assets/og-default.png');
  if (!Buffer.isBuffer(preview)
    || !preview.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
    || preview.readUInt32BE(16) !== 1200
    || preview.readUInt32BE(20) !== 630) {
    throw new Error('Generated documentation social preview must be a 1200x630 PNG.');
  }
  const stylesheet = pages.get('assets/docs.css');
  if (!stylesheet.includes('Source Sans 3') || /Source Serif|@import|fonts\.googleapis\.com/i.test(stylesheet)) {
    throw new Error('Generated documentation stylesheet does not meet font requirements.');
  }

  for (const [file, content] of pages) {
    if (!file.endsWith('.html')) continue;
    if (!content.includes('<meta name="description"')
      || !content.includes('<link rel="canonical"')
      || !content.includes('<meta property="og:image"')
      || !content.includes('<meta property="og:image:type" content="image/png">')
      || !content.includes('<meta property="og:image:alt" content="Eventrunner documentation">')
      || !content.includes('<meta name="twitter:image:alt" content="Eventrunner documentation">')
      || !content.includes('<link rel="icon" type="image/svg+xml"')) {
      throw new Error(`Generated documentation page is missing metadata: ${file}`);
    }
    if (/https:\/\/centercoopmedia\.github\.io\/run-of-show\//i.test(content)) {
      throw new Error(`Generated documentation page retains a legacy Pages link: ${file}`);
    }
    for (const document of manifest) {
      const sourcePattern = document.source.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const rawSourceLink = new RegExp(`href="(?:\\.?\\.?/)*${sourcePattern}(?:#|")`, 'i');
      if (rawSourceLink.test(content)) {
        throw new Error(`Generated documentation page retains a Markdown source link: ${file}`);
      }
    }
  }
}

function writeFile(root, relativePath, content) {
  const destination = path.resolve(root, relativePath);
  if (!destination.startsWith(`${root}${path.sep}`)) {
    throw new Error(`Generated documentation file escapes output directory: ${relativePath}`);
  }
  fs.mkdirSync(path.dirname(destination), { recursive: true });
  fs.writeFileSync(destination, content);
}

function writePages({ root, pages }) {
  const destination = outputRoot(root);
  fs.rmSync(destination, { recursive: true, force: true });
  fs.mkdirSync(destination, { recursive: true });
  for (const [file, content] of pages) writeFile(destination, file, content);
}

function readGeneratedPages(root) {
  const directory = outputRoot(root);
  if (!fs.existsSync(directory)) return new Map();
  const pages = new Map();
  const walk = (currentDirectory) => {
    for (const entry of fs.readdirSync(currentDirectory, { withFileTypes: true })) {
      const source = path.join(currentDirectory, entry.name);
      if (entry.isDirectory()) walk(source);
      if (entry.isFile()) pages.set(path.relative(directory, source).split(path.sep).join('/'), fs.readFileSync(source));
    }
  };
  walk(directory);
  return pages;
}

function equivalentContent(expected, actual) {
  return Buffer.compare(Buffer.isBuffer(expected) ? expected : Buffer.from(expected), actual) === 0;
}

function checkPages({ root, pages }) {
  validateGeneratedPages(pages);
  const actualPages = readGeneratedPages(root);
  if (actualPages.size !== pages.size) {
    throw new Error('Stale generated documentation in docs/docs/. Run node scripts/build-pages.cjs --write.');
  }
  for (const [file, expected] of pages) {
    const actual = actualPages.get(file);
    if (!actual || !equivalentContent(expected, actual)) {
      throw new Error(`Stale generated documentation in docs/docs/: ${file}. Run node scripts/build-pages.cjs --write.`);
    }
  }
}

function runCli(argumentsList = process.argv.slice(2)) {
  if (argumentsList.length !== 1 || !['--write', '--check'].includes(argumentsList[0])) {
    throw new Error('Usage: node scripts/build-pages.cjs --write|--check');
  }
  const root = path.resolve(__dirname, '..');
  const pages = buildPages({ root });
  if (argumentsList[0] === '--write') {
    writePages({ root, pages });
    process.stdout.write(`Wrote ${pages.size} generated documentation files to docs/docs/.\n`);
    return;
  }
  checkPages({ root, pages });
  process.stdout.write('Generated documentation is current.\n');
}

if (require.main === module) {
  try {
    runCli();
  } catch (error) {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
  }
}

module.exports = {
  DOCS_COLORS,
  DOCS_MANIFEST,
  buildPages,
  checkPages,
  contrastRatio,
  descriptionFromMarkdown,
  documentHeadings,
  renderDocument,
  runCli,
  safeHref,
  slugify,
  validateManifest,
  validateMarkdown,
  writePages,
};
