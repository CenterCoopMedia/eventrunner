'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  createGetSpeakerDiscussionPointsHandler,
  createSaveSpeakerDiscussionPointsHandler,
} = require('./discussionPoints.cjs');
const { createEmailCore } = require('../email/send.cjs');
const { makeSpeakersDb } = require('./speakersFake.cjs');

const T0 = Date.parse('2026-11-13T15:00:00.000Z');
const NOW = () => T0;
const QUIET = { error() {}, warn() {}, info() {} };
const REQUEST_1 = 'request_12345678';
const REQUEST_2 = 'request_abcdefgh';

const CONFIG = {
  event: {
    name: 'Example Summit',
    historicalDemo: false,
    sender: { email: 'events@example.test', name: 'Example Summit' },
    legal: {
      postalAddressHtml: 'Example Org<br>1 Main St',
      supportEmail: 'help@example.test',
    },
  },
  theme: { colors: { primary: 'BRAND', ink: 'INK' } },
  tierA: { publicUrl: 'https://summit.example.test' },
};

const TOKENS = {
  owner: { uid: 'u1', email: 'owner@example.test', email_verified: true },
  other: { uid: 'u2', email: 'other@example.test', email_verified: true },
  admin: { uid: 'admin-1', email: 'admin@example.test', email_verified: true },
};

function seed(overrides = {}) {
  return {
    'config/bootstrap': { adminEmails: ['admin@example.test'], staffEmails: [] },
    'config/event': { ...CONFIG.event },
    'speakers/s1': {
      firstName: 'Rae', lastName: 'Okonkwo', email: 'rae@example.test',
      slug: 'rae-okonkwo', status: 'approved', uid: 'u1',
    },
    'speakers/s2': {
      firstName: 'Bo', lastName: 'Writer', email: 'bo@example.test',
      slug: 'bo-writer', status: 'approved', uid: 'u2',
    },
    'speakers_public/s1': {
      speakerId: 's1', displayName: 'Rae Okonkwo', slug: 'rae-okonkwo',
    },
    ...overrides,
  };
}

function response() {
  return {
    statusCode: null,
    body: null,
    headers: {},
    set(name, value) { this.headers[name] = value; return this; },
    status(code) { this.statusCode = code; return this; },
    json(value) { this.body = value; return this; },
  };
}

function makeHarness({ records = seed(), config = CONFIG, sendEmail, now = NOW } = {}) {
  const db = makeSpeakersDb(records);
  const authChecks = [];
  const auth = {
    async verifyIdToken(token, checkRevoked) {
      authChecks.push({ token, checkRevoked });
      if (!TOKENS[token]) throw new Error('invalid token');
      return TOKENS[token];
    },
  };
  const sent = [];
  const deliver = sendEmail || (async (message) => {
    sent.push(message);
    return { status: 'sent', providerMessageId: `message-${sent.length}` };
  });
  const deps = { db, auth, getConfig: async () => config, sendEmail: deliver, now, log: QUIET };
  const get = createGetSpeakerDiscussionPointsHandler(deps);
  const save = createSaveSpeakerDiscussionPointsHandler(deps);
  const call = async (handler, token, body, method = 'POST') => {
    const res = response();
    await handler({
      method,
      headers: token ? { authorization: `Bearer ${token}` } : {},
      body,
    }, res);
    return res;
  };
  return {
    db,
    sent,
    authChecks,
    get: (token, speakerId = 's1', method) => call(get, token, { speakerId }, method),
    save: (token, body, method) => call(save, token, body, method),
  };
}

function body(text = 'Discuss the reporting process.', requestId = REQUEST_1, expectedRevision = 0) {
  return { speakerId: 's1', text, expectedRevision, requestId };
}

test('the owner reads null before a submission and both endpoints use revocation-checked bearer auth', async () => {
  const h = makeHarness();
  const res = await h.get('owner');
  assert.equal(res.statusCode, 200);
  assert.deepEqual(res.body, { submission: null });
  assert.deepEqual(h.authChecks, [{ token: 'owner', checkRevoked: true }]);
  assert.equal((await h.get('owner', 's1', 'GET')).statusCode, 405);
  assert.equal((await h.save('owner', body(), 'GET')).statusCode, 405);
});

