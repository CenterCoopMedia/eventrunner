'use strict';

/**
 * Organization (sponsor and partner) rows for the record import
 * (./recordImport.cjs).
 *
 * An organization is a `cmsOrganizations` record in the two-revision
 * model, so the import writes `cmsOrganizations_drafts` only, through
 * store.writeDraft. A new organization is a hidden draft
 * (`visible: false`); an update keeps the record's visibility.
 *
 * Validation is the editor's own: cms/organizations.cjs
 * `organizationSlugError` for the page address and
 * `validateOrganizationFields` for the fields, judged on the merged record.
 *
 * The slug is the document id and the page address (#193). It is chosen
 * once, on create: a mapped slug column, or the name the way the editor
 * suggests it. A row with no key whose address belongs to an organization
 * no import has linked is matched to it (recordImport.cjs). An address
 * another import's external ID holds, or an earlier row of the file, is a
 * row error.
 * Logos are not importable: a logo is a media library image, chosen in the
 * organization editor.
 */

const { generateSlug } = require('shared/slug');
const { contentFieldsOf, writeDraft } = require('../cms/store.cjs');
const { withoutSeedFlag } = require('./seedFlag.cjs');
const {
  ORGANIZATIONS_COLLECTION,
  ORGANIZATION_LIMITS,
  organizationSlugError,
  slugTakenMessage,
  validateOrganizationFields,
} = require('../cms/organizations.cjs');
const {
  reconcileFields,
  internals: { cell, cellOrNull, externalIdError, conflictNote, linkedByImport, matchNote, DELETED_NOTE },
} = require('./recordImport.cjs');

const TYPE = 'organizations';
const DRAFTS = `${ORGANIZATIONS_COLLECTION}_drafts`;

const FIELDS = Object.freeze([
  { id: 'externalId', required: true },
  { id: 'name', required: true },
  { id: 'slug' },
  { id: 'tier' },
  { id: 'url' },
  { id: 'description' },
  { id: 'order' },
]);

const RECORD_FIELDS = Object.freeze(['name', 'tier', 'url', 'description', 'order']);

function mappingError(mapping) {
  if (!mapping.externalId) return 'mapping.externalId: map a column to the external ID';
  if (!mapping.name) return "mapping.name: map a column to the organization's name";
  return null;
}

/** The page address a name suggests (the editor's organizationSlugFromName rule). */
function slugFromName(name) {
  return generateSlug(String(name ?? '')).slice(0, ORGANIZATION_LIMITS.slug).replace(/-+$/, '');
}

/** Blank is no order, a number is a number, anything else goes as typed so the validator names it. */
function orderValue(raw) {
  if (raw === null) return null;
  const number = Number(raw);
  return Number.isFinite(number) ? number : raw;
}

function mapRow({ row, mapping }) {
  const externalId = cell(row[mapping.externalId]);
  const idError = externalIdError(externalId);
  if (idError) return { ok: false, externalId: externalId || null, reasons: [idError] };

  const values = {};
  for (const field of ['name', 'tier', 'url', 'description']) {
    if (mapping[field]) values[field] = cellOrNull(row[mapping[field]]);
  }
  if (mapping.order) values.order = orderValue(cellOrNull(row[mapping.order]));
  const slug = mapping.slug ? cell(row[mapping.slug]) : '';
  return { ok: true, externalId, input: { values, slug } };
}

/** True when the address is used live or as a draft. */
async function slugStored({ db, tx, slug }) {
  const [live, draft] = await Promise.all([
    tx.get(db.collection(ORGANIZATIONS_COLLECTION).doc(slug)),
    tx.get(db.collection(DRAFTS).doc(slug)),
  ]);
  return live.exists || draft.exists;
}

