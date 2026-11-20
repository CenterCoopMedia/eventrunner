import { useId, useRef, useState } from 'react';
import { MAX_SCREENSHOTS, MIB } from './browser.mjs';

const ACCEPT = 'image/png,image/jpeg,image/webp,.png,.jpg,.jpeg,.webp';

export function useScreenshotFiles(mib) {
  const nextId = useRef(0);
  const [selection, setSelection] = useState({ files: [], error: '' });

  function add(files) {
    const additions = Array.from(files, (file) => ({ id: nextId.current++, file }));
    if (additions.length === 0) return;
    setSelection(({ files: current }) => {
      const eligible = additions.filter(({ file }) => file.size > 0 && file.size <= mib * MIB);
      const combined = [...current, ...eligible];
      const error = eligible.length !== additions.length
        ? `Choose images up to ${mib} MiB each. Empty files cannot be attached.`
        : combined.length > MAX_SCREENSHOTS ? 'Choose up to 3 screenshots.' : '';
      return { files: combined.slice(0, MAX_SCREENSHOTS), error };
    });
  }

  function onPaste(event) {
    const clipboard = event.clipboardData;
    if (!clipboard) return;
    if (clipboard.getData('text/plain') && event.target.matches('textarea, input:not([type="file"])')) return;
    const images = Array.from(clipboard.files).filter((file) => file.type.startsWith('image/'));
    if (images.length === 0) return;
    event.preventDefault();
    add(images);
  }

  return {
    ...selection, mib, add, onPaste,
    remove: (id) => setSelection(({ files }) => ({ files: files.filter((entry) => entry.id !== id), error: '' })),
    reset: () => setSelection({ files: [], error: '' }),
  };
}

export default function ScreenshotField({ selection, disabled, className, legendClass, inputClass, buttonClass }) {
  const id = useId();
  const input = useRef(null);
  const { files, error, mib, add, remove } = selection;
  return (
    <fieldset className={className} disabled={disabled}
      onDragOver={(event) => {
        if (event.dataTransfer.types.includes('Files')) {
          event.preventDefault();
          event.dataTransfer.dropEffect = disabled ? 'none' : 'copy';
        }
      }}
      onDrop={(event) => {
        event.preventDefault();
        if (!disabled) add(event.dataTransfer.files);
      }}
    >
      <legend className={legendClass}><label htmlFor={id}>Screenshots (optional)</label></legend>
      <p id={`${id}-help`}>Choose, paste, or drop up to 3 PNG, JPEG, or WebP images here. Up to {mib} MiB each.</p>
      <input
        ref={input}
        id={id}
        className={inputClass}
        type="file"
        accept={ACCEPT}
        multiple
        aria-describedby={`${id}-help`}
        onChange={(event) => {
          add(event.currentTarget.files);
          event.currentTarget.value = '';
        }}
      />
      <p aria-live="polite" aria-atomic="true">
        {files.length ? `${files.length} of ${MAX_SCREENSHOTS} screenshots selected.` : ''}
      </p>
      {error ? <p role="alert">{error}</p> : null}
      {files.length ? (
        <ul aria-label="Selected screenshots">
          {files.map(({ file, id: fileId }, index) => (
            <li key={fileId} style={{ overflowWrap: 'anywhere' }}>
              <span>{file.name || `Screenshot ${index + 1}`}</span>{' '}
              <button
                type="button"
                className={buttonClass}
                aria-label={`Remove screenshot ${index + 1}, ${file.name || 'pasted image'}`}
                onClick={() => {
                  remove(fileId);
                  input.current?.focus();
                }}
              >
                Remove
              </button>
            </li>
          ))}
        </ul>
      ) : null}
    </fieldset>
  );
}
