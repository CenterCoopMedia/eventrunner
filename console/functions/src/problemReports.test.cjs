'use strict';

const assert = require('node:assert/strict');
const { test } = require('node:test');
const { makeFakeDb, makeReq, makeRes } = require('./fakes.cjs');
const { cleanPageUrl, readReport, redact, reportOriginAllowed, reportProblemHandler } = require('./problemReports.cjs');
const { getProblemReportReceipts, readProblemReportScreenshot } = require('./problemReportReceipts.cjs');
const { notifyProblemReport } = require('./applicationStatus.cjs');
const { notifySubmissionOnce } = require('shared/operatorAlert');

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
    db: makeFakeDb(seed), auth, authFor: () => clientAuth, consoleProject: 'er-console', extraProjects, intake: INTAKE, now: () => 0, log: { error() {}, info() {} },
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
  assert.equal(body.surface, 'console');
  assert.match(body.request_id, /^[a-f0-9]{32}$/);
  assert.deepEqual(body.consoleLogs, [{ level: 'error', message: 'Bearer [removed] failed for [email removed]' }]);
  assert.equal(res.body.id, `er_${body.request_id}`);
});

test('a client admin is accepted only for a project this console built or listed', async () => {
  for (const projectId of ['er-nclocal', 'er-nclocal-f55ff16f66f43360']) {
    const built = {
      'applications/a1': { status: 'ready', answers: { webAddress: { name: 'nclocal' } } },
      'console_builds/a1': { resources: { projectId } },
    };
    const s = setup({ seed: built });
    const res = makeRes();
    await reportProblemHandler(s.deps)(makeReq({ token: jwt(projectId), body: BODY }), res);
    assert.equal(res.statusCode, 200);
    assert.equal(s.sent[0].body.site, projectId, 'the site is the recorded project, not the browser value');
    assert.equal(s.sent[0].body.surface, 'admin');
  }

  let s = setup({ seed: { 'applications/a1': { status: 'draft', answers: { webAddress: { name: 'nclocal' } } }, 'console_builds/a1': { resources: { projectId: 'er-nclocal' } } } });
  let res = makeRes();
  await reportProblemHandler(s.deps)(makeReq({ token: jwt('er-nclocal'), body: BODY }), res);
  assert.equal(res.statusCode, 401);
  assert.equal(s.clientAuth.calls.length, 0, 'an unknown project is never verified');
  assert.equal(s.sent.length, 0);

  s = setup({ extraProjects: ['legacy-site'] });
  res = makeRes();
  await reportProblemHandler(s.deps)(makeReq({ token: jwt('legacy-site'), body: BODY }), res);
  assert.equal(res.statusCode, 200);
});

