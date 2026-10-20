// Test helper (issue #333): answer fetch() for display size manifests the
// way the Storage bucket would, so a page under test can read real widths.
import { vi } from 'vitest';

export const TEST_GENERATION = '7';

/**
 * A ready manifest for `source`: copies at each width narrower than the
 * original, under generation TEST_GENERATION, as functions/src/media/
 * imageSizes.cjs writes them.
 */
export function readyManifest(source, width, targets = [320, 640, 1280, 1920]) {
  const dir = source.slice(0, source.lastIndexOf('/'));
  return {
    version: 1,
    status: 'ready',
    source,
    sourceGeneration: TEST_GENERATION,
    width,
    height: width,
    sizes: targets
      .filter((target) => target < width)
      .map((target) => ({
        target,
        width: target,
        height: target,
        path: `${dir}/_sizes/${TEST_GENERATION}/${target}.webp`,
      })),
  };
}

/**
 * Stub global fetch. `manifests` maps an original's path to the manifest
 * its sizes folder holds; any other request answers 404.
 *
 * @param {Record<string, object>} manifests
 * @returns {import('vitest').Mock}
 */
export function stubManifests(manifests) {
  const byManifestPath = new Map(
    Object.entries(manifests).map(([source, manifest]) => [
      `${source.slice(0, source.lastIndexOf('/'))}/_sizes/manifest.json`,
      manifest,
    ]),
  );
  const fetchMock = vi.fn(async (url) => {
    const match = /\/o\/([^?]+)\?alt=media/.exec(String(url));
    const manifest = match ? byManifestPath.get(decodeURIComponent(match[1])) : undefined;
    if (!manifest) return { ok: false, status: 404, json: async () => ({}) };
    return { ok: true, status: 200, json: async () => manifest };
  });
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}
