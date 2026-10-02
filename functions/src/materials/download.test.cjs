'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');

const {
  createDownloadSessionMaterialHandler,
  streamMaterialFile,
  internals: { sanitizeForHeader },
} = require('./download.cjs');

/** Minimal fake of the @google-cloud/storage File API surface this module
 * touches: exists()/getMetadata() resolve arrays (matching the real
 * client's [value, apiResponse] tuple shape), createReadStream() returns a
 * Readable-ish EventEmitter that can be piped. */
function fakeFile({ exists = true, contentType = 'application/pdf', bytes = 'fake-bytes' } = {}) {
  return {
    async exists() {
      return [exists];
    },
    async getMetadata() {
      return [{ contentType }];
    },
    createReadStream() {
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
    set(name, value) {
      headers[name] = value;
    },
    write() {},
    end() {},
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
});

test('streamMaterialFile: falls back to application/octet-stream when metadata has no contentType', async () => {
  const file = {
    async exists() {
      return [true];
    },
    async getMetadata() {
      return [{}]; // no contentType field at all
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

test('sanitizeForHeader: strips quotes and newlines that would break the header value', () => {
  assert.equal(sanitizeForHeader('normal.pdf'), 'normal.pdf');
  assert.equal(sanitizeForHeader('evil".pdf\r\nX-Injected: 1'), 'evil.pdfX-Injected: 1');
});

test('sanitizeForHeader: a blank/undefined filename falls back to a safe default', () => {
  assert.equal(sanitizeForHeader(''), 'download');
  assert.equal(sanitizeForHeader('   '), 'download');
  assert.equal(sanitizeForHeader(undefined), 'download');
});