test('client report identity uses saved build resources before approved settings and never guesses a project', async () => {
  const app = { status: 'ready', review: { settings: { projectId: 'er-approved' } }, answers: { webAddress: { name: 'nclocal' } } };
  for (const [build, projectId] of [[undefined, 'er-approved'], [{ resources: { projectId: 'er-recorded' } }, 'er-recorded']]) {
    const s = setup({ seed: { 'applications/a1': app, ...(build ? { 'console_builds/a1': build } : {}) } });
    const res = makeRes();
    await reportProblemHandler(s.deps)(makeReq({ token: jwt(projectId), body: BODY }), res);
    assert.equal(res.statusCode, 200);
  }
  const s = setup({ seed: { 'applications/a1': { ...app, review: null } } });
  const res = makeRes();
  await reportProblemHandler(s.deps)(makeReq({ token: jwt('er-nclocal'), body: BODY }), res);
  assert.equal(res.statusCode, 401);
  assert.equal(s.clientAuth.calls.length, 0);
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

test('a short description names its field and creates no report', async () => {
  const s = setup();
  const res = makeRes();
  await reportProblemHandler(s.deps)(makeReq({ token: jwt('er-console'), body: { ...BODY, description: 'short' } }), res);
  assert.equal(res.statusCode, 400);
  assert.equal(res.body.error.field, 'description');
  assert.equal(s.sent.length, 0);
});

test('a plain report saves one receipt even if the triage relay is down', async () => {
  const { deps, sent } = setup({ fetchStatus: 403 });
  const body = { ...BODY, submissionKey: 'a'.repeat(32) };
  const first = makeRes();
  const repeat = makeRes();
  await reportProblemHandler(deps)(makeReq({ token: jwt('er-console'), body }), first);
  await reportProblemHandler(deps)(makeReq({ token: jwt('er-console'), body }), repeat);
  assert.equal(first.statusCode, 200);
  assert.deepEqual(repeat.body, first.body);
  assert.equal(sent.length, 1);
  const id = sent[0].body.request_id;
  assert.equal(deps.db.read(`problem_report_receipts/${id}`).description, BODY.description);
});

test('another trigger invocation cannot repeat an attempted delivery', async () => {
  const db = makeFakeDb({ 'problem_report_receipts/receipt-1234': { screenshotCount: 0 } });
  const ref = db.doc('problem_report_receipts/receipt-1234');
  let attempts = 0;
  const notify = async () => { attempts += 1; throw new Error('mail stalled'); };
  await assert.rejects(() => notifySubmissionOnce({ db, ref, notify }), /mail stalled/);
  await notifySubmissionOnce({ db, ref, notify });
  assert.equal(attempts, 1);
});

test('a Console alert reaches the current operator list with a private receipt link', async () => {
  const db = makeFakeDb({ 'console_config/operators': { emails: [' Ops@Example.org ', 'ops@example.org'] } });
  const sent = [];
  const mailer = { sendSubmissionAlert: async (mail) => sent.push(mail) };
  const id = 'receipt-1234';
  await notifyProblemReport({
    db, mailer, log: { error() {} }, publicUrl: 'https://console.example.test', now: () => 0,
  }, { id, screenshotCount: 2, project: 'event-demo' });
  assert.equal(sent.length, 1);
  assert.equal(sent[0].to, 'ops@example.org');
  assert.equal(sent[0].message.kind, 'problem-report');
  assert.deepEqual(sent[0].message.fields, { site: 'event-demo', record: id, screenshots: 2 });
  assert.equal(sent[0].message.url, 'https://console.example.test/review/problem-reports?id=receipt-1234');
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

test('screenshots stay in the Console receipt, out of the relay, and require operator access', async () => {
  const operator = { email: 'ops@example.test' };
  const { deps, sent } = setup({ fetchStatus: 502, seed: { 'console_config/operators': { emails: [operator.email] } } });
  const image = await require('sharp')({ create: { width: 12, height: 12, channels: 3, background: 'white' } }).png().toBuffer();
  const replays = [];
  deps.log.info = (...entry) => replays.push(entry);
  const body = { ...BODY, submissionKey: 'f'.repeat(32), screenshots: [image.toString('base64')] };
  const res = makeRes();
  await reportProblemHandler(deps)(makeReq({ token: jwt('er-console'), body }), res);
  assert.equal(res.statusCode, 200, 'the Console receipt survives a relay refusal');
  const id = res.body.id;
  const retry = makeRes();
  await reportProblemHandler(deps)(makeReq({ token: jwt('er-console'), body }), retry);
  assert.deepEqual(retry.body, { id });
  assert.deepEqual(replays, [['reportProblem: replay matched an existing Console receipt', id]]);
  assert.equal(sent.length, 1);
  assert.equal(sent[0].body.request_id, id);
  assert.ok(!('screenshots' in sent[0].body));
  assert.ok(!JSON.stringify(sent[0].body).includes('problem-reports'));
  const receipt = await getProblemReportReceipts(deps, { user: operator, body: { id } });
  assert.equal(receipt.body.receipt.screenshotCount, 1);
  assert.equal(receipt.body.receipt.reporterEmail, 'pat@example.org');
  assert.ok(!('image' in receipt.body.receipt));
  const list = await getProblemReportReceipts(deps, { user: operator, body: {} });
  assert.ok(!('reporterEmail' in list.body.receipts[0]));
  await assert.rejects(() => getProblemReportReceipts(deps, {
    user: { email: 'client@example.test' }, body: { id },
  }), { status: 403 });
  await assert.rejects(() => readProblemReportScreenshot(deps, {
    user: { email: 'client@example.test' }, body: { id, index: 0 },
  }), { status: 403 });
  const view = await readProblemReportScreenshot(deps, { user: operator, body: { id, index: 0 } });
  assert.equal((await require('sharp')(Buffer.from(view.body.image, 'base64')).metadata()).format, 'webp');
  await assert.rejects(() => readProblemReportScreenshot({ ...deps, now: () => 30 * 24 * 60 * 60 * 1000 }, {
    user: operator, body: { id, index: 0 },
  }), { status: 404 });
});

test('origins, page addresses and fields are bounded', () => {
  assert.ok(reportOriginAllowed('https://console.eventrunner.org'));
  assert.ok(reportOriginAllowed('https://er-x.web.app'));
  assert.ok(!reportOriginAllowed('https://eventrunner.org.evil.test'));
  assert.ok(!reportOriginAllowed('http://nclocal.eventrunner.org'));
  assert.equal(cleanPageUrl('https://x.eventrunner.org/a?b=c#d'), 'https://x.eventrunner.org/a');
  assert.equal(cleanPageUrl('https://user:pw@x.eventrunner.org/'), null);
  assert.equal(cleanPageUrl('https://example.com/'), null);
  assert.equal(redact('see ?oobCode=123&x=1 token eyJabcdefghij.abcdefghij.sig'), 'see ?oobCode=[removed]&x=1 token [token removed]');
  assert.throws(() => readReport({ ...BODY, category: 'other' }), (err) => err.field === 'category');
  assert.throws(() => readReport({ ...BODY, url: 'https://example.com/' }), { status: 400 });
});

test('signup and invitation fragments are never sent to triage', async () => {
  for (const path of ['/start/link#token=live-signup-secret', '/invite/id?next=1#token=live-invite-secret']) {
    const { deps, sent } = setup();
    const res = makeRes();
    await reportProblemHandler(deps)(makeReq({ token: jwt('er-console'), body: { ...BODY, url: `https://console.eventrunner.org${path}` } }), res);
    assert.equal(res.statusCode, 200);
    assert.equal(sent[0].body.url, `https://console.eventrunner.org${path.split(/[?#]/)[0]}`);
    assert.ok(!JSON.stringify(sent).includes('live-signup-secret'));
    assert.ok(!JSON.stringify(sent).includes('live-invite-secret'));
  }
});
