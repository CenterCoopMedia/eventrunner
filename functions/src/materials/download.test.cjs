'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const { validateHeaderValue } = require('node:http');
const express = require('express');

const {
  createDownloadSessionMaterialHandler,
  streamMaterialFile,
  internals: { sanitizeForHeader },
} = require('./download.cjs');
const { MAX_MATERIAL_FILE_BYTES } = require('./policy.cjs');

/** Minimal fake of the @google-cloud/storage File API surface this module
 * touches: exists()/getMetadata() resolve arrays (matching the real
 * client's [value, apiResponse] tuple shape), createReadStream() returns a
 * Readable-ish EventEmitter that can be piped. */
function fakeFile({
  exists = true,
  contentType = 'application/pdf',
  bytes = 'fake-bytes',
  size = Buffer.byteLength(bytes),
  state = { streams: 0 },
} = {}) {
  return {
    async exists() {
      return [exists];
    },
    async getMetadata() {
      return [{ contentType, size }];
    },
    createReadStream() {
      state.streams += 1;
      const stream = new EventEmitter();
      stream.pipe = (dest) => {
        queueMicrotask(() => {
          dest.write?.(bytes);
          stream.emit('end');
        });
        return dest;
      };
      return stream;
    },
  };
}

function fakeRes() {
  const headers = {};
  return {
    statusCode: null,
    body: null,
    headersSent: false,
    ended: false,
    set(name, value) {
      headers[name] = value;
      return this;
    },
    type: express.response.type,
    attachment: express.response.attachment,
    write() {},
    end() {
      this.ended = true;
    },
    removeHeader(name) {
      delete headers[name];
    },
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(body) {
      this.body = body;
      return this;
    },
    headers,
  };
}

class MaterialNotFoundError extends Error {}
class SessionNotFoundError extends Error {}
class EmbargoedError extends Error {}

function downloadHandler(material, bucket) {
  return createDownloadSessionMaterialHandler({
    db: {},
    auth: {},
    getConfig: async () => ({}),
    bucket,
    resolveActorOptional: async () => ({ uid: 'admin', isAdmin: true, speakerId: null }),
    resolveMaterialAccess: async () => ({ material }),
    accessErrors: { MaterialNotFoundError, SessionNotFoundError, EmbargoedError },
    log: { error() {} },
  });
}

test('downloadSessionMaterial: refuses a legacy path outside its session before any Storage read', async () => {
  for (const storagePath of [
    'branding/logo.png',
    'session-materials/s2/slides.pdf',
    'session-materials/s1',
    'session-materials/s1/',
  ]) {
    let fileCalls = 0;
    const handler = downloadHandler(
      { sessionId: 's1', type: 'file', storagePath, filename: 'slides.pdf' },
      { file() { fileCalls += 1; return fakeFile(); } },
    );
    const res = fakeRes();
    await handler({ method: 'POST', body: { materialId: 'm1' } }, res);
    assert.equal(res.statusCode, 400, storagePath);
    assert.equal(res.body.error.code, 'bad-request', storagePath);
    assert.match(res.body.error.message, /^storagePath:/, storagePath);
    assert.equal(fileCalls, 0, storagePath);
  }
});

test('streamMaterialFile: returns false without touching the response when the object does not exist', async () => {
  const file = fakeFile({ exists: false });
  const res = fakeRes();
  const served = await streamMaterialFile({ file, res, filename: 'slides.pdf' });
  assert.equal(served, false);
  assert.equal(res.headers['Content-Type'], undefined);
});

test('streamMaterialFile: sets Content-Type from Storage metadata and a Content-Disposition naming the file', async () => {
  const file = fakeFile({ contentType: 'application/pdf' });
  const res = fakeRes();
  const served = await streamMaterialFile({ file, res, filename: 'Opening slides.pdf' });
  assert.equal(served, true);
  assert.equal(res.headers['Content-Type'], 'application/pdf');
  assert.equal(res.headers['Content-Disposition'], 'attachment; filename="Opening slides.pdf"');
  assert.equal(res.headers['Content-Length'], '10');
});

test('streamMaterialFile: emits a valid Unicode download header and preserves the Storage MIME type', async () => {
  const file = fakeFile({ contentType: 'application/x-eventrunner-fixture' });
  const res = fakeRes();
  const served = await streamMaterialFile({ file, res, filename: '資料.pdf' });

  assert.equal(served, true);
  assert.doesNotThrow(() => validateHeaderValue('Content-Disposition', res.headers['Content-Disposition']));
  assert.match(res.headers['Content-Disposition'], /filename\*=UTF-8''%E8%B3%87%E6%96%99\.pdf/);
  assert.equal(res.headers['Content-Type'], 'application/x-eventrunner-fixture');
});

test('streamMaterialFile: falls back to application/octet-stream when metadata has no contentType', async () => {
  const file = {
    async exists() {
      return [true];
    },
    async getMetadata() {
      return [{ size: 1 }]; // no contentType field at all
    },
    createReadStream: fakeFile().createReadStream,
  };
  const res = fakeRes();
  await streamMaterialFile({ file, res, filename: 'mystery' });
  assert.equal(res.headers['Content-Type'], 'application/octet-stream');
});

test('streamMaterialFile: never caches (private, no-store)', async () => {
  const file = fakeFile();
  const res = fakeRes();
  await streamMaterialFile({ file, res, filename: 'x' });
  assert.equal(res.headers['Cache-Control'], 'private, max-age=0, no-store');
});

