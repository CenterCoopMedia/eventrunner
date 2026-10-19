'use strict';

/**
 * Speaker rows for the record import (./recordImport.cjs).
 *
 * A new speaker is written the way createSpeaker writes one
 * (speakers/profile.cjs): validated by shared/speaker `validateSpeaker`,
 * given the same defaults, a server-minted document id, and a
 * `speaker_slugs` reservation in the same commit. Its status is always
 * `draft`, which has no public projection; the file cannot set a status.
 * The import never sends an invitation: that stays the Invite action on the
 * speakers list.
 *
 * An update writes only the mapped fields that reconcile says to write. It
 * never re-derives the slug from a new name (only a mapped slug moves it),
 * and it does not change the address of a speaker with an open invitation,
 * because the invitation went to the stored address. Staff change that in
 * the speaker editor, which handles the invitation.
 *
 * A PUBLISHED SPEAKER IS NEVER CHANGED IN PLACE. Speakers have no draft
 * revision: onSpeakerWritten (speakers/projection.cjs) republishes an
 * approved speaker on every write. So an update to a speaker the public
 * site shows goes into `pendingEdits`, the queue a speaker's own edits use
 * (profile.cjs applyUpdateOwnSpeakerProfile), and the live fields do not
 * move. Staff apply or discard the queue on the Speakers page. The merge
 * reads a queued value as the current one, so a change the speaker queued
 * is kept, not replaced. The slug of a published speaker is not changed at
 * all: applying the queue does not move the slug reservation, so the row
 * keeps the slug and says to change it in the speaker editor.
 *
 * A row with no key whose slug belongs to a speaker no import has linked
 * is matched to that speaker (recordImport.cjs), unless the row maps an
 * email address and the speaker has a different one: that is another
 * person with the same name, and the row is an error.
 */

const { validateSpeaker, isPubliclyVisibleSpeaker } = require('shared/speaker');
const { isValidDocId } = require('../cms/store.cjs');
const {
  internals: { SPEAKERS, SPEAKER_SLUGS, newSpeakerDefaults, findSlugOwner },
} = require('../speakers/profile.cjs');
const {
  reconcileFields,
  internals: { cell, externalIdError, conflictNote, isPlainObject, linkedByImport, matchNote, DELETED_NOTE },
} = require('./recordImport.cjs');

const TYPE = 'speakers';

/** The fields a column can be mapped to. */
const FIELDS = Object.freeze([
  { id: 'externalId', required: true },
  { id: 'firstName' },
  { id: 'lastName' },
  { id: 'name' },
  { id: 'slug' },
  { id: 'email' },
  { id: 'organization' },
  { id: 'jobTitle' },
  { id: 'bio' },
]);

/** The speaker fields the import writes, in the order the preview names them. */
const RECORD_FIELDS = Object.freeze(['firstName', 'lastName', 'slug', 'email', 'organization', 'jobTitle', 'bio']);

function mappingError(mapping) {
  if (!mapping.externalId) return 'mapping.externalId: map a column to the external ID';
  const hasSplit = Boolean(mapping.firstName && mapping.lastName);
  if (!hasSplit && !mapping.name) {
    return 'mapping.firstName: map the first and last name columns, or a full name column';
  }
  return null;
}

/** Split "Ada Lovelace" into its first word and the rest. */
function splitName(name) {
  const parts = name.split(/\s+/).filter(Boolean);
  if (parts.length === 0) return { firstName: '', lastName: '' };
  if (parts.length === 1) return { firstName: parts[0], lastName: '' };
  return { firstName: parts[0], lastName: parts.slice(1).join(' ') };
}

/**
 * One row as a speaker payload. A blank name is kept blank, so the shared
 * validator names it; a blank slug means "derive it from the name".
 */
function mapRow({ row, mapping }) {
  const externalId = cell(row[mapping.externalId]);
  const idError = externalIdError(externalId);
  if (idError) return { ok: false, externalId: externalId || null, reasons: [idError] };

  const payload = {};
  let firstName = mapping.firstName ? cell(row[mapping.firstName]) : '';
  let lastName = mapping.lastName ? cell(row[mapping.lastName]) : '';
  if (!firstName && !lastName && mapping.name) {
    ({ firstName, lastName } = splitName(cell(row[mapping.name])));
  }
  payload.firstName = firstName;
  payload.lastName = lastName;
  for (const field of ['slug', 'email', 'organization', 'jobTitle', 'bio']) {
    if (mapping[field]) payload[field] = cell(row[mapping[field]]);
  }
  return { ok: true, externalId, input: payload };
}

