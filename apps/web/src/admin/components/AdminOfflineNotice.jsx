import { useSyncExternalStore } from 'react';
import { Notice } from './formControls.jsx';

function subscribe(onChange) {
  window.addEventListener('online', onChange);
  window.addEventListener('offline', onChange);
  return () => {
    window.removeEventListener('online', onChange);
    window.removeEventListener('offline', onChange);
  };
}

/** Connection feedback does not grant permission to adopt a cached revision. */
export default function AdminOfflineNotice() {
  const online = useSyncExternalStore(subscribe, () => navigator.onLine, () => true);
  if (online !== false) return null;
  return (
    <div className="px-md py-sm">
      <Notice tone="caution" message="You’re offline. Reconnect to load saved content or submit changes. Content already loaded stays visible." />
    </div>
  );
}
