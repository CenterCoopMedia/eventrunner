'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  collectFiles,
  extractVisibleFragments,
  findFindings,
  isExcluded,
} = require('./check-copy-style.cjs');

test('code extraction keeps strings and JSX text but removes comments and regexes', () => {
  const source = [
    "const label = 'This is robust copy.'; // robust in a comment",
    'const matcher = /regex-only-token/u; /* seamless in a block comment */',
    'const detail = `Use a full stop, not a long dash.`;',
    "const view = <p>Admin's copy stays visible.</p>;",
  ].join('\n');
  const visible = extractVisibleFragments(source, 'apps/web/src/example.jsx')
    .map(({ text }) => text)
    .join('\n');

  assert.match(visible, /This is robust copy\./u);
  assert.doesNotMatch(visible, /robust in a comment/u);
  assert.doesNotMatch(visible, /seamless in a block comment/u);
  assert.doesNotMatch(visible, /regex-only-token/u);
  assert.match(visible, /Admin's copy stays visible\./u);
});

test('an apostrophe in JSX text does not expose later JSX comments', () => {
  const source = [
    'const view = (',
    "  <section>Admin's copy.{/* A robust internal comment. */}<span>Save.</span></section>",
    ');',
  ].join('\n');

  assert.deepEqual(findFindings(source, 'apps/web/src/example.jsx'), []);
});

test('JSX text adjacent to an expression is checked', () => {
  const source = 'const view = <p>A robust {name} workflow.</p>;';
  const findings = findFindings(source, 'apps/web/src/example.jsx');

  assert.deepEqual(
    findings.map(({ line, rule, match }) => ({ line, rule, match })),
    [{ line: 1, rule: 'stock-promotion', match: 'robust' }],
  );
});

test('findFindings reports blocked phrases in string literals', () => {
  const source = [
    "const first = 'A seamless workflow.';",
    "const second = 'Select a style. Save the page.';",
  ].join('\n');
  const findings = findFindings(source, 'apps/web/src/example.js');

  assert.deepEqual(
    findings.map(({ line, rule }) => ({ line, rule })),
    [{ line: 1, rule: 'stock-promotion' }],
  );
});

test('operational unlock instructions are allowed while promotion remains blocked', () => {
  const source = [
    "const action = 'Unlock the account.';",
    "const claim = 'Unlock your full potential.';",
  ].join('\n');
  const findings = findFindings(source, 'apps/web/src/example.js');

  assert.deepEqual(
    findings.map(({ line, rule, match }) => ({ line, rule, match })),
    [{ line: 2, rule: 'stock-promotion', match: 'Unlock' }],
  );
});

test('escaped newlines do not advance reported source locations', () => {
  const source = "const message = 'First line\\nA robust workflow.';";
  const findings = findFindings(source, 'apps/web/src/example.js');

  assert.equal(findings.length, 1);
  assert.equal(findings[0].line, 1);
  assert.equal(findings[0].excerpt.includes('First line\\nA robust workflow.'), true);
});

test('curly apostrophes do not bypass rhetorical-frame checks', () => {
  const source = "const message = 'Whether you’re ready or not, continue.';";
  const findings = findFindings(source, 'apps/web/src/example.js');

  assert.equal(findings.length, 1);
  assert.equal(findings[0].rule, 'rhetorical-frame');
  assert.equal(findings[0].match, 'Whether you’re');
});

test('preset scanning includes rendered fields and excludes private notes', () => {
  const clean = JSON.stringify(
    {
      '$palette-note': 'A robust internal calibration note.',
      id: 'example',
      label: 'Example',
      summary: 'A direct layout description.',
      bestFor: 'Use this style for small events.',
      options: {
        headingFace: {
          label: 'Heading face',
          prompt: 'Choose the heading typeface.',
          default: 'one',
          choices: [
            {
              id: 'one',
              label: 'One',
              why: 'Uses one typeface for headings.',
            },
          ],
        },
      },
    },
    null,
    2,
  );
  assert.deepEqual(
    findFindings(clean, 'design/tokens/presets/example.json'),
    [],
  );

  const blocked = clean.replace(
    'A direct layout description.',
    'A robust layout description.',
  );
  const findings = findFindings(
    blocked,
    'design/tokens/presets/example.json',
  );
  assert.equal(findings.length, 1);
  assert.equal(findings[0].rule, 'stock-promotion');
});

test('preset field extraction does not depend on JSON property order', () => {
  const source = JSON.stringify(
    {
      bestFor: 'Use this style for small events.',
      summary: 'A direct layout description.',
      label: 'Example',
      options: {
        headingFace: {
          prompt: 'Choose a robust heading typeface.',
          choices: [
            {
              why: 'Uses one typeface for headings.',
              label: 'One',
              id: 'one',
            },
          ],
          label: 'Heading face',
          default: 'one',
        },
      },
      id: 'example',
    },
    null,
    2,
  );
  const findings = findFindings(
    source,
    'design/tokens/presets/example.json',
  );
  const promptLine = source.slice(0, source.indexOf('Choose a robust')).split('\n').length;

  assert.equal(findings.length, 1);
  assert.equal(findings[0].rule, 'stock-promotion');
  assert.equal(findings[0].match, 'robust');
  assert.equal(findings[0].line, promptLine);
});

test('current operator runbooks are part of the scan', () => {
  const files = collectFiles();
  for (const file of [
    'docs/DEPLOY_RUNBOOK.md',
    'docs/POSTMARK_PROVISIONING.md',
    'docs/EVENTBRITE_VERIFICATION.md',
  ]) {
    assert.equal(files.includes(file), true, file);
  }
});

test('generated preset documentation and fixtures are excluded', () => {
  assert.equal(isExcluded('design/tokens/presets/README.md'), true);
  assert.equal(
    isExcluded('functions/src/ticketing/providers/__fixtures__/README.md'),
    true,
  );
});

test('Markdown comments and code examples are not prose', () => {
  const source = [
    '<!-- robust internal note -->',
    'Use the saved style.',
    '```js',
    "const label = 'seamless';",
    '```',
    'Run `robust-command` after the build.',
  ].join('\n');

  assert.deepEqual(findFindings(source, 'docs/example.md'), []);
});
