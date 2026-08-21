// One asset thumbnail. A media_assets row stores an object PATH, not a URL,
// so every rendering site would otherwise repeat the same resolve-and-hold
// dance; this component owns it, including the "resolved to nothing" state
// that means the object is gone from the bucket while its row survives.
import { useEffect, useState } from 'react';
import { assetUrl } from '../../lib/mediaSource.js';

export default function AssetImage({ path, alt = '', className = '' }) {
  const [url, setUrl] = useState(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let active = true;
    setUrl(null);
    setFailed(false);
    if (!path) return undefined;
    assetUrl(path).then((resolved) => {
      if (!active) return;
      if (resolved) setUrl(resolved);
      else setFailed(true);
    });
    return () => {
      active = false;
    };
  }, [path]);

  if (failed) {
    return (
      <span
        className={`flex items-center justify-center bg-brand-surface-alt p-2 text-center text-xs text-brand-ink-muted ${className}`}
      >
        This file is missing from storage.
      </span>
    );
  }
  if (!url) {
    // A placeholder rather than a spinner: a grid of spinners reads as an
    // error state, and the thumbnails resolve in a blink.
    return <span aria-hidden="true" className={`block bg-brand-surface-alt ${className}`} />;
  }
  return <img src={url} alt={alt} loading="lazy" className={className} />;
}