test('strict ownership returns 401 signed out and one 403 for a stranger, an admin and a missing id', async () => {
  const h = makeHarness();
  assert.equal((await h.get(null)).statusCode, 401);
  const other = await h.get('other');
  const admin = await h.get('admin');
  const missing = await h.get('owner', 'missing');
  const removedHarness = makeHarness({
    records: seed({
      'speakers/s1': {
        firstName: 'Rae', lastName: 'Okonkwo', email: 'rae@example.test',
        slug: 'rae-okonkwo', status: 'removed', uid: 'u1',
      },
    }),
  });
  const removed = await removedHarness.get('owner');
  assert.equal(other.statusCode, 403);
  assert.equal(admin.statusCode, 403);
  assert.equal(missing.statusCode, 403);
  assert.equal(removed.statusCode, 403);
  assert.deepEqual(other.body, missing.body, 'the refusal must not reveal whether the speaker id exists');
  assert.deepEqual(other.body, removed.body, 'a removed record uses the same ownership refusal');
  const saveOther = await h.save('other', body());
  const saveMissing = await h.save('owner', { ...body(), speakerId: 'missing' });
  assert.equal(saveOther.statusCode, 403);
  assert.equal(saveMissing.statusCode, 403);
  assert.deepEqual(saveOther.body, saveMissing.body);
  assert.equal(h.db.read('speakers', 's1').discussionPoints, undefined);
});

test('a new submission saves revision 1 and sends safely through the real email core', async () => {
  const db = makeSpeakersDb(seed());
  const provider = {
    name: 'fake',
    messages: [],
    async send(message) {
      this.messages.push(message);
      return { status: 'sent', providerMessageId: 'provider-1' };
    },
  };
  const sendEmail = createEmailCore({
    db,
    provider,
    getConfig: async () => CONFIG,
    sleep: async () => {},
    log: QUIET,
  }).send;
  const auth = {
    async verifyIdToken(token, checkRevoked) {
      assert.equal(token, 'owner');
      assert.equal(checkRevoked, true);
      return TOKENS.owner;
    },
  };
  const handler = createSaveSpeakerDiscussionPointsHandler({
    db, auth, getConfig: async () => CONFIG, sendEmail, now: NOW, log: QUIET,
  });
  const res = response();
  await handler({
    method: 'POST',
    headers: { authorization: 'Bearer owner' },
    body: body('  <img src=x onerror=alert(1)>\r\nOpening question.  '),
  }, res);

  assert.equal(res.statusCode, 200, JSON.stringify(res.body));
  assert.deepEqual(res.body, {
    submission: {
      text: '<img src=x onerror=alert(1)>\nOpening question.',
      revision: 1,
      requestId: REQUEST_1,
      submittedAt: new Date(T0).toISOString(),
      notification: { state: 'accepted' },
    },
  });

  const stored = db.read('speakers', 's1').discussionPoints;
  assert.equal(stored.text, res.body.submission.text);
  assert.equal(stored.revision, 1);
  assert.deepEqual(stored.submittedAt, new Date(T0));
  assert.deepEqual(stored.notification, { state: 'accepted' });
  assert.equal(provider.messages.length, 1);
  const mail = provider.messages[0];
  assert.equal(mail.to, 'help@example.test');
  assert.equal(mail.tag, 'speaker.discussion_points');
  assert.equal(mail.storeRendered, false);
  assert.doesNotMatch(mail.html, /<img src=x/i);
  assert.match(mail.html, /&lt;img src=x onerror=alert\(1\)&gt;/);

  const audit = db.ids('sent_emails').map((id) => db.read('sent_emails', id));
  assert.equal(audit.length, 1);
  assert.equal(audit[0].source, 'speaker-discussion-points');
  assert.deepEqual({
    templateId: audit[0].templateId,
    bodyStored: audit[0].bodyStored,
    subject: audit[0].subject,
    html: audit[0].html,
    text: audit[0].text,
  }, {
    templateId: 'speaker.discussion_points',
    bodyStored: false,
    subject: null,
    html: null,
    text: null,
  });
});

test('an exact request replay returns the current result and does not send again', async () => {
  const h = makeHarness();
  const first = await h.save('owner', body('  One question.  '));
  assert.equal(first.statusCode, 200);
  const replay = await h.save('owner', body('One question.'));
  assert.equal(replay.statusCode, 200);
  assert.deepEqual(replay.body, { ...first.body, replay: true });
  assert.equal(h.sent.length, 1);
  assert.equal(h.db.read('speakers', 's1').discussionPoints.revision, 1);
});

