'use strict';

/**
 * Organization field rules at the content-write seam (issues #192, #193).
 *
 * cmsOrganizations documents go through the generic content endpoints
 * (content.cjs), which checked reserved key NAMES and never a TYPE. A
 * script or a console write could store `name: 42`, and the public site
 * then had to drop the document in ContentContext before React threw on
 * it. These rules refuse that at the save, where the editor can put the
 * message next to the field it names. The read-side drop stays: it still
 * guards whatever reaches the collection without passing through here.
 *
 * THE SIX EDITOR FIELDS ARE CHECKED ON THE MERGED RESULT, the way the
 * speaker and session seams check theirs: what matters is the record that
 * ends up stored, not the half of it one request sent. The three profile
 * fields the editor does not show (`bio`, `supportDescription`,
 * `readMorePath`) are checked only when a request sends them, so a value a
 * script stored never blocks an editor save with an error about a field
 * the editor cannot reach. The public page guards each of those at render.
 * Every other key passes through, as the generic endpoint always allowed.
 *
 * The document id is the organization's page address, `/sponsors/<id>`,
 * so the editor derives it from the name in the slug shape below.
 *
 * Pure: no db, no clock. content.cjs calls these inside the write
 * transaction and throws the joined messages as a 400.
 */

const { storageObjectPath } = require('shared/venue');
const { safeUrlHref } = require('shared/urlSafety');

const COLLECTION = 'cmsOrganizations';

/** The speaker slug's shape (shared/speaker SLUG_RE): lowercase words joined by single hyphens. */
const ORGANIZATION_SLUG_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

/**
 * The longest value each field may hold, in characters. The editor mirrors
 * the ones it shows (apps/web/src/admin/organizationDoc.js), and a web test
 * imports this object to hold the two together.
 */
const ORGANIZATION_LIMITS = Object.freeze({
  slug: 80,
  name: 120,
  tier: 60,
  logoPath: 300,
  url: 2000,
  description: 500,
  bio: 5000,
  supportDescription: 2000,
  readMorePath: 200,
});

const MESSAGES = Object.freeze({
  nameMissing: "name: enter the organization's name",
  order: 'order: must be a number',
  url: 'url: must start with http:// or https://',
  logoPath: 'logoPath: choose an image from the media library',
});

const PROFILE_FIELDS = Object.freeze(['bio', 'supportDescription', 'readMorePath']);

const hasOwn = (object, key) => Object.prototype.hasOwnProperty.call(object ?? {}, key);

const tooLong = (field) => `${field}: use ${ORGANIZATION_LIMITS[field]} characters or fewer`;

/**
 * An optional text field: null and absent stay as they are, a string is
 * trimmed and a blank one becomes null, anything else is refused.
 *
 * @returns {{ ok: true, value: string|null } | { ok: false, message: string }}
 */
function optionalText(field, value, message = `${field}: must be text`) {
  if (value === null) return { ok: true, value: null };
  if (typeof value !== 'string') return { ok: false, message };
  const trimmed = value.trim();
  if (trimmed.length === 0) return { ok: true, value: null };
  if (trimmed.length > ORGANIZATION_LIMITS[field]) return { ok: false, message: tooLong(field) };
  return { ok: true, value: trimmed };
}

/**
 * Check and normalize one organization's fields.
 *
 * @param {object} fields the merged fields as they will be stored
 * @param {object} [sent] the request's own `fields`, which decides whether
 *   a profile field is checked at all
 * @returns {{ ok: true, fields: object } | { ok: false, errors: string[] }}
 */
function validateOrganizationFields(fields, sent = {}) {
  const out = { ...fields };
  const errors = [];

  // name: required, text, trimmed.
  if (typeof fields?.name !== 'string') {
    errors.push(hasOwn(fields, 'name') && fields.name !== null ? 'name: must be text' : MESSAGES.nameMissing);
  } else {
    const name = fields.name.trim();
    if (name.length === 0) errors.push(MESSAGES.nameMissing);
    else if (name.length > ORGANIZATION_LIMITS.name) errors.push(tooLong('name'));
    else out.name = name;
  }

  // tier and description: optional text.
  for (const field of ['tier', 'description']) {
    if (!hasOwn(fields, field) || fields[field] === undefined) continue;
    const verdict = optionalText(field, fields[field]);
    if (verdict.ok) out[field] = verdict.value;
    else errors.push(verdict.message);
  }

  // order: a finite number, or null for none.
  if (hasOwn(fields, 'order') && fields.order !== undefined && fields.order !== null) {
    if (typeof fields.order !== 'number' || !Number.isFinite(fields.order)) errors.push(MESSAGES.order);
  }

  // logoPath: a Storage object path, the same shape AssetImage renders.
  if (hasOwn(fields, 'logoPath') && fields.logoPath !== undefined) {
    const verdict = optionalText('logoPath', fields.logoPath, MESSAGES.logoPath);
    if (!verdict.ok) {
      errors.push(verdict.message);
    } else if (verdict.value === null) {
      out.logoPath = null;
    } else if (storageObjectPath(verdict.value) === null) {
      errors.push(MESSAGES.logoPath);
    } else {
      out.logoPath = verdict.value;
    }
  }

  // url: an absolute http(s) link, stored in the canonical form the check
  // approved, so what a reader follows is exactly what passed.
  if (hasOwn(fields, 'url') && fields.url !== undefined) {
    const verdict = optionalText('url', fields.url, MESSAGES.url);
    if (!verdict.ok) {
      errors.push(verdict.message);
    } else if (verdict.value === null) {
      out.url = null;
    } else {
      const href = safeUrlHref(verdict.value);
      if (!href) errors.push(MESSAGES.url);
      else if (href.length > ORGANIZATION_LIMITS.url) errors.push(tooLong('url'));
      else out.url = href;
    }
  }

  // The profile fields: only when this request sends them, and only when
  // the merge kept them (a DELETE_FIELD_SENTINEL removes the key first).
  for (const field of PROFILE_FIELDS) {
    if (!hasOwn(sent, field) || !hasOwn(fields, field) || fields[field] === undefined) continue;
    const verdict = optionalText(field, fields[field]);
    if (verdict.ok) out[field] = verdict.value;
    else errors.push(verdict.message);
  }

  return errors.length > 0 ? { ok: false, errors } : { ok: true, fields: out };
}

module.exports = {
  ORGANIZATIONS_COLLECTION: COLLECTION,
  ORGANIZATION_SLUG_RE,
  ORGANIZATION_LIMITS,
  validateOrganizationFields,
};
