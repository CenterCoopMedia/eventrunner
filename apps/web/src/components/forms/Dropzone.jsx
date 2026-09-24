// Dropzone — send a file (expansion record §3.3).
//
// A RULED REGION AROUND A REAL FILE INPUT. The input is the platform's own:
// it opens the picker on Enter and Space, it takes the `accept` list, and a
// form can read it. It sits off screen because a native file input cannot
// be drawn from the tokens, and the region shows the one focus ring while
// the input inside it has focus (`.dropzone:focus-within`), so a keyboard
// reader sees where they are. A file dropped on the region reaches the same
// handler a picked file does.
//
// A STATED PROGRESS LINE WITH A <progress> ELEMENT, never a spinner: the
// caller reports how many files have gone and the region says "2 of 3 files
// sent" through the progress device. A SENT LIST WITH A STATE WORD per file,
// "Sent", "Sending…", "Failed", in the data face; never colour alone. The
// progress line and the sent list sit in one `role="status"` region, so a
// screen reader hears the result land, and the region carries
// `aria-busy="true"` while a send is under way (the state grammar's busy
// state, expansion record §2.1).
//
// A REFUSAL IS A RULE AS WELL AS A SENTENCE. The error is stated under the
// region and the input carries `aria-invalid`; the region itself takes
// `data-invalid`, which the stylesheet draws as the strong rule in the
// danger ink — the same alarm rule a checkbox in error draws — so the state
// is never the red sentence alone (brief §2.4).
//
// The dropzone draws and reports. Where the bytes go, what a refusal says,
// and whether a file is too large are the caller's (lib/mediaSource.js
// checkFile, lib/photoUpload.js), the same split ProfilePhotoField makes.
import { useId, useRef, useState } from 'react';
import Progress from '../Progress.jsx';
import { quietActionClass } from '../controlClasses.js';

/** The word for each state a sent file can be in. */
export const SENT_STATE_WORD = Object.freeze({
  sending: 'Sending…',
  sent: 'Sent',
  failed: 'Failed',
});

/**
 * @param {object} props
 * @param {string} props.label what the region takes: "Session slides"
 * @param {string} [props.hint] the types and the limit, in words
 * @param {string[]} [props.accept] MIME types the input offers
 * @param {boolean} [props.multiple]
 * @param {(files: File[]) => void} props.onFiles picked or dropped files
 * @param {{ value: number, max: number } | null} [props.progress] how many
 *   files have gone, while a send is under way
 * @param {Array<{ id: string, name: string, state: 'sending'|'sent'|'failed', detail?: string }>} [props.sent]
 * @param {string} [props.error] the refusal, under the region
 * @param {boolean} [props.disabled]
 * @param {string} [props.chooseLabel] the control's words
 */
export default function Dropzone({
  label,
  hint,
  accept,
  multiple = false,
  onFiles,
  progress = null,
  sent = [],
  error,
  disabled = false,
  chooseLabel = 'Choose a file',
}) {
  const id = useId();
  const hintId = `${id}-hint`;
  const errorId = `${id}-error`;
  const inputRef = useRef(null);
  const [dragging, setDragging] = useState(false);

  function take(fileList) {
    const files = Array.from(fileList ?? []);
    if (files.length === 0) return;
    onFiles(multiple ? files : files.slice(0, 1));
  }

  function onDrop(event) {
    event.preventDefault();
    setDragging(false);
    if (disabled) return;
    take(event.dataTransfer?.files);
  }

  function onDragOver(event) {
    // Without this the browser opens the file instead of handing it over.
    event.preventDefault();
    if (!disabled && !dragging) setDragging(true);
  }

  const describedBy = [hint ? hintId : null, error ? errorId : null].filter(Boolean).join(' ') || undefined;

  return (
    <div className="flex flex-col gap-xs">
      <div
        className="dropzone flex flex-col items-start gap-xs"
        data-dragging={dragging ? 'true' : undefined}
        data-invalid={error ? 'true' : undefined}
        aria-busy={progress ? 'true' : undefined}
        onDragOver={onDragOver}
        onDragLeave={() => setDragging(false)}
        onDrop={onDrop}
      >
        <label htmlFor={id} className="font-data text-caption font-semibold text-text-primary">
          {label}
        </label>
        {hint ? (
          <p id={hintId} className="text-caption text-text-secondary">
            {hint}
          </p>
        ) : null}
        <input
          id={id}
          ref={inputRef}
          type="file"
          className="sr-only"
          accept={Array.isArray(accept) && accept.length ? accept.join(',') : undefined}
          multiple={multiple}
          disabled={disabled}
          aria-invalid={error ? 'true' : undefined}
          aria-describedby={describedBy}
          onChange={(event) => {
            take(event.target.files);
            // Choosing the same file again re-fires the change event.
            event.target.value = '';
          }}
        />
        {/* Two sentences, not one with a control in the middle of it: the
            invitation is a line of copy and the control keeps its own
            sentence-case label, so neither carries a capital mid-sentence. */}
        <div className="flex flex-wrap items-baseline gap-x-sm gap-y-xs">
          <p className="text-caption text-text-secondary">
            Drop {multiple ? 'files' : 'a file'} here.
          </p>
          <button
            type="button"
            className={quietActionClass}
            disabled={disabled}
            onClick={() => inputRef.current?.click()}
          >
            {chooseLabel}
          </button>
        </div>
        {/* One live region for the result: the progress line while files
            go, the sent list once they have. It is in the document from the
            start, so assistive technology is listening when the first
            change lands. */}
        <div role="status" className="flex w-full flex-col gap-xs">
          {progress ? (
            <Progress
              className="w-full"
              value={progress.value}
              max={progress.max}
              unit={progress.max === 1 ? 'file' : 'files'}
              done="sent"
            />
          ) : null}
          {sent.length > 0 ? (
            <ul className="dropzone__sent mt-xs w-full pt-xs">
            {sent.map((file) => (
              <li
                key={file.id}
                className="flex flex-wrap items-baseline justify-between gap-x-md gap-y-3xs py-3xs"
              >
                <span className="min-w-0 break-words font-mono text-caption text-text-primary">
                  {file.name}
                </span>
                <span className="font-data text-caption text-text-secondary">
                  {SENT_STATE_WORD[file.state] ?? file.state}
                  {file.detail ? ` — ${file.detail}` : ''}
                </span>
              </li>
            ))}
            </ul>
          ) : null}
        </div>
      </div>
      {error ? (
        <p id={errorId} className="text-caption text-danger">
          {error}
        </p>
      ) : null}
    </div>
  );
}
