'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const sharp = require('sharp');
const { renderProfilePhoto, createProfilePhotoUploadHandler } = require('./profilePhoto.cjs');

test('re-encodes valid small images too, strips metadata and bounds dimensions', async () => {
  for (const width of [16, 1024]) {
    const source = await sharp({ create: { width, height: width, channels: 3, background: 'red' } })
      .withMetadata().png().toBuffer();
    const result = await renderProfilePhoto(source);
    const meta = await sharp(result).metadata();
    assert.equal(meta.format, 'webp');
    assert.equal(meta.width, Math.min(width, 512));
    assert.equal(meta.height, Math.min(width, 512));
    assert.equal(meta.exif, undefined);
    assert.equal(meta.icc, undefined);
  }
});

test('rejects highly compressed above-ceiling raster, corrupt bytes, SVG and byte cap', async () => {
  const bomb = await sharp({ create: { width: 6400, height: 6400, channels: 3, background: 'white' } }).png().toBuffer();
  assert.ok(bomb.length < 2 * 1024 * 1024);
  for (const source of [bomb, Buffer.from('bad'), Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"/>'), Buffer.alloc(2 * 1024 * 1024)]) {
    await assert.rejects(renderProfilePhoto(source));
  }
});

function setup({ caller = { uid: 'owner' }, exists = true, render = renderProfilePhoto } = {}) {
  const writes = [];
  const handler = createProfilePhotoUploadHandler({
    verify: async () => caller,
    db: { collection: () => ({ doc: () => ({ get: async () => ({ exists }) }) }) },
    bucket: { file: (path) => ({ save: async (buffer, options) => writes.push({ path, buffer, options }) }) },
    newId: () => 'fresh', render,
  });
  const res = { status(n) { this.code = n; return this; }, json(body) { this.body = body; return this; }, set() {} };
  return { handler, res, writes };
}

test('authentication, live account and validation failures never write public objects', async () => {
  for (const [options, code] of [[{ caller: null }, 401], [{ exists: false }, 403], [{}, 400]]) {
    const { handler, res, writes } = setup(options);
    await handler({ method: 'POST', body: { data: Buffer.from('bad').toString('base64') } }, res);
    assert.equal(res.code, code);
    assert.deepEqual(writes, []);
  }
});

test('only decoded output is published at a server-owned path with a validation stamp', async () => {
  const source = await sharp({ create: { width: 8, height: 8, channels: 3, background: 'blue' } }).png().toBuffer();
  const { handler, res, writes } = setup();
  await handler({ method: 'POST', body: { data: source.toString('base64'), uid: 'victim', path: 'arbitrary' } }, res);
  assert.equal(res.code, 200);
  assert.equal(res.body.path, 'profile-photos/owner/fresh/photo.webp');
  assert.equal(writes.length, 1);
  assert.equal((await sharp(writes[0].buffer).metadata()).format, 'webp');
  assert.equal(writes[0].options.metadata.metadata.profilePhotoValidated, 'v1');
});
