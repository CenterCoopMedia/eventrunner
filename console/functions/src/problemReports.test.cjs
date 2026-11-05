'use strict';

const assert = require('node:assert/strict');
const { test } = require('node:test');
const { makeFakeDb, makeReq, makeRes } = require('./fakes.cjs');
const { cleanPageUrl, readReport, redact, reportOriginAllowed, reportProblemHandler } = require('./problemReports.cjs');

const jwt = (aud) => `h.${Buffer.from(JSON.stringify({ aud })).toString('base64url')}.s`;
const user = (overrides = {}) => ({ uid: 'u1', email: 'Pat@Example.org', email_verified: true, ...overrides });
const verifier = (decoded) => ({ calls: [], async verifyIdToken(token, revoked) { this.calls.push({ token, revoked }); if (!decoded) throw new Error('bad'); return decoded; } });
const INTAKE = { url: 'https://triage.example/intake', secret: 's', accessId: 'id', accessSecret: 'as' };
const BODY = { category: 'bug', description: 'The save button does nothing.', url: 'https://nclocal.eventrunner.org/admin/pitches?token=x', surface: 'admin', site: 'nclocal', version: 'abc123',
  consoleLogs: [{ level: 'error', message: 'Bearer abc.def failed for pat@example.org' }] };

function setup({ seed = {}, consoleUser = user(), clientUser = user(), fetchStatus = 200, extraProjects = [] } = {}) {
  const sent = [];
  const auth = verifier(consoleUser);
  const clientAuth = verifier(clientUser);
  const deps = {
    db: makeFakeDb(seed), auth, authFor: () => clientAuth, consoleProject: 'er-console', extraProjects, intake: INTAKE, now: () => 0, log: { error() {} },
    fetch: async (url, init) => { sent.push({ url, init, body: JSON.parse(init.body) }); return { ok: fetchStatus === 200, status: fetchStatus, json: async () => ({ success: true, id: `er_${JSON.parse(init.body).request_id}` }) }; },
  };
  return { deps, sent, auth, clientAuth };
}

test('a console user report is forwarded with the verified email, no query and redacted logs', async () => {
  const { deps, sent, auth } = setup();
  const res = makeRes();
  await reportProblemHandler(deps)(makeReq({ token: jwt('er-console'), body: { ...BODY, surface: 'console', site: 'ignored' } }), res);
  assert.equal(res.statusCode, 200);
  assert.deepEqual(auth.calls[0].revoked, true);
  const { body, init } = sent[0];
  assert.equal(init.headers.Authorization, 'Bearer s');
  assert.equal(init.headers['CF-Access-Client-Id'], 'id');
  assert.equal(body.email, 'pat@example.org');
  assert.equal(body.url, 'https://nclocal.eventrunner.org/admin/pitches');
  assert.equal(body.site, '');
  assert.match(body.request_id, /^[a-f0-9]{32}$/);
  assert.deepEqual(body.consoleLogs, [{ level: 'error', message: 'Bearer [removed] failed for [email removed]' }]);
  assert.equal(res.body.id, `er_${body.request_id}`);
});

test('a client admin is accepted only for a project this console built or listed', async () => {
  const built = { 'applications/a1': { status: 'ready', answers: { webAddress: { name: 'nclocal' } } } };
  let s = setup({ seed: built });
  let res = makeRes();
  await reportProblemHandler(s.deps)(makeReq({ token: jwt('er-nclocal'), body: BODY }), res);
  assert.equal(res.statusCode, 200);
  assert.equal(s.sent[0].body.site, 'nclocal');

  s = setup({ seed: { 'applications/a1': { status: 'draft', answers: { webAddress: { name: 'nclocal' } } } } });
  res = makeRes();
  await reportProblemHandler(s.deps)(makeReq({ token: jwt('er-nclocal'), body: BODY }), res);
  assert.equal(res.statusCode, 401);
  assert.equal(s.clientAuth.calls.length, 0, 'an unknown project is never verified');
  assert.equal(s.sent.length, 0);

  s = setup({ extraProjects: ['legacy-site'] });
  res = makeRes();
  await reportProblemHandler(s.deps)(makeReq({ token: jwt('legacy-site'), body: BODY }), res);
  assert.equal(res.statusCode, 200);
});

test('no token, a bad token or an unverified email is refused before anything is sent', async () => {
  for (const [token, options] of [[null, {}], [jwt('er-console'), { consoleUser: null }], [jwt('er-console'), { consoleUser: user({ email_verified: false }) }], ['junk', {}]]) {
    const s = setup(options);
    const res = makeRes();
    await reportProblemHandler(s.deps)(makeReq({ token, body: BODY }), res);
    assert.equal(res.statusCode, 401);
    assert.equal(s.sent.length, 0);
  }
});

test('a short description names its field; a refused forward is a plain 502', async () => {
  let s = setup();
  let res = makeRes();
  await reportProblemHandler(s.deps)(makeReq({ token: jwt('er-console'), body: { ...BODY, description: 'short' } }), res);
  assert.equal(res.statusCode, 400);
  assert.equal(res.body.error.field, 'description');
  s = setup({ fetchStatus: 403 });
  res = makeRes();
  await reportProblemHandler(s.deps)(makeReq({ token: jwt('er-console'), body: BODY }), res);
  assert.equal(res.statusCode, 502);
  assert.equal(res.body.error.message, 'The report could not be sent. Try again in a minute.');
});

test('one person gets ten reports an hour', async () => {
  const s = setup();
  for (let i = 0; i < 10; i += 1) {
    const res = makeRes();
    await reportProblemHandler(s.deps)(makeReq({ token: jwt('er-console'), body: BODY }), res);
    assert.equal(res.statusCode, 200);
  }
  const res = makeRes();
  await reportProblemHandler(s.deps)(makeReq({ token: jwt('er-console'), body: BODY }), res);
  assert.equal(res.statusCode, 429);
});

test('origins, page addresses and fields are bounded', () => {
  assert.ok(reportOriginAllowed('https://console.eventrunner.org'));
  assert.ok(reportOriginAllowed('https://er-x.web.app'));
  assert.ok(!reportOriginAllowed('https://eventrunner.org.evil.test'));
  assert.ok(!reportOriginAllowed('http://nclocal.eventrunner.org'));
  assert.equal(cleanPageUrl('https://x.eventrunner.org/a?b=c#d'), 'https://x.eventrunner.org/a#d');
  assert.equal(cleanPageUrl('https://user:pw@x.eventrunner.org/'), null);
  assert.equal(cleanPageUrl('https://example.com/'), null);
  assert.equal(redact('see ?oobCode=123&x=1 token eyJabcdefghij.abcdefghij.sig'), 'see ?oobCode=[removed]&x=1 token [token removed]');
  assert.throws(() => readReport({ ...BODY, category: 'other' }), (err) => err.field === 'category');
  assert.throws(() => readReport({ ...BODY, surface: 'public' }), { status: 400 });
});