test('rapid saves store every revision but send one organizer email per speaker per 15-minute window', async () => {
  let nowMs = T0;
  const h = makeHarness({ now: () => nowMs });
  const first = await h.save('owner', body('First question.'));
  assert.equal(first.statusCode, 200);
  assert.equal(first.body.submission.notification.state, 'accepted');

  for (const [revision, offset] of [[2, 1000], [3, 15 * 60 * 1000 - 1]]) {
    nowMs = T0 + offset;
    const res = await h.save('owner', body(`Question ${revision}.`, `request_window_${revision}`, revision - 1));
    assert.equal(res.statusCode, 200);
    assert.equal(res.body.submission.revision, revision);
    assert.equal(res.body.submission.notification.state, 'omitted');
    const saved = h.db.read('speakers', 's1').discussionPoints;
    assert.equal(saved.text, `Question ${revision}.`);
    assert.equal(saved.notificationWindowStartedAt, T0, 'suppressed saves do not extend the window');
  }
  assert.equal(h.sent.length, 1);

  // A replay stays idempotent even when a new email window is available.
  nowMs = T0 + 15 * 60 * 1000;
  const replay = await h.save('owner', body('Question 3.', 'request_window_3', 2));
  assert.equal(replay.statusCode, 200);
  assert.equal(replay.body.replay, true);
  assert.equal(replay.body.submission.notification.state, 'omitted');
  assert.equal(h.sent.length, 1);
  assert.equal(h.db.read('speakers', 's1').discussionPoints.notificationWindowStartedAt, T0);

  const next = await h.save('owner', body('Question 4.', 'request_window_4', 3));
  assert.equal(next.statusCode, 200);
  assert.equal(next.body.submission.notification.state, 'accepted');
  assert.equal(h.sent.length, 2, 'a new save at the window boundary can send again');
  assert.equal(h.db.read('speakers', 's1').discussionPoints.notificationWindowStartedAt, nowMs);
  const nextReplay = await h.save('owner', body('Question 4.', 'request_window_4', 3));
  assert.deepEqual(nextReplay.body, { ...next.body, replay: true });
  assert.equal(h.sent.length, 2);
});

test('one speaker cannot consume another speaker notification window', async () => {
  const h = makeHarness();
  await h.save('owner', body());
  const other = await h.save('other', { ...body(), speakerId: 's2' });
  assert.equal(other.statusCode, 200);
  assert.equal(other.body.submission.notification.state, 'accepted');
  assert.equal(h.sent.length, 2);
});

test('a superseded save releases its unused window without sending either stale text or a replay', async () => {
  const h = makeHarness();
  const transaction = h.db.runTransaction.bind(h.db);
  let superseded = false;
  let newer;
  h.db.runTransaction = async (fn) => {
    const result = await transaction(fn);
    if (!superseded && result?.submission?.requestId === REQUEST_1) {
      superseded = true;
      newer = await h.save('owner', body('Newer question.', REQUEST_2, 1));
    }
    return result;
  };

  const older = await h.save('owner', body('Superseded question.'));
  assert.equal(older.statusCode, 409);
  assert.equal(newer.statusCode, 200);
  assert.equal(newer.body.submission.notification.state, 'omitted');
  const current = h.db.read('speakers', 's1').discussionPoints;
  assert.equal(current.text, 'Newer question.');
  assert.equal(current.revision, 2);
  assert.equal(current.notificationWindowStartedAt, null);
  assert.equal(h.sent.length, 0, 'superseded text and the omitted newer update do not send');

  const replay = await h.save('owner', body('Newer question.', REQUEST_2, 1));
  assert.equal(replay.body.replay, true);
  assert.equal(replay.body.submission.notification.state, 'omitted');
  assert.equal(h.sent.length, 0, 'replay does not resend the newer update');
  const next = await h.save('owner', body('Next explicit update.', 'request_next_update', 2));
  assert.equal(next.statusCode, 200);
  assert.equal(next.body.submission.notification.state, 'accepted');
  assert.equal(h.sent.length, 1, 'an explicit update can use the released window immediately');
  assert.equal(h.db.read('speakers', 's1').discussionPoints.text, 'Next explicit update.');
});

