'use strict';

const { isMediaLibraryPath, storageObjectPath } = require('shared/venue');
const { MAX_CAPTION_LENGTH, MAX_CREDIT_LENGTH } = require('shared/imageCaption');
const { badRequest, internal, notFound, sendError } = require('../core/errors.cjs');
const { contentFieldsOf, isAlreadyExistsError, isValidDocId, logAdminAction, writeConfigVersion, internals } = require('../cms/store.cjs');
const { scanReplacementUsage } = require('./usage.cjs');
const { replaceImageFields } = require('./replacementPlacements.cjs');
const { internals: { isBrandingAsset, referencedByBranding, BRANDING_REFUSAL } } = require('./upload.cjs');

function assetDescription(row) {
  const path = storageObjectPath(row?.path);
  if (!isMediaLibraryPath(path)) return null;
  const text = (value) => typeof value === 'string' ? value.trim() : '';
  return {
    path, alt: text(row.alt), caption: text(row.caption).slice(0, MAX_CAPTION_LENGTH),
    credit: text(row.credit).slice(0, MAX_CREDIT_LENGTH),
  };
}

function referenceKeys(references) {
  return references.map(({ docPath, field }) => JSON.stringify([docPath, field])).sort();
}

function groupsFor(references) {
  const groups = new Map();
  for (const { docPath, field } of references) {
    const [stored, id] = docPath.split('/');
    const collection = stored.replace(/_drafts$/, '');
    const key = `${collection}/${id}`;
    if (!groups.has(key)) groups.set(key, { collection, id, live: [], draft: [] });
    const group = groups.get(key);
    group[stored === collection ? 'live' : 'draft'].push(field);
  }
  return groups;
}

async function replaceGroup({ db, queueRef, group, key, plan, bucket, targetExists, actor, now }) {
  const { collection, id, live, draft } = group;
  const liveRef = db.collection(collection).doc(id);
  const draftRef = collection === 'config' ? null : db.collection(`${collection}_drafts`).doc(id);
  const targetRef = db.collection('media_assets').doc(plan.replacementId);
  return db.runTransaction(async (tx) => {
    const [queueSnap, liveSnap, targetSnap, draftSnap] = await tx.getAll(
      queueRef, liveRef, targetRef, ...(draftRef ? [draftRef] : []),
    );
    const queue = queueSnap.data();
    if (queue.status === 'done' || queue.mediaReplacement.completed?.[key]) return;
    const at = new Date(now());
    const settle = (outcome) => tx.set(queueRef, {
      mediaReplacement: { completed: { [key]: outcome } }, updatedAt: at,
    }, { merge: true });
    const liveData = liveSnap.data();
    const draftData = draftSnap?.data();
    if (!targetExists || assetDescription(targetSnap.data())?.path !== plan.target.path) {
      settle('The replacement file is missing. Choose or upload another image.');
      return;
    }

    const replace = (doc, expected) => replaceImageFields({
      collection, id, doc, expected, source: { ...plan.source, id: plan.assetId },
      target: { ...plan.target, id: plan.replacementId }, bucket,
      keepDescription: plan.keepDescription,
    });
    const nextLive = replace(liveData, live);
    const nextDraft = replace(draftData, draft);
    const refusal = nextLive.failed[0] ?? nextDraft.failed[0];
    if (refusal) {
      // A stale choice needs a fresh preview. Resending the confirmed plan
      // must never overwrite a placement another editor has since changed.
      settle(refusal.reason);
      return;
    }

    let revision;
    if (live.length > 0 && collection === 'config') {
      writeConfigVersion({
        tx, ref: liveRef, historyRef: db.collection('cmsVersionHistory').doc(), docPath: key, fields: nextLive.next, at, actor,
      });
    } else if (live.length > 0) {
      const previous = typeof liveData.revision === 'number' ? liveData.revision
        : await internals.maxHistoryRevision({ db, docPath: key });
      revision = previous + 1;
      tx.set(liveRef, { ...nextLive.next, revision, publishedAt: at, publishedBy: actor.uid });
      tx.set(db.collection('cmsVersionHistory').doc(), {
        docPath: key, revision, fields: contentFieldsOf(nextLive.next), visible: liveData.visible === true,
        publishedAt: at, publishedBy: actor.email, publishedByUid: actor.uid,
      });
    }
    const followsLive = revision !== undefined && draftData && draftData.basedOnRevision === liveData.revision;
    if (draft.length > 0) {
      const basedOnRevision = followsLive ? { basedOnRevision: revision } : {};
      tx.set(draftRef, { ...nextDraft.next, ...basedOnRevision, updatedAt: at, updatedBy: actor.email });
    } else if (followsLive) {
      tx.update(draftRef, { basedOnRevision: revision });
    }
    settle(true);
  });
}

function needsDescription({ docPath, field }) {
  return docPath.startsWith('cmsContent') || docPath.startsWith('cmsUpdates') || field === 'venue.map.image';
}

