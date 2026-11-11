'use strict';

/**
 * Console settings and the agreement (ADR 0007, amendment 2026-11-04), and the
 * settings a build uses (§5).
 *
 * `console_config/settings` = { gcpFolder, billingAccount, region }, the values
 * for every build. Operators edit them through saveConsoleSettings; the browser
 * never writes them.
 *
 * `console_config/agreement` is the current agreement, and
 * `console_config/agreement/versions/{version}` keeps each version. A save
 * makes a new version and never rewrites an old one. `sha256` is the hash
 * of `title`, two line feeds and `body`.
 *
 * A build's settings are { gcpFolder, billingAccount, region, projectId,
 * environment }. The project id and the environment name are made from the
 * web-address name, so no value is typed, and every value is checked here.
 */

const { createHash } = require('node:crypto');
const { ConsoleError } = require('./http.cjs');
const { toIso } = require('./access.cjs');
const { requireOperator } = require('./reviewAccess.cjs');

const FOLDER_RE = /^(?:folders\/)?(\d{6,20})$/;
const BILLING_RE = /^(?:billingAccounts\/)?([0-9A-F]{6}-[0-9A-F]{6}-[0-9A-F]{6})$/i;
// A Google Cloud region, for example us-central1 or northamerica-northeast1.
const REGION_RE = /^[a-z]+-[a-z]+\d{1,2}$/;
// GCP project id: 6 to 30 characters, lowercase letters, digits and
// hyphens, starts with a letter, does not end with a hyphen.
const PROJECT_ID_RE = /^[a-z][a-z0-9-]{4,28}[a-z0-9]$/;
// A GitHub Environment name as the deploy workflows use it.
const ENVIRONMENT_RE = /^[a-z0-9][a-z0-9-]{0,62}$/;
const PROJECT_PREFIX = 'er-';
const PROJECT_MAX = 30;
const PROJECT_MIN = 6;

const MESSAGES = Object.freeze({
  gcpFolder: 'Enter the Google Cloud folder number, for example folders/123456789012.',
  billingAccount: 'Enter the billing account, for example 012345-6789AB-CDEF01.',
  region: 'Enter a Google Cloud region, for example us-central1.',
  projectId: 'Enter a project id of 6 to 30 characters: lowercase letters, digits and hyphens. Start with a letter. Do not end with a hyphen.',
  environment: 'Enter an environment name of up to 63 characters: lowercase letters, digits and hyphens.',
});

const text = (value) => (typeof value === 'string' ? value.trim() : '');

/** @returns {string|null} `folders/<number>` */
function normalizeFolder(value) {
  const match = text(value).match(FOLDER_RE);
  return match ? `folders/${match[1]}` : null;
}

/** @returns {string|null} the account id in capitals, with no prefix */
function normalizeBilling(value) {
  const match = text(value).match(BILLING_RE);
  return match ? match[1].toUpperCase() : null;
}

function normalizeRegion(value) {
  const region = text(value).toLowerCase();
  return REGION_RE.test(region) ? region : null;
}

function normalizeProjectId(value) {
  const id = text(value);
  return PROJECT_ID_RE.test(id) ? id : null;
}

function normalizeEnvironment(value) {
  const name = text(value);
  return ENVIRONMENT_RE.test(name) ? name : null;
}

/**
 * The default project id for a web-address name: `er-<name>`. siteNames.cjs
 * limits a name so this fits whole, so two names never share a project. Other
 * text is cut and made long enough, and the result always passes the
 * project-id rules.
 */
function projectIdFor(name) {
  const safe = String(name || '').toLowerCase().replace(/[^a-z0-9-]/g, '-');
  let id = `${PROJECT_PREFIX}${safe}`.slice(0, PROJECT_MAX).replace(/-+$/, '');
  if (id.length < PROJECT_MIN) id = `${id}-site`.slice(0, PROJECT_MAX);
  return id;
}

