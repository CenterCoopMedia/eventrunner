'use strict';

/**
 * Console settings and the build settings an approval records
 * (ADR 0007 §5).
 *
 * `console_config/settings` = { gcpFolder, billingAccount, region }. These
 * are the defaults for every approval. Operators edit them through
 * saveConsoleSettings; the browser never writes them.
 *
 * An approval records `review.settings` =
 *   { gcpFolder, billingAccount, region, projectId, environment }.
 * The project id and the environment name are made from the web-address
 * name, so an operator approves with no typed value. The operator can
 * change any value, and every value is checked here.
 */

const { ConsoleError } = require('./http.cjs');
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
 * The default project id for a web-address name: `er-<name>`, cut to 30
 * characters with no trailing hyphen, and made long enough. The result
 * always passes the project-id rules.
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

/** The approval values before any operator change. */
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

async function getConsoleSettings({ db }, { user }) {
  await requireOperator(db, user);
  return { body: { settings: await readConsoleSettings(db) } };
}

async function saveConsoleSettings({ db, now = Date.now }, { body, user }) {
  await requireOperator(db, user);
  const input = body.settings && typeof body.settings === 'object' ? body.settings : {};
  const settings = checkSettings(CONSOLE_FIELDS, {}, input);
  const auditRef = db.collection('console_audit').doc();
  await db.runTransaction(async (tx) => {
    tx.set(db.collection('console_config').doc('settings'), settings);
    tx.create(auditRef, { action: 'save-settings', appId: null, by: user.uid, at: new Date(now()) });
  });
  return { body: { settings } };
}

module.exports = {
  APPROVAL_FIELDS,
  CONSOLE_FIELDS,
  approvalDefaults,
  checkSettings,
  environmentFor,
  getConsoleSettings,
  normalizeBilling,
  normalizeFolder,
  normalizeProjectId,
  projectIdFor,
  readConsoleSettings,
  saveConsoleSettings,
};
