'use strict';

const assert = require('node:assert/strict');
const { test } = require('node:test');
const sharp = require('sharp');
const {
  MIB, PUBLIC_SCREENSHOT_MIB, SIGNED_IN_SCREENSHOT_MIB, ScreenshotError,
  freshScreenshotAuth, readScreenshots, renderScreenshots,
} = require('./screenshots.cjs');

const pixels = (width, height) => sharp({ create: { width, height, channels: 3, background: 'white' } });
const read = (bytes) => readScreenshots([bytes.toString('base64')], SIGNED_IN_SCREENSHOT_MIB);

test('accepts still PNG, JPEG, and WebP and removes metadata after applying orientation', async () => {
  const inputs = await Promise.all([
    pixels(20, 12).png().toBuffer(),
    pixels(20, 12).withMetadata({ orientation: 6 }).jpeg().toBuffer(),
    pixels(20, 12).webp().toBuffer(),
  ]);
  assert.ok((await sharp(inputs[1]).metadata()).exif);
  const output = await renderScreenshots(inputs.flatMap(read), sharp, 4_000_000);
  for (const [index, image] of output.entries()) {
    const meta = await sharp(image).metadata();
    assert.equal(meta.format, 'webp');
    assert.equal(meta.width, index === 1 ? 12 : 20);
    assert.equal(meta.height, index === 1 ? 20 : 12);
    assert.equal(meta.exif, undefined);
    assert.equal(meta.icc, undefined);
  }
});

test('refuses oversized and malformed input, spoofed bytes, corrupt images and excessive pixels', async () => {
  const oversizedForPublic = Buffer.alloc(MIB + 1).toString('base64');
  assert.throws(() => readScreenshots([oversizedForPublic], PUBLIC_SCREENSHOT_MIB), ScreenshotError);
  assert.equal(readScreenshots([oversizedForPublic], SIGNED_IN_SCREENSHOT_MIB).length, 1);
  assert.throws(() => readScreenshots(['AAAA', 'AAAA', 'AAAA', 'AAAA'], PUBLIC_SCREENSHOT_MIB), ScreenshotError);
  assert.throws(() => readScreenshots(['Zg= '], PUBLIC_SCREENSHOT_MIB), ScreenshotError);
  assert.throws(() => readScreenshots(['Zh=='], PUBLIC_SCREENSHOT_MIB), ScreenshotError);
  const png = await pixels(20, 12).png().toBuffer();
  const tooManyPixels = await pixels(2100, 2000).png().toBuffer();
  for (const invalid of [Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"/>'), png.subarray(0, 24), tooManyPixels]) {
    await assert.rejects(() => renderScreenshots(read(invalid), sharp, 4_000_000), ScreenshotError);
  }
});

test('an image read requires a freshly issued, unrevoked ID token', async () => {
  let iat = 700;
  const auth = freshScreenshotAuth({
    async verifyIdToken(token, checkRevoked) {
      assert.equal(token, 'fixture-token');
      assert.equal(checkRevoked, true);
      return { iat };
    },
  }, () => 1_000_000);
  assert.deepEqual(await auth.verifyIdToken('fixture-token', true), { iat });
  iat -= 1;
  await assert.rejects(() => auth.verifyIdToken('fixture-token', true), /Refresh your sign-in/);
});
