import { afterEach, expect, it, vi } from 'vitest';
import { act, cleanup, render } from '@testing-library/react';

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

it('keeps slow-boot counts through cached config, suspends sends, and drops only on confirmed opt-out', async () => {
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
  expect(sent()).toHaveLength(1);
  answer(false);
  expect(sent()).toHaveLength(2);
  answer(true);
  reportHeldUp();
  answer(false, false);
  answer(false);
  expect(sent()).toHaveLength(2);
  reportHeldUp();
  expect(sent()).toHaveLength(3);
  setFieldVitalsEnabled(false);
});
