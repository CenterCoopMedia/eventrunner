import { useEffect, useRef, useState } from 'react';
import { useLocation } from 'react-router';
import { quietActionClass } from './controlClasses.js';
import { publicSubscriptionsForRoute } from '../lib/publicSubscriptions.js';
import { hasStalePublicReads, readSavedPublicBuild } from '../lib/savedPublicBuild.js';

const TYPES = {
  document: 'public-offline-document',
  download: 'public-offline-download',
  check: 'public-offline-check',
  update: 'public-offline-use-update',
  disabled: 'public-offline-disabled',
};

function displayTime(value) {
  const date = new Date(value);
  return Number.isFinite(date.getTime()) ? date.toLocaleString() : null;
}

async function fetchPolicy(base) {
  const response = await fetch(new URL('offline-policy.json', base), {
    credentials: 'omit', cache: 'no-store', redirect: 'error', signal: AbortSignal.timeout(5_000),
  });
  if (!response.ok || !response.headers.get('content-type')?.includes('application/json')) {
    throw new Error('Offline policy is unavailable');
  }
  return response.json();
}

function start(service, base) {
  return service.register(new URL('sw.js', base), { scope: base, updateViaCache: 'none' });
}

export default function SavedPublicNotice() {
  const { pathname, search } = useLocation();
  const saved = readSavedPublicBuild();
  const savedId = saved?.id;
  const [registration, setRegistration] = useState(null);
  const [waiting, setWaiting] = useState(null);
  const [allowed, setAllowed] = useState(false);
  const [disabled, setDisabled] = useState(false);
  const [feedback, setFeedback] = useState('');
  const [downloadRequested, setDownloadRequested] = useState(false);
  const [, setTick] = useState(0);
  const reloadTimer = useRef(null);
  const saveData = navigator.connection?.saveData === true;
  const service = navigator.serviceWorker;
  const base = new URL(import.meta.env.BASE_URL, location.origin).href;
  const route = pathname.replace(/\/$/, '') || '/';

  useEffect(() => {
    let live = true;
    let observed;
    let installing;
    setAllowed(false);
    const refresh = () => {
      if (live) setWaiting(observed?.active ? observed.waiting : null);
    };
    const track = () => {
      installing?.removeEventListener('statechange', refresh);
      installing = observed?.installing;
      installing?.addEventListener('statechange', refresh);
      if (downloadRequested) installing?.postMessage({ type: TYPES.download });
      refresh();
    };
    const watch = (next) => {
      if (!live || !next || next.scope !== base || observed === next) return;
      observed?.removeEventListener('updatefound', track);
      observed = next;
      setRegistration(next);
      observed.addEventListener('updatefound', track);
      track();
    };
    const scriptUrl = new URL('sw.js', base).href;
    const describe = () => {
      if (service.controller?.scriptURL === scriptUrl) {
        service.controller.postMessage({ type: TYPES.document, id: savedId ?? null });
      }
    };
    const check = () => {
      if (!saveData || downloadRequested) observed?.active?.postMessage({ type: TYPES.check });
    };
    const message = ({ source, data }) => {
      if (source?.scriptURL === scriptUrl && data?.type === TYPES.disabled) setDisabled(true);
    };
    service.addEventListener('controllerchange', describe);
    service.addEventListener('message', message);
    globalThis.addEventListener('online', check);
    describe();
    service.getRegistration(base).then(async (existing) => {
      watch(existing);
      const policy = await fetchPolicy(base);
      if (!live) return;
      if (policy.enabled === false) {
        if (savedId) setDisabled(true);
        observed?.active?.postMessage({ type: TYPES.check });
        return;
      }
      if (policy.enabled !== true || !policy.routes?.includes(route)
        || new URLSearchParams(search).has('preview')) return;
      setAllowed(true);
      if (!observed && (!saveData || downloadRequested)) watch(await start(service, base));
      check();
    }).catch(() => {
      if (live && downloadRequested) setFeedback('Connect to download a copy.');
    });
    return () => {
      live = false;
      installing?.removeEventListener('statechange', refresh);
      observed?.removeEventListener('updatefound', track);
      service.removeEventListener('controllerchange', describe);
      service.removeEventListener('message', message);
      globalThis.removeEventListener('online', check);
    };
  }, [base, downloadRequested, route, saveData, savedId, search, service]);

  useEffect(() => {
    if (!savedId) return undefined;
    const refresh = () => setTick((tick) => tick + 1);
    const timer = setInterval(refresh, 1000);
    globalThis.addEventListener('offline', refresh);
    globalThis.addEventListener('online', refresh);
    return () => {
      clearInterval(timer);
      globalThis.removeEventListener('offline', refresh);
      globalThis.removeEventListener('online', refresh);
    };
  }, [savedId]);

  useEffect(() => () => reloadTimer.current?.(), []);

  async function retry() {
    if (saveData) {
      setDownloadRequested(true);
      registration?.installing?.postMessage({ type: TYPES.download });
    }
    if (!registration) {
      return;
    }
    setFeedback('Checking for a new copy…');
    try {
      await registration.update();
      setWaiting(registration.waiting);
      setFeedback('');
    } catch {
      setFeedback('Connect to check for a new copy.');
    }
  }

  function useUpdate() {
    reloadTimer.current?.();
    const oldController = service.controller;
    const channel = new MessageChannel();
    let keepRoute;
    const cleanup = () => {
      clearTimeout(timeout);
      service.removeEventListener('controllerchange', reload);
      channel.port1.close();
    };
    const reload = () => {
      if (service.controller === oldController || typeof keepRoute !== 'boolean') return;
      cleanup();
      if (keepRoute) location.reload();
      else location.assign(base);
    };
    channel.port1.onmessage = ({ data }) => {
      keepRoute = data?.keepRoute;
      reload();
    };
    const timeout = setTimeout(() => {
      cleanup();
      setFeedback('The new copy did not open. Try again.');
    }, 10_000);
    reloadTimer.current = cleanup;
    service.addEventListener('controllerchange', reload);
    waiting.postMessage({ type: TYPES.update }, [channel.port2]);
  }

  if (!saved && !(allowed && (waiting || saveData))) return null;
  const savedAt = saved && displayTime(saved.savedAt);
  const generatedAt = saved && displayTime(saved.generatedAt);
  const datasets = [
    'config/event', 'config/features', 'config/theme',
    ...publicSubscriptionsForRoute(pathname, search).filter((name) => name !== 'badges'),
  ];
  return (
    <div className="notice-bar stage py-xs" role="status">
      {saved && <>
        <p>Saved copy. Updates have not been confirmed.</p>
        {savedAt && <p>Saved on this device <time dateTime={saved.savedAt}>{savedAt}</time>.</p>}
        {generatedAt && <p>Snapshot generated <time dateTime={saved.generatedAt}>{generatedAt}</time>.</p>}
        {(navigator.onLine === false || hasStalePublicReads(datasets)) && (
          <p>This information may have changed. Check times and locations with event staff.</p>
        )}
      </>}
      {disabled ? <>
        <p>Saved copies are turned off.</p>
        <button type="button" className={quietActionClass} onClick={() => location.reload()}>Reload the page</button>
      </> : <>
        {feedback && <p>{feedback}</p>}
        <button type="button" className={quietActionClass} onClick={waiting ? useUpdate : retry}>
          {waiting ? 'Reload for the new copy' : saved ? 'Check for a new copy' : 'Download a saved copy'}
        </button>
      </>}
    </div>
  );
}
