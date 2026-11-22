'use strict';

const { internals: { decodedReferenceText, stringLeaves } } = require('./usage.cjs');

// Upload paths carry the media_assets document ID between the folder and filename.
// The same path can also appear inside prose or a Storage download URL.
const ASSET_REFERENCE = /(?:cms-images|branding)\/([\w-]+)\//g;

function guardableMediaPath(path, assetId) {
  return [...path.matchAll(ASSET_REFERENCE)].some((match) => match.index === 0 && match[1] === assetId);
}

async function requireAvailableMediaReferences({ db, tx, fields }) {
  const values = stringLeaves(fields).flatMap(({ value }) => [value, decodedReferenceText(value)]);
  const assetIds = [...new Set(values.flatMap((value) => [...value.matchAll(ASSET_REFERENCE)].map((match) => match[1])))];
  for (let start = 0; start < assetIds.length; start += 30) {
    // Read the same durable receipt the remover updates. A concurrent write
    // either commits first and is seen by the usage scan, or retries against
    // the reservation. The completed receipt also guards stale editor tabs.
    const query = db.collection('cmsPublishQueue').where('mediaReplacement.assetId', 'in', assetIds.slice(start, start + 30));
    const snapshot = await tx.get(query);
    const unavailable = snapshot.docs.some((doc) => {
      const plan = doc.data().mediaReplacement;
      return ['removing', 'deleted'].includes(plan.deletion?.status)
        && values.some((value) => value.includes(plan.source.path));
    });
    if (unavailable) {
      const message = 'An image in this edit was removed from the media library. Choose a current image and save again.';
      throw Object.assign(new Error(message), { httpError: { status: 409, code: 'media-unavailable', message } });
    }
  }
}

module.exports = { guardableMediaPath, requireAvailableMediaReferences };
