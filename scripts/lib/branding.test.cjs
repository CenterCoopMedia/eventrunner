'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { uploadPlaceholderBranding, mayOverwrite, BRANDING_ASSETS } = require('./branding.cjs');

/**
 * A Storage bucket fake: `objects` maps object path -> metadata, or is
 * absent for an object that does not exist.
 */
function fakeBucket(objects = {}, { uploadThrows = false } = {}) {
  const uploads = [];
  const bucket = {
    uploads,
    file(objectPath) {
      return {
        async exists() {
          return [Object.prototype.hasOwnProperty.call(objects, objectPath)];
        },
        async getMetadata() {
          return [objects[objectPath]];
        },
      };
    },
    async upload(source, options) {
      if (uploadThrows) throw new Error('bucket does not exist');
      uploads.push(options.destination);
      objects[options.destination] = options.metadata;
    },
  };
  return bucket;
}

test('every slot is uploaded into an empty bucket, stamped as seeded', async () => {
  const bucket = fakeBucket();
  const result = await uploadPlaceholderBranding({ bucket: () => bucket });
  assert.deepEqual(result.uploaded.sort(), Object.keys(BRANDING_ASSETS).sort());
  assert.deepEqual(result.skipped, []);
  // The stamp is what makes a later re-run able to tell its own upload
  // from a client's logo.
  assert.equal(bucket.uploads.length, 4);
});

test('a re-run refreshes its own placeholders', async () => {
  const bucket = fakeBucket();
  await uploadPlaceholderBranding({ bucket: () => bucket });
  const rerun = await uploadPlaceholderBranding({ bucket: () => bucket });
  assert.equal(rerun.uploaded.length, 4);
  assert.equal(rerun.skipped.length, 0);
});

test('a client-replaced asset is never overwritten by a placeholder', async () => {
  // The Storage half of the seeded-document rule: --force must not put a
  // neutral placeholder back over the logo a client uploaded.
  const bucket = fakeBucket({
    'branding/logo.svg': { contentType: 'image/svg+xml', metadata: {} },
  });
  const result = await uploadPlaceholderBranding({ bucket: () => bucket });
  assert.equal(result.uploaded.includes('branding/logo.svg'), false);
  const skip = result.skipped.find((s) => s.path === 'branding/logo.svg');
  assert.equal(skip.kind, 'protected');
  assert.match(skip.reason, /client-replaced/);
  assert.equal(bucket.uploads.includes('branding/logo.svg'), false);
});

test('unreadable metadata is treated as the client asset, not as ours', async () => {
  const file = {
    async exists() { return [true]; },
    async getMetadata() { throw new Error('permission denied'); },
  };
  const verdict = await mayOverwrite(file);
  assert.equal(verdict.overwrite, false);
});

test('an absent object is always writable', async () => {
  const verdict = await mayOverwrite({ async exists() { return [false]; } });
  assert.equal(verdict.overwrite, true);
});

test('an unprovisioned bucket reports errors, and never throws at the caller', async () => {
  const result = await uploadPlaceholderBranding({
    bucket: () => { throw new Error('EVENT_STORAGE_BUCKET is not set'); },
  });
  assert.equal(result.uploaded.length, 0);
  assert.equal(result.skipped.length, 4);
  for (const skip of result.skipped) assert.equal(skip.kind, 'error');
});

test('an upload failure is an error-kind skip, not a silent success', async () => {
  const bucket = fakeBucket({}, { uploadThrows: true });
  const result = await uploadPlaceholderBranding({ bucket: () => bucket });
  assert.equal(result.uploaded.length, 0);
  assert.equal(result.skipped.every((s) => s.kind === 'error'), true);
});

test('a dry run touches no bucket at all', async () => {
  const result = await uploadPlaceholderBranding({
    bucket: () => { throw new Error('should not be called'); },
    dryRun: true,
  });
  assert.equal(result.uploaded.length, 4);
});
