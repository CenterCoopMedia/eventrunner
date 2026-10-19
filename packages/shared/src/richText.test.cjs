'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  RICH_TEXT_ALLOWED_TAGS,
  isSafeRichTextHref,
  hasRichTextContent,
} = require('./richText.cjs');

test('rich-text links use the public renderer policy', () => {
  for (const href of ['/about', '#top', './next', '../prior', 'page', 'https://example.org', 'http://example.org', 'mailto:a@example.org', 'tel:+15550100']) {
    assert.equal(isSafeRichTextHref(href), true, href);
  }
  for (const href of ['', 'javascript:alert(1)', 'data:text/html,x', 'vbscript:x', 'sms:+15550100', null]) {
    assert.equal(isSafeRichTextHref(href), false, String(href));
  }
});

test('the policy excludes Quill image, video, and formula output', () => {
  assert.equal(RICH_TEXT_ALLOWED_TAGS.includes('img'), false);
  assert.equal(RICH_TEXT_ALLOWED_TAGS.includes('video'), false);
  assert.equal(RICH_TEXT_ALLOWED_TAGS.includes('span'), false);
});

test('the browser entry exposes the same named policy exports', async () => {
  const browserPolicy = await import('./richText.mjs');
  assert.equal(browserPolicy.isSafeRichTextHref, isSafeRichTextHref);
  assert.equal(browserPolicy.hasRichTextContent, hasRichTextContent);
  assert.equal(browserPolicy.RICH_TEXT_ALLOWED_TAGS, RICH_TEXT_ALLOWED_TAGS);
});

test('required rich text needs readable content or a visible divider', () => {
  for (const value of ['', '  ', '<p><br></p>', '<p>&nbsp;</p>', '<p>\u200b</p>']) {
    assert.equal(hasRichTextContent(value), false, value);
  }
  for (const value of ['<p>Words</p>', '<p>&amp;</p>', '<hr>']) {
    assert.equal(hasRichTextContent(value), true, value);
  }
});

test('required rich text treats tags, dividers, and stray brackets as before', () => {
  for (const value of ['<hr/>', '<p><br/><br /></p>', '<p></p><p>&nbsp; &nbsp;</p>', '<a href="/x"></a>']) {
    assert.equal(hasRichTextContent(value), false, value);
  }
  for (const value of ['<hr class="rule">', '<HR>', '<p>Words<br>here</p>', '<p>a < b</p>', '<p>x</p><hr', '<hr\t']) {
    assert.equal(hasRichTextContent(value), true, value);
  }
});

test('required rich text is decided in linear time on hostile markup', () => {
  // Each of these took hundreds of milliseconds or more with the earlier
  // patterns: an unclosed divider or tag made the engine scan to the end
  // of the value from every opening bracket. At this size that is over 10 s,
  // so the 500 ms ceiling leaves room for a slow CI worker.
  for (const value of ['<hr\t'.repeat(50000), '<'.repeat(200000), `<p>${'<b'.repeat(100000)}`]) {
    const started = performance.now();
    hasRichTextContent(value);
    const elapsed = performance.now() - started;
    assert.ok(elapsed < 500,`${value.slice(0, 4)}... took ${elapsed.toFixed(1)} ms`);
  }
});
