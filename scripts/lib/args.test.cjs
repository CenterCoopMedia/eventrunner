'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { parseArgv, unknownFlags } = require('./args.cjs');

test('boolean flags, value flags, and --flag=value', () => {
  const args = parseArgv(['--force', '--answers', 'a.json', '--seeded-threshold=3'], {
    withValue: ['answers', 'seeded-threshold'],
  });
  assert.equal(args.force, true);
  assert.equal(args.answers, 'a.json');
  assert.equal(args['seeded-threshold'], '3');
});

test('repeatable flags collect in argv order', () => {
  const args = parseArgv(['--admin', 'a@example.org', '--admin', 'b@example.org'], {
    repeatable: ['admin'],
  });
  assert.deepEqual(args.admin, ['a@example.org', 'b@example.org']);
});

test('a value flag followed by another flag does not swallow it', () => {
  // `--answers --force` is a typo, not a file named "--force": consuming
  // the next flag as the value would silently drop --force.
  const args = parseArgv(['--answers', '--force'], { withValue: ['answers'] });
  assert.equal(args.answers, '');
  assert.equal(args.force, true);
});

test('positionals collect under _', () => {
  const args = parseArgv(['one', '--force', 'two']);
  assert.deepEqual(args._, ['one', 'two']);
});

test('unknownFlags reports typos and ignores positionals', () => {
  const args = parseArgv(['--anwsers', 'x.json', 'positional'], { withValue: ['anwsers'] });
  assert.deepEqual(unknownFlags(args, ['answers', 'force']), ['anwsers']);
});
