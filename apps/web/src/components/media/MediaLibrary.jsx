// The browsable library: every indexed asset as a grid, with upload, search,
// per-asset details, and delete-with-usage-warning.
//
// One component serves both jobs the issue names. On the Media tab it is a
// browser: clicking a tile opens its detail modal. Inside ImagePicker it is
// a chooser: `onSelect` is supplied, tiles become picker buttons, and the
// "details" affordance moves to a secondary control so a pick is never one
// mis-click from a delete dialog.
import { useMemo, useState } from 'react';
import EmptyState from '../EmptyState.jsx';
import LoadingState from '../LoadingState.jsx';
import { formatBytes } from '../../lib/mediaSource.js';
import { primaryButtonClass, secondaryButtonClass } from '../../admin/components/formControls.jsx';
import AssetImage from './AssetImage.jsx';
import AssetModal from './AssetModal.jsx';
import UploadModal from './UploadModal.jsx';
import { useMediaLibrary } from './useMediaLibrary.js';

/** Case-insensitive match across the fields a person would search by. */
function matches(asset, term) {
  if (!term) return true;
  const haystack = [asset.filename, asset.title, asset.alt, asset.path]
    .filter((value) => typeof value === 'string')
    .join(' ')
    .toLowerCase();
  return haystack.includes(term.toLowerCase());
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
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="flex-1">
          <label htmlFor="media-search" className="text-sm font-semibold text-brand-ink">
            Search the library
          </label>
          <input
            id="media-search"
            type="search"
            value={term}
            onChange={(event) => setTerm(event.target.value)}
            placeholder="File name, title, or description"
            className="touch-target mt-1 w-full rounded-brand border border-brand-ink/20 bg-brand-surface px-3 py-2 text-brand-ink"
          />
        </div>
        <button type="button" className={primaryButtonClass} onClick={() => setUploading(true)}>
          Upload a file
        </button>
      </div>

      {error ? (
        <p role="status" className="rounded-brand border border-warning/40 bg-warning/10 px-3 py-2 text-sm text-warning">
          The library could not be loaded just now. It will reappear when the connection recovers.
        </p>
      ) : null}
      {notice ? (
        <p role="status" className="rounded-brand border border-success/40 bg-success/10 px-3 py-2 text-sm text-success">
          {notice}
        </p>
      ) : null}

      {loading ? <LoadingState label="Loading the media library…" /> : null}

      {!loading && visible.length === 0 ? (
        <EmptyState
          title={term ? 'Nothing matches that search' : 'No files yet'}
          description={
            term
              ? 'Try a different word, or clear the search to see everything.'
              : emptyHint ||
                'Upload an image to start the library. Files are stored server-side; nothing is written from the browser.'
          }
        />
      ) : null}

      <ul className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
        {visible.map((asset) => {
          const isSelected = selectedPath && asset.path === selectedPath;
          return (
            <li
              key={asset.id}
              className={`flex flex-col overflow-hidden rounded-brand border ${
                isSelected ? 'border-brand-primary ring-2 ring-brand-primary' : 'border-brand-ink/15'
              } bg-brand-surface`}
            >
              <button
                type="button"
                className="touch-target block w-full text-left"
                aria-pressed={choosing ? Boolean(isSelected) : undefined}
                onClick={() => (choosing ? onSelect(asset) : setDetail(asset))}
              >
                <AssetImage
                  path={asset.path}
                  alt={asset.alt ?? ''}
                  className="h-32 w-full bg-brand-surface-alt object-contain"
                />
                <span className="block px-3 py-2">
                  <span className="block truncate text-sm font-semibold text-brand-ink">
                    {asset.title || asset.filename}
                  </span>
                  <span className="block text-xs text-brand-ink-muted">
                    {formatBytes(asset.size)}
                    {asset.alt ? '' : ' · no alt text'}
                  </span>
                </span>
              </button>
              {choosing ? (
                <button
                  type="button"
                  className="touch-target border-t border-brand-ink/10 px-3 py-2 text-left text-xs text-brand-ink-muted hover:bg-brand-surface-alt"
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
        <p className="text-sm text-brand-ink-muted">
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
