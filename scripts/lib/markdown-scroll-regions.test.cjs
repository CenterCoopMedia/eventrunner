'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { renderMarkdown } = require('./markdown-pages.cjs');

test('wide Markdown structures opt into measured scroll behavior', () => {
  const code = renderMarkdown('# Example\n\n```js\nconst value = 1;\n```').html;
  assert.match(code, /<pre data-scroll-region data-scroll-label="Code example \(js\)">/);

  const table = renderMarkdown('# Table\n\n| Name | Value |\n| --- | --- |\n| A | B |').html;
  assert.match(table, /class="table-scroll" data-scroll-region data-scroll-label="Table"/);
});