/** The file's values, normalized the way the validator stores them. */
function normalizedIncoming(values) {
  const verdict = validateOrganizationFields(values, values);
  if (!verdict.ok) return verdict;
  const out = {};
  for (const field of RECORD_FIELDS) {
    if (Object.prototype.hasOwnProperty.call(values, field)) out[field] = verdict.fields[field] ?? null;
  }
  return { ok: true, fields: out };
}

async function planRow({ db, tx, input, key, claimed, actor, now }) {
  const label = input.values.name ?? null;
  const incoming = normalizedIncoming(input.values);
  if (!incoming.ok) return { verdict: 'error', label, reasons: incoming.errors };

  if (!key) {
    const docId = input.slug || slugFromName(incoming.fields.name);
    const slugError = organizationSlugError(docId);
    if (slugError) return { verdict: 'error', label, reasons: [slugError] };
    if (claimed.has(`organization:${docId}`)) {
      return { verdict: 'error', label, reasons: [`slug: an earlier row of this file uses "${docId}". Give one of the rows a different address.`] };
    }
    if (await slugStored({ db, tx, slug: docId })) {
      if (await linkedByImport({ db, tx, type: TYPE, docId })) {
        return {
          verdict: 'error',
          label,
          reasons: [`${slugTakenMessage(docId)}. An earlier import made it from another external ID. Check the external ID, or map a slug column with a different address.`],
        };
      }
      return planUpdate({
        db, tx, incoming, label, key: { docId, values: null }, actor, now, matched: true,
      });
    }
    return {
      verdict: 'create',
      docId,
      label,
      changedFields: Object.keys(incoming.fields),
      values: incoming.fields,
      claims: [`organization:${docId}`],
      async write(writeTx) {
        await writeDraft({
          db,
          tx: writeTx,
          collection: ORGANIZATIONS_COLLECTION,
          docId,
          fields: incoming.fields,
          visible: false,
          actor,
          now,
          createOnly: true,
        });
      },
    };
  }
  return planUpdate({ db, tx, incoming, label, key, actor, now });
}

async function planUpdate({ db, tx, incoming, label, key, actor, now, matched = false }) {
  const docId = key.docId;
  const [draftSnap, liveSnap] = await Promise.all([
    tx.get(db.collection(DRAFTS).doc(docId)),
    tx.get(db.collection(ORGANIZATIONS_COLLECTION).doc(docId)),
  ]);
  const base = draftSnap.exists ? draftSnap.data() : liveSnap.exists ? liveSnap.data() : null;
  if (!base) return { verdict: 'unchanged', docId, label, notes: [DELETED_NOTE] };
  const current = withoutSeedFlag(contentFieldsOf(base));

  const { patch, conflicts } = reconcileFields({ incoming: incoming.fields, last: key.values, current });
  const notes = conflicts.map(conflictNote);
  if (matched) notes.unshift(matchNote('organization', docId, 'address'));
  const changedFields = Object.keys(patch);
  const merged = { ...current, ...patch };
  const claims = matched ? [`organization:${docId}`] : [];
  if (changedFields.length === 0) {
    // A matched row still links the record, so it is an update.
    return {
      verdict: matched ? 'update' : 'unchanged', matched, docId, label: current.name ?? label, notes, values: incoming.fields, claims,
    };
  }
  const verdict = validateOrganizationFields(merged, patch);
  if (!verdict.ok) return { verdict: 'error', docId, label, reasons: verdict.errors };
  return {
    verdict: 'update',
    matched,
    claims,
    docId,
    label: verdict.fields.name ?? label,
    changedFields,
    notes,
    values: incoming.fields,
    async write(writeTx) {
      await writeDraft({
        db, tx: writeTx, collection: ORGANIZATIONS_COLLECTION, docId, fields: verdict.fields, actor, now,
      });
    },
  };
}

module.exports = {
  type: TYPE,
  docPath: DRAFTS,
  fields: FIELDS,
  mappingError,
  mapRow,
  planRow,
  internals: { RECORD_FIELDS, slugFromName, orderValue },
};
