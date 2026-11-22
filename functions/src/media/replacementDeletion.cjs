'use strict';

const { storageObjectPath } = require('shared/venue');
const { logAdminAction } = require('../cms/store.cjs');
const { scanUsage } = require('./usage.cjs');
const { removeMediaFile } = require('./upload.cjs');

async function deleteReplacedOriginal({ db, bucket, queueRef, publisherAvailable, now, log }) {
  try {
    const decision = await db.runTransaction(async (transaction) => {
      const queue = (await transaction.get(queueRef)).data();
      const plan = queue?.mediaReplacement;
      if (plan?.deleteOriginal !== true) return null;
      const previous = plan.deletion;
      if (previous?.status === 'deleted' || previous?.status === 'kept') return previous;
      if (queue.status !== 'done' || !plan.places.length || plan.places.some(({ docPath }) => (
        plan.completed[docPath.replace(/_drafts\//, '/')] !== true
      ))) {
        return { status: 'kept', message: 'The original file was kept because some places could not be changed.' };
      }
      const record = (deletion) => {
        transaction.set(queueRef, { mediaReplacement: { deletion } }, { merge: true });
        return deletion;
      };

      const { path } = plan.source;
      const ref = db.collection('media_assets').doc(plan.assetId);
      const asset = (await transaction.get(ref)).data();
      if (storageObjectPath(asset?.path) !== path || (asset.deleting && previous?.status !== 'removing')) {
        return record({ status: 'kept', message: 'The original file’s library entry changed. Check the media library before deleting it.' });
      }

      // Check the full usage corpus, including places the replacement does not edit.
      const usage = await scanUsage({ db, transaction, paths: [path] });
      if (usage[path].length > 0) {
        if (previous?.status === 'removing') transaction.update(ref, { deleting: false });
        return record({ status: 'kept', message: 'The original file was kept because it is still used in your event.' });
      }

      const publishLive = plan.places.some(({ docPath }) => !docPath.split('/')[0].endsWith('_drafts'));
      if (publishLive && queue.publisher?.status !== 'done') {
        const publisherFailed = queue.publisher?.status === 'failed' || queue.publisher?.invoke?.status === 'failed';
        if (!publisherAvailable || publisherFailed) {
          return record({ status: 'kept', message: 'The original file was kept because the public site may still use it.' });
        }
        return previous ?? record({ status: 'waiting-for-site', message: 'The original file stays in the library while the public site updates.' });
      }

      transaction.update(ref, { deleting: true });
      record({ status: 'removing', message: '' });
      return { status: 'removing', ref, path, actor: { uid: plan.deleteRequestedByUid, email: queue.requestedBy } };
    });
    if (decision?.status !== 'removing') return decision;

    const deleted = { status: 'deleted', message: 'The original file was deleted.' };
    const batch = db.batch();
    batch.set(queueRef, { mediaReplacement: { deletion: deleted } }, { merge: true });
    const { ref, path, actor } = decision;
    await removeMediaFile({ db, bucket, ref, path, batch });
    await logAdminAction({ db, action: 'mediaDelete', docPath: ref.path, actor, now, log });
    return deleted;
  } catch (err) {
    log.error('Image replacement could not confirm deletion of the original', err);
    return { status: 'retry', message: 'The original file’s deletion could not be confirmed. Try again.' };
  }
}

function createReplacementPublicationHandler({ db, getBucket, now = Date.now, log = console }) {
  return async function onReplacementPublication({ data }) {
    const after = data?.after?.data();
    const status = after?.publisher?.status;
    if (after?.mediaReplacement?.deletion?.status !== 'waiting-for-site'
      || !['done', 'failed'].includes(status) || status === data.before.data()?.publisher?.status) return;

    const deletion = await deleteReplacedOriginal({ db, bucket: getBucket(), queueRef: data.after.ref, publisherAvailable: true, now, log });
    if (deletion?.status === 'retry') throw new Error('Original image deletion needs another attempt.');
  };
}

function buildHandlers() {
  const { onDocumentUpdated } = require('firebase-functions/v2/firestore');
  const region = (process.env.EVENT_FIREBASE_REGION || '').trim() || 'us-central1';
  return {
    onMediaReplacementPublication: onDocumentUpdated({ region, retry: true, document: 'cmsPublishQueue/{queueId}' }, async (event) => {
      const { getDb } = require('../core/firestore.cjs');
      const { getBucket } = require('../core/storage.cjs');
      await createReplacementPublicationHandler({ db: getDb(), getBucket })(event);
    }),
  };
}

module.exports = { deleteReplacedOriginal, createReplacementPublicationHandler, get handlers() { return buildHandlers(); } };
