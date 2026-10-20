'use strict';

const fs = require('node:fs');
const path = require('node:path');

const { pagesSite } = require('./lib/pages-site.cjs');

const REPO_ROOT = path.resolve(__dirname, '..');
// Local task ledgers and agent state are not versioned project documentation.
// Ignoring them keeps a developer checkout's result aligned with the clean
// checkout that the documentation job evaluates in CI.
const SKIP_DIRS = new Set([
  '.claude',
  '.git',
  '.worktrees',
  'coverage',
  'dist',
  'node_modules',
  'tasks',
]);
const MARKDOWN_LINK_RE = /!?\[[^\]]*\]\(\s*(?:<([^>\n]+)>|([^\s)]+))/g;
const MARKDOWN_REFERENCE_DEFINITION_RE = /^[ \t]{0,3}\[([^\]\n]+)\]:\s*(?:<([^>\n]+)>|(\S+))/gm;
const MARKDOWN_REFERENCE_USE_RE = /!?\[([^\]\n]+)\](?:\[([^\]\n]*)\])?/g;
const HTML_REFERENCE_RE = /\b(?:href|src)=['"]([^'"]+)['"]/gi;
const URL_SCHEME_RE = /^([a-z][a-z\d+.-]*:)/i;
const SAFE_EXTERNAL_SCHEMES = new Set(['http:', 'https:', 'mailto:', 'tel:']);
const GENERATED_DOCS_PREFIX = 'docs/docs/';
// Built when Pages is deployed (.github/workflows/pages.yml), never committed.
// A link into it is checked only when a local build is present; the Pages
// workflow runs this checker after it builds the demo.
const BUILT_AT_DEPLOY_DIRS = ['docs/demo'];

