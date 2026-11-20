export { MAX_SCREENSHOTS, MIB, PUBLIC_SCREENSHOT_MIB, SIGNED_IN_SCREENSHOT_MIB } from '../screenshotPolicy.mjs';

export class ScreenshotReadError extends Error {
  constructor() {
    super('A screenshot could not be opened. Remove it and choose it again.');
  }
}

export function newReportSubmissionKey() {
  const bytes = globalThis.crypto.getRandomValues(new Uint8Array(16));
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
}

export async function encodeScreenshots(screenshots) {
  if (screenshots.length === 0) return {};
  const values = await Promise.all(screenshots.map(({ file }) => new Promise((resolve, reject) => {
    const reader = new globalThis.FileReader();
    reader.onload = () => resolve(reader.result.split(',', 2)[1]);
    reader.onerror = reader.onabort = () => reject(new ScreenshotReadError());
    reader.readAsDataURL(file);
  })));
  return { screenshots: values };
}
