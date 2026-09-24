'use strict';

// Bulk materials (issue #189): the list every material endpoint and the
// archive. The archive tests run the real handler behind a real HTTP server
// and read the zip the client receives with a small central-directory
// reader, so the entry names, the bytes and the CRC-32 of each file are
// checked in the file itself, not in what the handler meant to write.
//
// Small fakes of their own: cms/firestoreFake.cjs has no collection-level
// limit(), and the archive needs a Storage bucket whose read streams can
// fail part way.

const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const zlib = require('node:zlib');
const { Readable, Writable } = require('node:stream');
const { ZipFile } = require('yazl');

const {
  createListAllSessionMaterialsHandler,
  createDownloadSessionMaterialsArchiveHandler,
  handlers,
  internals: {
    MAX_LIST_ROWS, MAX_ARCHIVE_BYTES, ARCHIVE_ACTION, MAX_NAME_LENGTH,
    readMaterialIds, cleanNamePart, entryNames, parseSize, listRow, streamArchive,
  },
} = require('./bulk.cjs');

const OPERATOR = 'operator@example.com';
const STAFF = 'staff@example.com';
const BOOTSTRAP = { adminEmails: [OPERATOR], staffEmails: [STAFF] };
const QUIET = { error() {}, warn() {}, info() {} };
const T0 = Date.parse('2026-09-24T12:00:00.000Z');
const now = () => T0;

const auth = {
  async verifyIdToken(token) {
    const table = {
      operator: { uid: 'op-1', email: OPERATOR, email_verified: true },
      staff: { uid: 'staff-1', email: STAFF, email_verified: true },
      stranger: { uid: 'x-1', email: 'stranger@example.com', email_verified: true },
    };
    if (!table[token]) throw new Error('invalid token');
    return table[token];
  },
};
const getConfig = async () => ({ bootstrap: BOOTSTRAP });

// --- fakes -----------------------------------------------------------------

/**
 * Firestore, just wide enough: config/bootstrap for requireAdmin,
 * session_materials by id and by limit(), getAll, and one batch shape.
 * `events` records 'commit' so a test can order it against the first byte.
 */
function makeDb({ materials = {}, failCommit = false, failList = false, events = [], commitGate = null } = {}) {
  const docs = new Map(Object.entries(materials));
  let autoId = 0;
  const db = {
    events,
    logs: [],
    limits: [],
    collection(name) {
      return {
        doc(id) {
          const docId = id ?? `auto-${(autoId += 1)}`;
          return {
            _col: name,
            id: docId,
            async get() {
              if (name === 'config' && docId === 'bootstrap') return { exists: true, data: () => BOOTSTRAP };
              const data = name === 'session_materials' ? docs.get(docId) : undefined;
              return { exists: data !== undefined, data: () => data };
            },
          };
        },
        limit(n) {
          db.limits.push(n);
          return {
            async get() {
              if (failList) throw new Error('list failed');
              const rows = [...docs.entries()].map(([id, data]) => ({ id, data: () => data }));
              return { docs: rows.slice(0, n) };
            },
          };
        },
      };
    },
    async getAll(...refs) {
      return refs.map((ref) => {
        const data = ref._col === 'session_materials' ? docs.get(ref.id) : undefined;
        return { exists: data !== undefined, data: () => data };
      });
    },
    batch() {
      const rows = [];
      return {
        set(ref, data) {
          rows.push({ path: `${ref._col}/${ref.id}`, data });
        },
        async commit() {
          if (commitGate) await commitGate;
          events.push('commit');
          if (failCommit) throw new Error('commit failed');
          db.logs.push(...rows);
        },
      };
    },
  };
  return db;
}

/**
 * A bucket of named objects. Each read stream is counted open from its
 * creation until it ends or closes, so a test can see two open at once.
 *
 * spec: { bytes: Buffer, size?: string|number, exists?: boolean,
 *         failAfterFirstChunk?: boolean, stallAfterFirstChunk?: boolean }
 * `existsGate`, when given, holds every exists() until it resolves.
 */
