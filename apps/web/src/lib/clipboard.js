// Copy text to the clipboard (issue #166).
//
// The async clipboard API is the path where it exists. The fallback is the
// old select-and-execCommand trick behind a throwaway element, because the
// API needs a secure context a local demo build may not have. Both failure
// modes answer `false`, and the caller says so — a copy control that
// silently did nothing is a dead end.

/**
 * @param {string} text
 * @param {{ documentRef?: Document, navigatorRef?: Navigator }} [views] injectable for tests
 * @returns {Promise<boolean>} whether the text reached the clipboard
 */
export async function copyTextToClipboard(text, { documentRef, navigatorRef } = {}) {
  const doc = documentRef ?? (typeof document === 'undefined' ? null : document);
  const nav = navigatorRef ?? (typeof navigator === 'undefined' ? null : navigator);
  if (typeof text !== 'string' || !text || !doc) return false;

  if (nav?.clipboard?.writeText) {
    try {
      await nav.clipboard.writeText(text);
      return true;
    } catch {
      // Fall through to the legacy path.
    }
  }

  try {
    const area = doc.createElement('textarea');
    area.value = text;
    area.setAttribute('readonly', '');
    area.style.position = 'fixed';
    area.style.opacity = '0';
    doc.body.appendChild(area);
    area.select();
    const copied = doc.execCommand?.('copy') === true;
    area.remove();
    return copied;
  } catch {
    return false;
  }
}
