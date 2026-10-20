'use strict';

// The speaker mail wording endpoint (issue #204): read, save, preview and
// reset the saved wording of speaker.invite and speaker.accepted. The last
// tests send a real invitation and a real acceptance through invites.cjs
// after a save, which is the issue's "Done when": the next invite uses the
// edited wording, and an unknown token is refused at save.
// tests/speaker-mail-templates.rules.test.js runs the same path against
// the Firestore emulator and the real email core.

const test = require('node:test');
const assert = require('node:assert/strict');

const { createSpeakerMailTemplatesHandler, internals } = require('./mailTemplates.cjs');
const {
  createSendSpeakerInviteHandler,
  applyMintInvite,
  applyAcceptInvite,
  sendAcceptedEmail,
} = require('./invites.cjs');
const { makeSpeakersDb: makeBareSpeakersDb } = require('./speakersFake.cjs');
const { getDefaultTemplate, resetTemplateCacheForTest, loadTemplate } = require('../email/templates.cjs');

const STAFF = { uid: 'staff-1', email: 'staff@example.org' };
const T0 = Date.parse('2026-10-20T12:00:00Z');
const NOW = () => T0;
const QUIET = { error() {}, warn() {}, info() {} };

const CONFIG = {
  event: {
    name: 'Example Summit',
    days: [{ date: '2027-05-13' }],
    sender: { email: 's@example.org', name: 'Example Summit' },
    legal: { postalAddressHtml: 'Example Org<br>1 Main St', supportEmail: 'help@example.org' },
  },
  theme: { colors: { primary: 'BRAND', ink: 'INK' } },
  tierA: { publicUrl: 'https://summit.example.org' },
};

const NEW_INVITE = {
  subject: 'Will you speak at {{event_name}}?',
  html: '<p>Dear {{speaker_name}}, <a href="{{invite_url}}">accept</a>.</p>',
  text: 'Dear {{speaker_name}}, accept here: {{invite_url}}',
};

function makeDb(seed = {}) {
  return makeBareSpeakersDb({
    'config/bootstrap': { adminEmails: ['operator@example.org'], staffEmails: [STAFF.email] },
    'config/event': { name: 'Example Summit', historicalDemo: false },
    'speakers/rae': {
      firstName: 'Rae', lastName: 'Okonkwo', email: 'rae@example.org', status: 'draft', uid: null, inviteToken: null,
    },
    'users/u1': { uid: 'u1', speakerId: null, registrationStatus: 'pending' },
    ...seed,
  });
}

function fakeRes() {
  return {
    statusCode: null,
    body: null,
    headers: {},
    set(k, v) { this.headers[k] = v; return this; },
    status(code) { this.statusCode = code; return this; },
    json(body) { this.body = body; return this; },
  };
}

const TOKENS = {
  staff: { uid: STAFF.uid, email: STAFF.email, email_verified: true },
  stranger: { uid: 'u-9', email: 'someone@example.org', email_verified: true },
};

async function call(db, body, { token = 'staff', method = 'POST' } = {}) {
  const res = fakeRes();
  await createSpeakerMailTemplatesHandler({
    db,
    auth: { verifyIdToken: async (t) => { if (!TOKENS[t]) throw new Error('bad token'); return TOKENS[t]; } },
    getConfig: async () => CONFIG,
    now: NOW,
    log: QUIET,
  })({ method, headers: token ? { authorization: `Bearer ${token}` } : {}, body }, res);
  return res;
}

function adminLogs(db) {
  return db.ids('admin_logs').map((id) => db.read('admin_logs', id));
}

test.beforeEach(() => resetTemplateCacheForTest());

test('the endpoint needs POST and a signed-in staff account, and names its actions', async () => {
  const db = makeDb();
  assert.equal((await call(db, { action: 'templates' }, { token: null })).statusCode, 401);
  assert.equal((await call(db, { action: 'templates' }, { token: 'stranger' })).statusCode, 403);
  assert.equal((await call(db, { action: 'templates' }, { method: 'GET' })).statusCode, 405);
  const bad = await call(db, { action: 'nope' });
  assert.equal(bad.statusCode, 400);
  assert.match(bad.body.error.message, /^action: /);
  const wrongId = await call(db, { action: 'saveTemplate', templateId: 'auth.otp', subject: 'x' });
  assert.equal(wrongId.statusCode, 400);
  assert.match(wrongId.body.error.message, /^templateId: Must be one of speaker\.invite, speaker\.accepted/);
});

