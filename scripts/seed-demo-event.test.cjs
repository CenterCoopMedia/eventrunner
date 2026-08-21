'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { isDemoProject } = require('./seed-demo-event.cjs');

test('a delimited demo component identifies a demo project', () => {
  for (const id of ['demo-run-of-show', 'run_of_show_demo', 'demo', 'client.demo.site', 'DEMO-Run']) {
    assert.equal(isDemoProject(id), true, `${id} should count as a demo project`);
  }
});

test('a project that merely contains the letters "demo" does not', () => {
  // The guard exists to stop placeholder speakers being published on a
  // live site; a substring test would have waved this one through.
  for (const id of ['democratic-media-prod', 'demography-summit', 'moderndemo1']) {
    assert.equal(isDemoProject(id), false, `${id} must not count as a demo project`);
  }
});

test('an explicitly configured demo project id is matched exactly', () => {
  assert.equal(isDemoProject('showcase-instance', 'showcase-instance'), true);
  assert.equal(isDemoProject('demo-run-of-show', 'showcase-instance'), false,
    'a configured id replaces the heuristic rather than adding to it');
});

test('a missing or blank project id is never a demo project', () => {
  assert.equal(isDemoProject(''), false);
  assert.equal(isDemoProject(undefined), false);
});
