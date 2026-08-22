'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { checkRange, main } = require('./check-dco.cjs');

const SEP = '\x00\x00';

function fakeLog(records) {
  return () => records.map((r) => `${r.sha}\x00${r.body}`).join(SEP) + SEP;
}

test('checkRange: every commit signed off', () => {
  const run = fakeLog([
    { sha: 'a'.repeat(40), body: 'Add thing\n\nSigned-off-by: A Dev <a@example.org>' },
    { sha: 'b'.repeat(40), body: 'Fix thing\n\nSigned-off-by: A Dev <a@example.org>' },
  ]);
  const commits = checkRange('base..head', run);
  assert.equal(commits.length, 2);
  assert.ok(commits.every((c) => c.signedOff));
});

test('checkRange: flags a commit with no trailer', () => {
  const run = fakeLog([
    { sha: 'a'.repeat(40), body: 'Add thing\n\nSigned-off-by: A Dev <a@example.org>' },
    { sha: 'b'.repeat(40), body: 'Forgot to sign off' },
  ]);
  const commits = checkRange('base..head', run);
  assert.equal(commits.filter((c) => !c.signedOff).length, 1);
  assert.equal(commits[1].signedOff, false);
});

test('checkRange: trailer must look like a real name+email, not just the label', () => {
  const run = fakeLog([
    { sha: 'a'.repeat(40), body: 'Sloppy\n\nSigned-off-by: nope' },
  ]);
  const commits = checkRange('base..head', run);
  assert.equal(commits[0].signedOff, false);
});

test('main: exits 2 and reports the bad range when git cannot read it', () => {
  const errs = [];
  const orig = console.error;
  console.error = (...a) => errs.push(a.join(' '));
  try {
    const code = main(['not-a-real-sha', 'also-not-a-real-sha']);
    assert.equal(code, 2);
    assert.match(errs.join('\n'), /Could not read the commit range/);
  } finally {
    console.error = orig;
  }
});

test('main: usage error when arguments are missing', () => {
  const errs = [];
  const orig = console.error;
  console.error = (...a) => errs.push(a.join(' '));
  try {
    const code = main([]);
    assert.equal(code, 2);
    assert.match(errs.join('\n'), /Usage:/);
  } finally {
    console.error = orig;
  }
});
