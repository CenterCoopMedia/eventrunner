// One asset thumbnail. A media_assets row stores an object PATH, not a URL,
// so every rendering site would otherwise repeat the same resolve-and-guard
// dance; this component owns it, including the "the object is gone from the
// bucket while its row survives" case, which arrives as a load error rather
// than a resolve failure now that URLs are built rather than fetched
// (lib/mediaSource.js).
import { useEffect, useState } from 'react';
import { assetUrl } from '../../lib/mediaSource.js';

export default function AssetImage({ path, alt = '', className = '' }) {
  const url = assetUrl(path);
  const [failed, setFailed] = useState(false);

  // A new path is a new image: clear the previous failure so one missing
  // object does not poison the slot for everything chosen after it.
  useEffect(() => {
    setFailed(false);
  }, [path]);

  if (!url || failed) {
    return (
      <span
        className={`flex items-center justify-center bg-brand-surface-alt p-2 text-center text-xs text-brand-ink-muted ${className}`}
      >
        This file is missing from storage.
      </span>
    );
  }
  return (
    <img
      src={url}
      alt={alt}
      loading="lazy"
      className={className}
      onError={() => setFailed(true)}
    />
  );
}
