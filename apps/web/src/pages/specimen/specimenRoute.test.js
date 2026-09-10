// The route exists under the demo build and under a development server, and
// nowhere else.
//
// The second test reads App.jsx as text. A render test cannot prove this
// one: vitest runs with DEV set, so the gate is open in every render, and
// the fact that matters is a build fact — the dynamic import must sit
// inside the gate, or the bundler emits the chunk for a client production
// build even though no route ever points at it.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { SPECIMEN_ENABLED, SPECIMEN_PATH, specimenRouteEnabled } from './specimenRoute.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const appSource = fs.readFileSync(path.resolve(here, '..', '..', 'App.jsx'), 'utf8');
const routeSource = fs.readFileSync(path.resolve(here, 'specimenRoute.js'), 'utf8');

describe('specimenRouteEnabled', () => {
  it('is open in the demo build', () => {
    expect(specimenRouteEnabled({ demo: true, dev: false })).toBe(true);
  });

  it('is open in a development server', () => {
    expect(specimenRouteEnabled({ demo: false, dev: true })).toBe(true);
  });

  it('is closed in a client production build', () => {
    expect(specimenRouteEnabled({ demo: false, dev: false })).toBe(false);
  });
});

describe('the route registration in App.jsx', () => {
  it('names the path from the module, so the two cannot drift', () => {
    expect(SPECIMEN_PATH).toBe('specimen');
    expect(appSource).toContain('SPECIMEN_PATH');
  });

  it('puts the dynamic import behind the gate', () => {
    const importLine = /SPECIMEN_ENABLED\s*\?\s*lazyPage\(\(\) => import\('\.\/pages\/specimen\/Specimen\.jsx'\)\)\s*:\s*null/u;
    expect(appSource).toMatch(importLine);
  });

  it('states the gate as an expression the bundler can fold, not as a call', () => {
    // A call across a module boundary is not folded, so the ternary in
    // App.jsx would survive and Rollup would emit the chunk for a client
    // production build. Measured: the chunk appears with a call and
    // disappears with this expression.
    expect(routeSource).toMatch(
      /export const SPECIMEN_ENABLED = IS_DEMO \|\| import\.meta\.env\.DEV;/u,
    );
    expect(appSource).not.toMatch(/SPECIMEN_ENABLED = /u);
  });

  it('agrees with the pure predicate in this environment', () => {
    expect(SPECIMEN_ENABLED).toBe(specimenRouteEnabled());
  });

  it('renders the route only when the gate is open', () => {
    expect(appSource).toContain('{SpecimenPage ? (');
  });

  it('imports the page exactly once, and only through that gate', () => {
    const imports = appSource.match(/import\('\.\/pages\/specimen\/Specimen\.jsx'\)/gu) ?? [];
    expect(imports).toHaveLength(1);
  });
});
