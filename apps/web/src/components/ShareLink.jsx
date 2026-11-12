import { useState } from 'react';
import { copyTextToClipboard } from '../lib/clipboard.js';
import { publicUrl } from '../lib/publicUrl.js';
import { inputClass, quietActionClass } from './controlClasses.js';

function ShareAction({ url, title, shareLabel, copyLabel, className }) {
  const [busy, setBusy] = useState(false);
  const [copyOnly, setCopyOnly] = useState(false);
  const [message, setMessage] = useState('');
  const [manualCopy, setManualCopy] = useState(false);
  const native = typeof globalThis.navigator?.share === 'function' && !copyOnly;

  async function activate() {
    if (busy) return;
    setBusy(true);
    setMessage('');
    setManualCopy(false);
    try {
      if (native) {
        // Call before any await so the reader's press still activates it.
        await navigator.share({ title, url });
      } else {
        const copied = await copyTextToClipboard(url);
        setMessage(copied ? 'Link copied.' : 'Copy did not work. Select and copy the link below.');
        setManualCopy(!copied);
      }
    } catch (error) {
      if (error?.name !== 'AbortError') {
        setCopyOnly(true);
        setMessage('Sharing is unavailable. Copy the link instead.');
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className={`flex flex-wrap items-center gap-xs ${className}`}>
      <button type="button" className={quietActionClass} aria-disabled={busy || undefined} aria-busy={busy || undefined} onClick={activate}>
        {busy ? (native ? 'Opening share options…' : 'Copying link…') : (native ? shareLabel : copyLabel)}
      </button>
      <p role="status" className="font-data text-caption text-text-secondary">{message}</p>
      {manualCopy ? (
        <label className="w-full font-data text-caption text-text-secondary">
          Link to copy
          <input className={inputClass} type="text" readOnly value={url} onFocus={(event) => event.target.select()} />
        </label>
      ) : null}
    </div>
  );
}

export default function ShareLink({ path, title, shareLabel = 'Share link', copyLabel = 'Copy link', className = '' }) {
  const url = publicUrl(path);
  // A different public target owns fresh feedback, including late answers.
  return <ShareAction key={url} url={url} title={title} shareLabel={shareLabel} copyLabel={copyLabel} className={className} />;
}