/** The display label a preview row shows. */
function labelOf(fields) {
  return `${fields.firstName ?? ''} ${fields.lastName ?? ''}`.trim() || null;
}

/**
 * The file's value for each mapped speaker field, normalized by the shared
 * validator, so it compares with what is stored. A blank slug is null.
 */
function incomingValues(payload, fields) {
  const out = {};
  for (const field of RECORD_FIELDS) {
    if (!Object.prototype.hasOwnProperty.call(payload, field)) continue;
    out[field] = Object.prototype.hasOwnProperty.call(fields, field) ? fields[field] : null;
  }
  if (out.slug === '') out.slug = null;
  return out;
}

const slugClaim = (slug) => `speaker-slug:${slug}`;

function slugTakenReason(slug) {
  return `slug: "${slug}" is already used by another speaker. Map a slug column with a different value.`;
}

const PUBLISHED_NOTE = 'The changes are pending review, because this speaker is published. Apply or discard them on the Speakers page.';
const PUBLISHED_SLUG_NOTE = 'slug: kept the page address, because this speaker is published. Change it in the speaker editor.';

async function planCreate({ db, tx, payload, claimed, actor, now, newId }) {
  const verdict = validateSpeaker(payload);
  if (!verdict.ok) return { verdict: 'error', label: labelOf(payload), reasons: verdict.errors };
  const fields = { ...newSpeakerDefaults(), ...verdict.fields, status: 'draft' };

  if (claimed.has(slugClaim(fields.slug))) {
    return {
      verdict: 'error',
      label: labelOf(fields),
      reasons: [`slug: an earlier row of this file uses "${fields.slug}". Give one of the rows a different slug.`],
    };
  }
  const owner = await findSlugOwner({ tx, db, slug: fields.slug });
  if (owner) {
    const ownerSnap = await tx.get(db.collection(SPEAKERS).doc(owner));
    const ownerEmail = ownerSnap.exists ? ownerSnap.data()?.email : null;
    if (!ownerSnap.exists) {
      return { verdict: 'error', label: labelOf(fields), reasons: [slugTakenReason(fields.slug)] };
    }
    if (await linkedByImport({ db, tx, type: TYPE, docId: owner })) {
      return {
        verdict: 'error',
        label: labelOf(fields),
        reasons: [`slug: "${fields.slug}" belongs to a speaker that an earlier import made from another external ID. Check the external ID. For a different person with the same name, map a slug column with a different value.`],
      };
    }
    if (fields.email && ownerEmail && fields.email !== ownerEmail) {
      return {
        verdict: 'error',
        label: labelOf(fields),
        reasons: [`slug: "${fields.slug}" belongs to an existing speaker with a different email address. If this is a different person, map a slug column with a different value.`],
      };
    }
    // The same person, typed in the editor before the import: link it.
    return planUpdate({
      db, tx, payload, key: { docId: owner, values: null }, claimed, actor, now, matched: true,
    });
  }

  const docId = (newId ?? (() => require('node:crypto').randomBytes(12).toString('hex')))();
  if (!isValidDocId(docId)) throw new Error('The speaker id could not be assigned.');
  const at = new Date(now());
  const doc = {
    ...fields,
    // Server-owned, exactly as createSpeaker seeds them (§4.3 rule 3).
    uid: null,
    inviteToken: null,
    approvedAt: null,
    createdAt: at,
    updatedAt: at,
    updatedBy: actor.email,
  };
  // A mapped slug column records the slug the record got, derived or not,
  // so a later blank cell reads as "unchanged" rather than as a new value.
  const values = incomingValues(payload, verdict.fields);
  if (Object.prototype.hasOwnProperty.call(values, 'slug')) values.slug = fields.slug;
  return {
    verdict: 'create',
    docId,
    label: labelOf(fields),
    changedFields: Object.keys(values),
    values,
    claims: [slugClaim(fields.slug)],
    write(writeTx) {
      writeTx.create(db.collection(SPEAKER_SLUGS).doc(fields.slug), { speakerId: docId, updatedAt: at });
      writeTx.set(db.collection(SPEAKERS).doc(docId), doc);
    },
  };
}

