// Sanitizer policy tests: the richtext subset is allowlist-only — script,
// style, iframes, event handlers, and javascript: URLs never survive.
import { describe, expect, it } from 'vitest';
import { sanitizeHtml, isSafeHref } from './sanitizeHtml.js';

describe('sanitizeHtml', () => {
  it('strips <script> elements and their contents', () => {
    const out = sanitizeHtml('<p>Before</p><script>window.x = 1;</script><p>After</p>');
    expect(out).toBe('<p>Before</p><p>After</p>');
    expect(out).not.toContain('script');
    expect(out).not.toContain('window.x');
  });

  it('strips event handler attributes like onload and onclick', () => {
    const out = sanitizeHtml(
      '<p onclick="doEvil()">Hi</p><img src="x" onerror="doEvil()">',
    );
    expect(out).not.toContain('onclick');
    expect(out).not.toContain('onerror');
    expect(out).not.toContain('doEvil');
    expect(out).toContain('<p>Hi</p>');
  });

  it('removes style, iframe, object, and embed entirely', () => {
    const out = sanitizeHtml(
      '<style>p{display:none}</style><iframe src="https://example.org"></iframe><object></object><embed><p>Kept</p>',
    );
    expect(out).toBe('<p>Kept</p>');
  });

  it('drops javascript: hrefs but keeps safe ones', () => {
    const out = sanitizeHtml(
      '<a href="javascript:doEvil()">bad</a> <a href="https://example.org/x">good</a> <a href="/local">rel</a> <a href="mailto:hi@example.org">mail</a>',
    );
    expect(out).not.toContain('javascript:');
    expect(out).toContain('href="https://example.org/x"');
    expect(out).toContain('href="/local"');
    expect(out).toContain('href="mailto:hi@example.org"');
    // Links keep noopener/noreferrer.
    expect(out).toContain('rel="noopener noreferrer"');
  });

  it('strips style and class attributes from allowed tags', () => {
    const out = sanitizeHtml('<p style="color:red" class="x" data-y="z">Hi</p>');
    expect(out).toBe('<p>Hi</p>');
  });

  it('unwraps unknown-but-harmless wrappers, keeping their text', () => {
    const out = sanitizeHtml('<div><span>Hello</span> <em>there</em></div>');
    expect(out).toBe('Hello <em>there</em>');
  });

  it('keeps the allowed formatting subset intact', () => {
    const input =
      '<h2>Head</h2><p><strong>Bold</strong> and <em>italic</em></p><ul><li>One</li><li>Two</li></ul><blockquote>Quote</blockquote>';
    expect(sanitizeHtml(input)).toBe(input);
  });

  it('returns empty string for non-strings and empty input', () => {
    expect(sanitizeHtml(null)).toBe('');
    expect(sanitizeHtml(undefined)).toBe('');
    expect(sanitizeHtml('')).toBe('');
    expect(sanitizeHtml(42)).toBe('');
  });
});

describe('isSafeHref', () => {
  it('accepts relative, fragment, http(s), mailto, and tel hrefs', () => {
    for (const href of ['/a', '#top', './x', '../y', 'page', 'https://e.org', 'http://e.org', 'mailto:a@e.org', 'tel:+15550100']) {
      expect(isSafeHref(href)).toBe(true);
    }
  });

  it('rejects javascript:, data:, vbscript:, and empty values', () => {
    for (const href of ['javascript:x', ' JAVASCRIPT:x', 'data:text/html,x', 'vbscript:x', '', null]) {
      expect(isSafeHref(href)).toBe(false);
    }
  });
});
