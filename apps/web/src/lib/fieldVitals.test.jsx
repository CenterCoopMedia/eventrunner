import { StrictMode } from 'react';
import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { onCLS, onINP, onLCP } from 'web-vitals/attribution';
import { validSample } from 'shared/webVitals';
import { createFieldVitalsCollector, fieldVitalsEnabled, reportHeldUp } from './fieldVitals.js';
import * as reporter from './fieldVitalsReporter.js';
import { fieldVitalsRoute } from './fieldVitalsRoute.js';
import useLoadingStage from './useLoadingStage.js';
import { LoadingStateView } from '../components/LoadingState.jsx';
import { render } from '@testing-library/react';
import { routePage, isRoutePrefetchPending } from './routePage.jsx';
import { installChunkReload } from './chunkReload.js';

// The only simulated modules are the third-party browser observer API.
vi.mock('web-vitals/attribution', () => ({ onCLS: vi.fn(), onINP: vi.fn(), onLCP: vi.fn() }));

let frames;
let frameId;
let beacon;
let collectors;
beforeEach(() => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'performance'] });
  frames = new Map();
  frameId = 0;
  collectors = [];
  vi.stubGlobal('requestAnimationFrame', (callback) => { frames.set(++frameId, callback); return frameId; });
  vi.stubGlobal('cancelAnimationFrame', (id) => frames.delete(id));
  vi.stubGlobal('innerWidth', 390);
  beacon = vi.fn(() => true);
  Object.defineProperty(navigator, 'sendBeacon', { configurable: true, value: beacon });
  window.history.replaceState({}, '', '/attendees/private-account?secret=private');
  delete globalThis.__eventHeldUpBoot;
});
afterEach(() => {
  cleanup();
  collectors.forEach((collector) => collector.stop());
  document.getElementById('app-boot')?.remove();
  delete globalThis.__eventHeldUpBoot;
  delete navigator.sendBeacon;
  vi.clearAllMocks();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

function start(options = {}) {
  const load = vi.fn(async () => reporter);
  const collector = createFieldVitalsCollector({ load, routePattern: fieldVitalsRoute,
    endpoint: 'https://first-party.example/logWebVitals', random: () => 0, ...options });
  collectors.push(collector);
  return { collector, load };
}
async function paint() {
  const pending = [...frames.values()];
  frames.clear();
  await act(async () => { await Promise.all(pending.map((callback) => callback())); });
}
const samples = () => beacon.mock.calls.map(([, body]) => JSON.parse(body));
const metric = (name, value, overrides = {}) => ({ name, value, id: `private-${name}`, ...overrides });
const callback = (api) => api.mock.calls.at(-1)[0];

describe('field performance collection', () => {
  it('is production-only even with a demo opt-in, and never starts in dev', () => {
    expect(fieldVitalsEnabled({ PROD: true })).toBe(true);
    for (const env of [{ PROD: false }, { PROD: true, DEV: true },
      { PROD: true, VITE_DEMO_MODE: '1' }, { PROD: true, VITE_DEMO_MODE: 'true' }]) {
      expect(fieldVitalsEnabled(env)).toBe(false);
    }
  });

  it('waits for live enablement and a paint before loading or sending', async () => {
    const { collector, load } = start();
    reportHeldUp();
    await paint();
    expect(load).not.toHaveBeenCalled();
    expect(beacon).not.toHaveBeenCalled();
    collector.setEnabled(true);
    await paint();
    expect(load).not.toHaveBeenCalled();
    expect(beacon).not.toHaveBeenCalled();
    await paint();
    expect(load).toHaveBeenCalledOnce();
    expect(samples()).toEqual([{ route: '/attendees/:uid', device: 'mobile', name: 'held_up', value: 1 }]);
  });

  it('sends only the exact schema, numeric attribution, sanitized navigation route and viewport class', async () => {
    const { collector } = start();
    collector.setEnabled(true);
    await paint(); await paint();
    callback(onLCP)(metric('LCP', 2500, { navigationURL: 'https://site.test/speakers/private?secret=x',
      attribution: { timeToFirstByte: 100, resourceLoadDelay: 200, resourceLoadDuration: 300,
        elementRenderDelay: 1900, target: '#private-user', url: 'https://private.example/image',
        lcpEntry: { id: 'private' } }, userId: 'private' }));
    callback(onINP)(metric('INP', 200));
    callback(onCLS)(metric('CLS', 0.1, { navigationURL: 'https://site.test/custom/private?email=private' }));
    expect(samples()).toHaveLength(7);
    expect(samples().map(({ name }) => name)).toEqual(['LCP', 'LCP_TTFB', 'LCP_RESOURCE_DELAY', 'LCP_RESOURCE_DURATION', 'LCP_RENDER_DELAY', 'INP', 'CLS']);
    expect(samples().every(validSample)).toBe(true);
    expect(samples()[0]).toEqual({ route: '/speakers/:slug', device: 'mobile', name: 'LCP', value: 2500 });
    expect(samples()[5].route).toBe('/attendees/:uid');
    expect(samples()[6].route).toBe('/*');
    expect(JSON.stringify(samples())).not.toMatch(/private|selector|cookie|session|navigationURL|userId/);
    expect(beacon.mock.calls.every(([endpoint]) => endpoint === 'https://first-party.example/logWebVitals')).toBe(true);
    expect(onLCP.mock.calls[0][1].generateTarget(document.body)).toBe('');
    expect(onLCP.mock.calls[0][1].reportSoftNavs).toBe(true);
  });

  it('counts a metric once in memory and silently drops invalid numeric values', async () => {
    const { collector } = start();
    collector.setEnabled(true);
    await paint(); await paint();
    const report = callback(onCLS);
    report(metric('CLS', 0.1));
    report(metric('CLS', 0.2));
    report(metric('CLS', NaN, { id: 'not-a-number' }));
    report(metric('CLS', -1, { id: 'negative' }));
    expect(samples()).toEqual([{ route: '/attendees/:uid', device: 'mobile', name: 'CLS', value: 0.1 }]);
  });

  it('drops unsampled and disabled visits, cancels a pending paint, and stops sends on opt-out', async () => {
    const unsampled = start({ random: () => 0.1 });
    unsampled.collector.setEnabled(true);
    reportHeldUp();
    await paint(); await paint();
    expect(unsampled.load).not.toHaveBeenCalled();
    unsampled.collector.stop();
    const { collector, load } = start();
    reportHeldUp();
    collector.setEnabled(false);
    collector.setEnabled(true);
    await paint();
    collector.setEnabled(false);
    await paint();
    expect(load).not.toHaveBeenCalled();
    collector.setEnabled(true);
    await paint(); await paint();
    expect(beacon).not.toHaveBeenCalled();
    collector.setEnabled(false);
    callback(onINP)(metric('INP', 100));
    reportHeldUp();
    expect(beacon).not.toHaveBeenCalled();
  });

  it('does not surface or retry an import or send failure', async () => {
    const reload = vi.fn();
    const uninstall = installChunkReload(globalThis, { reload, isPrefetching: isRoutePrefetchPending });
    const failed = vi.fn(async () => {
      const event = new Event('vite:preloadError', { cancelable: true });
      globalThis.dispatchEvent(event);
      expect(event.defaultPrevented).toBe(false);
      throw new Error('chunk unavailable');
    });
    const { collector } = start({ load: routePage(failed).prefetch });
    collector.setEnabled(true);
    await paint(); await paint();
    collector.setEnabled(false); collector.setEnabled(true);
    await paint(); await paint();
    expect(failed).toHaveBeenCalledOnce();
    expect(reload).not.toHaveBeenCalled();
    uninstall();
    collector.stop();
    const next = start();
    next.collector.setEnabled(true);
    await paint(); await paint();
    beacon.mockImplementation(() => { throw new Error('network denied'); });
    expect(() => callback(onINP)(metric('INP', 100))).not.toThrow();
    expect(beacon).toHaveBeenCalledOnce();
    next.collector.setEnabled(null); next.collector.setEnabled(true);
    expect(beacon).toHaveBeenCalledOnce();
    expect(frames.size).toBe(0);
  });

  it('never sends a result from an import that completes after stop', async () => {
    let finish;
    const { collector } = start({ load: () => new Promise((resolve) => { finish = resolve; }) });
    collector.setEnabled(true);
    await paint();
    const nextFrame = [...frames.values()][0];
    frames.clear();
    const loading = nextFrame();
    collector.stop();
    finish(reporter);
    await loading;
    expect(onLCP).not.toHaveBeenCalled();
    expect(beacon).not.toHaveBeenCalled();
  });

  it.each([true, null])('caps sent and queued observations together when enablement is %s', async (enabled) => {
    const { collector } = start();
    collector.setEnabled(true);
    await paint(); await paint();
    for (let index = 0; index < 95; index += 1) reportHeldUp();
    collector.setEnabled(enabled);
    callback(onLCP)(metric('LCP', 2500, { attribution: {
      timeToFirstByte: 100, resourceLoadDelay: 200, resourceLoadDuration: 300,
      elementRenderDelay: 1900,
    } }));
    for (let index = 0; index < 110; index += 1) reportHeldUp();
    expect(beacon).toHaveBeenCalledTimes(enabled === true ? 100 : 95);
    collector.setEnabled(true);
    expect(beacon).toHaveBeenCalledTimes(100);
    expect(samples().slice(95).map(({ name }) => name)).toEqual([
      'LCP', 'LCP_TTFB', 'LCP_RESOURCE_DELAY', 'LCP_RESOURCE_DURATION', 'LCP_RENDER_DELAY',
    ]);
  });
});

describe('real held-up appearances', () => {
  it('reports at 10 seconds once per shared wait, including StrictMode, retries and reactivation', async () => {
    const { collector } = start();
    collector.setEnabled(true);
    await paint(); await paint();
    const { result, rerender } = renderHook(({ active }) => useLoadingStage({ active }),
      { wrapper: StrictMode, initialProps: { active: true } });
    act(() => vi.advanceTimersByTime(9999));
    expect(beacon).not.toHaveBeenCalled();
    act(() => vi.advanceTimersByTime(1));
    expect(samples()).toHaveLength(1);
    rerender({ active: true });
    act(() => vi.advanceTimersByTime(50000));
    expect(result.current.stage).toBe('prolonged');
    expect(samples()).toHaveLength(1);
    act(() => result.current.restart());
    act(() => vi.advanceTimersByTime(10000));
    expect(samples()).toHaveLength(2);
    rerender({ active: false }); rerender({ active: true });
    act(() => vi.advanceTimersByTime(10000));
    expect(samples()).toHaveLength(3);
  });

  it('drains a slow HTML boot marker only after enablement and dedupes its inherited loader', async () => {
    globalThis.__eventHeldUpBoot = true;
    const boot = document.createElement('div'); boot.id = 'app-boot'; document.body.append(boot);
    act(() => vi.advanceTimersByTime(11000));
    const { collector } = start();
    renderHook(() => useLoadingStage(), { wrapper: StrictMode });
    expect(beacon).not.toHaveBeenCalled();
    collector.setEnabled(true);
    await paint(); await paint();
    expect(samples()).toEqual([{ route: '/attendees/:uid', device: 'mobile', name: 'held_up', value: 1 }]);
  });

  it('never counts specimen renderers or inactive waits', async () => {
    const { collector } = start();
    collector.setEnabled(true);
    await paint(); await paint();
    render(<LoadingStateView stage="slow" />);
    renderHook(() => useLoadingStage({ active: false }));
    act(() => vi.advanceTimersByTime(60000));
    expect(beacon).not.toHaveBeenCalled();
  });
});
