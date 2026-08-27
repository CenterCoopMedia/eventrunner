'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  findFindings,
  stripCodeComments,
  textToScan,
} = require('./check-copy-style.cjs');

test('stripCodeComments removes comments and preserves strings and lines', () => {
  const source = [
    "const label = 'This is robust copy.'; // robust in a comment",
    '/* seamless in a block comment */',
    'const detail = `Use a full stop — not a long dash.`;',
  ].join('\n');
  const stripped = stripCodeComments(source);

  assert.match(stripped, /This is robust copy\./u);
  assert.doesNotMatch(stripped, /robust in a comment/u);
  assert.doesNotMatch(stripped, /seamless in a block comment/u);
  assert.match(stripped, /Use a full stop — not a long dash\./u);
  assert.equal(stripped.split('\n').length, source.split('\n').length);
});

test('findFindings reports blocked phrases and punctuation with source lines', () => {
  const source = [
    "const first = 'A seamless workflow.';",
    "const second = 'Choose a style — then save it.';",
  ].join('\n');
  const findings = findFindings(source, 'apps/web/src/example.js');

  assert.deepEqual(
    findings.map(({ line, rule }) => ({ line, rule })),
    [
      { line: 1, rule: 'stock-promotion' },
      { line: 2, rule: 'long-dash' },
    ],
  );
});

test('findFindings accepts direct operational copy', () => {
  const source = "const message = 'Select a style. Save the page.';";
  assert.deepEqual(findFindings(source, 'apps/web/src/example.js'), []);
});

test('textToScan removes HTML comments but keeps visible text', () => {
  const source = '<!-- robust internal note -->\n<p>Use the saved style.</p>';
  const scanned = textToScan(source, 'docs/index.html');
  assert.doesNotMatch(scanned, /robust internal note/u);
  assert.match(scanned, /Use the saved style/u);
});
