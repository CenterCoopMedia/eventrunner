'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { sanitizeRichTextHtml, sanitizeRichTextFields } = require('./richText.cjs');

test('server rich-text sanitizer keeps the shared formatting and link policy', () => {
  const input = [
    '<h2>Heading</h2>',
    '<p><strong>Bold</strong> and <em>italic</em> with ',
    '<a href="/details" target="_blank" onclick="bad()">details</a>.</p>',
    '<ol><li>First</li></ol><blockquote>Quote</blockquote><pre><code>x</code></pre><hr>',
  ].join('');
  assert.equal(
    sanitizeRichTextHtml(input),
    '<h2>Heading</h2><p><strong>Bold</strong> and <em>italic</em> with ' +
      '<a href="/details" rel="noopener noreferrer">details</a>.</p>' +
      '<ol><li>First</li></ol><blockquote>Quote</blockquote><pre><code>x</code></pre><hr>',
  );
});

test('server rich-text output uses the browser canonical form for void elements', () => {
  assert.equal(sanitizeRichTextHtml('<p>First<br />Second</p><hr />'), '<p>First<br>Second</p><hr>');
});

test('server rich-text sanitizer rejects unsafe and unsupported Quill formats', () => {
  const input = [
    '<p><a href="javascript:alert(1)">unsafe</a></p>',
    '<img src="data:image/png;base64,abc" onerror="bad()">',
    '<iframe class="ql-video" src="https://example.org/video">fallback</iframe>',
    '<span class="ql-formula" data-value="x"><script>bad()</script></span>',
  ].join('');
  const clean = sanitizeRichTextHtml(input);
  assert.equal(clean, '<p><a>unsafe</a></p>');
  for (const rejected of ['javascript:', '<img', 'ql-video', 'fallback', 'ql-formula', '<script', 'bad()']) {
    assert.equal(clean.includes(rejected), false, rejected);
  }
});

test('all three registry rich-text fields are sanitized and plain fields stay literal', () => {
  for (const [blockType, field] of [
    ['richtext', 'value'],
    ['faq_item', 'answer'],
    ['sponsor_package', 'benefits'],
  ]) {
    assert.equal(
      sanitizeRichTextFields({ blockType, [field]: '<p onclick="bad()">Safe</p>' })[field],
      '<p>Safe</p>',
      `${blockType}.${field}`,
    );
  }
  assert.deepEqual(
    sanitizeRichTextFields({
      blockType: 'faq_item',
      question: '<b>plain field stays literal</b>',
      answer: '<p>Answer</p>',
    }),
    {
      blockType: 'faq_item',
      question: '<b>plain field stays literal</b>',
      answer: '<p>Answer</p>',
    },
  );
  assert.deepEqual(
    sanitizeRichTextFields({ blockType: 'text', value: '<b>plain field stays literal</b>' }),
    { blockType: 'text', value: '<b>plain field stays literal</b>' },
  );
});
