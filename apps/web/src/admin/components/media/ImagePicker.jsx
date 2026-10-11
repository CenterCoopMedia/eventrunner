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
import { useEffect, useId, useRef, useState } from 'react';
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

export default function ImagePicker({
  label,
  value,
  onChange,
  folder = 'cms-images',
  hint = null,
  error = null,
}) {
  const id = useId();
  const [browsing, setBrowsing] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const [phase, setPhase] = useState('idle');
  const probe = useRef(0);
  const src = slotSrc(folder, value);

  useEffect(() => {
    probe.current += 1;
    if (!value) {
      setPhase('idle');
      return;
    }
    if (!src) {
      setPhase('unavailable');
      return;
    }
    setPhase('loading');
  }, [value, src, attempt]);

  function onLoad() {
    probe.current += 1;
    setPhase('ready');
  }

  function onError() {
    const ticket = probe.current;
    const url = src;
    fetch(url, { method: 'HEAD' })
      .then((response) => {
        if (ticket !== probe.current) return;
        setPhase(assetFailureKind(response.status));
      })
      .catch(() => {
        if (ticket !== probe.current) return;
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
                key={`${src}:${attempt}`}
                src={src}
                alt=""
                className={`h-full w-full object-contain${phase === 'ready' ? '' : ' invisible'}`}
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
              [hint ? `${id}-hint` : null, phase === 'loading' || !ASSET_SLOT_STATUS[phase] ? null : statusId, error ? `${id}-error` : null]
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
      <AssetSlotStatus phase={phase} id={statusId} onRetry={() => setAttempt((n) => n + 1)} />

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
