// saveTextFile — the browser half of the attendee export (issue #184).
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { saveTextFile } from './downloadFile.js';

/**
 * The blob's bytes as text, byte-order mark kept. jsdom's Blob has no
 * text(), and FileReader.readAsText drops a leading mark while it decodes,
 * so read the bytes and decode them with the mark left in place.
 */
function readBlob(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(new TextDecoder('utf-8', { ignoreBOM: true }).decode(reader.result));
    reader.onerror = () => reject(reader.error);
    reader.readAsArrayBuffer(blob);
  });
}

describe('saveTextFile', () => {
  let createObjectURL;
  let revokeObjectURL;
  let clicked;
  let originalCreate;
  let originalRevoke;

  beforeEach(() => {
    vi.useFakeTimers();
    originalCreate = URL.createObjectURL;
    originalRevoke = URL.revokeObjectURL;
    createObjectURL = vi.fn(() => 'blob:attendees');
    revokeObjectURL = vi.fn();
    URL.createObjectURL = createObjectURL;
    URL.revokeObjectURL = revokeObjectURL;
    clicked = [];
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function click() {
      clicked.push({ href: this.href, download: this.download, attached: document.body.contains(this) });
    });
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
    URL.createObjectURL = originalCreate;
    URL.revokeObjectURL = originalRevoke;
  });

  it('saves the text as a UTF-8 CSV blob under the given name', async () => {
    saveTextFile('attendees-2026-09-23.csv', '\uFEFF"Name"\r\n"Ada Quill"\r\n');

    expect(createObjectURL).toHaveBeenCalledTimes(1);
    const blob = createObjectURL.mock.calls[0][0];
    expect(blob).toBeInstanceOf(Blob);
    expect(blob.type).toBe('text/csv;charset=utf-8');
    // FileReader settles on a real timer.
    vi.useRealTimers();
    expect(await readBlob(blob)).toBe('\uFEFF"Name"\r\n"Ada Quill"\r\n');

    expect(clicked).toEqual([
      { href: 'blob:attendees', download: 'attendees-2026-09-23.csv', attached: true },
    ]);
    // The temporary anchor does not stay in the page.
    expect(document.querySelectorAll('a[download]')).toHaveLength(0);
  });

  it('revokes the object URL on the next tick, not in the same one', () => {
    saveTextFile('attendees-2026-09-23.csv', 'x');

    expect(revokeObjectURL).not.toHaveBeenCalled();
    vi.runAllTimers();
    expect(revokeObjectURL).toHaveBeenCalledWith('blob:attendees');
  });
});
