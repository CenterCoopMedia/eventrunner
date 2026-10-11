// ImagePicker: one image slot, backed by the media library. Admin-only
// (design brief §5.2, admin story part 2 "the cut file").
//
// The reusable half of this issue. Any admin form with an image field —
// the branding logo slots today, the speaker wizard's headshot and CMS
// image blocks as they land — renders this instead of a bare path input and
// gets browse, upload, preview, and clear for free.
//
// The stored VALUE is the Storage object path, not a download URL. Download
// URLs carry a token, expire in the sense that they change when an object is
// replaced, and would pin config/theme to one bucket; the path is the stable
// identity every consumer (and scanMediaUsage) already speaks.
//
// The path stays editable as text underneath, in the mono: it is an
// identifier, and identifiers are the machine's. Assets seeded by init
// (`branding/logo.svg`) or served from the bundle have no media_assets row
// to click, and a picker that could not express them would be a downgrade
// from the plain field it replaces.
import { useId, useRef, useState } from 'react';
import {
  FieldError,
  fieldHintClass,
  fieldLabelClass,
  secondaryButtonClass,
} from '../formControls.jsx';
import { assetUrl, brandingSrc } from '../../../lib/mediaSource.js';
import AssetSlotStatus, { ASSET_SLOT_STATUS, assetFailureKind } from './AssetSlotStatus.jsx';
import ModalShell from './ModalShell.jsx';
import MediaLibrary from './MediaLibrary.jsx';

// Branding slots and the page preview must ask the same origin. The preview
// uses brandingSrc: a flat seeded path is a bundle file, and only a library
// upload is a Storage object. assetUrl sends every flat path to Storage.
function slotSrc(folder, value) {
  if (!value) return null;
  return folder === 'branding' ? brandingSrc(value) : assetUrl(value);
}

// The frame clips the picture only. The status sentence is a sibling below the row.
const frameClass =
  'asset-slot-frame flex h-16 w-16 shrink-0 items-center justify-center overflow-hidden rounded-admin border-admin-hairline border-admin-rule-hairline bg-admin-ground-soft';

function initialPhase(value, src) {
  if (!value) return 'idle';
  if (!src) return 'unavailable';
  return 'loading';
}

export default function ImagePicker({
  label,
  value,
  onChange,
  folder = 'cms-images',
  hint = null,
  error = null,
}) {
  const id = useId();
  const src = slotSrc(folder, value);
  const identity = `${value ?? ''}\0${src ?? ''}`;
  const generation = useRef(0);
  const [browsing, setBrowsing] = useState(false);
  const [reload, setReload] = useState(0);
  const [retrying, setRetrying] = useState(false);
  const [phase, setPhase] = useState(() => initialPhase(value, src));
  const [seenIdentity, setSeenIdentity] = useState(identity);
  const [seenReload, setSeenReload] = useState(0);

  // Reset while rendering. A passive effect runs too late: a cached image can
  // already have reported load, and the effect would hide it again.
  let shownPhase = phase;
  let shownRetrying = retrying;
  if (seenIdentity !== identity || seenReload !== reload) {
    generation.current += 1;
    const identityChanged = seenIdentity !== identity;
    const nextReload = identityChanged ? 0 : reload;
    if (identityChanged) {
      setSeenIdentity(identity);
      setRetrying(false);
      shownRetrying = false;
      if (reload !== 0) setReload(0);
    }
    if (seenReload !== nextReload) setSeenReload(nextReload);
    shownPhase = nextReload === 0 ? initialPhase(value, src) : (src ? 'loading' : initialPhase(value, src));
    if (shownPhase !== phase) setPhase(shownPhase);
  }

  function accept(ticket) {
    if (ticket !== generation.current) return;
    setPhase('ready');
  }

  function bindImage(node) {
    if (node && node.complete && node.naturalWidth > 0) accept(Number(node.dataset.generation));
  }

  function onLoad(event) {
    accept(Number(event.currentTarget.dataset.generation));
  }

  function onError(event) {
    const ticket = Number(event.currentTarget.dataset.generation);
    const url = event.currentTarget.currentSrc || event.currentTarget.src;
    if (ticket !== generation.current || !url) return;
    // GET is the method a Storage bucket allows the browser to read. HEAD is
    // rejected before a 404 or 403 can be seen.
    fetch(url, { method: 'GET' })
      .then((response) => {
        const cancel = response.body?.cancel?.();
        if (cancel && typeof cancel.then === 'function') cancel.catch(() => {});
        if (ticket !== generation.current) return;
        setPhase(assetFailureKind(response.status));
      })
      .catch(() => {
        if (ticket !== generation.current) return;
        setPhase('failed');
      });
  }

  const statusId = `${id}-status`;

  return (
    <div className="flex min-w-0 flex-col gap-2xs">
      <label htmlFor={id} className={fieldLabelClass}>
        {label}
      </label>
      {hint ? (
        <p id={`${id}-hint`} className={fieldHintClass}>
          {hint}
        </p>
      ) : null}

      <div className="flex min-w-0 flex-wrap items-start gap-sm">
        {value ? (
          <span className={frameClass}>
            {src ? (
              <img
                key={`${src}:${reload}`}
                src={src}
                alt=""
                data-generation={generation.current}
                ref={bindImage}
                className={`h-full w-full object-contain${shownPhase === 'ready' ? '' : ' invisible'}`}
                onLoad={onLoad}
                onError={onError}
              />
            ) : null}
          </span>
        ) : (
          <span
            aria-hidden="true"
            className={`${frameClass} border-dashed font-admin-data text-admin-xs text-admin-ink-secondary`}
          >
            None
          </span>
        )}
        <div className="min-w-0 flex-1">
          <input
            id={id}
            className="admin-target min-h-admin-control min-w-0 w-full rounded-admin border-admin-hairline border-admin-rule-control bg-admin-ground-input px-sm py-xs font-admin-data text-admin-sm text-admin-ink-data aria-[invalid=true]:border-admin-rule-alarm"
            value={value ?? ''}
            onChange={(event) => onChange(event.target.value)}
            aria-invalid={error ? 'true' : undefined}
            aria-describedby={
              [hint ? `${id}-hint` : null, shownPhase === 'loading' || !ASSET_SLOT_STATUS[shownPhase] ? null : statusId, error ? `${id}-error` : null]
                .filter(Boolean)
                .join(' ') || undefined
            }
            placeholder={`${folder}/…`}
          />
          <div className="mt-2xs flex flex-wrap gap-2xs">
            <button type="button" className={secondaryButtonClass} onClick={() => setBrowsing(true)}>
              Choose or upload…
            </button>
            {value ? (
              <button type="button" className={secondaryButtonClass} onClick={() => onChange('')}>
                Clear
              </button>
            ) : null}
          </div>
        </div>
      </div>
      <AssetSlotStatus
        phase={shownPhase}
        id={statusId}
        retrying={shownRetrying}
        onRetry={() => {
          setRetrying(true);
          setReload((n) => n + 1);
        }}
      />

      <FieldError id={`${id}-error`} message={error} />

      {browsing ? (
        <ModalShell
          title={`Choose an image — ${label}`}
          description="Pick a file from the library, or upload a new one."
          onClose={() => setBrowsing(false)}
        >
          <MediaLibrary
            folder={folder}
            selectedPath={value || null}
            onSelect={(asset) => {
              onChange(asset ? asset.path : '');
              if (asset) setBrowsing(false);
            }}
          />
        </ModalShell>
      ) : null}
    </div>
  );
}