test('failed and ambiguous notification attempts keep their window while later saves still store', async () => {
  for (const result of [{ status: 'failed' }, { status: 'failed', ambiguous: true }]) {
    let sends = 0;
    const h = makeHarness({ sendEmail: async () => { sends += 1; return result; } });
    await h.save('owner', body('First question.'));
    const later = await h.save('owner', body('Second question.', REQUEST_2, 1));
    assert.equal(later.statusCode, 200);
    assert.equal(later.body.submission.notification.state, 'omitted');
    assert.equal(h.db.read('speakers', 's1').discussionPoints.text, 'Second question.');
    assert.equal(sends, 1);
  }
});

test('a replay after a failed notification returns the saved failure without another send', async () => {
  let sends = 0;
  const h = makeHarness({
    sendEmail: async () => {
      sends += 1;
      return { status: 'failed', error: 'provider refused' };
    },
  });
  const first = await h.save('owner', body('One question.'));
  assert.equal(first.body.submission.notification.state, 'failed');
  const replay = await h.save('owner', body(' One question. '));
  assert.equal(replay.statusCode, 200);
  assert.deepEqual(replay.body, { submission: first.body.submission, replay: true });
  assert.equal(sends, 1);
});

test('a cold replay of a saved unknown result does not attempt notification again', async () => {
  const submittedAt = new Date(T0 - 1000);
  const h = makeHarness({
    records: seed({
      'speakers/s1': {
        firstName: 'Rae', lastName: 'Okonkwo', email: 'rae@example.test',
        slug: 'rae-okonkwo', status: 'approved', uid: 'u1',
        discussionPoints: {
          text: 'Saved before a process stopped.',
          revision: 1,
          requestId: REQUEST_1,
          submittedAt,
          notification: { state: 'unknown' },
        },
      },
    }),
    sendEmail: async () => { throw new Error('a replay must not send'); },
  });
  const replay = await h.save('owner', body('Saved before a process stopped.'));
  assert.equal(replay.statusCode, 200);
  assert.deepEqual(replay.body, {
    submission: {
      text: 'Saved before a process stopped.',
      revision: 1,
      requestId: REQUEST_1,
      submittedAt: submittedAt.toISOString(),
      notification: { state: 'unknown' },
    },
    replay: true,
  });
});

test('a Firestore transaction body retry still creates one revision and one notification', async () => {
  const h = makeHarness();
  const commit = h.db.runTransaction.bind(h.db);
  let retried = false;
  h.db.runTransaction = async (fn) => {
    if (!retried) {
      retried = true;
      await fn({
        get: (target) => target.get(),
        create() {},
        set() {},
        update() {},
        delete() {},
      });
    }
    return commit(fn);
  };

  const res = await h.save('owner', body('Retried transaction question.'));
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.submission.revision, 1);
  assert.equal(h.db.read('speakers', 's1').discussionPoints.revision, 1);
  assert.equal(h.sent.length, 1);
});

test('ownership removal between transaction attempts refuses the retried save', async () => {
  const h = makeHarness();
  const commit = h.db.runTransaction.bind(h.db);
  let removed = false;
  h.db.runTransaction = async (fn) => {
    if (!removed) {
      removed = true;
      // Firestore discards the first attempt when its read set changes.
      await fn({ get: (ref) => ref.get(), update() {} });
      await h.db.collection('speakers').doc('s1').update({ uid: null, status: 'removed' });
    }
    return commit(fn);
  };
  const res = await h.save('owner', body());
  assert.equal(res.statusCode, 403);
  assert.equal(h.db.read('speakers', 's1').discussionPoints, undefined);
  assert.equal(h.sent.length, 0);
});

test('a changed reused request and a stale revision conflict without changing the saved map', async () => {
  const h = makeHarness();
  assert.equal((await h.save('owner', body('First question.'))).statusCode, 200);
  const reused = await h.save('owner', body('Changed question.'));
  assert.equal(reused.statusCode, 409);
  const stale = await h.save('owner', body('Later question.', REQUEST_2, 0));
  assert.equal(stale.statusCode, 409);
  assert.equal(h.sent.length, 1);
  assert.equal(h.db.read('speakers', 's1').discussionPoints.text, 'First question.');
});

test('a later request replaces the private map without touching pending edits or the public projection', async () => {
  const h = makeHarness();
  await h.save('owner', body('First question.'));
  const later = await h.save('owner', body('Second question.', REQUEST_2, 1));
  assert.equal(later.statusCode, 200);
  assert.equal(later.body.submission.revision, 2);
  assert.equal(later.body.submission.requestId, REQUEST_2);
  const canonical = h.db.read('speakers', 's1');
  assert.equal(canonical.discussionPoints.text, 'Second question.');
  assert.equal(canonical.discussionPoints.revision, 2);
  assert.equal(canonical.pendingEdits, undefined);
  assert.equal(h.db.read('speakers_public', 's1').discussionPoints, undefined);
  const ownRead = await h.get('owner');
  assert.deepEqual(ownRead.body, { submission: later.body.submission });
});

