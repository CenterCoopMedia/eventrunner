'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  observeScrollRegion,
  updateScrollRegion,
} = require('../docs/scroll-regions.js');

function element({ clientWidth = 100, scrollWidth = 100, label = 'Table' } = {}) {
  const attributes = new Map([['data-scroll-label', label]]);
  return {
    clientWidth,
    scrollWidth,
    firstElementChild: {},
    previousElementSibling: null,
    querySelector: () => null,
    setAttribute: (name, value) => attributes.set(name, String(value)),
    getAttribute: (name) => attributes.get(name) ?? null,
    hasAttribute: (name) => attributes.has(name),
    removeAttribute: (name) => attributes.delete(name),
  };
}

test('updateScrollRegion adds semantics only while content overflows', () => {
  const node = element({ clientWidth: 100, scrollWidth: 200, label: 'Code example' });
  assert.equal(updateScrollRegion(node), true);
  assert.equal(node.getAttribute('tabindex'), '0');
  assert.equal(node.getAttribute('role'), 'region');
  assert.equal(node.getAttribute('aria-label'), 'Code example');

  node.scrollWidth = 100;
  assert.equal(updateScrollRegion(node), false);
  assert.equal(node.getAttribute('tabindex'), null);
  assert.equal(node.getAttribute('role'), null);
  assert.equal(node.getAttribute('aria-label'), null);
});

test('observeScrollRegion recomputes on resize and cleans up observers', () => {
  let resizeCallback;
  let disconnected = 0;
  let removed = 0;
  class ResizeObserverDouble {
    constructor(callback) { resizeCallback = callback; }
    observe() {}
    disconnect() { disconnected += 1; }
  }
  const node = element();
  const view = {
    ResizeObserver: ResizeObserverDouble,
    addEventListener() {},
    removeEventListener() { removed += 1; },
  };
  const dispose = observeScrollRegion(node, view);
  node.scrollWidth = 300;
  resizeCallback();
  assert.equal(node.getAttribute('role'), 'region');
  dispose();
  assert.equal(disconnected, 1);
  assert.equal(removed, 1);
});
