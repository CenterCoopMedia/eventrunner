'use strict';

/**
 * Web-address names (ADR 0007 §3, "Your web address").
 *
 * `site_names/{name}` { appId, orgId, reservedAt }
 *
 * One document per name, so a name has at most one holder: a reservation
 * is a create of that document inside a transaction. The browser cannot
 * read the collection (console/firestore.rules); checkWebAddress answers
 * for it on the server.
 *
 * A name is 3 to 30 characters of lowercase letters, digits and hyphens.
 * It does not start or end with a hyphen, and it is not on RESERVED.
 */

const SITE_DOMAIN = 'eventrunner.org';
const COLLECTION = 'site_names';
const NAME_MIN = 3;
const NAME_MAX = 30;
const NAME_RE = /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/;

// Names CCM uses or may use, and names that look official on a mail or
// web address. Kept on the server only, so a new entry needs no web release.
const RESERVED = Object.freeze(new Set([
  'about', 'abuse', 'account', 'accounts', 'admin', 'administrator', 'api', 'app', 'apps', 'assets',
  'auth', 'beta', 'billing', 'blog', 'cdn', 'ccm', 'cloud', 'console', 'dashboard', 'demo', 'dev',
  'docs', 'email', 'eventrunner', 'events', 'files', 'ftp', 'hello', 'help', 'hostmaster', 'imap',
  'info', 'internal', 'legal', 'login', 'mail', 'media', 'mx', 'no-reply', 'noreply', 'ns1', 'ns2',
  'operator', 'operators', 'pop', 'portal', 'postmaster', 'preview', 'privacy', 'prod', 'production',
  'root', 'sandbox', 'security', 'signin', 'signup', 'smtp', 'staging', 'static', 'status', 'support',
  'terms', 'test', 'webmail', 'webmaster', 'www',
]));

/** Trim and lowercase. @returns {string} '' when the value is not text */
function normalizeSiteName(value) {
  return typeof value === 'string' ? value.trim().toLowerCase() : '';
}

/**
 * The format and reserved-list check, with no database read.
 * @returns {null | { reason: 'format'|'reserved', message: string }}
 */
function siteNameProblem(name) {
  if (name.length < NAME_MIN || name.length > NAME_MAX) {
    return { reason: 'format', message: `Use ${NAME_MIN} to ${NAME_MAX} characters.` };
  }
  if (!NAME_RE.test(name)) {
    return {
      reason: 'format',
      message: 'Use only lowercase letters, numbers and hyphens. Do not start or end with a hyphen.',
    };
  }
  // "xn--" starts an encoded international name, which reads as another name.
  if (RESERVED.has(name) || name.startsWith('xn--')) {
    return { reason: 'reserved', message: 'This name is not available. Choose another name.' };
  }
  return null;
}

const TAKEN = { reason: 'taken', message: 'Another event already uses this name. Choose another name.' };

/**
 * Full verdict for a name, as the application `appId` sees it: a name the
 * same application holds is available to it.
 *
 * @returns {Promise<{ available: boolean, reason?: string, message?: string }>}
 */
async function siteNameVerdict(db, name, appId) {
  const problem = siteNameProblem(name);
  if (problem) return { available: false, ...problem };
  const snap = await db.collection(COLLECTION).doc(name).get();
  if (snap.exists && snap.data().appId !== appId) return { available: false, ...TAKEN };
  return { available: true };
}

/** `name.eventrunner.org` */
function siteAddress(name) {
  return `${name}.${SITE_DOMAIN}`;
}

/**
 * Inside a transaction: every reservation `appId` holds, by name. Reads
 * only; the caller writes after all its reads, as Firestore requires.
 *
 * @returns {Promise<string[]>}
 */
async function heldNames(tx, db, appId) {
  const snap = await tx.get(db.collection(COLLECTION).where('appId', '==', appId));
  return snap.docs.map((doc) => doc.id);
}

/** Inside a transaction: delete every reservation in `names`. */
function releaseNames(tx, db, names) {
  for (const name of names) tx.delete(db.collection(COLLECTION).doc(name));
}

/**
 * checkWebAddress: answers while the client types. Any signed-in person
 * may ask; the answer says only whether the name can be used.
 */
async function checkWebAddress({ db }, { body }) {
  const name = normalizeSiteName(body.name);
  const appId = typeof body.appId === 'string' ? body.appId : '';
  const verdict = await siteNameVerdict(db, name, appId);
  return { body: { name, address: siteAddress(name), ...verdict } };
}

module.exports = {
  COLLECTION,
  NAME_MAX,
  NAME_MIN,
  RESERVED,
  SITE_DOMAIN,
  TAKEN,
  checkWebAddress,
  heldNames,
  normalizeSiteName,
  releaseNames,
  siteAddress,
  siteNameProblem,
  siteNameVerdict,
};
