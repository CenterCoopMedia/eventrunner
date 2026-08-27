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
import { useId, useState } from 'react';
import { fieldLabelClass, secondaryButtonClass } from '../formControls.jsx';
import AssetImage from '../../../components/media/AssetImage.jsx';
import ModalShell from './ModalShell.jsx';
import MediaLibrary from './MediaLibrary.jsx';

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

  return (
    <div className="flex flex-col gap-2xs">
      <label htmlFor={id} className={fieldLabelClass}>
        {label}
      </label>
      {hint ? (
        <p id={`${id}-hint`} className="text-caption text-admin-ink-secondary">
          {hint}
        </p>
      ) : null}

      <div className="flex items-start gap-sm">
        {value ? (
          <AssetImage
            path={value}
            alt=""
            className="h-16 w-16 shrink-0 rounded-admin border-admin-hairline border-admin-rule-hairline bg-admin-ground-input object-contain"
          />
        ) : (
          <span
            aria-hidden="true"
            className="flex h-16 w-16 shrink-0 items-center justify-center rounded-admin border-dashed border-admin-hairline border-admin-rule-hairline font-admin-data text-folio text-admin-ink-secondary"
          >
            None
          </span>
        )}
        <div className="flex-1">
          <input
            id={id}
            className="admin-target w-full rounded-admin border-admin-hairline border-admin-rule-strong bg-admin-ground-input px-sm py-2xs font-admin-data text-folio text-admin-ink-data aria-[invalid=true]:border-admin-rule-alarm"
            value={value ?? ''}
            onChange={(event) => onChange(event.target.value)}
            aria-invalid={error ? 'true' : undefined}
            aria-describedby={
              [hint ? `${id}-hint` : null, error ? `${id}-error` : null].filter(Boolean).join(' ') ||
              undefined
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

      {error ? (
        <p id={`${id}-error`} className="text-caption text-admin-state-error">
          {error}
        </p>
      ) : null}

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
