// The browsable library: every indexed asset as a grid, with upload, search,
// per-asset details, and delete-with-usage-warning. Admin-only (design brief
// §5.2, admin story part 2 "the cut file") — a print shop's cabinet of
// engravings, not a photo gallery. The thumbnail is evidence; the path and
// size beside it, in the mono, are the point.
//
// One component serves both jobs the issue names. On the Media tab it is a
// browser: clicking a tile opens its detail modal. Inside ImagePicker it is
// a chooser: `onSelect` is supplied, tiles become picker buttons, and the
// "details" affordance moves to a secondary control so a pick is never one
// mis-click from a delete dialog.
import { useMemo, useState } from 'react';
import { formatBytes } from '../../../lib/mediaSource.js';
import { AdminEmptyState, AdminLoadingState } from '../adminChrome.jsx';
import { Notice, primaryButtonClass, secondaryButtonClass } from '../formControls.jsx';
import AssetImage from '../../../components/media/AssetImage.jsx';
import { useMediaLibrary } from '../../../components/media/useMediaLibrary.js';
import AssetModal from './AssetModal.jsx';
import UploadModal from './UploadModal.jsx';

/** Case-insensitive match across the fields a person would search by. */
function matches(asset, term) {
  if (!term) return true;
  const haystack = [asset.filename, asset.title, asset.alt, asset.path]
    .filter((value) => typeof value === 'string')
    .join(' ')
    .toLowerCase();
  return haystack.includes(term.toLowerCase());
}

/** A tile's frame. Selection is never colour alone: the heavier rule pairs
 * with the "Selected" word rendered beside the title below. */
function tileClass(isSelected) {
  return [
    'flex flex-col overflow-hidden rounded-admin bg-admin-ground-raised',
    isSelected ? 'border-admin-strong border-admin-rule-strong' : 'border-admin-hairline border-admin-rule-hairline',
  ].join(' ');
}

export default function MediaLibrary({
  folder = 'cms-images',
  onSelect = null,
  selectedPath = null,
  emptyHint = null,
}) {
  const library = useMediaLibrary({ folder });
  const { assets, loading, error, scanUsage, upload, updateMetadata, remove } = library;
  const [term, setTerm] = useState('');
  const [uploading, setUploading] = useState(false);
  const [detail, setDetail] = useState(null);
  const [notice, setNotice] = useState(null);

  const visible = useMemo(() => assets.filter((asset) => matches(asset, term)), [assets, term]);
  const choosing = typeof onSelect === 'function';

  return (
    <div className="flex flex-col gap-sm">
      <div className="flex flex-wrap items-end justify-between gap-sm">
        <div className="flex flex-1 flex-col gap-3xs">
          <label htmlFor="media-search" className="text-caption font-semibold text-admin-ink">
            Search the library
          </label>
          <input
            id="media-search"
            type="search"
            value={term}
            onChange={(event) => setTerm(event.target.value)}
            placeholder="File name, title, or description"
            className="admin-target w-full rounded-admin border-admin-hairline border-admin-rule-strong bg-admin-ground-input px-sm py-2xs font-admin-ui text-caption text-admin-ink"
          />
        </div>
        <button type="button" className={primaryButtonClass} onClick={() => setUploading(true)}>
          Upload a file
        </button>
      </div>

      {error ? (
        <Notice
          tone="caution"
          message="The library could not be loaded just now. It will reappear when the connection recovers."
        />
      ) : null}
      {notice ? <Notice tone="ok" message={notice} /> : null}

      {loading ? <AdminLoadingState label="Loading the media library…" /> : null}

      {!loading && visible.length === 0 ? (
        <AdminEmptyState
          title={term ? 'Nothing matches that search' : 'No files yet'}
          description={
            term
              ? 'Try a different word, or clear the search to see everything.'
              : emptyHint ||
                'Upload an image to start the library. Files are stored server-side; nothing is written from the browser.'
          }
        />
      ) : null}

      <ul className="grid grid-cols-2 gap-sm sm:grid-cols-3 lg:grid-cols-4">
        {visible.map((asset) => {
          const isSelected = selectedPath && asset.path === selectedPath;
          return (
            <li key={asset.id} className={tileClass(isSelected)}>
              <button
                type="button"
                className="admin-target block w-full text-left"
                aria-pressed={choosing ? Boolean(isSelected) : undefined}
                onClick={() => (choosing ? onSelect(asset) : setDetail(asset))}
              >
                <AssetImage
                  path={asset.path}
                  alt={asset.alt ?? ''}
                  className="h-32 w-full bg-admin-ground-input object-contain"
                />
                <span className="block px-sm py-2xs">
                  <span className="flex flex-wrap items-baseline gap-x-2xs">
                    <span className="block truncate text-caption font-semibold text-admin-ink">
                      {asset.title || asset.filename}
                    </span>
                    {isSelected ? (
                      <span className="font-admin-data text-folio text-admin-ink-data">Selected</span>
                    ) : null}
                  </span>
                  <span className="block truncate font-admin-data text-folio text-admin-ink-data">
                    {asset.path}
                  </span>
                  <span className="block font-admin-data text-folio text-admin-ink-secondary">
                    {formatBytes(asset.size)}
                  </span>
                  {asset.alt ? null : (
                    <span className="block text-folio text-admin-ink-secondary">no alt text</span>
                  )}
                </span>
              </button>
              {choosing ? (
                <button
                  type="button"
                  className="admin-target border-admin-rule-hairline border-t-admin-hairline px-sm py-2xs text-left font-admin-ui text-folio text-admin-ink-secondary hover:bg-admin-ground-input"
                  onClick={() => setDetail(asset)}
                >
                  Details and delete
                </button>
              ) : null}
            </li>
          );
        })}
      </ul>

      {uploading ? (
        <UploadModal
          folder={folder}
          upload={upload}
          onClose={() => setUploading(false)}
          onUploaded={(asset) => {
            setUploading(false);
            setNotice(`Uploaded ${asset?.filename ?? 'the file'}.`);
            // Picking straight after uploading is the common path: the
            // person came here to put THIS image somewhere.
            if (choosing && asset) onSelect(asset);
          }}
        />
      ) : null}

      {detail ? (
        <AssetModal
          asset={detail}
          scanUsage={scanUsage}
          updateMetadata={updateMetadata}
          remove={remove}
          onChanged={() => setNotice('Library updated.')}
          onClose={() => setDetail(null)}
        />
      ) : null}

      {!choosing && visible.length > 0 ? (
        <p className="font-admin-data text-folio text-admin-ink-data">
          {visible.length} of {assets.length} {assets.length === 1 ? 'file' : 'files'} shown.
        </p>
      ) : null}

      {choosing && selectedPath ? (
        <button type="button" className={secondaryButtonClass} onClick={() => onSelect(null)}>
          Clear the selection
        </button>
      ) : null}
    </div>
  );
}