const BASE_PAGE_METADATA = [
  ['doctype', /^<!doctype html>/i],
  ['language', /<html\b[^>]*\blang=['"][^'"]+['"]/i],
  ['viewport', /<meta\b[^>]*name=['"]viewport['"]/i],
  ['title', /<title>[^<]+<\/title>/i],
  // A description tag with an empty `content` is the same as no description
  // to every crawler that reads it, so the check requires the content too.
  ['description', /<meta\b(?=[^>]*\bname=['"]description['"])(?=[^>]*\bcontent=['"][^'"]+['"])[^>]*>/i],
  ['favicon', /<link\b(?=[^>]*\brel=['"]icon['"])(?=[^>]*\btype=['"]image\/svg\+xml['"])(?=[^>]*\bhref=['"][^'"]+\.svg(?:[?#][^'"]*)?['"])[^>]*>/i],
];

// A social card renders before the image is fetched, so the declared type and
// dimensions are what most previews lay out against; the alt text is what a
// reader using a screen reader gets instead of the card.
const SOCIAL_IMAGE_METADATA = [
  ['og:image:type', /<meta\b(?=[^>]*\bproperty=['"]og:image:type['"])(?=[^>]*\bcontent=['"]image\/png['"])[^>]*>/i],
  ['og:image:width', /<meta\b(?=[^>]*\bproperty=['"]og:image:width['"])(?=[^>]*\bcontent=['"]1200['"])[^>]*>/i],
  ['og:image:height', /<meta\b(?=[^>]*\bproperty=['"]og:image:height['"])(?=[^>]*\bcontent=['"]630['"])[^>]*>/i],
  ['og:image:alt', /<meta\b(?=[^>]*\bproperty=['"]og:image:alt['"])(?=[^>]*\bcontent=['"][^'"]+['"])[^>]*>/i],
];

const GENERATED_PAGE_METADATA = [
  ['canonical', /<link\b(?=[^>]*\brel=['"]canonical['"])(?=[^>]*\bhref=['"][^'"]+['"])[^>]*>/i],
  ['og:title', /<meta\b(?=[^>]*\bproperty=['"]og:title['"])(?=[^>]*\bcontent=['"][^'"]+['"])[^>]*>/i],
  ['og:description', /<meta\b(?=[^>]*\bproperty=['"]og:description['"])(?=[^>]*\bcontent=['"][^'"]+['"])[^>]*>/i],
  ['og:type', /<meta\b(?=[^>]*\bproperty=['"]og:type['"])(?=[^>]*\bcontent=['"][^'"]+['"])[^>]*>/i],
  ['og:url', /<meta\b(?=[^>]*\bproperty=['"]og:url['"])(?=[^>]*\bcontent=['"][^'"]+['"])[^>]*>/i],
  ['og:image', /<meta\b(?=[^>]*\bproperty=['"]og:image['"])(?=[^>]*\bcontent=['"][^'"]+['"])[^>]*>/i],
  ...SOCIAL_IMAGE_METADATA,
  ['twitter:card', /<meta\b(?=[^>]*\bname=['"]twitter:card['"])(?=[^>]*\bcontent=['"][^'"]+['"])[^>]*>/i],
  ['twitter:title', /<meta\b(?=[^>]*\bname=['"]twitter:title['"])(?=[^>]*\bcontent=['"][^'"]+['"])[^>]*>/i],
  ['twitter:description', /<meta\b(?=[^>]*\bname=['"]twitter:description['"])(?=[^>]*\bcontent=['"][^'"]+['"])[^>]*>/i],
  ['twitter:image', /<meta\b(?=[^>]*\bname=['"]twitter:image['"])(?=[^>]*\bcontent=['"][^'"]+['"])[^>]*>/i],
  ['twitter:image:alt', /<meta\b(?=[^>]*\bname=['"]twitter:image:alt['"])(?=[^>]*\bcontent=['"][^'"]+['"])[^>]*>/i],
];

// The landing page is hand-written, so nothing but build-pages' address move
// touches its head. These are the tags a shared link actually needs and the
// one link that has to reach the documentation site — the two things easiest
// to lose in an edit. The absolute URLs must name the configured site address
// (scripts/lib/pages-site.cjs), so a site deployed for one address never
// tells a crawler it lives at another.
function landingPageMetadata(site) {
  const url = escapeRegExp(site.url);
  return [
    ['canonical', new RegExp(`<link\\b(?=[^>]*\\brel=['"]canonical['"])(?=[^>]*\\bhref=['"]${url}['"])[^>]*>`, 'i')],
    ['og:title', /<meta\b(?=[^>]*\bproperty=['"]og:title['"])(?=[^>]*\bcontent=['"][^'"]+['"])[^>]*>/i],
    ['og:description', /<meta\b(?=[^>]*\bproperty=['"]og:description['"])(?=[^>]*\bcontent=['"][^'"]+['"])[^>]*>/i],
    ['og:type', /<meta\b(?=[^>]*\bproperty=['"]og:type['"])(?=[^>]*\bcontent=['"]website['"])[^>]*>/i],
    ['og:url', new RegExp(`<meta\\b(?=[^>]*\\bproperty=['"]og:url['"])(?=[^>]*\\bcontent=['"]${url}['"])[^>]*>`, 'i')],
    ['og:image', new RegExp(`<meta\\b(?=[^>]*\\bproperty=['"]og:image['"])(?=[^>]*\\bcontent=['"]${url}[^'"]+\\.png['"])[^>]*>`, 'i')],
    ...SOCIAL_IMAGE_METADATA,
    ['twitter:card', /<meta\b(?=[^>]*\bname=['"]twitter:card['"])(?=[^>]*\bcontent=['"]summary_large_image['"])[^>]*>/i],
    ['twitter:title', /<meta\b(?=[^>]*\bname=['"]twitter:title['"])(?=[^>]*\bcontent=['"][^'"]+['"])[^>]*>/i],
    ['twitter:description', /<meta\b(?=[^>]*\bname=['"]twitter:description['"])(?=[^>]*\bcontent=['"][^'"]+['"])[^>]*>/i],
    ['twitter:image', new RegExp(`<meta\\b(?=[^>]*\\bname=['"]twitter:image['"])(?=[^>]*\\bcontent=['"]${url}[^'"]+\\.png['"])[^>]*>`, 'i')],
    ['twitter:image:alt', /<meta\b(?=[^>]*\bname=['"]twitter:image:alt['"])(?=[^>]*\bcontent=['"][^'"]+['"])[^>]*>/i],
    ['documentation entry point', new RegExp(`<a\\b[^>]*\\bhref=['"](?:\\./|${escapeRegExp(site.base)})docs/['"][^>]*>`, 'i')],
  ];
}

// A generated page states its own address and its social card's. Both must
// sit under the configured site address: a docs/docs tree rendered for another
// address (PAGES_BASE_URL set, build-pages not run) fails here before deploy.
function generatedPageAddress(site) {
  const docsUrl = escapeRegExp(site.docsUrl);
  return [
    ['canonical under the site address', new RegExp(`<link\\b(?=[^>]*\\brel=['"]canonical['"])(?=[^>]*\\bhref=['"]${docsUrl}[^'"]*['"])[^>]*>`, 'i')],
    ['og:url under the site address', new RegExp(`<meta\\b(?=[^>]*\\bproperty=['"]og:url['"])(?=[^>]*\\bcontent=['"]${docsUrl}[^'"]*['"])[^>]*>`, 'i')],
    ['og:image under the site address', new RegExp(`<meta\\b(?=[^>]*\\bproperty=['"]og:image['"])(?=[^>]*\\bcontent=['"]${escapeRegExp(site.url)}[^'"]+['"])[^>]*>`, 'i')],
  ];
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function listFiles(root, predicate, relativeRoot = root) {
  const files = [];
  for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      if (SKIP_DIRS.has(entry.name)) continue;
      files.push(...listFiles(path.join(root, entry.name), predicate, relativeRoot));
      continue;
    }
    const fullPath = path.join(root, entry.name);
    if (predicate(fullPath)) files.push(path.relative(relativeRoot, fullPath));
  }
  return files.sort();
}

function localTargetPath(sourcePath, target, root, pagesBase = pagesSite().base) {
  if (!target || target.startsWith('#')) return null;
  let decoded;
  try {
    decoded = decodeURIComponent(target);
  } catch {
    decoded = target;
  }
  const scheme = decoded.match(URL_SCHEME_RE)?.[1].toLowerCase();
  if (scheme) {
    if (SAFE_EXTERNAL_SCHEMES.has(scheme)) return null;
    return { path: target, error: `unsupported URL scheme: ${scheme}` };
  }
  const withoutFragment = decoded.split('#', 1)[0].split('?', 1)[0];
  if (!withoutFragment) return null;
  let candidate;
  if (withoutFragment.startsWith('/')) {
    // A root-relative path is a URL on the published site: the part after the
    // site's path base is a path under docs/. With a base of `/` (a custom
    // domain) every root-relative path is one.
    const pagesBaseWithoutSlash = pagesBase.slice(0, -1);
    if (withoutFragment !== pagesBaseWithoutSlash && !withoutFragment.startsWith(pagesBase)) {
      return { path: withoutFragment, error: `unsupported root-relative path (expected ${pagesBase})` };
    }
    const pagesPath = withoutFragment === pagesBaseWithoutSlash
      ? ''
      : withoutFragment.slice(pagesBase.length);
    candidate = path.resolve(root, 'docs', pagesPath);
  } else {
    candidate = path.resolve(
      root,
      path.relative(root, sourcePath).split(path.sep).slice(0, -1).concat(withoutFragment).join(path.sep),
    );
  }
  const relative = path.relative(root, candidate);
  if (relative.startsWith('..') || path.isAbsolute(relative)) {
    return { path: candidate, error: 'target escapes the repository' };
  }
  return {
    path: candidate,
    pagesRoute: withoutFragment.startsWith('/'),
  };
}

function extractTargets(text, expression) {
  const targets = [];
  for (const match of text.matchAll(expression)) {
    targets.push(match[1] || match[2]);
  }
  return targets;
}

function normalizeReferenceLabel(label) {
  return label.trim().replace(/\s+/g, ' ').toLowerCase();
}

function extractMarkdownTargets(text) {
  const targets = extractTargets(text, MARKDOWN_LINK_RE);
  const definitions = new Map();
  for (const match of text.matchAll(MARKDOWN_REFERENCE_DEFINITION_RE)) {
    definitions.set(normalizeReferenceLabel(match[1]), match[2] || match[3]);
  }
  const content = text.replace(MARKDOWN_REFERENCE_DEFINITION_RE, '');
  for (const match of content.matchAll(MARKDOWN_REFERENCE_USE_RE)) {
    const referenceLabel = match[2] === undefined ? match[1] : match[2] || match[1];
    const target = definitions.get(normalizeReferenceLabel(referenceLabel));
    if (target) targets.push(target);
  }
  return targets;
}

function displayPath(root, sourcePath) {
  return path.relative(root, sourcePath).replaceAll(path.sep, '/');
}

function isUnbuiltDeployTarget(candidate, root) {
  return BUILT_AT_DEPLOY_DIRS.some((dir) => {
    const builtRoot = path.join(root, dir);
    const relative = path.relative(builtRoot, candidate);
    const inside = !relative.startsWith('..') && !path.isAbsolute(relative);
    return inside && !fs.existsSync(path.join(builtRoot, 'index.html'));
  });
}

function checkLocalTargets(sourcePath, targets, root, htmlReferences = false, pagesBase = pagesSite().base) {
  const errors = [];
  for (const target of targets) {
    const resolved = localTargetPath(sourcePath, target, root, pagesBase);
    if (!resolved) continue;
    if (!resolved.error && isUnbuiltDeployTarget(resolved.path, root)) continue;
    if (resolved.error) {
      errors.push(`${displayPath(root, sourcePath)}: ${target} (${resolved.error})`);
    } else {
      const withoutFragment = target.split('#', 1)[0].split('?', 1)[0];
      const directoryRoute = htmlReferences && withoutFragment.endsWith('/');
      if (!targetExists(resolved.path, resolved.pagesRoute || directoryRoute)) {
        errors.push(`${displayPath(root, sourcePath)}: missing ${target}`);
      }
    }
  }
  return errors;
}

function targetExists(candidate, pagesRoute = false) {
  if (!fs.existsSync(candidate)) return false;
  return !pagesRoute || !fs.statSync(candidate).isDirectory() || fs.existsSync(path.join(candidate, 'index.html'));
}

function checkMarkdownLinks(root, site = pagesSite()) {
  const errors = [];
  for (const relativePath of listFiles(root, (file) => /\.mdx?$/.test(file))) {
    const sourcePath = path.join(root, relativePath);
    const text = fs.readFileSync(sourcePath, 'utf8');
    errors.push(...checkLocalTargets(sourcePath, extractMarkdownTargets(text), root, false, site.base));
  }
  return errors;
}

function checkPages(root, site = pagesSite()) {
  const pagePath = path.join(root, 'docs', 'index.html');
  if (!fs.existsSync(pagePath)) return ['docs/index.html: missing Pages entrypoint'];
  const pagePaths = listFiles(root, (file) => {
    const relativePath = path.relative(root, file).replaceAll(path.sep, '/');
    return relativePath.startsWith('docs/') && relativePath.endsWith('.html');
  });
  const text = fs.readFileSync(pagePath, 'utf8');
  const errors = BASE_PAGE_METADATA
    .concat(landingPageMetadata(site))
    .filter(([, expression]) => !expression.test(text))
    .map(([name]) => `docs/index.html: missing ${name}`);
  for (const relativePath of pagePaths) {
    const currentPath = path.join(root, relativePath);
    const currentText = currentPath === pagePath ? text : fs.readFileSync(currentPath, 'utf8');
    const publicPath = relativePath.replaceAll(path.sep, '/');
    // This deliberately scopes the generated-page policy to docs/docs. The
    // demo's public metadata is owned by the dedicated redesign tracked in #109.
    if (publicPath.startsWith(GENERATED_DOCS_PREFIX)) {
      errors.push(...BASE_PAGE_METADATA
        .concat(GENERATED_PAGE_METADATA, generatedPageAddress(site))
        .filter(([, expression]) => !expression.test(currentText))
        .map(([name]) => `${publicPath}: missing ${name}`));
    }
    errors.push(...checkLocalTargets(currentPath, extractTargets(currentText, HTML_REFERENCE_RE), root, true, site.base));
  }
  return errors;
}

function checkRepository(root = REPO_ROOT, site = pagesSite()) {
  return [...checkMarkdownLinks(root, site), ...checkPages(root, site)];
}

function main(root = REPO_ROOT) {
  let site;
  try {
    site = pagesSite();
  } catch (error) {
    console.error(`documentation checks failed: ${error.message}`);
    return 2;
  }
  const errors = checkRepository(root, site);
  if (errors.length > 0) {
    console.error('documentation checks failed:');
    for (const error of errors) console.error(`- ${error}`);
    return 1;
  }
  console.log(`documentation checks passed for ${site.url}`);
  return 0;
}

if (require.main === module) process.exitCode = main();

module.exports = {
  checkMarkdownLinks,
  checkPages,
  checkRepository,
  extractTargets,
  extractMarkdownTargets,
  isUnbuiltDeployTarget,
  localTargetPath,
  main,
};
