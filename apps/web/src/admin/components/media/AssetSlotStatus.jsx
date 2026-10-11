// Status for one image slot. The sentence lives here, never inside the
// thumbnail: a 4rem frame wraps it into a one-word column.
import { secondaryButtonClass } from '../formControls.jsx';

export const ASSET_SLOT_STATUS = Object.freeze({
  loading: 'Loading this file.',
  unavailable: 'This path cannot be shown.',
  missing: 'This file is missing from storage. Choose or upload a replacement, or try again.',
  denied: 'You do not have permission to view this file. Try again, or choose another file.',
  failed: 'This file could not be loaded. Try again, or choose another file.',
});

/** Map a readable HTTP status to a slot state. Any other code is a failed load. */
export function assetFailureKind(status) {
  if (status === 401 || status === 403) return 'denied';
  if (status === 404) return 'missing';
  return 'failed';
}

/**
 * @param {{ phase: string, id: string, onRetry: () => void }} props
 */
export default function AssetSlotStatus({ phase, id, onRetry }) {
  const message = ASSET_SLOT_STATUS[phase];
  if (!message) return null;
  const retry = phase === 'missing' || phase === 'denied' || phase === 'failed';
  return (
    <div className="flex w-full min-w-0 flex-col items-start gap-2xs">
      <p id={id} className="asset-slot-status m-0 w-full text-admin-sm text-admin-ink">
        {message}
      </p>
      {retry ? (
        <button type="button" className={secondaryButtonClass} onClick={onRetry}>
          Try again
        </button>
      ) : null}
    </div>
  );
}
