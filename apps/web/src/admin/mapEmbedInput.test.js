import { describe, expect, it } from 'vitest';
import { mapEmbedInput } from './mapEmbedInput.js';

const src = 'https://www.google.com/maps/embed?pb=!1m2&hl=en';

describe('Google Maps embed input', () => {
  it('accepts a copied URL or the src from a copied iframe', () => {
    expect(mapEmbedInput(src)).toBe(src);
    expect(mapEmbedInput(`<iframe width="600" src="${src.replaceAll('&', '&amp;')}"
      height="450" style="border:0" loading="lazy"></iframe>`)).toBe(src);
    expect(mapEmbedInput(`<iframe title='src="ignored"' src='${src}' allowfullscreen></iframe>`)).toBe(src);
  });

  it('rejects unsupported sources and other HTML', () => {
    for (const input of [
      '<iframe src="https://example.org/maps/embed?pb=fixture"></iframe>',
      '<iframe src="javascript:alert(1)"></iframe>',
      `<p><iframe src="${src}"></iframe></p>`,
      `<iframe src="${src}"></iframe><p>Other content</p>`,
      `<iframe srcdoc="<p>${src}</p>"></iframe>`,
      `<iframe src="https://example.org" src="${src}"></iframe>`,
    ]) {
      expect(mapEmbedInput(input), input).toBe('');
    }
  });
});
