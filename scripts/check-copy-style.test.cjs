'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  findFindings,
  isExcluded,
  isLongDashScope,
  maskCodeToVisibleText,
  textToScan,
} = require('./check-copy-style.cjs');

test('maskCodeToVisibleText keeps strings and JSX text but removes comments and regexes', () => {
  const source = [
    "const label = 'This is robust copy.'; // robust in a comment",
    'const matcher = /regex-only-token/u; /* seamless in a block comment */',
    'const detail = `Use a full stop — not a long dash.`;',
    'const view = <p>Choose a style — then save it.</p>;',
  ].join('\n');
  const visible = maskCodeToVisibleText(source);

  assert.match(visible, /This is robust copy\./u);
  assert.doesNotMatch(visible, /robust in a comment/u);
  assert.doesNotMatch(visible, /seamless in a block comment/u);
  assert.doesNotMatch(visible, /regex-only-token/u);
  assert.match(visible, /Use a full stop — not a long dash\./u);
  assert.match(visible, /Choose a style — then save it\./u);
  assert.equal(visible.split('\n').length, source.split('\n').length);
});

test('findFindings reports blocked phrases and punctuation on audience-facing code lines', () => {
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

test('a standalone long dash placeholder is not treated as prose', () => {
  const source = "const missingValue = '—';";
  assert.deepEqual(findFindings(source, 'apps/web/src/example.js'), []);
});

test('long-dash enforcement is limited to current audience-facing surfaces', () => {
  assert.equal(isLongDashScope('apps/web/src/pages/Home.jsx'), true);
  assert.equal(isLongDashScope('design/tokens/presets/atlas.json'), true);
  assert.equal(isLongDashScope('docs/index.html'), true);
  assert.equal(isLongDashScope('docs/DEPLOY_RUNBOOK.md'), false);
  assert.equal(isLongDashScope('README.md'), false);

  const internal = 'The build runs here — then deploys.';
  assert.deepEqual(findFindings(internal, 'README.md'), []);
  assert.equal(
    findFindings(internal, 'design/tokens/presets/atlas.json')[0].rule,
    'long-dash',
  );
});

test('literal file parsing language is not a design metaphor', () => {
  const source = "const message = 'That file could not be read as text.';";
  assert.deepEqual(findFindings(source, 'apps/web/src/example.js'), []);
});

test('generated preset documentation and fixtures are excluded', () => {
  assert.equal(isExcluded('design/tokens/presets/README.md'), true);
  assert.equal(
    isExcluded('functions/src/ticketing/providers/__fixtures__/README.md'),
    true,
  );
  assert.deepEqual(
    findFindings(
      'A seamless layout — with a story that reads as authority.',
      'design/tokens/presets/README.md',
    ),
    [],
  );
});

test('textToScan removes HTML comments but keeps visible text', () => {
  const source = '<!-- robust internal note -->\n<p>Use the saved style.</p>';
  const scanned = textToScan(source, 'docs/index.html');
  assert.doesNotMatch(scanned, /robust internal note/u);
  assert.match(scanned, /Use the saved style/u);
});
