'use strict';

const { badRequest, internal, sendError } = require('../core/errors.cjs');
const { internals, isValidDocId, logAdminAction } = require('./store.cjs');

async function publishMenuOrder({ db, ids, queueRef, actor, now, log, publish, res }) {
  if (!Array.isArray(ids) || !ids.length || !ids.every(isValidDocId) || new Set(ids).size !== ids.length) {
    return badRequest(res, 'The menu order could not be read. Refresh the page and try again.');
  }

  let results;
  try {
    results = await db.runTransaction(async (tx) => {
      const [live, drafts, existing] = await Promise.all([
        tx.get(db.collection('cmsPages')),
        tx.get(db.collection('cmsPages_drafts')),
        tx.get(queueRef),
      ]);
      if (existing.exists) return 'request-id-in-use';

      const positions = new Map(ids.map((id, order) => [id, order]));
      const snapshots = [...live.docs, ...drafts.docs];
      const storedIds = new Set(snapshots.map((doc) => doc.id));
      if (storedIds.size !== ids.length || ids.some((id) => !storedIds.has(id))) return 'menu-list-changed';

      const changed = snapshots.filter((doc) => doc.data().order !== positions.get(doc.id));
      const published = live.docs.filter((doc) => doc.data().order !== positions.get(doc.id)).map((doc) => doc.id);
      // Reserve one write for the publish record. The order is committed as a unit.
      if (changed.length + 1 > internals.MAX_WRITES_PER_BATCH) return 'menu-too-large';
      for (const doc of changed) tx.update(doc.ref, { order: positions.get(doc.id) });
      if (!published.length) return {};

      const timestamp = new Date(now());
      const progress = { cmsPages: { published, skipped: [], chunksCommitted: 1 } };
      tx.create(queueRef, {
        status: 'done', menuOrder: true, request: { cmsPages: published }, progress, plannedChunks: 1,
        requestedBy: actor.email, requestedAt: timestamp, updatedAt: timestamp, finishedAt: timestamp,
      });
      return progress;
    });
  } catch (err) {
    log.error('cmsPublish menu order write failed', err);
    return internal(res, 'The menu order could not be confirmed. Check the page list before trying again.');
  }

  if (results === 'request-id-in-use') {
    return sendError(res, 409, results, 'Check Recent publishes for the result.');
  }
  if (results === 'menu-list-changed') {
    return sendError(res, 409, results, 'The page list changed. Check the list, then publish the menu order again.');
  }
  if (results === 'menu-too-large') {
    return sendError(res, 400, results, 'This menu has too many changes to publish together. Contact support for help.');
  }
  const queueId = results.cmsPages ? queueRef.id : null;
  if (queueId) {
    await logAdminAction({ db, action: 'cms-publish-menu-order', docPath: queueRef.path, actor, now, log });
    await publish(queueId);
  }
  return res.status(200).json({ queueId, status: 'done', results });
}

module.exports = { publishMenuOrder };