async function planUpdate({ db, tx, payload, key, claimed, actor, now, matched = false }) {
  const docId = key.docId;
  const ref = db.collection(SPEAKERS).doc(docId);
  const snap = await tx.get(ref);
  if (!snap.exists) {
    return { verdict: 'unchanged', docId, label: labelOf(payload), notes: [DELETED_NOTE] };
  }
  const stored = snap.data();
  const published = isPubliclyVisibleSpeaker(stored);
  const queued = published && isPlainObject(stored.pendingEdits) ? stored.pendingEdits : {};

  // A blank slug is "derive it" on create, and "leave it" on an update.
  const sent = { ...payload };
  if (sent.slug === '') delete sent.slug;
  const verdict = validateSpeaker(sent, { partial: true });
  if (!verdict.ok) return { verdict: 'error', docId, label: labelOf(stored), reasons: verdict.errors };
  const incoming = incomingValues(payload, verdict.fields);
  // A blank slug cell says nothing on an update: it neither clears the slug
  // nor replaces the slug the last import recorded.
  if (incoming.slug === null) delete incoming.slug;

  // A queued value is the one staff will see next, so it is the current one.
  const { patch, conflicts } = reconcileFields({ incoming, last: key.values, current: { ...stored, ...queued } });
  const notes = conflicts.map(conflictNote);
  if (matched) notes.unshift(matchNote('speaker', stored.slug, 'slug'));
  if (Object.prototype.hasOwnProperty.call(patch, 'email') && stored.status === 'invited') {
    delete patch.email;
    notes.push('email: kept the stored address. This speaker has an open invitation. Change the address in the speaker editor.');
  }
  if (published && patch.slug !== undefined) {
    delete patch.slug;
    notes.push(PUBLISHED_SLUG_NOTE);
  }

  if (patch.slug !== undefined) {
    const owner = claimed.has(slugClaim(patch.slug))
      ? 'this file'
      : await findSlugOwner({ tx, db, slug: patch.slug, exceptId: docId });
    if (owner) return { verdict: 'error', docId, label: labelOf(stored), reasons: [slugTakenReason(patch.slug)] };
  }

  const changedFields = Object.keys(patch);
  const label = labelOf({ ...stored, ...patch });
  const claims = [patch.slug, matched ? stored.slug : null].filter(Boolean).map(slugClaim);
  if (changedFields.length === 0) {
    // A matched row still links the record, so it is an update.
    return { verdict: matched ? 'update' : 'unchanged', matched, docId, label, notes, values: incoming, claims };
  }
  if (published) notes.push(PUBLISHED_NOTE);
  const at = new Date(now());
  return {
    verdict: 'update',
    matched,
    docId,
    label,
    changedFields,
    notes,
    values: incoming,
    claims,
    write(writeTx) {
      if (published) {
        // The whole map is written, so a queued edit of another field stays.
        writeTx.set(ref, {
          pendingEdits: { ...queued, ...patch },
          pendingEditsAt: at,
          pendingEditsBy: actor.email,
        }, { merge: true });
        return;
      }
      if (patch.slug !== undefined && patch.slug !== stored.slug) {
        writeTx.set(db.collection(SPEAKER_SLUGS).doc(patch.slug), { speakerId: docId, updatedAt: at });
        if (typeof stored.slug === 'string' && stored.slug) {
          writeTx.delete(db.collection(SPEAKER_SLUGS).doc(stored.slug));
        }
      }
      writeTx.set(ref, { ...patch, updatedAt: at, updatedBy: actor.email }, { merge: true });
    },
  };
}

/** Reads only; the returned `write` applies the row after every read. */
async function planRow({ db, tx, input, key, claimed, actor, now, newId }) {
  if (!key) return planCreate({ db, tx, payload: input, claimed, actor, now, newId });
  return planUpdate({ db, tx, payload: input, key, claimed, actor, now });
}

module.exports = {
  type: TYPE,
  docPath: SPEAKERS,
  fields: FIELDS,
  mappingError,
  mapRow,
  planRow,
  internals: { RECORD_FIELDS, splitName, incomingValues },
};