test('templates returns the shipped wording, no saved wording, and the tokens of both messages', async () => {
  const db = makeDb();
  const res = await call(db, { action: 'templates' });
  assert.equal(res.statusCode, 200);
  assert.deepEqual(res.body.templates.map((t) => t.id), ['speaker.invite', 'speaker.accepted']);
  const [invite, accepted] = res.body.templates;
  const shipped = getDefaultTemplate('speaker.invite');
  assert.deepEqual(invite.shipped, { subject: shipped.subject, html: shipped.html, text: shipped.text });
  assert.equal(invite.saved, null);
  assert.deepEqual(invite.savedErrors, []);
  assert.deepEqual(invite.requiredTokens, ['invite_url']);
  assert.deepEqual(invite.tokens, ['speaker_name', 'invite_url', 'invite_type', 'admin_contact_email']);
  assert.ok(invite.globalTokens.includes('event_name'));
  assert.deepEqual(accepted.requiredTokens, ['profile_wizard_url']);
  assert.deepEqual(accepted.tokens, ['speaker_name', 'profile_wizard_url', 'deadline']);
});

test('save refuses an unknown token, a dropped invite link and a locked key, and stores nothing', async () => {
  const db = makeDb();
  const unknown = await call(db, { action: 'saveTemplate', templateId: 'speaker.invite', ...NEW_INVITE, text: `${NEW_INVITE.text} {{nope}}` });
  assert.equal(unknown.statusCode, 400);
  assert.match(unknown.body.error.message, /text: unknown token \{\{nope\}\}/);

  const noLink = await call(db, { action: 'saveTemplate', templateId: 'speaker.invite', text: 'Dear {{speaker_name}}.' });
  assert.equal(noLink.statusCode, 400);
  assert.match(noLink.body.error.message, /text: missing required token \{\{invite_url\}\}/);

  const empty = await call(db, { action: 'saveTemplate', templateId: 'speaker.accepted', subject: '   ' });
  assert.equal(empty.statusCode, 400);
  assert.match(empty.body.error.message, /subject must be a non-empty string/);

  const nothing = await call(db, { action: 'saveTemplate', templateId: 'speaker.accepted' });
  assert.equal(nothing.statusCode, 400);

  const huge = await call(db, {
    action: 'saveTemplate', templateId: 'speaker.invite', html: `${'x'.repeat(internals.MAX_WORDING_FIELD_LENGTH)}{{invite_url}}`,
  });
  assert.equal(huge.statusCode, 400);
  assert.match(huge.body.error.message, /^html: Must be at most 100 KB\./);

  assert.equal(db.read('email_templates', 'speaker.invite'), undefined);
  assert.equal(db.read('email_templates', 'speaker.accepted'), undefined);
  assert.equal(adminLogs(db).length, 0);
});

test('save stores only the wording fields, records who saved, and writes an admin log row', async () => {
  const db = makeDb();
  const res = await call(db, {
    action: 'saveTemplate', templateId: 'speaker.invite', ...NEW_INVITE, storeRendered: true, tokens: ['x'],
  });
  assert.equal(res.statusCode, 200);
  const stored = db.read('email_templates', 'speaker.invite');
  assert.deepEqual(Object.keys(stored).sort(), ['html', 'subject', 'text', 'updatedAt', 'updatedBy']);
  assert.equal(stored.updatedBy, STAFF.email);
  assert.equal(res.body.template.id, 'speaker.invite');
  assert.equal(res.body.template.saved.subject, NEW_INVITE.subject);
  assert.equal(res.body.template.saved.updatedBy, STAFF.email);
  assert.equal(res.body.template.saved.updatedAt, new Date(T0).toISOString());
  const logs = adminLogs(db);
  assert.equal(logs.length, 1);
  assert.equal(logs[0].action, 'saveEmailTemplate');
  assert.equal(logs[0].docPath, 'email_templates/speaker.invite');
  assert.equal(logs[0].email, STAFF.email);
});

