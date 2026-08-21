'use strict';

/**
 * Neutral branding placeholders for the `branding/` Storage slots
 * (spec §5.1 step g, §5.4, §7.2).
 *
 * The four assets already ship in `apps/web/public/branding/` — a wordless
 * logo, a mark, a favicon, and an OG card, all drawn from theme tokens and
 * naming no organization. Init copies them into the deployment's Storage
 * bucket so every slot resolves to something from the first minute, and
 * records which slots are still placeholders on `config/theme` so the
 * launch-readiness branding row (§5.1.1) can tell "not replaced yet" from
 * "replaced by the client".
 *
 * Upload is fail-soft by design. `storage.rules` makes `branding/`
 * server-write-only, and the Admin SDK bypasses rules, so the upload works
 * wherever a bucket exists — but a bucket may legitimately not exist yet
 * (Storage not provisioned, or a Firestore-only emulator run). §5.1.1 is
 * explicit that init warns rather than fails, and the assets are also
 * served from `apps/web/public/` in the build, so a skipped upload
 * degrades to "served from the bundle", not a broken page.
 */

const fs = require('node:fs');
const path = require('node:path');

const SOURCE_DIR = path.resolve(__dirname, '..', '..', 'apps', 'web', 'public', 'branding');

/** Storage object path → source file, one per §7.2 logo slot. */
const BRANDING_ASSETS = Object.freeze({
  'branding/logo.svg': 'logo.svg',
  'branding/mark.svg': 'mark.svg',
  'branding/favicon.svg': 'favicon.svg',
  'branding/og-default.svg': 'og-default.svg',
});

/**
 * Whether an existing Storage object may be overwritten by a placeholder.
 *
 * The same rule as the seeded Firestore documents, expressed in the only
 * place Storage can carry it: init stamps `metadata.seeded = 'true'` on
 * everything it uploads, so an object without that stamp is a client's own
 * logo and is left alone. Without this, a `--force` re-run would replace a
 * client's uploaded branding with a neutral placeholder — the Storage
 * version of exactly the clobber the Firestore path refuses.
 *
 * @param {object} file a Storage File handle
 * @returns {Promise<{ overwrite: boolean, reason: string }>}
 */
async function mayOverwrite(file) {
  let exists = false;
  try {
    [exists] = await file.exists();
  } catch (err) {
    return { overwrite: false, reason: `could not check existing object: ${err.message}` };
  }
  if (!exists) return { overwrite: true, reason: 'absent' };
  let metadata = null;
  try {
    [metadata] = await file.getMetadata();
  } catch (err) {
    // Unknown provenance is treated as the client's: refusing to write is
    // recoverable (upload it again), overwriting a logo is not.
    return { overwrite: false, reason: `could not read object metadata: ${err.message}` };
  }
  if (metadata?.metadata?.seeded === 'true') {
    return { overwrite: true, reason: 'still the seeded placeholder' };
  }
  return { overwrite: false, reason: 'client-replaced asset' };
}

/**
 * Upload every placeholder asset that is absent or still a placeholder.
 *
 * @param {{ bucket: () => object, dryRun?: boolean, sourceDir?: string }} args
 *   `bucket` is a thunk so a deployment without EVENT_STORAGE_BUCKET fails
 *   here (caught, warned) instead of at credential-resolution time.
 * @returns {Promise<{ uploaded: string[],
 *                     skipped: Array<{ path: string, reason: string,
 *                                      kind: 'protected'|'error' }> }>}
 *   `protected` is a normal outcome (the slot already holds a client
 *   asset); only `error` entries are worth a warning.
 */
async function uploadPlaceholderBranding({ bucket, dryRun = false, sourceDir = SOURCE_DIR }) {
  const uploaded = [];
  const skipped = [];

  let target = null;
  if (!dryRun) {
    try {
      target = bucket();
    } catch (err) {
      for (const objectPath of Object.keys(BRANDING_ASSETS)) {
        skipped.push({ path: objectPath, reason: err.message, kind: 'error' });
      }
      return { uploaded, skipped };
    }
  }

  for (const [objectPath, file] of Object.entries(BRANDING_ASSETS)) {
    const source = path.join(sourceDir, file);
    if (!fs.existsSync(source)) {
      skipped.push({ path: objectPath, reason: `missing source asset ${source}`, kind: 'error' });
      continue;
    }
    if (dryRun) {
      uploaded.push(objectPath);
      continue;
    }
    const verdict = await mayOverwrite(target.file(objectPath));
    if (!verdict.overwrite) {
      // Not a problem: the slot already holds something this script must
      // not touch. Reported, but never as a warning.
      skipped.push({ path: objectPath, reason: verdict.reason, kind: 'protected' });
      continue;
    }
    try {
      await target.upload(source, {
        destination: objectPath,
        metadata: {
          contentType: 'image/svg+xml',
          cacheControl: 'public, max-age=3600',
          metadata: { seeded: 'true' },
        },
      });
      uploaded.push(objectPath);
    } catch (err) {
      skipped.push({ path: objectPath, reason: err.message, kind: 'error' });
    }
  }
  return { uploaded, skipped };
}

module.exports = { BRANDING_ASSETS, SOURCE_DIR, uploadPlaceholderBranding, mayOverwrite };
