'use strict';
// The Airtable client against a fake fetch. No test calls the real API.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const {
  AirtableError, readAirtableSource, listAirtableRecords, airtableOrigin, redact,
  internals: { MIN_REQUEST_GAP_MS, RATE_LIMIT_WAIT_MS, MAX_PAGES, LIST_BUDGET_MS },
} = require('./airtableClient.cjs');

const TOKEN = 'pat' + 'FAKEfake000000.' + '0'.repeat(64);
const BASE = 'appAAAAAAAAAAAAAA';
const TABLE = 'tblBBBBBBBBBBBBBB';
const VIEW = 'viwCCCCCCCCCCCCCC';
const fieldMap = { externalId: null, email: 'Email', title: 'Title', description: 'Description', organization: 'Organization', format: 'Format', consent: 'Consent' };
const source = { enabled: true, baseId: BASE, table: TABLE, view: VIEW, fieldMap, scheduleMinutes: 0 };
const rec = (n) => ({ id: `rec${String(n).padStart(14, '0')}`, fields: { Title: `Pitch ${n}` } });

function response(status, body) {
  return { ok: status >= 200 && status < 300, status, async json() { return body; } };
}

/** A fake Airtable list endpoint: answers queued responses in order. */
function fakeFetch(answers) {
  const calls = [];
  const fetchImpl = async (url, init) => {
    calls.push({ url: new URL(url), init });
    const next = answers.shift();
    if (!next) throw new Error('unexpected request');
    if (next instanceof Error) throw next;
    return next;
  };
  return { fetchImpl, calls };
}

function clock() {
  let t = 1_000_000;
  const waits = [];
  return { now: () => t, sleep: async (ms) => { waits.push(ms); t += ms; }, waits };
}

test('connection settings accept Airtable ids and names, and refuse malformed ones', () => {
  const ok = readAirtableSource({ ...source, table: '  Session pitches ', view: '', extra: 'dropped' });
  assert.equal(ok.ok, true);
  assert.deepEqual(ok.value, { ...source, table: 'Session pitches', view: null });
  assert.equal(readAirtableSource(source).value.view, VIEW);
  for (const [patch, pattern] of [
    [{ baseId: 'appShort' }, /baseId/],
    [{ baseId: 'https://example.test/app' }, /baseId/],
    [{ table: '' }, /table: is required/],
    [{ table: 'tblShort' }, /17 characters/],
    [{ view: 'viwShort' }, /17 characters/],
    [{ table: 'Line\nbreak' }, /line breaks/],
    [{ table: 'x'.repeat(101) }, /100 characters/],
    [{ scheduleMinutes: 5 }, /scheduleMinutes/],
    [{ enabled: 'yes' }, /enabled/],
    [{ fieldMap: { ...fieldMap, consent: '' } }, /fieldMap.consent: is required/],
    [{ fieldMap: { ...fieldMap, email: 7 } }, /fieldMap.email: must be text/],
    [{ fieldMap: { ...fieldMap, title: 'Email' } }, /one pitch field only/],
  ]) {
    const result = readAirtableSource({ ...source, ...patch });
    assert.equal(result.ok, false, JSON.stringify(patch));
    assert.match(result.message, pattern);
  }
});

test('only the Functions emulator may use a loopback origin', () => {
  assert.equal(airtableOrigin({}), 'https://api.airtable.com');
  assert.equal(airtableOrigin({ EVENT_AIRTABLE_API_ORIGIN: 'http://127.0.0.1:5199' }), 'https://api.airtable.com');
  assert.equal(airtableOrigin({ FUNCTIONS_EMULATOR: 'true', EVENT_AIRTABLE_API_ORIGIN: 'https://attacker.example.test' }), 'https://api.airtable.com');
  assert.equal(airtableOrigin({ FUNCTIONS_EMULATOR: 'true', EVENT_AIRTABLE_API_ORIGIN: 'http://127.0.0.1:5199' }), 'http://127.0.0.1:5199');
});

test('pages through every offset with the token in the header only, the mapped fields, and the view', async () => {
  const { fetchImpl, calls } = fakeFetch([
    response(200, { records: [rec(1), rec(2)], offset: 'itrPAGE2/rec00000000000002' }),
    response(200, { records: [rec(3)] }),
  ]);
  const time = clock();
  const result = await listAirtableRecords({ fetchImpl, token: TOKEN, source, env: {}, ...time });
  assert.equal(result.complete, true);
  assert.deepEqual(result.records.map((r) => r.id), [rec(1).id, rec(2).id, rec(3).id]);
  assert.equal(calls.length, 2);
  for (const { url, init } of calls) {
    assert.equal(url.origin, 'https://api.airtable.com');
    assert.equal(url.pathname, `/v0/${BASE}/${TABLE}`);
    assert.equal(url.searchParams.get('view'), VIEW);
    assert.equal(url.searchParams.get('pageSize'), '100');
    assert.deepEqual(url.searchParams.getAll('fields[]').sort(), ['Consent', 'Description', 'Email', 'Format', 'Organization', 'Title']);
    assert.equal(init.headers.Authorization, `Bearer ${TOKEN}`);
    assert.equal(init.method, 'GET');
    assert.ok(!url.toString().includes(TOKEN));
  }
  assert.equal(calls[0].url.searchParams.get('offset'), null);
  assert.equal(calls[1].url.searchParams.get('offset'), 'itrPAGE2/rec00000000000002');
  // Two requests are spaced to stay under five per second.
  assert.deepEqual(time.waits, [MIN_REQUEST_GAP_MS]);
});

