import { useEffect, useRef, useState } from 'react';

const PREVIEW_MS = 60_000;

export default function ScreenshotViewer({ count, readScreenshot, className, buttonClass }) {
  const current = useRef(null);
  const [preview, setPreview] = useState(null);
  const [loading, setLoading] = useState(false);
  const [status, setStatus] = useState('');

  function discard() {
    const active = current.current;
    if (!active) return;
    current.current = null;
    clearTimeout(active.timer);
    if (active.url) URL.revokeObjectURL(active.url);
  }

  useEffect(() => discard, []);

  async function open(index) {
    discard();
    const active = { url: null, timer: null };
    current.current = active;
    setPreview(null);
    setLoading(true);
    setStatus('');
    try {
      const { image } = await readScreenshot(index);
      if (current.current !== active) return;
      const bytes = Uint8Array.from(atob(image), (character) => character.charCodeAt(0));
      active.url = URL.createObjectURL(new Blob([bytes], { type: 'image/webp' }));
      active.timer = setTimeout(() => {
        discard();
        setPreview(null);
        setStatus('Screenshot preview expired. Open it again to see it.');
      }, PREVIEW_MS);
      setPreview({ url: active.url, number: index + 1 });
      setStatus(`Screenshot ${index + 1} opened.`);
    } catch (error) {
      if (current.current === active) setStatus(error.message || 'The screenshot could not be opened. Try again.');
    } finally {
      if (current.current === active) setLoading(false);
    }
  }

  return (
    <div className={className}>
      <p>{count} {count === 1 ? 'screenshot' : 'screenshots'}</p>
      {Array.from({ length: count }, (_, index) => (
        <button className={buttonClass} type="button" key={index} onClick={() => open(index)}>
          View screenshot {index + 1}
        </button>
      ))}
      <p role="status">{loading ? 'Opening screenshot…' : status}</p>
      {preview ? <img src={preview.url} alt={`Submitted screenshot ${preview.number}`} style={{ maxWidth: '100%', height: 'auto' }} /> : null}
    </div>
  );
}
