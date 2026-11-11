'use strict';

const { LEGACY_PAGES, pagesInOrder } = require('./pages-manifest.cjs');

// Shared by the address rewriter, link checker and upload staging step.
// Add a new marketing page here before linking to it from a served page.
const LANDING_PAGES = Object.freeze([
  'index.html',
  'features/index.html',
  'how-it-works/index.html',
  'videos/index.html',
  'project/index.html',
  'support/index.html',
  'privacy/index.html',
  'terms-of-service/index.html',
]);

const PUBLIC_HTML_FILES = Object.freeze([
  ...LANDING_PAGES,
  'docs/index.html',
  ...pagesInOrder().map((page) => `docs/${page.route}index.html`),
  ...LEGACY_PAGES.map((page) => `docs/${page.route}index.html`),
]);
const HTML_FILES = new Set(PUBLIC_HTML_FILES);
const ROOT_FILES = new Set([
  '.nojekyll', 'CNAME', 'robots.txt', 'sitemap.xml',
  'tokens.css', 'styles.css', 'docs.css',
  'site.js', 'docs-ui.js', 'scroll-regions.js',
  'favicon.svg', 'favicon-32.png', 'apple-touch-icon.png',
  'og-default.png', 'social-preview.png',
]);

/** Whether a path relative to docs/ belongs in the public website artifact. */
function isPublicFile(relativePath) {
  const name = String(relativePath).replaceAll('\\', '/');
  if (!name || name.startsWith('/') || name.split('/').some((part) => part === '..' || part === '.')) return false;
  if (ROOT_FILES.has(name) || HTML_FILES.has(name)) return true;
  if (name.split('/').some((part) => part.startsWith('.'))) return false;
  // The demo is a separate generated application, built immediately before
  // staging. Do not copy any other arbitrary directory recursively.
  if (name.startsWith('demo/')) return true;
  if (/^fonts\/[^/]+\.(?:woff2?|ttf|otf)$/.test(name)) return true;
  if (/^fonts\/(?:README\.md|[^/]*(?:LICENSE|OFL)[^/]*\.txt)$/.test(name)) return true;
  if (/^assets\/.+\.(?:svg|png|webp|jpe?g|gif|avif)$/.test(name)) return true;
  if (/^videos\/[^/]+\.(?:mp4|webm|png|webp|vtt)$/.test(name)) return true;
  return /^videos\/[^/]+-transcript\.md$/.test(name);
}

module.exports = { LANDING_PAGES, PUBLIC_HTML_FILES, isPublicFile };
