// An isolated document for drawing public pages in the admin at a true CSS
// width: the page's own media queries and viewport units read the frame, not
// the admin window. Used by the Branding preview (ThemeProof) and by the
// section layout preview.
import { PREVIEW_STYLE_ID } from './themePreview.js';

export const PREVIEW_DOCUMENT = '<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"></head><body></body></html>';

/** Keep styles from the app and its deferred chunks in the proof document. */
export function syncProofStyles(sourceHead, proofHead) {
  const copies = new Map();
  function refresh() {
    const styles = [...sourceHead.querySelectorAll('link[rel="stylesheet"], style')]
      .filter((node) => node.id !== PREVIEW_STYLE_ID);
    for (const [source, copy] of copies) {
      if (styles.includes(source)) continue;
      copy.remove();
      copies.delete(source);
    }
    // Keep the app's cascade order and the proof's own overrides at the end.
    let before = proofHead.querySelector(`#${PREVIEW_STYLE_ID}`);
    for (const source of styles.reverse()) {
      let copy = copies.get(source);
      if (!copy || !source.isEqualNode(copy)) {
        copy?.remove();
        copy = source.cloneNode(true);
        copies.set(source, copy);
      }
      if (copy.parentNode !== proofHead || copy.nextSibling !== before) {
        proofHead.insertBefore(copy, before);
      }
      before = copy;
    }
  }

  refresh();
  const observer = new MutationObserver(refresh);
  observer.observe(sourceHead, {
    childList: true,
    subtree: true,
    characterData: true,
    attributes: true,
    attributeFilter: ['href', 'rel', 'media', 'id', 'disabled'],
  });
  return () => {
    observer.disconnect();
    for (const copy of copies.values()) copy.remove();
  };
}
