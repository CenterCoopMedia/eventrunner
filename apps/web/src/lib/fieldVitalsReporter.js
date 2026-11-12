import { onCLS, onINP, onLCP } from 'web-vitals/attribution';
import { validSample } from 'shared/webVitals';

const LCP_PARTS = {
  timeToFirstByte: 'LCP_TTFB',
  resourceLoadDelay: 'LCP_RESOURCE_DELAY',
  resourceLoadDuration: 'LCP_RESOURCE_DURATION',
  elementRenderDelay: 'LCP_RENDER_DELAY',
};

export function startVitalsReporter({ send, routePattern, initialURL, window: win = globalThis }) {
  const reported = new Set();
  function report(metric) {
    // The library can update a metric after the page returns from hidden.
    // Count its first report once. IDs stay in memory and never enter a body.
    const key = `${metric.name}:${metric.id}`;
    if (reported.has(key) || reported.size >= 100) return;
    reported.add(key);
    const route = routePattern(metric.navigationURL || initialURL);
    const device = win.innerWidth < 768 ? 'mobile' : 'desktop';
    const emit = (name, value) => {
      const sample = { route, device, name, value };
      if (validSample(sample)) send(sample);
    };
    emit(metric.name, metric.value);
    if (metric.name === 'LCP') {
      for (const [field, name] of Object.entries(LCP_PARTS)) emit(name, metric.attribution?.[field]);
    }
  }
  // Empty targets prevent selector generation. Only the numeric fields above
  // leave this module; URLs and performance entries are never serialized.
  const options = { reportSoftNavs: true, generateTarget: () => '' };
  onLCP(report, options);
  onINP(report, options);
  onCLS(report, options);
}
