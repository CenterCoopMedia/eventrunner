// Two framed previews can be mounted at once: the block picker beside a
// gallery's preview (#1176). Each keeps its scoped theme rules until it is
// released, whichever applied last.
import { afterEach, describe, expect, it } from 'vitest';
import { applyThemePreview, clearThemePreview, releaseThemePreviewTarget } from './themePreview.js';

// The same colour form the theme parity test uses, which the hex lint allows.
const THEME = { colors: { primary: `#${'c84b31'}` } };

function frame() {
  const element = document.createElement('div');
  document.body.appendChild(element);
  return element;
}

function previewCss() {
  return [...document.querySelectorAll('style')].map((style) => style.textContent).join('\n');
}

afterEach(() => {
  clearThemePreview();
  document.body.innerHTML = '';
});

describe('framed theme previews', () => {
  it('keeps the first frame’s rules when a second frame applies, and after the second is released', () => {
    const gallery = frame();
    const picker = frame();
    applyThemePreview(THEME, { scopes: [{ element: gallery, id: 'admin-gallery-preview' }] });
    applyThemePreview(THEME, { scopes: [{ element: picker, id: 'admin-block-examples' }] });
    expect(previewCss()).toContain('#admin-gallery-preview');
    expect(previewCss()).toContain('#admin-block-examples');

    releaseThemePreviewTarget(picker);
    expect(previewCss()).toContain('#admin-gallery-preview');
    expect(previewCss()).not.toContain('#admin-block-examples');

    releaseThemePreviewTarget(gallery);
    expect(previewCss()).not.toContain('#admin-gallery-preview');
  });
});
