import { useEffect, useRef, useState } from 'react';
import AssetImage from '../../../components/media/AssetImage.jsx';
import BusyLabel from '../../../components/BusyLabel.jsx';
import { CheckboxField, Notice, SaveStatus, primaryButtonClass, secondaryButtonClass } from '../formControls.jsx';
import { mediaErrorMessage } from './mediaErrors.js';

const REPLACEMENT_ERRORS = {
  'usage-changed': 'The places using this image changed. Review the updated list and confirm again.',
  'missing-image-description': 'Add an image description to the replacement or keep the current one.',
  'missing-image-file': 'The replacement file is missing. Choose or upload another image.',
  'request-id-in-use': 'Review the places and confirm again to start a new replacement.',
};

function Places({ places, usageLocation }) {
  return (
    <ul className="list-disc space-y-3xs ps-5 text-admin-sm text-admin-ink">
      {places.map((place) => {
        const [label, href] = usageLocation(place);
        const revision = place.docPath.split('/')[0].endsWith('_drafts') ? 'Draft' : 'Published';
        return (
          <li key={`${place.docPath}:${place.field}`}>
            <a href={href} className="admin-target text-admin-ink-link underline underline-offset-2">{place.label || label}</a>
            <span className="text-admin-ink-secondary"> · {revision} · {place.field}</span>
            {place.reason ? <p>{place.reason}</p> : null}
          </li>
        );
      })}
    </ul>
  );
}

export default function AssetReplacement({ asset, scanUsage, replace, renderPicker, onBusy, onChanged, onClose, usageLocation }) {
  const [choosing, setChoosing] = useState(true);
  const [replacement, setReplacement] = useState(null);
  const [places, setPlaces] = useState(null);
  const [checkCount, setCheckCount] = useState(0);
  const [keepDescription, setKeepDescription] = useState(false);
  const [result, setResult] = useState(null);
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const chooserButton = useRef(null);
  const request = useRef(null);
  const inFlight = useRef(false);

  useEffect(() => {
    let current = true;
    scanUsage([asset.path], { replacement: true }).then((usage) => {
      if (current) setPlaces(usage[asset.path] ?? []);
    }).catch(() => {
      if (current) setError('The places using this image could not be checked. Try again.');
    });
    return () => { current = false; };
  }, [asset.path, scanUsage, checkCount]);

  function reviewRemaining() {
    request.current = null;
    setResult(null);
    setPlaces(null);
    setError(null);
    setCheckCount((count) => count + 1);
  }

  async function confirm() {
    if (inFlight.current || !replacement || !places?.length) return;
    inFlight.current = true;
    const id = request.current ??= globalThis.crypto.randomUUID();
    setBusy(true);
    onBusy(true);
    setError(null);
    try {
      const outcome = await replace(id, {
        assetId: asset.id, replacementId: replacement.id, keepDescription, references: places,
      });
      setResult(outcome);
      onChanged();
    } catch (err) {
      if (err.code === 'usage-changed' && Array.isArray(err.usage)) {
        request.current = null;
        setPlaces(err.usage);
      }
      if (err.status >= 400 && err.status < 500 && err.status !== 408 && err.status !== 429) request.current = null;
      setError(mediaErrorMessage(err, REPLACEMENT_ERRORS[err.code] ?? 'The replacement could not finish. Try again.'));
    } finally {
      inFlight.current = false;
      setBusy(false);
      onBusy(false);
    }
  }

  const confirmed = Boolean(request.current);
  return (
    <div className="mt-sm space-y-sm rounded-admin border-admin-hairline border-admin-rule-control bg-admin-ground-proof p-sm">
      <h4 className="text-admin-base font-bold text-admin-ink">Replace this image</h4>
      {replacement ? (
        <div className="flex items-center gap-sm">
          <AssetImage path={replacement.path} alt="" decorative className="h-16 w-16 object-contain" />
          <p className="min-w-0 break-words">{replacement.title || replacement.filename}</p>
        </div>
      ) : null}
      {!confirmed ? (
        <button type="button" ref={chooserButton} className={secondaryButtonClass} onClick={() => setChoosing(true)}>
          {replacement ? 'Choose a different image' : 'Choose or upload an image'}
        </button>
      ) : null}
      {choosing ? renderPicker({
        onClose: () => setChoosing(false), returnFocusRef: chooserButton,
        onSelect: (next) => { setReplacement(next); setChoosing(false); },
      }) : null}
      {error ? <Notice tone="error" message={error} /> : null}
      {!result && !places && !error ? <p role="status">Checking the places that use this image…</p> : null}
      {!places && error ? <button type="button" className={secondaryButtonClass} onClick={reviewRemaining}>Retry usage check</button> : null}
      {places?.length === 0 ? <p>No image placements currently use this file.</p> : null}
      {!result && places?.length > 0 ? (
        <>
          <p>{places.length} {places.length === 1 ? 'place will change' : 'places will change'}. The previous image stays in the library.</p>
          <Places places={places} usageLocation={usageLocation} />
          {replacement && !keepDescription ? (
            <p className="text-admin-sm text-admin-ink-secondary">
              {replacement.caption || replacement.credit
                ? [replacement.caption, replacement.credit].filter(Boolean).join(' · ')
                : 'The replacement image has no caption or credit.'}
            </p>
          ) : null}
          <CheckboxField label="Keep the current description" checked={keepDescription} onChange={setKeepDescription}
            help="Keep the alt text, caption, and credit at each place. Clear the checkbox to use the replacement image’s description." disabled={busy || confirmed} />
        </>
      ) : null}
      {result?.changed?.length > 0 ? (
        <>
          <SaveStatus message={`${result.changed.length} ${result.changed.length === 1 ? 'place changed' : 'places changed'}.`} />
          <Places places={result.changed} usageLocation={usageLocation} />
        </>
      ) : null}
      {result?.failed?.length > 0 ? (
        <>
          <Notice tone="error" message="Some places could not be changed." />
          <Places places={result.failed} usageLocation={usageLocation} />
        </>
      ) : null}
      <div className="flex flex-wrap gap-xs">
        {replacement && places?.length > 0 && (!result || result.status === 'failed') ? (
          <button type="button" className={primaryButtonClass} onClick={confirm} aria-disabled={busy || undefined} aria-busy={busy || undefined}>
            <BusyLabel busy={busy} pending="Replacing the image…">{confirmed ? 'Retry replacement' : 'Confirm replacement'}</BusyLabel>
          </button>
        ) : null}
        {result?.status === 'done' && result.failed?.length > 0 ? <button type="button" className={secondaryButtonClass} disabled={busy} onClick={reviewRemaining}>Review remaining uses</button> : null}
        <button type="button" className={secondaryButtonClass} disabled={busy} onClick={onClose}>{result ? 'Close replacement details' : 'Cancel replacement'}</button>
      </div>
    </div>
  );
}
