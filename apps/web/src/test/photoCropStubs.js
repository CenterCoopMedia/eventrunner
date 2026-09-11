// Stubs for tests that drive a photo field through the crop step (issue
// #175). jsdom loads no images, mints no object URLs, and draws no canvas —
// the crop needs all three, and the assertions only need them to record.
import { expect, vi } from 'vitest';
import { fireEvent, screen } from '@testing-library/react';

/** A picture that loads immediately and knows a 400×200 shape. */
class FakeImage {
  constructor() {
    this.naturalWidth = 400;
    this.naturalHeight = 200;
    this.onload = null;
    this.srcValue = '';
  }
  set src(value) {
    this.srcValue = value;
    queueMicrotask(() => this.onload?.());
  }
  get src() {
    return this.srcValue;
  }
}

/** Install every stub the crop step needs. Call in beforeEach. */
export function installPhotoCropStubs() {
  vi.stubGlobal('Image', FakeImage);
  URL.createObjectURL = vi.fn(() => 'blob:fixture');
  URL.revokeObjectURL = vi.fn();
  HTMLCanvasElement.prototype.getContext = vi.fn(() => ({ drawImage: vi.fn() }));
  HTMLCanvasElement.prototype.toBlob = vi.fn((callback) =>
    callback(new Blob(['crop'], { type: 'image/png' })),
  );
}

export function uninstallPhotoCropStubs() {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  delete HTMLCanvasElement.prototype.getContext;
  delete HTMLCanvasElement.prototype.toBlob;
}

/**
 * Choose a file in the field, wait for the crop step's picture, and press
 * Apply — the path a reader takes who is happy with the centred square.
 *
 * @param {File} file
 * @param {RegExp} label what the field calls this photo
 */
export async function chooseAndApplyCrop(file, label) {
  fireEvent.change(screen.getByLabelText(/Upload a photo|Replace photo/), {
    target: { files: [file] },
  });
  const box = await screen.findByRole('application', { name: new RegExp(label, 'i') });
  await vi.waitFor(() => expect(box.querySelector('img')).not.toBeNull());
  fireEvent.click(screen.getByRole('button', { name: 'Use this crop' }));
}