function makeBucket(objects, { existsGate = null } = {}) {
  const state = { open: 0, maxOpen: 0, streams: [], reads: [], existsCalls: 0 };
  return {
    state,
    file(path) {
      const spec = objects[path];
      return {
        async exists() {
          state.existsCalls += 1;
          if (existsGate) await existsGate;
          return [Boolean(spec) && spec.exists !== false];
        },
        async getMetadata() {
          return [{ size: spec.size ?? String(spec.bytes.length), contentType: 'application/pdf' }];
        },
        createReadStream() {
          state.reads.push(path);
          state.open += 1;
          state.maxOpen = Math.max(state.maxOpen, state.open);
          let counted = true;
          const release = () => {
            if (counted) state.open -= 1;
            counted = false;
          };
          const half = Math.ceil(spec.bytes.length / 2);
          const chunks = [spec.bytes.subarray(0, half), spec.bytes.subarray(half)];
          let index = 0;
          const stream = new Readable({
            read() {
              if (index === 1 && spec.failAfterFirstChunk) {
                index += 1;
                setImmediate(() => stream.destroy(new Error('storage read failed')));
                return;
              }
              if (index === 1 && spec.stallAfterFirstChunk) return; // never ends
              if (index < chunks.length) {
                const chunk = chunks[index];
                index += 1;
                setImmediate(() => stream.push(chunk));
                return;
              }
              setImmediate(() => stream.push(null));
            },
          });
          stream.on('end', release);
          stream.on('close', release);
          state.streams.push(stream);
          return stream;
        },
      };
    },
  };
}

function fileMaterial(sessionId, filename, extra = {}) {
  return {
    sessionId,
    type: 'file',
    url: null,
    storagePath: `session-materials/${sessionId}/${filename}`,
    filename,
    reviewStatus: 'pending',
    submittedBySpeakerId: null,
    createdBy: 'uid-private',
    createdAt: new Date(T0 - 1000),
    updatedAt: new Date('2026-09-20T10:00:00.000Z'),
    ...extra,
  };
}

/** A fake Express response for the refusals, which never stream. */
function fakeRes() {
  const res = {
    statusCode: null, body: null, headers: {}, writes: 0, ended: 0,
    set(name, value) { res.headers[name] = value; return res; },
    status(code) { res.statusCode = code; return res; },
    json(body) { res.body = body; return res; },
    write() { res.writes += 1; return true; },
    end() { res.ended += 1; return res; },
    on() { return res; },
  };
  return res;
}

function req(token, body, method = 'POST') {
  return { method, headers: token ? { authorization: `Bearer ${token}` } : {}, body };
}

// --- a real HTTP server around the handler --------------------------------

/**
 * Serve `handler` on a free port with the three Express methods it uses.
 * `trace` records 'write', 'end' and 'destroy' on each response, in order,
 * next to the db's 'commit'. `handled` counts the handler calls that have
 * settled, so a test can see a handler that never returns.
 */
