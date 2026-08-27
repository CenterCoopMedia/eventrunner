#!/usr/bin/env node
'use strict';

const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '../..');
const file = path.join(ROOT, '.github/workflows/ci.yml');
const source = fs.readFileSync(file, 'utf8');
const before = `      - name: Run ESLint\n        run: npm run lint\n`;
const after = `      - name: Run ESLint\n        run: npm run lint\n      - name: Check user-facing copy\n        run: npm run check:copy\n`;
const first = source.indexOf(before);

if (first === -1) {
  if (source.includes('      - name: Check user-facing copy\n')) {
    console.log('The CI copy step is already present.');
    process.exit(0);
  }
  throw new Error('The CI lint step was not found.');
}
if (source.indexOf(before, first + before.length) !== -1) {
  throw new Error('The CI lint step appears more than once.');
}

fs.writeFileSync(
  file,
  `${source.slice(0, first)}${after}${source.slice(first + before.length)}`,
);
console.log('Prepared .github/workflows/ci.yml.');
