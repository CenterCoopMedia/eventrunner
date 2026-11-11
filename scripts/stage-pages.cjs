#!/usr/bin/env node
'use strict';

/**
 * Build the upload artifact from reviewed public paths, not the docs source
 * directory. ADRs, runbooks, plans and evidence remain available on GitHub.
 * Run after build-pages and build-demo. No dependencies or network access.
 */
const fs = require('node:fs');
const path = require('node:path');
const { PUBLIC_HTML_FILES, isPublicFile } = require('./lib/pages-public-files.cjs');

const ROOT = path.resolve(__dirname, '..');

function collectPublicFiles(source, current = source) {
  const files = [];
  for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
    const fullPath = path.join(current, entry.name);
    const relative = path.relative(source, fullPath).replaceAll(path.sep, '/');
    if (entry.isSymbolicLink()) {
      // A directory symlink can hide its type from the allowlist. Refuse all
      // symlinks rather than copying anything outside the source directory.
      throw new Error(`Pages staging refuses a symbolic link: ${relative}`);
    }
    if (entry.isDirectory()) {
      files.push(...collectPublicFiles(source, fullPath));
    } else if (entry.isFile() && isPublicFile(relative)) {
      files.push(relative);
    }
  }
  return files.sort();
}

function stagePages({ root = ROOT } = {}) {
  const source = path.join(root, 'docs');
  const output = path.join(root, 'dist', 'pages');
  const files = collectPublicFiles(source);
  const available = new Set(files);
  // Validate before removing an earlier artifact. An incomplete build must
  // never replace a complete staging directory with a partial website.
  const missing = [...PUBLIC_HTML_FILES, 'demo/index.html'].filter((file) => !available.has(file));
  if (missing.length) throw new Error(`Pages build is incomplete: ${missing.join(', ')}`);
  fs.rmSync(output, { recursive: true, force: true });
  fs.mkdirSync(output, { recursive: true });
  for (const file of files) {
    const destination = path.join(output, file);
    fs.mkdirSync(path.dirname(destination), { recursive: true });
    fs.copyFileSync(path.join(source, file), destination);
  }
  return { output, files };
}

function main() {
  try {
    const { output, files } = stagePages();
    console.log(`Staged ${files.length} public files in ${path.relative(ROOT, output)}`);
    return 0;
  } catch (error) {
    console.error(`Pages staging failed: ${error.message}`);
    return 1;
  }
}

if (require.main === module) process.exitCode = main();

module.exports = { collectPublicFiles, main, stagePages };
