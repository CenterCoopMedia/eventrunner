// What the media endpoints refuse, in the words a person reads (issue 186).
//
// functions/src/media refuses a staff write to a branding file with one
// fixed message; the drawer says it as a sentence wherever it can come back
// (upload, save, delete). The two predicates mirror the server's
// `isBrandingAsset` and `referencedByBranding` so the drawer can hold the
// write controls back BEFORE a request the server would refuse, instead of
// offering a button that fails.

/** The server's refusal, verbatim (functions/src/media/upload.cjs). */
export const BRANDING_REFUSAL = 'branding: operator access required';

/** The one-line note the read-only drawer and modal carry. */
export const BRANDING_NOTE = 'Ask your site manager to change branding files.';

/** The refusal, as a sentence. */
export const BRANDING_REFUSED = 'Only your site manager can change branding files.';

/**
 * The sentence an endpoint's error is shown as.
 *
 * @param {unknown} err
 * @returns {string}
 */
export function mediaErrorMessage(err, fallback = 'The file could not be updated. Try again.') {
  if (err?.message === BRANDING_REFUSAL) return BRANDING_REFUSED;
  if (err?.code === 'unauthenticated' || err?.status === 401) return 'Your session has expired. Sign in again.';
  if (err?.code === 'forbidden' || err?.status === 403) return 'You cannot change this file. Ask your site manager for help.';
  if (err?.code === 'asset-in-use') return 'This file is in use. Review where it is used before deleting it.';
  if (err?.code === 'not-found' || err?.status === 404) return 'This file is no longer available. Choose another file.';
  return fallback;
}

/** @param {{ folder?: string, path?: string } | null | undefined} asset @returns {boolean} */
export function isBrandingAsset(asset) {
  return asset?.folder === 'branding'
    || (typeof asset?.path === 'string' && asset.path.startsWith('branding/'));
}

/**
 * Whether the usage scan shows an asset on a branding surface — a theme
 * slot, or the social sharing card — which makes it branding whatever
 * folder it sits in.
 *
 * @param {Array<{ docPath: string, field?: string }> | null | undefined} references
 * @returns {boolean}
 */
export function referencedByBranding(references) {
  return (references ?? []).some((reference) => typeof reference?.docPath === 'string'
    && (reference.docPath.startsWith('config/theme')
      || (reference.docPath === 'config/event' && reference.field === 'seo.defaultOgImagePath')));
}
