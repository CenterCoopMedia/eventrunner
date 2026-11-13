import { afterEach, expect, it, vi } from 'vitest';
import { act, cleanup, render } from '@testing-library/react';
import { onCLS, onINP, onLCP } from 'web-vitals/attribution';
import { validSample } from 'shared/webVitals';

const { snapshots } = vi.hoisted(() => ({ snapshots: new Map() }));
vi.mock('firebase/app', () => ({ initializeApp: () => ({}) }));
vi.mock('firebase/auth', () => ({ getAuth: () => ({}), connectAuthEmulator: vi.fn() }));
vi.mock('firebase/firestore', () => ({
  getFirestore: () => ({}), connectFirestoreEmulator: vi.fn(), disableNetwork: vi.fn(),
  doc: (_db, ...path) => ({ path: path.join('/') }),
  onSnapshot: (reference, _options, next) => {
    snapshots.set(reference.path, next);
    return () => snapshots.delete(reference.path);
  },
}));
vi.mock('web-vitals/attribution', () => ({ onCLS: vi.fn(), onINP: vi.fn(), onLCP: vi.fn() }));
let suspend;

afterEach(() => {
  suspend?.(false);
  cleanup();
  delete globalThis.__eventHeldUpBoot;
  delete navigator.sendBeacon;
  document.getElementById('event-theme-runtime')?.remove();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

it('retains counts and metrics through cached config, sends only on confirmed opt-in, and drops on opt-out', async () => {
  vi.stubEnv('PROD', true);
  vi.stubEnv('DEV', false);
  vi.stubEnv('VITE_DEMO_MODE', '0');
  vi.stubEnv('VITE_FIREBASE_PROJECT_ID', 'demo-field-vitals');
  vi.stubEnv('VITE_FIREBASE_APP_CHECK_SITE_KEY', '');
  vi.spyOn(Math, 'random').mockReturnValue(0);
  vi.stubGlobal('innerWidth', 390);
  const frames = new Map();
  let id = 0;
  vi.stubGlobal('requestAnimationFrame', (callback) => { frames.set(++id, callback); return id; });
  vi.stubGlobal('cancelAnimationFrame', (frame) => frames.delete(frame));
  const beacon = vi.fn(() => true);
  Object.defineProperty(navigator, 'sendBeacon', { configurable: true, value: beacon });
  window.history.replaceState({}, '', '/attendees/private-account');
  globalThis.__eventHeldUpBoot = true;

  const { initFieldVitals, reportHeldUp, setFieldVitalsEnabled } = await import('../lib/fieldVitals.js');
  suspend = setFieldVitalsEnabled;
  const { fieldVitalsRoute } = await import('../lib/fieldVitalsRoute.js');
  const { EventConfigProvider } = await import('../contexts/EventConfigContext.jsx');
  const { default: FieldVitals } = await import('./FieldVitals.jsx');
  initFieldVitals(fieldVitalsRoute);
  render(<EventConfigProvider><FieldVitals /></EventConfigProvider>);

  const answer = (fromCache, on = true) => act(() => snapshots.get('config/features')({
    exists: () => true, data: () => ({ coreWebVitals: on }), metadata: { fromCache },
  }));
  const paint = async () => {
    const pending = [...frames.values()];
    frames.clear();
    await act(async () => { await Promise.all(pending.map((callback) => callback())); });
  };
  const sent = () => beacon.mock.calls.map(([, body]) => JSON.parse(body));

  answer(true, false);
  answer(true);
  await paint(); await paint();
  expect(beacon).not.toHaveBeenCalled();
  answer(false);
  await paint();
  expect(beacon).not.toHaveBeenCalled();
  await paint();
  expect(sent()).toEqual([{ route: '/attendees/:uid', device: 'mobile', name: 'held_up', value: 1 }]);

  answer(true);
  reportHeldUp();
  const lcp = { name: 'LCP', value: 2500, id: 'private-lcp',
    navigationURL: 'https://site.test/speakers/private?secret=x',
    attribution: { timeToFirstByte: 100, resourceLoadDelay: 200, resourceLoadDuration: 300,
      elementRenderDelay: 1900, target: '#private-user', url: 'https://private.example/image' } };
  const reportLCP = onLCP.mock.calls.at(-1)[0];
  const reportINP = onINP.mock.calls.at(-1)[0];
  const reportCLS = onCLS.mock.calls.at(-1)[0];
  reportLCP(lcp);
  reportINP({ name: 'INP', value: 200, id: 'private-inp' });
  reportCLS({ name: 'CLS', value: 0.1, id: 'private-cls' });
  reportLCP({ ...lcp, value: 2600 });
  expect(sent()).toHaveLength(1);
  answer(false);
  expect(sent()).toEqual([
    { route: '/attendees/:uid', device: 'mobile', name: 'held_up', value: 1 },
    { route: '/attendees/:uid', device: 'mobile', name: 'held_up', value: 1 },
    { route: '/speakers/:slug', device: 'mobile', name: 'LCP', value: 2500 },
    { route: '/speakers/:slug', device: 'mobile', name: 'LCP_TTFB', value: 100 },
    { route: '/speakers/:slug', device: 'mobile', name: 'LCP_RESOURCE_DELAY', value: 200 },
    { route: '/speakers/:slug', device: 'mobile', name: 'LCP_RESOURCE_DURATION', value: 300 },
    { route: '/speakers/:slug', device: 'mobile', name: 'LCP_RENDER_DELAY', value: 1900 },
    { route: '/attendees/:uid', device: 'mobile', name: 'INP', value: 200 },
    { route: '/attendees/:uid', device: 'mobile', name: 'CLS', value: 0.1 },
  ]);
  expect(sent().every(validSample)).toBe(true);
  expect(JSON.stringify(sent())).not.toMatch(/private|secret|navigationURL|target/);
  reportLCP(lcp);
  expect(sent()).toHaveLength(9);
  answer(true);
  reportHeldUp();
  reportINP({ name: 'INP', value: 300, id: 'discarded-inp' });
  reportCLS({ name: 'CLS', value: 0.2, id: 'discarded-cls' });
  answer(false, false);
  reportLCP({ ...lcp, id: 'disabled-lcp' });
  answer(false);
  expect(sent()).toHaveLength(9);
  reportHeldUp();
  expect(sent()).toHaveLength(10);
  setFieldVitalsEnabled(false);
});