async function serve(handler, trace) {
  const state = { started: 0, handled: 0 };
  const server = http.createServer((request, response) => {
    let raw = '';
    request.on('data', (chunk) => { raw += chunk; });
    request.on('end', () => {
      request.body = raw ? JSON.parse(raw) : {};
      response.set = (name, value) => { response.setHeader(name, value); return response; };
      response.status = (code) => { response.statusCode = code; return response; };
      response.json = (body) => {
        response.setHeader('Content-Type', 'application/json');
        response.end(JSON.stringify(body));
        return response;
      };
      const write = response.write.bind(response);
      const end = response.end.bind(response);
      const destroy = response.destroy.bind(response);
      response.write = (...args) => { trace.push('write'); return write(...args); };
      response.end = (...args) => { trace.push('end'); return end(...args); };
      response.destroy = (...args) => { trace.push('destroy'); return destroy(...args); };
      state.started += 1;
      handler(request, response)
        .catch((err) => trace.push(`handler threw: ${err.message}`))
        .finally(() => { state.handled += 1; });
    });
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address();
  return {
    port,
    state,
    close: () => new Promise((resolve) => {
      server.closeAllConnections();
      server.close(resolve);
    }),
  };
}

/**
 * POST and collect the whole body. Rejects when the server cuts the body
 * off, the way a browser's `response.blob()` rejects.
 */
function post(port, body, { token = 'staff', onFirstChunk, abortAfterMs } = {}) {
  return new Promise((resolve, reject) => {
    const request = http.request({
      host: '127.0.0.1',
      port,
      method: 'POST',
      path: '/',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    }, (response) => {
      const chunks = [];
      response.on('data', (chunk) => {
        if (chunks.length === 0) onFirstChunk?.(request);
        chunks.push(chunk);
      });
      response.on('end', () => {
        if (response.complete) resolve({ status: response.statusCode, headers: response.headers, body: Buffer.concat(chunks) });
        else reject(new Error('the body stopped before it finished'));
      });
      response.on('error', reject);
      response.on('aborted', () => reject(new Error('aborted')));
    });
    request.on('error', reject);
    // A body that never settles is a failure, not a hung run.
    request.setTimeout(5000, () => request.destroy(new Error('the response did not settle')));
    if (abortAfterMs !== undefined) setTimeout(() => request.destroy(new Error('the admin left')), abortAfterMs);
    request.end(JSON.stringify(body));
  });
}

/** The entries of a zip, read from its central directory. */
function readZip(buffer) {
  let eocd = -1;
  for (let offset = buffer.length - 22; offset >= 0; offset -= 1) {
    if (buffer.readUInt32LE(offset) === 0x06054b50) {
      eocd = offset;
      break;
    }
  }
  assert.ok(eocd >= 0, 'the zip has an end of central directory record');
  const count = buffer.readUInt16LE(eocd + 10);
  let cursor = buffer.readUInt32LE(eocd + 16);
  const entries = [];
  for (let index = 0; index < count; index += 1) {
    assert.equal(buffer.readUInt32LE(cursor), 0x02014b50, 'a central directory header');
    const flags = buffer.readUInt16LE(cursor + 8);
    const method = buffer.readUInt16LE(cursor + 10);
    const crc32 = buffer.readUInt32LE(cursor + 16);
    const compressedSize = buffer.readUInt32LE(cursor + 20);
    const nameLength = buffer.readUInt16LE(cursor + 28);
    const extraLength = buffer.readUInt16LE(cursor + 30);
    const commentLength = buffer.readUInt16LE(cursor + 32);
    const localOffset = buffer.readUInt32LE(cursor + 42);
    const name = buffer.subarray(cursor + 46, cursor + 46 + nameLength).toString('utf8');
    assert.equal(buffer.readUInt32LE(localOffset), 0x04034b50, 'a local file header');
    const localName = buffer.readUInt16LE(localOffset + 26);
    const localExtra = buffer.readUInt16LE(localOffset + 28);
    const start = localOffset + 30 + localName + localExtra;
    entries.push({ name, flags, method, crc32, data: buffer.subarray(start, start + compressedSize) });
    cursor += 46 + nameLength + extraLength + commentLength;
  }
  return entries;
}

async function withUncaught(fn) {
  const uncaught = [];
  const listener = (err) => uncaught.push(err);
  process.on('uncaughtException', listener);
  try {
    await fn();
    // Let any stray error surface before the listener goes.
    await new Promise((resolve) => setTimeout(resolve, 50));
  } finally {
    process.off('uncaughtException', listener);
  }
  return uncaught;
}

// A stream that never settles fails its test instead of holding the run open.
const STREAMED = { timeout: 10_000 };

async function until(check, label, timeoutMs = 2000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (check()) return;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  assert.fail(`timed out waiting for ${label}`);
}

// --- ids ---------------------------------------------------------------------

test('readMaterialIds refuses a non-list, an empty list, 51 ids, a repeat, and ids that are not document ids', () => {
  for (const body of [undefined, {}, { materialIds: 'm1' }, { materialIds: { 0: 'm1' } }]) {
    const result = readMaterialIds(body);
    assert.equal(result.ok, false);
    assert.match(result.errors[0], /^materialIds: /);
  }
  assert.deepEqual(readMaterialIds({ materialIds: [] }).errors, ['materialIds: select at least one file.']);

  const many = Array.from({ length: 51 }, (_, index) => `m${index}`);
  assert.deepEqual(readMaterialIds({ materialIds: many }).errors, [
    'materialIds: an archive holds at most 50 files. 51 were sent.',
  ]);

  assert.deepEqual(readMaterialIds({ materialIds: ['m1', 'm2', 'm1'] }).errors, ['materialIds[2]: m1 is listed twice.']);
  for (const bad of [42, null, '', '/', 'a/b', '.', '..']) {
    const result = readMaterialIds({ materialIds: ['m1', bad] });
    assert.deepEqual(result.errors, ['materialIds[1]: must be a material id.'], `refuses ${JSON.stringify(bad)}`);
  }
});

test('readMaterialIds accepts 1 and 50 ids', () => {
  assert.deepEqual(readMaterialIds({ materialIds: ['m1'] }), { ok: true, ids: ['m1'] });
  const fifty = Array.from({ length: 50 }, (_, index) => `m${index}`);
  assert.deepEqual(readMaterialIds({ materialIds: fifty }), { ok: true, ids: fifty });
});

// --- entry names -------------------------------------------------------------

test('entry names put each file in its session folder, and a hostile name stays inside it', () => {
  const names = entryNames([
    { sessionId: 's1', filename: 'Opening slides.pdf' },
    { sessionId: 's1', filename: '../../x' },
    { sessionId: 's1', filename: '..' },
    { sessionId: 's1', filename: 'a/b\\c.pdf' },
    { sessionId: 's1', filename: 'tab\there\u0000.pdf' },
    { sessionId: 's1', filename: '' },
    { sessionId: 's1', filename: '  .hidden  ' },
    { sessionId: 'c:talk', filename: 'Q&A: what next?.pdf' },
  ]);
  assert.deepEqual(names, [
    's1/Opening slides.pdf',
    's1/-..-x',
    's1/file',
    's1/a-b-c.pdf',
    's1/tab-here-.pdf',
    's1/file (2)',
    's1/hidden',
    'c-talk/Q&A- what next-.pdf',
  ]);
  for (const name of names) {
    const [folder, ...rest] = name.split('/');
    assert.equal(rest.length, 1, `${name} has exactly one folder`);
    assert.ok(!['..', '.'].includes(folder) && !rest.includes('..'), `${name} cannot climb`);
    // yazl throws on a `..` segment, an absolute path, and a drive letter.
    assert.doesNotThrow(() => new ZipFile().addBuffer(Buffer.from('x'), name), `yazl accepts ${name}`);
  }
});

test('a repeat name in one folder, compared without case, takes a number before its extension', () => {
  assert.deepEqual(
    entryNames([
      { sessionId: 's1', filename: 'Slides.pdf' },
      { sessionId: 's1', filename: 'slides.pdf' },
      { sessionId: 's1', filename: 'SLIDES.PDF' },
      { sessionId: 's2', filename: 'slides.pdf' },
      { sessionId: 's1', filename: 'notes' },
      { sessionId: 's1', filename: 'notes' },
    ]),
    ['s1/Slides.pdf', 's1/slides (2).pdf', 's1/SLIDES (3).PDF', 's2/slides.pdf', 's1/notes', 's1/notes (2)'],
  );
});

test('a long name is cut to 150 characters and keeps its extension, with or without a number', () => {
  const long = `${'x'.repeat(300)}.pptx`;
  const cleaned = cleanNamePart(long);
  assert.equal(cleaned.length, MAX_NAME_LENGTH);
  assert.ok(cleaned.endsWith('.pptx'));

  const [first, second] = entryNames([
    { sessionId: 's1', filename: long },
    { sessionId: 's1', filename: long },
  ]);
  assert.equal(first.split('/')[1].length, MAX_NAME_LENGTH);
  assert.equal(second.split('/')[1].length, MAX_NAME_LENGTH);
  assert.ok(second.endsWith(' (2).pptx'));
});

test('parseSize reads the decimal string Storage sends, and nothing else', () => {
  assert.equal(parseSize('1048576'), 1048576);
  assert.equal(parseSize(12), 12);
  for (const bad of ['', ' ', '12.5', '-1', '1e3', 'abc', null, undefined, NaN, -1, 1.5]) {
    assert.equal(parseSize(bad), null, `refuses ${JSON.stringify(bad)}`);
  }
});

// --- the list ----------------------------------------------------------------

test('listAllSessionMaterials answers every material without createdBy, with updatedAt as a number', async () => {
  const db = makeDb({
    materials: {
      m1: fileMaterial('s1', 'Slides.pdf'),
      m2: {
        sessionId: 's2', type: 'link', url: 'https://example.org/deck', storagePath: null, filename: 'Deck',
        reviewStatus: 'approved', submittedBySpeakerId: 'sp-1', createdBy: 'uid-private',
        createdAt: new Date(T0), updatedAt: { toMillis: () => 1700000000000 },
      },
    },
  });
  const res = fakeRes();
  await createListAllSessionMaterialsHandler({ db, auth, getConfig, log: QUIET })(req('staff', {}), res);

  assert.equal(res.statusCode, 200);
  assert.equal(res.body.truncated, false);
  assert.deepEqual(res.body.materials, [
    {
      id: 'm1', sessionId: 's1', type: 'file', filename: 'Slides.pdf', reviewStatus: 'pending',
      url: null, storagePath: 'session-materials/s1/Slides.pdf', submittedBySpeakerId: null,
      updatedAt: Date.parse('2026-09-20T10:00:00.000Z'),
    },
    {
      id: 'm2', sessionId: 's2', type: 'link', filename: 'Deck', reviewStatus: 'approved',
      url: 'https://example.org/deck', storagePath: null, submittedBySpeakerId: 'sp-1', updatedAt: 1700000000000,
    },
  ]);
  const text = JSON.stringify(res.body);
  assert.ok(!text.includes('uid-private') && !text.includes('createdBy') && !text.includes('createdAt'));
  assert.deepEqual(db.limits, [MAX_LIST_ROWS + 1]);
  assert.equal(listRow('m3', { type: 'link', url: 'https://x.test', storagePath: 'session-materials/s1/x' }).storagePath, null);
});

test('listAllSessionMaterials says truncated at 2,001 rows and answers 2,000', async () => {
  const materials = {};
  for (let index = 0; index < 2001; index += 1) materials[`m${index}`] = fileMaterial('s1', `f${index}.pdf`);
  const res = fakeRes();
  await createListAllSessionMaterialsHandler({ db: makeDb({ materials }), auth, getConfig, log: QUIET })(req('staff', {}), res);
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.truncated, true);
  assert.equal(res.body.materials.length, 2000);
});

test('listAllSessionMaterials: 405 on GET, 401 with no token, 403 for an address on no list, 500 on a failed read', async () => {
  const handler = createListAllSessionMaterialsHandler({ db: makeDb(), auth, getConfig, log: QUIET });
  let res = fakeRes();
  await handler(req('staff', {}, 'GET'), res);
  assert.equal(res.statusCode, 405);
  res = fakeRes();
  await handler(req(null, {}), res);
  assert.equal(res.statusCode, 401);
  res = fakeRes();
  await handler(req('stranger', {}), res);
  assert.equal(res.statusCode, 403);

  const failing = makeDb({ failList: true });
  res = fakeRes();
  await createListAllSessionMaterialsHandler({ db: failing, auth, getConfig, log: QUIET })(req('staff', {}), res);
  assert.equal(res.statusCode, 500);
  assert.equal(res.body.error.message, 'Materials could not be listed.');
});

test('a caller listed only in staffEmails passes both endpoints, and so does an operator', STREAMED, async () => {
  for (const token of ['staff', 'operator']) {
    const list = fakeRes();
    await createListAllSessionMaterialsHandler({ db: makeDb(), auth, getConfig, log: QUIET })(req(token, {}), list);
    assert.equal(list.statusCode, 200, `${token} lists`);

    const db = makeDb({ materials: { m1: fileMaterial('s1', 'a.pdf') } });
    const bucket = makeBucket({ 'session-materials/s1/a.pdf': { bytes: Buffer.from('alpha') } });
    const trace = [];
    const server = await serve(createDownloadSessionMaterialsArchiveHandler({ db, auth, getConfig, bucket, now, log: QUIET }), trace);
    try {
      const response = await post(server.port, { materialIds: ['m1'] }, { token });
      assert.equal(response.status, 200, `${token} downloads`);
    } finally {
      await server.close();
    }
  }
});

// --- archive refusals ----------------------------------------------------------

async function refuse(materials, objects, ids) {
  const db = makeDb({ materials });
  const bucket = makeBucket(objects);
  const res = fakeRes();
  await createDownloadSessionMaterialsArchiveHandler({ db, auth, getConfig, bucket, now, log: QUIET })(
    req('staff', { materialIds: ids }),
    res,
  );
  // Nothing of an archive is sent, no Storage object is read, and no audit row is written.
  assert.equal(res.writes, 0);
  assert.equal(res.headers['Content-Type'], undefined);
  assert.deepEqual(bucket.state.reads, []);
  assert.deepEqual(db.logs, []);
  assert.deepEqual(db.events, []);
  return res;
}

test('the archive refuses before the first byte: an unknown id, a link, a path outside the session folder', async () => {
  let res = await refuse({ m1: fileMaterial('s1', 'a.pdf') }, {}, ['m1', 'm9']);
  assert.equal(res.statusCode, 404);
  assert.equal(res.body.error.message, 'materialIds: m9 does not exist.');

  res = await refuse({
    m1: fileMaterial('s1', 'a.pdf'),
    m2: { sessionId: 's1', type: 'link', url: 'https://example.org', filename: 'Deck', reviewStatus: 'approved' },
  }, {}, ['m1', 'm2']);
  assert.equal(res.statusCode, 400);
  assert.equal(res.body.error.message, 'materialIds: m2 is a link. Only files go in an archive.');

  for (const storagePath of ['branding/logo.png', 'session-materials/s2/a.pdf', 'session-materials/s1', 'session-materials/s1/']) {
    res = await refuse({ m1: fileMaterial('s1', 'a.pdf', { storagePath }) }, { [storagePath]: { bytes: Buffer.from('x') } }, ['m1']);
    assert.equal(res.statusCode, 400, storagePath);
    assert.equal(res.body.error.message, 'materialIds: m1 is not stored in its session’s folder.');
  }
});

test('the archive refuses a missing Storage object by name, and a size Storage did not state', async () => {
  let res = await refuse(
    { m1: fileMaterial('s1', 'a.pdf'), m2: fileMaterial('s1', 'Gone.pdf') },
    { 'session-materials/s1/a.pdf': { bytes: Buffer.from('x') } },
    ['m1', 'm2'],
  );
  assert.equal(res.statusCode, 404);
  assert.equal(res.body.error.message, 'materialIds: the file for Gone.pdf is missing from storage.');

  res = await refuse(
    { m1: fileMaterial('s1', 'a.pdf') },
    { 'session-materials/s1/a.pdf': { bytes: Buffer.from('x'), size: 'unknown' } },
    ['m1'],
  );
  assert.equal(res.statusCode, 500);
  assert.equal(res.body.error.message, 'materialIds: the size of a.pdf could not be read.');
});

test('sizes given as strings are parsed and summed: past 200 MiB is 413 too-large, at the limit passes', async () => {
  const half = String(MAX_ARCHIVE_BYTES / 2);
  const materials = { m1: fileMaterial('s1', 'a.pdf'), m2: fileMaterial('s1', 'b.pdf') };
  const res = await refuse(materials, {
    'session-materials/s1/a.pdf': { bytes: Buffer.from('x'), size: half },
    'session-materials/s1/b.pdf': { bytes: Buffer.from('x'), size: String(MAX_ARCHIVE_BYTES / 2 + 1) },
  }, ['m1', 'm2']);
  assert.equal(res.statusCode, 413);
  assert.equal(res.body.error.code, 'too-large');
  assert.equal(
    res.body.error.message,
    'materialIds: the selected files come to 200.0 MB. An archive holds at most 200 MB. Select fewer files.',
  );

  // Two strings that reach the cap exactly are summed as numbers, not joined as text.
  const { internals: { planArchive } } = require('./bulk.cjs');
  const plan = await planArchive({
    db: makeDb({ materials }),
    bucket: makeBucket({
      'session-materials/s1/a.pdf': { bytes: Buffer.from('x'), size: half },
      'session-materials/s1/b.pdf': { bytes: Buffer.from('x'), size: half },
    }),
    ids: ['m1', 'm2'],
    now,
  });
  assert.equal(plan.ok, true);
  assert.deepEqual(plan.entries.map((entry) => entry.size), [MAX_ARCHIVE_BYTES / 2, MAX_ARCHIVE_BYTES / 2]);
});

test('the archive refuses a bad request body, 405 on GET, 401 with no token, 403 for an address on no list', async () => {
  const handler = createDownloadSessionMaterialsArchiveHandler({ db: makeDb(), auth, getConfig, bucket: makeBucket({}), now, log: QUIET });
  let res = fakeRes();
  await handler(req('staff', { materialIds: [] }), res);
  assert.equal(res.statusCode, 400);
  assert.equal(res.body.error.message, 'materialIds: select at least one file.');
  res = fakeRes();
  await handler(req('staff', {}, 'GET'), res);
  assert.equal(res.statusCode, 405);
  res = fakeRes();
  await handler(req(null, { materialIds: ['m1'] }), res);
  assert.equal(res.statusCode, 401);
  res = fakeRes();
  await handler(req('stranger', { materialIds: ['m1'] }), res);
  assert.equal(res.statusCode, 403);
});

// --- audit -----------------------------------------------------------------------

test('a failed audit commit is a 500 and not one byte of the archive', STREAMED, async () => {
  const trace = [];
  const db = makeDb({ materials: { m1: fileMaterial('s1', 'a.pdf') }, failCommit: true, events: trace });
  const bucket = makeBucket({ 'session-materials/s1/a.pdf': { bytes: Buffer.from('alpha') } });
  const server = await serve(createDownloadSessionMaterialsArchiveHandler({ db, auth, getConfig, bucket, now, log: QUIET }), trace);
  try {
    const response = await post(server.port, { materialIds: ['m1'] });
    assert.equal(response.status, 500);
    assert.deepEqual(JSON.parse(response.body.toString('utf8')), {
      error: { code: 'internal', message: 'The archive could not be recorded, so it was not built.' },
    });
    assert.deepEqual(bucket.state.reads, []);
    assert.deepEqual(db.logs, []);
    assert.deepEqual(trace, ['commit', 'end']);
  } finally {
    await server.close();
  }
});

// --- the stream --------------------------------------------------------------------

test('the archive holds the selected files under their planned names, each CRC-32 true to its bytes', STREAMED, async () => {
  const trace = [];
  const materials = {
    m1: fileMaterial('s1', 'Slides.pdf'),
    m2: fileMaterial('s1', 'slides.pdf', { storagePath: 'session-materials/s1/other.pdf' }),
    m3: fileMaterial('s2', '../../notes.txt', { storagePath: 'session-materials/s2/notes.txt' }),
  };
  const bytes = {
    'session-materials/s1/Slides.pdf': Buffer.from('%PDF first deck bytes'),
    'session-materials/s1/other.pdf': Buffer.from('%PDF second deck, a little longer'),
    'session-materials/s2/notes.txt': Buffer.from('plain notes\n'),
  };
  const db = makeDb({ materials, events: trace });
  const bucket = makeBucket(Object.fromEntries(Object.entries(bytes).map(([path, b]) => [path, { bytes: b }])));
  const server = await serve(createDownloadSessionMaterialsArchiveHandler({ db, auth, getConfig, bucket, now, log: QUIET }), trace);
  try {
    const response = await post(server.port, { materialIds: ['m1', 'm2', 'm3'] });
    assert.equal(response.status, 200);
    assert.equal(response.headers['content-type'], 'application/zip');
    assert.equal(response.headers['content-disposition'], 'attachment; filename="session-materials.zip"');
    assert.equal(response.headers['cache-control'], 'private, max-age=0, no-store');
    assert.equal(response.headers['content-length'], undefined);
    assert.equal(response.headers['transfer-encoding'], 'chunked');

    const entries = readZip(response.body);
    assert.deepEqual(entries.map((entry) => entry.name), ['s1/Slides.pdf', 's1/slides (2).pdf', 's2/-..-notes.txt']);
    const expected = [bytes['session-materials/s1/Slides.pdf'], bytes['session-materials/s1/other.pdf'], bytes['session-materials/s2/notes.txt']];
    entries.forEach((entry, index) => {
      assert.equal(entry.method, 0, `${entry.name} is stored, not deflated`);
      assert.ok(entry.flags & 0x800, `${entry.name} is flagged UTF-8`);
      assert.equal(entry.crc32, zlib.crc32(expected[index]), `${entry.name} CRC-32`);
      assert.deepEqual(entry.data, expected[index], `${entry.name} bytes`);
    });

    // One read stream at a time, in the order the admin asked.
    assert.equal(bucket.state.maxOpen, 1);
    assert.deepEqual(bucket.state.reads, ['session-materials/s1/Slides.pdf', 'session-materials/s1/other.pdf', 'session-materials/s2/notes.txt']);

    // One audit row per material, committed before the first byte.
    assert.deepEqual(db.logs.map((row) => row.data), ['m1', 'm2', 'm3'].map((id) => ({
      action: ARCHIVE_ACTION,
      docPath: `session_materials/${id}`,
      uid: 'staff-1',
      email: STAFF,
      at: new Date(T0),
    })));
    assert.ok(db.logs.every((row) => row.path.startsWith('admin_logs/')));
    assert.equal(trace[0], 'commit');
    assert.ok(trace.indexOf('write') > 0);
    assert.equal(trace.at(-1), 'end');
    assert.ok(!trace.includes('destroy'));
  } finally {
    await server.close();
  }
});

test('a Storage stream that fails part way destroys the response: never ended, no uncaught error', STREAMED, async () => {
  const trace = [];
  const materials = { m1: fileMaterial('s1', 'a.pdf'), m2: fileMaterial('s1', 'b.pdf') };
  const bucket = makeBucket({
    'session-materials/s1/a.pdf': { bytes: Buffer.from('first file bytes') },
    'session-materials/s1/b.pdf': { bytes: Buffer.from('second file bytes'), failAfterFirstChunk: true },
  });
  const server = await serve(
    createDownloadSessionMaterialsArchiveHandler({ db: makeDb({ materials, events: trace }), auth, getConfig, bucket, now, log: QUIET }),
    trace,
  );
  try {
    const uncaught = await withUncaught(async () => {
      await assert.rejects(post(server.port, { materialIds: ['m1', 'm2'] }));
    });
    assert.deepEqual(uncaught, []);
    assert.ok(trace.includes('destroy'), 'the response is destroyed');
    assert.ok(!trace.includes('end'), 'the response is never ended');
    assert.equal(bucket.state.maxOpen, 1);
  } finally {
    await server.close();
  }
});

test('a Storage stream shorter than its stated size destroys the response: never ended, no uncaught error', STREAMED, async () => {
  const trace = [];
  const materials = { m1: fileMaterial('s1', 'a.pdf') };
  const bucket = makeBucket({ 'session-materials/s1/a.pdf': { bytes: Buffer.from('short'), size: '50' } });
  const server = await serve(
    createDownloadSessionMaterialsArchiveHandler({ db: makeDb({ materials, events: trace }), auth, getConfig, bucket, now, log: QUIET }),
    trace,
  );
  try {
    const uncaught = await withUncaught(async () => {
      await assert.rejects(post(server.port, { materialIds: ['m1'] }));
    });
    assert.deepEqual(uncaught, []);
    assert.ok(trace.includes('destroy'));
    assert.ok(!trace.includes('end'));
  } finally {
    await server.close();
  }
});

test('when the admin leaves mid-archive, the open Storage stream is destroyed', STREAMED, async () => {
  const trace = [];
  const materials = { m1: fileMaterial('s1', 'a.pdf') };
  const bucket = makeBucket({ 'session-materials/s1/a.pdf': { bytes: Buffer.from('x'.repeat(4096)), stallAfterFirstChunk: true } });
  const server = await serve(
    createDownloadSessionMaterialsArchiveHandler({ db: makeDb({ materials, events: trace }), auth, getConfig, bucket, now, log: QUIET }),
    trace,
  );
  try {
    await assert.rejects(post(server.port, { materialIds: ['m1'] }, { onFirstChunk: (request) => request.destroy() }));
    await until(() => bucket.state.streams[0]?.destroyed === true, 'the read stream to be destroyed');
    assert.ok(!trace.includes('end'));
  } finally {
    await server.close();
  }
});

test('when the admin leaves while the files are checked, no Storage read starts, no row is written, and the handler returns', STREAMED, async () => {
  const trace = [];
  let openGate;
  const existsGate = new Promise((resolve) => { openGate = resolve; });
  const db = makeDb({ materials: { m1: fileMaterial('s1', 'a.pdf') }, events: trace });
  const bucket = makeBucket({ 'session-materials/s1/a.pdf': { bytes: Buffer.from('alpha') } }, { existsGate });
  const server = await serve(createDownloadSessionMaterialsArchiveHandler({ db, auth, getConfig, bucket, now, log: QUIET }), trace);
  try {
    const leaving = post(server.port, { materialIds: ['m1'] }, { abortAfterMs: 50 });
    await until(() => bucket.state.existsCalls === 1, 'the file check to start');
    await assert.rejects(leaving);
    // The response is closed while exists() is still waiting.
    await new Promise((resolve) => setTimeout(resolve, 50));
    openGate();
    await until(() => server.state.handled === 1, 'the handler to return');
    assert.deepEqual(bucket.state.reads, []);
    assert.deepEqual(db.logs, []);
    assert.ok(!trace.includes('write'));
  } finally {
    openGate();
    await server.close();
  }
});

test('when the admin leaves while the audit rows commit, no Storage read starts and the handler returns', STREAMED, async () => {
  const trace = [];
  let openGate;
  const commitGate = new Promise((resolve) => { openGate = resolve; });
  const db = makeDb({ materials: { m1: fileMaterial('s1', 'a.pdf') }, events: trace, commitGate });
  const bucket = makeBucket({ 'session-materials/s1/a.pdf': { bytes: Buffer.from('alpha') } });
  const server = await serve(createDownloadSessionMaterialsArchiveHandler({ db, auth, getConfig, bucket, now, log: QUIET }), trace);
  try {
    const leaving = post(server.port, { materialIds: ['m1'] }, { abortAfterMs: 50 });
    await assert.rejects(leaving);
    await new Promise((resolve) => setTimeout(resolve, 50));
    openGate();
    await until(() => server.state.handled === 1, 'the handler to return');
    // The rows were already on their way; the archive is not built.
    assert.deepEqual(bucket.state.reads, []);
    assert.equal(bucket.state.open, 0);
    assert.ok(!trace.includes('write'));
  } finally {
    openGate();
    await server.close();
  }
});

test('once the archive has stopped, the next entry opens no Storage read', STREAMED, async () => {
  const res = new Writable({ write(_chunk, _encoding, callback) { callback(); } });
  res.status = () => res;
  res.set = () => res;
  const bucket = makeBucket({
    'session-materials/s1/a.pdf': { bytes: Buffer.from('first') },
    'session-materials/s1/b.pdf': { bytes: Buffer.from('second') },
  });
  const first = bucket.file('session-materials/s1/a.pdf');
  const open = first.createReadStream;
  // The admin leaves the moment the first file has been read, before yazl
  // asks for the second.
  first.createReadStream = () => {
    const stream = open();
    stream.on('end', () => res.emit('close'));
    return stream;
  };
  const mtime = new Date(T0);
  await streamArchive({
    entries: [
      { file: first, size: 5, name: 's1/a.pdf', mtime },
      { file: bucket.file('session-materials/s1/b.pdf'), size: 6, name: 's1/b.pdf', mtime },
    ],
    res,
    log: QUIET,
  });
  await new Promise((resolve) => setTimeout(resolve, 50));
  assert.deepEqual(bucket.state.reads, ['session-materials/s1/a.pdf']);
});

// --- the deployed wrappers -----------------------------------------------------------

test('the deployed endpoints answer the preflight from an allowed origin, not 405', async () => {
  const previous = process.env.EVENT_ALLOWED_ORIGINS;
  process.env.EVENT_ALLOWED_ORIGINS = 'https://admin.example.test';
  try {
    for (const name of ['listAllSessionMaterials', 'downloadSessionMaterialsArchive']) {
      const res = fakeRes();
      res.send = (body) => { res.body = body; return res; };
      await handlers[name]({ method: 'OPTIONS', headers: { origin: 'https://admin.example.test' } }, res);
      assert.equal(res.statusCode, 204, name);
      assert.equal(res.headers['Access-Control-Allow-Origin'], 'https://admin.example.test');
      assert.match(res.headers['Access-Control-Allow-Headers'], /Authorization/);
    }
    assert.equal(handlers.downloadSessionMaterialsArchive.__endpoint.timeoutSeconds, 540);
  } finally {
    if (previous === undefined) delete process.env.EVENT_ALLOWED_ORIGINS;
    else process.env.EVENT_ALLOWED_ORIGINS = previous;
  }
});