test('encodes a table name and stops at the page limit as an incomplete read', async () => {
  const answers = Array.from({ length: MAX_PAGES }, (_, i) => response(200, { records: [rec(i)], offset: `itr${i}` }));
  const { fetchImpl, calls } = fakeFetch(answers);
  const result = await listAirtableRecords({ fetchImpl, token: TOKEN, source: { ...source, table: 'Session pitches/2027' }, env: {}, ...clock() });
  assert.equal(result.complete, false);
  assert.equal(result.records.length, MAX_PAGES);
  assert.equal(calls.length, MAX_PAGES);
  assert.equal(calls[0].url.pathname, `/v0/${BASE}/Session%20pitches%2F2027`);
});

test('waits 30 seconds after a 429 and retries, then succeeds', async () => {
  const { fetchImpl, calls } = fakeFetch([response(429, { errors: [{ error: 'RATE_LIMIT_REACHED' }] }), response(200, { records: [rec(1)] })]);
  const time = clock();
  const result = await listAirtableRecords({ fetchImpl, token: TOKEN, source, env: {}, ...time });
  assert.equal(result.records.length, 1);
  assert.equal(calls.length, 2);
  assert.ok(time.waits.includes(RATE_LIMIT_WAIT_MS));
});

test('reports a lasting 429 and other refusals with a safe code and message', async () => {
  const cases = [
    [[response(429, {}), response(429, {}), response(429, {})], 'rate-limited'],
    [[response(401, { error: { type: 'AUTHENTICATION_REQUIRED', message: `bad ${TOKEN}` } })], 'token-rejected'],
    [[response(403, { error: { type: 'INVALID_PERMISSIONS_OR_MODEL_NOT_FOUND' } })], 'forbidden'],
    [[response(404, { error: 'NOT_FOUND' })], 'not-found'],
    [[response(422, { error: { type: 'UNKNOWN_FIELD_NAME', message: 'Unknown field name: "Consent"' } })], 'invalid-request'],
    [[response(503, {}), response(503, {}), response(503, {})], 'unavailable'],
    [[new Error(`socket closed for ${TOKEN}`), new Error('again'), new Error('again')], 'network'],
    [[response(200, { nothing: true })], 'bad-response'],
    [[response(200, { records: [{ id: 'not-a-record' }] })], 'bad-response'],
  ];
  for (const [answers, code] of cases) {
    const { fetchImpl } = fakeFetch(answers);
    await assert.rejects(listAirtableRecords({ fetchImpl, token: TOKEN, source, env: {}, ...clock() }), (err) => {
      assert.ok(err instanceof AirtableError);
      assert.equal(err.code, code);
      assert.ok(!err.message.includes(TOKEN), err.message);
      assert.ok(!err.message.includes('patFAKE'), err.message);
      return true;
    });
  }
  const { fetchImpl } = fakeFetch([response(422, { error: { type: 'UNKNOWN_FIELD_NAME' } })]);
  await assert.rejects(listAirtableRecords({ fetchImpl, token: TOKEN, source, env: {}, ...clock() }), /UNKNOWN_FIELD_NAME/);
});

test('stops with a stated reason before rate-limit waits pass the run budget', async () => {
  // Each page meets two 429s before it succeeds: 60 seconds of waiting.
  const answers = Array.from({ length: MAX_PAGES }, (_, i) => [response(429, {}), response(429, {}), response(200, { records: [rec(i)], offset: `itr${i}` })]).flat();
  const { fetchImpl } = fakeFetch(answers);
  const time = clock();
  const start = time.now();
  await assert.rejects(listAirtableRecords({ fetchImpl, token: TOKEN, source, env: {}, ...time }), (err) => {
    assert.ok(err instanceof AirtableError);
    assert.equal(err.code, 'timed-out');
    return true;
  });
  assert.ok(time.now() - start <= LIST_BUDGET_MS, `waited ${time.now() - start} ms`);
});

test('refuses to run without a token', async () => {
  const { fetchImpl, calls } = fakeFetch([]);
  await assert.rejects(listAirtableRecords({ fetchImpl, token: '', source, env: {}, ...clock() }), { code: 'no-token' });
  assert.equal(calls.length, 0);
});

test('redact removes the token, token-shaped strings and bearer headers', () => {
  const text = `Authorization: Bearer ${TOKEN}; token=${TOKEN}; other=patABCDEFGHIJKLMN.123; legacy=keyABCDEFGHIJKLMN`;
  const out = redact(text, TOKEN);
  assert.ok(!out.includes(TOKEN));
  assert.ok(!out.includes('patABCDEFGHIJKLMN'));
  assert.ok(!out.includes('keyABCDEFGHIJKLMN'));
  assert.match(out, /\[redacted\]/);
});