test('a save of one field keeps the shipped copy for the others', async () => {
  const db = makeDb();
  const res = await call(db, { action: 'saveTemplate', templateId: 'speaker.accepted', subject: 'Welcome to {{event_name}}' });
  assert.equal(res.statusCode, 200);
  const shipped = getDefaultTemplate('speaker.accepted');
  assert.equal(res.body.template.saved.subject, 'Welcome to {{event_name}}');
  assert.equal(res.body.template.saved.html, shipped.html);
  assert.deepEqual(Object.keys(db.read('email_templates', 'speaker.accepted')).sort(), ['subject', 'updatedAt', 'updatedBy']);
});

test('preview renders the exact message with sample values, footer included', async () => {
  const db = makeDb();
  const res = await call(db, { action: 'preview', templateId: 'speaker.invite' });
  assert.equal(res.statusCode, 200);
  const { preview } = res.body;
  assert.equal(preview.source, 'shipped');
  assert.equal(preview.subject, 'You are invited to speak at Example Summit');
  const link = `https://summit.example.org/speaker/accept?token=${internals.SAMPLE_INVITE_CODE}`;
  assert.ok(preview.html.includes(link));
  assert.ok(preview.text.includes(link));
  assert.ok(preview.text.includes(`Hi ${internals.SAMPLE_SPEAKER.firstName} ${internals.SAMPLE_SPEAKER.lastName},`));
  // The staff member who previews is the contact the invitation names.
  assert.ok(preview.text.includes(STAFF.email));
  // The provider gets the legal footer once; the preview shows it once.
  assert.equal(preview.text.split('Example Org').length - 1, 1);
  assert.deepEqual(preview.problems, []);

  const accepted = await call(db, { action: 'preview', templateId: 'speaker.accepted' });
  assert.ok(accepted.body.preview.text.includes('https://summit.example.org/speaker/profile'));
});

test('preview names a missing site address, since neither message then has a working link', async () => {
  const db = makeDb();
  const res = fakeRes();
  await createSpeakerMailTemplatesHandler({
    db,
    auth: { verifyIdToken: async () => TOKENS.staff },
    getConfig: async () => ({ ...CONFIG, tierA: { publicUrl: '' } }),
    now: NOW,
    log: QUIET,
  })({ method: 'POST', headers: { authorization: 'Bearer t' }, body: { action: 'preview', templateId: 'speaker.accepted' } }, res);
  assert.equal(res.statusCode, 200);
  assert.match(res.body.preview.problems[0], /no public site address/);
});

test('preview of a draft shows the draft and stores nothing; a bad draft is refused with the save errors', async () => {
  const db = makeDb();
  const res = await call(db, { action: 'preview', templateId: 'speaker.invite', ...NEW_INVITE });
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.preview.source, 'draft');
  assert.equal(res.body.preview.subject, 'Will you speak at Example Summit?');
  assert.ok(res.body.preview.text.startsWith('Dear Sample Speaker, accept here: https://summit.example.org/speaker/accept?token='));
  assert.equal(db.read('email_templates', 'speaker.invite'), undefined);
  assert.equal(adminLogs(db).length, 0);

  const bad = await call(db, { action: 'preview', templateId: 'speaker.invite', subject: 'Hi {{who}}' });
  assert.equal(bad.statusCode, 400);
  assert.match(bad.body.error.message, /subject: unknown token \{\{who\}\}/);
});

test('preview of saved wording that fails its check says the shipped wording is sent', async () => {
  const db = makeDb({ 'email_templates/speaker.invite': { text: 'No link here.' } });
  const list = await call(db, { action: 'templates' });
  assert.match(list.body.templates[0].savedErrors.join(' '), /missing required token \{\{invite_url\}\}/);
  const res = await call(db, { action: 'preview', templateId: 'speaker.invite' });
  assert.equal(res.body.preview.source, 'shipped');
  assert.equal(res.body.preview.usedFallback, true);
  assert.equal(res.body.preview.subject, 'You are invited to speak at Example Summit');
});

