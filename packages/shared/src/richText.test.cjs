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