test('missing or unsuccessful notification paths keep the saved text and report a truthful state', async () => {
  const cases = [
    {
      name: 'missing address',
      config: { ...CONFIG, event: { ...CONFIG.event, legal: { ...CONFIG.event.legal, supportEmail: '' } } },
      records: seed({
        'config/event': { ...CONFIG.event, legal: { ...CONFIG.event.legal, supportEmail: '' } },
      }),
      sendEmail: async () => { throw new Error('must not send'); },
      state: 'omitted',
    },
    { name: 'provider refusal', sendEmail: async () => ({ status: 'failed', error: 'refused' }), state: 'failed' },
    { name: 'ambiguous provider result', sendEmail: async () => ({ status: 'failed', ambiguous: true }), state: 'unknown' },
    { name: 'send-once skip', sendEmail: async () => ({ status: 'sent', skipped: true }), state: 'unknown' },
    { name: 'thrown send', sendEmail: async () => { throw new Error('socket closed'); }, state: 'unknown' },
  ];
  for (const scenario of cases) {
    const h = makeHarness({
      records: scenario.records,
      config: scenario.config || CONFIG,
      sendEmail: scenario.sendEmail,
    });
    const res = await h.save('owner', body(`Question for ${scenario.name}.`));
    assert.equal(res.statusCode, 200, scenario.name);
    assert.equal(res.body.submission.notification.state, scenario.state, scenario.name);
    assert.equal(h.db.read('speakers', 's1').discussionPoints.text, `Question for ${scenario.name}.`);
    assert.equal(h.db.read('speakers', 's1').discussionPoints.notification.state, scenario.state);
  }
});

test('a historical demo refuses the save inside the transaction', async () => {
  const h = makeHarness({
    records: seed({ 'config/event': { name: 'Example Summit', historicalDemo: true } }),
  });
  const res = await h.save('owner', body());
  assert.equal(res.statusCode, 403);
  assert.equal(res.body.error.code, 'read-only-demo');
  assert.ok(h.db.reads.includes('config/event'));
  assert.equal(h.db.read('speakers', 's1').discussionPoints, undefined);
  assert.equal(h.sent.length, 0);
});

test('a late result from an older request cannot overwrite the current notification state', async () => {
  let nowMs = T0;
  let startFirst;
  let finishFirst;
  let startSecond;
  let finishSecond;
  let calls = 0;
  const firstStarted = new Promise((resolve) => { startFirst = resolve; });
  const firstResult = new Promise((resolve) => { finishFirst = resolve; });
  const secondStarted = new Promise((resolve) => { startSecond = resolve; });
  const secondResult = new Promise((resolve) => { finishSecond = resolve; });
  const h = makeHarness({
    now: () => nowMs,
    sendEmail: async () => {
      calls += 1;
      if (calls === 1) {
        startFirst();
        return firstResult;
      }
      startSecond();
      return secondResult;
    },
  });

  const older = h.save('owner', body('Older question.'));
  await firstStarted;
  nowMs += 15 * 60 * 1000;
  const newer = h.save('owner', body('Newer question.', REQUEST_2, 1));
  await secondStarted;
  finishFirst({ status: 'failed', error: 'late refusal' });
  await older;

  const pending = h.db.read('speakers', 's1').discussionPoints;
  assert.equal(pending.revision, 2);
  assert.deepEqual(pending.notification, { state: 'unknown' });
  finishSecond({ status: 'sent', providerMessageId: 'newer-message' });
  assert.equal((await newer).body.submission.notification.state, 'accepted');

  const current = h.db.read('speakers', 's1').discussionPoints;
  assert.equal(current.revision, 2);
  assert.equal(current.requestId, REQUEST_2);
  assert.equal(current.text, 'Newer question.');
  assert.deepEqual(current.notification, { state: 'accepted' });
});

test('bad input is rejected before a write or notification', async () => {
  const h = makeHarness();
  const res = await h.save('owner', body(' \n\t '));
  assert.equal(res.statusCode, 400);
  assert.equal(h.db.read('speakers', 's1').discussionPoints, undefined);
  assert.equal(h.sent.length, 0);
});