test('reset deletes the saved wording, logs it, and the shipped copy applies again', async () => {
  const db = makeDb();
  await call(db, { action: 'saveTemplate', templateId: 'speaker.invite', ...NEW_INVITE });
  const res = await call(db, { action: 'resetTemplate', templateId: 'speaker.invite' });
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.template.saved, null);
  assert.equal(db.read('email_templates', 'speaker.invite'), undefined);
  assert.deepEqual(adminLogs(db).map((row) => row.action), ['saveEmailTemplate', 'resetEmailTemplate']);
  const preview = await call(db, { action: 'preview', templateId: 'speaker.invite' });
  assert.equal(preview.body.preview.source, 'shipped');
});

test('a historical demo refuses save and reset before anything is stored, and still previews', async () => {
  const db = makeDb({
    'config/event': { name: 'Example Summit', historicalDemo: true },
    'email_templates/speaker.accepted': { subject: 'Kept {{event_name}}' },
  });
  const save = await call(db, { action: 'saveTemplate', templateId: 'speaker.invite', ...NEW_INVITE });
  assert.equal(save.statusCode, 403);
  assert.equal(save.body.error.code, 'read-only-demo');
  const reset = await call(db, { action: 'resetTemplate', templateId: 'speaker.accepted' });
  assert.equal(reset.statusCode, 403);
  assert.equal(db.read('email_templates', 'speaker.invite'), undefined);
  assert.equal(db.read('email_templates', 'speaker.accepted').subject, 'Kept {{event_name}}');
  assert.equal(adminLogs(db).length, 0);
  assert.equal((await call(db, { action: 'preview', templateId: 'speaker.invite' })).statusCode, 200);
});

test('Done when: edited wording is used by the next invite, after the old copy was cached', async () => {
  const db = makeDb();
  // An earlier render puts the shipped copy in the loader's cache.
  await loadTemplate({ db, id: 'speaker.invite', now: NOW });
  const save = await call(db, { action: 'saveTemplate', templateId: 'speaker.invite', ...NEW_INVITE });
  assert.equal(save.statusCode, 200);

  const sent = [];
  const res = fakeRes();
  await createSendSpeakerInviteHandler({
    db,
    auth: { verifyIdToken: async () => TOKENS.staff },
    getConfig: async () => CONFIG,
    sendEmail: async (message) => { sent.push(message); return { status: 'sent', providerMessageId: 'm1' }; },
    now: NOW,
    log: QUIET,
  })({ method: 'POST', headers: { authorization: 'Bearer t' }, body: { speakerId: 'rae' } }, res);
  assert.equal(res.statusCode, 200);
  assert.equal(sent.length, 1);
  assert.equal(sent[0].subject, 'Will you speak at Example Summit?');
  assert.match(sent[0].text, /^Dear Rae Okonkwo, accept here: https:\/\/summit\.example\.org\/speaker\/accept\?token=/);
  // The invite body holds a bearer link, so it is never stored.
  assert.equal(sent[0].storeRendered, false);
});

test('Done when: edited acceptance wording is used by the next acceptance mail', async () => {
  const db = makeDb();
  const minted = await applyMintInvite({ db, speakerId: 'rae', inviteType: 'speaker', mode: 'send', actor: STAFF, now: NOW });
  const accepted = await applyAcceptInvite({
    db, token: minted.token, uid: 'u1', email: 'rae@example.org', emailVerified: true, now: NOW,
  });
  assert.equal(accepted.ok, true);
  await call(db, {
    action: 'saveTemplate',
    templateId: 'speaker.accepted',
    subject: 'Thanks, {{speaker_name}}',
    text: 'Write your profile: {{profile_wizard_url}}',
  });
  const sent = [];
  await sendAcceptedEmail({
    db,
    sendEmail: async (message) => { sent.push(message); return { status: 'sent' }; },
    getConfig: async () => CONFIG,
    speakerId: 'rae',
    speaker: db.read('speakers', 'rae'),
    now: NOW,
    log: QUIET,
  });
  assert.equal(sent[0].subject, 'Thanks, Rae Okonkwo');
  assert.equal(sent[0].text.split('\n')[0], 'Write your profile: https://summit.example.org/speaker/profile');
});