/** The default environment name for a web-address name. */
function environmentFor(name) {
  const safe = String(name || '').toLowerCase().replace(/[^a-z0-9-]/g, '-').replace(/^-+/, '').slice(0, 63);
  return safe || 'site';
}

/** @returns {Promise<{ gcpFolder: string, billingAccount: string, region: string }>} '' for a missing value */
async function readConsoleSettings(db) {
  const snap = await db.collection('console_config').doc('settings').get();
  const data = snap.exists ? snap.data() : {};
  return { gcpFolder: text(data.gcpFolder), billingAccount: text(data.billingAccount), region: text(data.region) };
}

/** The build values for a web-address name. */
function approvalDefaults(settings, siteName) {
  return {
    gcpFolder: settings.gcpFolder,
    billingAccount: settings.billingAccount,
    region: settings.region,
    projectId: siteName ? projectIdFor(siteName) : '',
    environment: siteName ? environmentFor(siteName) : '',
  };
}

const NORMALIZERS = Object.freeze({
  gcpFolder: normalizeFolder,
  billingAccount: normalizeBilling,
  region: normalizeRegion,
  projectId: normalizeProjectId,
  environment: normalizeEnvironment,
});

/**
 * Check every named field. An operator value replaces the default.
 * @throws {ConsoleError} 400 invalid-setting, naming the first bad field
 */
function checkSettings(fields, defaults, overrides = {}) {
  const out = {};
  for (const field of fields) {
    const given = overrides && Object.prototype.hasOwnProperty.call(overrides, field) ? overrides[field] : defaults[field];
    const value = NORMALIZERS[field](given);
    if (!value) {
      const err = new ConsoleError(400, 'invalid-setting', MESSAGES[field]);
      err.field = field;
      throw err;
    }
    out[field] = value;
  }
  return out;
}

const CONSOLE_FIELDS = Object.freeze(['gcpFolder', 'billingAccount', 'region']);
const APPROVAL_FIELDS = Object.freeze([...CONSOLE_FIELDS, 'projectId', 'environment']);
const AGREEMENT_TITLE_MAX = 200;
const AGREEMENT_BODY_MAX = 200000;

const SIGNUPS_CLOSED = 'This site is not taking sign-ups right now. We saved your answers. Try again later.';

function signupsClosed() {
  return new ConsoleError(409, 'signups-closed', SIGNUPS_CLOSED);
}

/** One line-ending form, no outer space, so the hash of a text is stable. */
function cleanAgreementText(value) {
  return typeof value === 'string' ? value.replace(/\r\n?/g, '\n').trim() : '';
}

function agreementHash(title, body) {
  return createHash('sha256').update(`${title}\n\n${body}`, 'utf8').digest('hex');
}

/** The stored agreement, or null when any part is missing or the text no longer matches its hash. */
function checkedAgreement(data) {
  if (!data || !Number.isSafeInteger(data.version) || data.version < 1) return null;
  const { version, title, body, sha256 } = data;
  if (typeof title !== 'string' || !title || typeof body !== 'string' || !body) return null;
  if (sha256 !== agreementHash(title, body)) return null;
  return { version, title, body, sha256 };
}

function agreementRef(db) {
  return db.collection('console_config').doc('agreement');
}

const CONSOLE_FIELD_WORDS = Object.freeze({
  gcpFolder: 'the Google Cloud folder',
  billingAccount: 'the billing account',
  region: 'the region',
});

/**
 * What a signup needs, read with `get` (a transaction's or the database's).
 * `open` needs the agreement and every setting a build uses, so nothing starts
 * that cannot build. `missing` names what is not set, for an operator.
 *
 * @returns {Promise<{ open: boolean, agreement: object|null, missing: string[] }>}
 */