async function prepare({ db, bucket, body, actor, res }) {
  const { assetId, replacementId, keepDescription = false, references } = body || {};
  if (!isValidDocId(assetId) || !isValidDocId(replacementId) || assetId === replacementId
    || typeof keepDescription !== 'boolean' || !Array.isArray(references)
    || !references.every((ref) => typeof ref?.docPath === 'string' && typeof ref?.field === 'string')) {
    badRequest(res, 'Choose a different library image and check where it will be used.');
    return null;
  }
  const library = db.collection('media_assets');
  const [oldSnap, newSnap] = await db.getAll(library.doc(assetId), library.doc(replacementId));
  const oldRow = oldSnap.data();
  const newRow = newSnap.data();
  const source = assetDescription(oldRow);
  const target = assetDescription(newRow);
  if (!source || !target || source.path === target.path) {
    badRequest(res, 'Choose two different images from the media library.');
    return null;
  }
  const usage = await scanReplacementUsage({ db, paths: [source.path], bucket: bucket.name });
  const places = usage[source.path].map(({ docPath, field, label }) => ({ docPath, field, ...(label ? { label } : {}) }));
  const operatorOnly = isBrandingAsset(oldRow) || isBrandingAsset(newRow) || referencedByBranding(places);
  if (operatorOnly && actor.tier !== 'operator') {
    sendError(res, 403, 'forbidden', BRANDING_REFUSAL);
    return null;
  }
  if (JSON.stringify(referenceKeys(references)) !== JSON.stringify(referenceKeys(places))) {
    res.status(409).json({ error: { code: 'usage-changed', message: 'The image uses changed. Review the updated list.' }, usage: places });
    return null;
  }
  if (!keepDescription && !target.alt && places.some(needsDescription)) {
    sendError(res, 400, 'missing-image-description', 'Add an image description to the replacement or keep the current one.');
    return null;
  }
  return {
    assetId, replacementId, keepDescription, source, target: { path: target.path, alt: target.alt },
    places, operatorOnly, completed: {},
  };
}

/** A regular publish receipt also tracks which replacement groups committed.
 * Each group's live/draft changes and progress commit together. The normal
 * site publisher refreshes the committed public snapshot when it finishes. */
async function runMediaReplacement({ db, getBucket, queueRef, body, actor, now, log, publish, res }) {
  try {
    const bucket = getBucket();
    let row = (await queueRef.get()).data();
    let checkedPath;
    if (!row && body) {
      const plan = await prepare({ db, bucket, body, actor, res });
      if (!plan) return;
      if (plan.places.length === 0) return res.status(200).json({ status: 'done', changed: [], failed: [] });
      const [exists] = await bucket.file(plan.target.path).exists();
      if (!exists) return sendError(res, 400, 'missing-image-file', 'The replacement file is missing. Choose or upload an image.');
      checkedPath = plan.target.path;
      const at = new Date(now());
      try {
        await queueRef.create({
          status: 'running', request: {}, progress: {}, mediaReplacement: plan,
          requestedBy: actor.email, requestedAt: at, updatedAt: at,
        });
      } catch (err) {
        if (!isAlreadyExistsError(err)) throw err;
      }
      row = (await queueRef.get()).data();
    }
    const plan = row?.mediaReplacement;
    if (!plan) return notFound(res, 'No image replacement was found.');
    if (plan.operatorOnly && actor.tier !== 'operator') return sendError(res, 403, 'forbidden', BRANDING_REFUSAL);
    if (body && (plan.assetId !== body.assetId || plan.replacementId !== body.replacementId
      || plan.keepDescription !== (body.keepDescription === true))) {
      return sendError(res, 409, 'request-id-in-use', 'This request already belongs to another image replacement.');
    }
    const targetExists = row.status === 'done' || checkedPath === plan.target.path
      || (await bucket.file(plan.target.path).exists())[0];

    const groups = groupsFor(plan.places);
    const errors = new Map();
    for (const [key, group] of groups) {
      if (row.status === 'done' || plan.completed[key]) continue;
      try {
        await replaceGroup({ db, queueRef, group, key, plan, bucket: bucket.name, targetExists, actor, now });
      } catch (err) {
        log.error('Image replacement group did not commit', key, err);
        errors.set(key, 'This place could not be saved. Try again.');
      }
    }

    const outcome = await db.runTransaction(async (tx) => {
      const latest = (await tx.get(queueRef)).data();
      const completed = latest.mediaReplacement.completed;
      const changed = [];
      const failed = [];
      for (const place of plan.places) {
        const key = place.docPath.replace(/_drafts\//, '/');
        if (completed[key] === true) changed.push(place);
        else failed.push({ ...place, reason: completed[key] || errors.get(key) || 'This place could not be saved.' });
      }
      const pending = [...groups.keys()].some((key) => !completed[key]);
      const status = latest.status === 'done' || !pending ? 'done' : 'failed';
      const at = new Date(now());
      if (latest.status !== 'done') {
        tx.set(queueRef, { status, updatedAt: at, ...(status === 'done' ? { finishedAt: at } : {}) }, { merge: true });
      }
      return {
        changed, failed, status,
        finished: status === 'done' && latest.status !== 'done',
        publishLive: changed.some(({ docPath }) => !docPath.split('/')[0].endsWith('_drafts')),
      };
    });
    const { finished, publishLive, ...result } = outcome;
    if (finished) await logAdminAction({ db, action: 'mediaReplace', docPath: queueRef.path, actor, now, log });
    const publisher = finished && publishLive ? await publish(queueRef.id) : undefined;
    return res.status(200).json({ queueId: queueRef.id, ...result, ...(publisher ? { publisher } : {}) });
  } catch (err) {
    log.error('Image replacement failed', err);
    return internal(res, 'The replacement could not finish. Try again to continue.');
  }
}

module.exports = { runMediaReplacement };