test('streamMaterialFile: streams a file at the exact cap', async () => {
  const state = { streams: 0 };
  const res = fakeRes();
  const served = await streamMaterialFile({
    file: fakeFile({ size: String(MAX_MATERIAL_FILE_BYTES), state }),
    res,
    filename: 'largest.pdf',
  });
  assert.equal(served, true);
  assert.equal(res.headers['Content-Length'], String(MAX_MATERIAL_FILE_BYTES));
  assert.equal(state.streams, 1);
});

test('streamMaterialFile: an error before the first byte ends a complete 500 response', async () => {
  const file = {
    async exists() {
      return [true];
    },
    async getMetadata() {
      return [{ contentType: 'application/pdf', size: 10 }];
    },
    createReadStream() {
      const stream = new EventEmitter();
      stream.pipe = () => {
        queueMicrotask(() => stream.emit('error', new Error('Storage read failed')));
      };
      return stream;
    },
  };
  const res = fakeRes();
  let logged = 0;

  const served = await streamMaterialFile({
    file,
    res,
    filename: 'slides.pdf',
    log: { error() { logged += 1; } },
  });

  assert.equal(served, true);
  assert.equal(res.statusCode, 500);
  assert.equal(res.headers['Content-Length'], undefined);
  assert.equal(res.ended, true);
  assert.equal(logged, 1);
});

test('streamMaterialFile: does not declare Content-Length for a gzip-stored object', async () => {
  const file = fakeFile({ contentType: 'application/pdf' });
  const metadata = file.getMetadata.bind(file);
  file.getMetadata = async () => {
    const [data] = await metadata();
    return [{ ...data, contentEncoding: 'gzip' }];
  };
  const res = fakeRes();
  const served = await streamMaterialFile({ file, res, filename: 'slides.pdf' });
  assert.equal(served, true);
  assert.equal(res.headers['Content-Length'], undefined);
  assert.equal(res.headers['Content-Type'], 'application/pdf');
});

test('streamMaterialFile: a failure after the first byte destroys the response instead of ending it', async () => {
  const file = {
    async exists() {
      return [true];
    },
    async getMetadata() {
      return [{ contentType: 'application/pdf', size: 10 }];
    },
    createReadStream() {
      const stream = new EventEmitter();
      stream.pipe = (dest) => {
        queueMicrotask(() => {
          dest.write?.('partial');
          dest.headersSent = true;
          stream.emit('error', new Error('Storage read failed'));
        });
        return dest;
      };
      return stream;
    },
  };
  const res = fakeRes();
  let destroyed = null;
  res.destroy = (err) => {
    destroyed = err;
  };

  const served = await streamMaterialFile({
    file,
    res,
    filename: 'slides.pdf',
    log: { error() {} },
  });

  assert.equal(served, true);
  assert.equal(res.headers['Content-Length'], '10');
  assert.equal(res.ended, false);
  assert.equal(destroyed?.message, 'Storage read failed');
});

test('downloadSessionMaterial: refuses a legacy file over the cap before its stream opens', async () => {
  const state = { streams: 0 };
  const size = MAX_MATERIAL_FILE_BYTES + 1;
  const file = fakeFile({ size: String(size), state });
  const handler = downloadHandler(
    {
      sessionId: 's1',
      type: 'file',
      storagePath: 'session-materials/s1/slides.pdf',
      filename: 'slides.pdf',
    },
    { file() { return file; } },
  );
  const res = fakeRes();
  await handler({ method: 'POST', body: { materialId: 'm1' } }, res);
  assert.equal(res.statusCode, 413);
  assert.equal(res.body.error.code, 'too-large');
  assert.match(res.body.error.message, new RegExp(`${size}.*${MAX_MATERIAL_FILE_BYTES}`));
  assert.equal(state.streams, 0);
});

test('downloadSessionMaterial: refuses a legacy file with no valid size before its stream opens', async () => {
  const state = { streams: 0 };
  const file = fakeFile({ size: 'unknown', state });
  const handler = downloadHandler(
    {
      sessionId: 's1',
      type: 'file',
      storagePath: 'session-materials/s1/slides.pdf',
      filename: 'slides.pdf',
    },
    { file() { return file; } },
  );
  const res = fakeRes();
  await handler({ method: 'POST', body: { materialId: 'm1' } }, res);
  assert.equal(res.statusCode, 500);
  assert.equal(res.body.error.code, 'internal');
  assert.equal(state.streams, 0);
});

test('sanitizeForHeader: strips quotes and controls that would break the header value', () => {
  assert.equal(sanitizeForHeader('normal.pdf'), 'normal.pdf');
  assert.equal(sanitizeForHeader('evil".pdf\r\nX-Injected: 1'), 'evil.pdfX-Injected: 1');
  assert.equal(sanitizeForHeader('tab\there\u0000.pdf'), 'tabhere.pdf');
});

test('sanitizeForHeader: a blank/undefined filename falls back to a safe default', () => {
  assert.equal(sanitizeForHeader(''), 'download');
  assert.equal(sanitizeForHeader('   '), 'download');
  assert.equal(sanitizeForHeader(undefined), 'download');
});

test('sanitizeForHeader: bounds a legacy name without splitting a surrogate pair', () => {
  const name = `${'a'.repeat(239)}\u{1F4C4}rest.pdf`;
  const sanitized = sanitizeForHeader(name);
  assert.equal(sanitized, 'a'.repeat(239));
  assert.ok(sanitized.length <= 240);
});

test('sanitizeForHeader: repairs an unpaired legacy surrogate before Express formats it', () => {
  const filename = sanitizeForHeader('bad\uD800name.pdf');
  const res = fakeRes();

  assert.equal(filename, 'bad\uFFFDname.pdf');
  assert.doesNotThrow(() => res.attachment(filename));
  assert.doesNotThrow(() => validateHeaderValue('Content-Disposition', res.headers['Content-Disposition']));
});
