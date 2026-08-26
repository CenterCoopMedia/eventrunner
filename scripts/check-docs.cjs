'use strict';

const fs = require('node:fs');
const path = require('node:path');

const REPO_ROOT = path.resolve(__dirname, '..');
const PAGES_BASE = '/eventrunner/';
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
const LOCAL_SCHEME_RE = /^[a-z][a-z\d+.-]*:/i;

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

function localTargetPath(sourcePath, target, root) {
  if (!target || target.startsWith('#') || LOCAL_SCHEME_RE.test(target)) return null;
  let decoded;
  try {
    decoded = decodeURIComponent(target);
  } catch {
    decoded = target;
  }
  const withoutFragment = decoded.split('#', 1)[0].split('?', 1)[0];
  if (!withoutFragment) return null;
  let candidate;
  if (withoutFragment.startsWith('/')) {
    const pagesBaseWithoutSlash = PAGES_BASE.slice(0, -1);
    if (withoutFragment !== pagesBaseWithoutSlash && !withoutFragment.startsWith(PAGES_BASE)) {
      return { path: withoutFragment, error: `unsupported root-relative path (expected ${PAGES_BASE})` };
    }
    const pagesPath = withoutFragment === pagesBaseWithoutSlash
      ? ''
      : withoutFragment.slice(PAGES_BASE.length);
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

function checkLocalTargets(sourcePath, targets, root, htmlReferences = false) {
  const errors = [];
  for (const target of targets) {
    const resolved = localTargetPath(sourcePath, target, root);
    if (!resolved) continue;
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

function checkMarkdownLinks(root) {
  const errors = [];
  for (const relativePath of listFiles(root, (file) => /\.mdx?$/.test(file))) {
    const sourcePath = path.join(root, relativePath);
    const text = fs.readFileSync(sourcePath, 'utf8');
    errors.push(...checkLocalTargets(sourcePath, extractMarkdownTargets(text), root));
  }
  return errors;
}

function checkPages(root) {
  const pagePath = path.join(root, 'docs', 'index.html');
  if (!fs.existsSync(pagePath)) return ['docs/index.html: missing Pages entrypoint'];
  const pagePaths = listFiles(root, (file) => {
    const relativePath = path.relative(root, file).replaceAll(path.sep, '/');
    return relativePath.startsWith('docs/') && relativePath.endsWith('.html');
  });
  const text = fs.readFileSync(pagePath, 'utf8');
  const required = [
    ['doctype', /^<!doctype html>/i],
    ['language', /<html\b[^>]*\blang=['"][^'"]+['"]/i],
    ['viewport', /<meta\b[^>]*name=['"]viewport['"]/i],
    ['title', /<title>[^<]+<\/title>/i],
    ['description', /<meta\b[^>]*name=['"]description['"]/i],
    ['favicon', /<link\b[^>]*rel=['"]icon['"]/i],
  ];
  const errors = required
    .filter(([, expression]) => !expression.test(text))
    .map(([name]) => `docs/index.html: missing ${name}`);
  for (const relativePath of pagePaths) {
    const currentPath = path.join(root, relativePath);
    const currentText = currentPath === pagePath ? text : fs.readFileSync(currentPath, 'utf8');
    errors.push(...checkLocalTargets(currentPath, extractTargets(currentText, HTML_REFERENCE_RE), root, true));
  }
  return errors;
}

function checkRepository(root = REPO_ROOT) {
  return [...checkMarkdownLinks(root), ...checkPages(root)];
}

function main(root = REPO_ROOT) {
  const errors = checkRepository(root);
  if (errors.length > 0) {
    console.error('documentation checks failed:');
    for (const error of errors) console.error(`- ${error}`);
    return 1;
  }
  console.log('documentation checks passed');
  return 0;
}

if (require.main === module) process.exitCode = main();

module.exports = {
  checkMarkdownLinks,
  checkPages,
  checkRepository,
  extractTargets,
  extractMarkdownTargets,
  localTargetPath,
  main,
};
