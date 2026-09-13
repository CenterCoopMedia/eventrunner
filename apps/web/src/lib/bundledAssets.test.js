import { afterEach, describe, expect, it, vi } from 'vitest';
import { bundledDemoAssetUrl } from './bundledAssets.js';

afterEach(() => vi.unstubAllEnvs());

describe('bundled demo assets', () => {
  it('uses the build base for every demo image surface', () => {
    vi.stubEnv('BASE_URL', '/eventrunner/');
    for (const path of [
      'demo/speakers/marisol-reyes.webp',
      'demo/sponsors/beacon-community-fund.webp',
      'demo/summit-gathering.webp',
      'branding/demo-venue-plan.svg',
    ]) {
      expect(bundledDemoAssetUrl(path)).toBe(`/eventrunner/${path}`);
    }
  });

  it('does not intercept uploaded assets or unsafe paths', () => {
    for (const path of [null, 42, '../demo/photo.webp', 'demo/../photo.png',
      'demo/%2e%2e/photo.png', '/demo/photo.webp', 'https://example.org/demo/photo.webp',
      'cms-images/123/photo.png', 'branding/123/logo.svg']) {
      expect(bundledDemoAssetUrl(path)).toBeNull();
    }
  });
});