async function readSignupTerms(get, db) {
  const settings = await get(db.collection('console_config').doc('settings'));
  const current = await get(agreementRef(db));
  const values = settings.exists ? settings.data() : {};
  const agreement = current.exists ? checkedAgreement(current.data()) : null;
  const missing = [
    ...CONSOLE_FIELDS.filter((field) => !NORMALIZERS[field](values[field])).map((field) => CONSOLE_FIELD_WORDS[field]),
    ...(agreement ? [] : ['the agreement']),
  ];
  return { open: missing.length === 0, agreement, missing };
}

/** One saved version, checked as above, or null. */
async function readAgreementVersion(get, db, version) {
  const snap = await get(agreementRef(db).collection('versions').doc(String(version)));
  return snap.exists ? checkedAgreement(snap.data()) : null;
}

async function getConsoleSettings({ db }, { user }) {
  await requireOperator(db, user);
  const current = await agreementRef(db).get();
  const data = current.exists ? current.data() : null;
  const agreement = data
    ? { version: data.version, title: data.title, body: data.body, sha256: data.sha256, savedAt: toIso(data.savedAt) }
    : null;
  return { body: { settings: await readConsoleSettings(db), agreement } };
}

async function saveConsoleSettings({ db, now = Date.now }, { body, user }) {
  await requireOperator(db, user);
  const input = body.settings && typeof body.settings === 'object' ? body.settings : {};
  const settings = checkSettings(CONSOLE_FIELDS, {}, input);
  const auditRef = db.collection('console_audit').doc();
  await db.runTransaction(async (tx) => {
    tx.set(db.collection('console_config').doc('settings'), settings, { merge: true });
    tx.create(auditRef, { action: 'save-settings', appId: null, by: user.uid, at: new Date(now()) });
  });
  return { body: { settings } };
}

function fieldError(field, message) {
  const err = new ConsoleError(400, 'invalid-setting', message);
  err.field = field;
  return err;
}

/**
 * Save the agreement as a new version. The same text saves nothing, so a
 * second select does not make a version that clients must accept again.
 */
async function saveAgreement({ db, now = Date.now }, { body, user }) {
  await requireOperator(db, user);
  const input = body.agreement && typeof body.agreement === 'object' ? body.agreement : {};
  const title = cleanAgreementText(input.title);
  const content = cleanAgreementText(input.body);
  if (!title || title.length > AGREEMENT_TITLE_MAX) {
    throw fieldError('agreementTitle', `Enter a title of up to ${AGREEMENT_TITLE_MAX} characters.`);
  }
  if (!content || content.length > AGREEMENT_BODY_MAX) {
    throw fieldError('agreementBody', `Enter the agreement text, up to ${AGREEMENT_BODY_MAX.toLocaleString('en-US')} characters.`);
  }
  const sha256 = agreementHash(title, content);
  const at = new Date(now());
  const ref = agreementRef(db);
  const auditRef = db.collection('console_audit').doc();
  const saved = await db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    const current = snap.exists ? snap.data() : null;
    if (current?.sha256 === sha256) return { ...current, created: false };
    const version = (Number.isSafeInteger(current?.version) ? current.version : 0) + 1;
    const record = { version, title, body: content, sha256, savedAt: at, savedBy: user.uid };
    // A create: when the version exists, the save fails and the old text stays.
    tx.create(ref.collection('versions').doc(String(version)), record);
    tx.set(ref, record);
    tx.create(auditRef, { action: 'save-agreement', appId: null, by: user.uid, at, version });
    return { ...record, created: true };
  });
  return {
    body: {
      created: saved.created,
      agreement: { version: saved.version, title: saved.title, body: saved.body, sha256: saved.sha256, savedAt: toIso(saved.savedAt) },
    },
  };
}

module.exports = {
  APPROVAL_FIELDS,
  SIGNUPS_CLOSED,
  agreementHash,
  approvalDefaults,
  checkSettings,
  environmentFor,
  getConsoleSettings,
  normalizeBilling,
  normalizeFolder,
  normalizeProjectId,
  projectIdFor,
  readAgreementVersion,
  readConsoleSettings,
  readSignupTerms,
  saveAgreement,
  saveConsoleSettings,
  signupsClosed,
};
