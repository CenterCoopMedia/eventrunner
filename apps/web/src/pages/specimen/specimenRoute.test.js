// The route exists under the demo build and under a development server, and
// nowhere else.
//
// The second group reads specimenRoute.js and App.jsx as text. A render test
// cannot prove this one: vitest runs with DEV set, so the gate is open in
// every render, and the fact that matters is a build fact — the dynamic
// import must sit inside the gate, in the gate's own module, or the bundler
// emits the chunk for a client production build even though no route ever
// points at it.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { loadSpecimenPage, SPECIMEN_ENABLED, SPECIMEN_PATH, specimenRouteEnabled } from './specimenRoute.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const appSource = fs.readFileSync(path.resolve(here, '..', '..', 'App.jsx'), 'utf8');
const routeSource = fs.readFileSync(path.resolve(here, 'specimenRoute.js'), 'utf8');
const demoModeSource = fs.readFileSync(path.resolve(here, '..', '..', 'lib', 'demoMode.js'), 'utf8');

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

describe('the route registration in specimenRoute.js and App.jsx', () => {
  it('names the path from the module, so the two cannot drift', () => {
    expect(SPECIMEN_PATH).toBe('specimen');
    expect(appSource).toContain('SPECIMEN_PATH');
  });

  it('puts the dynamic import behind the gate, in the gate\'s own module', () => {
    const importLine = /export const loadSpecimenPage = SPECIMEN_ENABLED \? \(\) => import\('\.\/Specimen\.jsx'\) : null;/u;
    expect(routeSource).toMatch(importLine);
    expect(appSource).toMatch(/const SpecimenPage = loadSpecimenPage \? lazyPage\(loadSpecimenPage\) : null;/u);
  });

  it('states the gate as an expression the bundler can fold, not as a call', () => {
    // Rolldown folds only a condition it reads in the module that holds the
    // import(). A call, or a constant imported from another module, leaves
    // the chunk in a client production build. Measured: the chunk appears
    // with IS_DEMO from lib/demoMode.js and disappears with this expression.
    const gate = /export const SPECIMEN_ENABLED =\s+import\.meta\.env\.VITE_DEMO_MODE === '1' \|\|\s+import\.meta\.env\.VITE_DEMO_MODE === 'true' \|\|\s+import\.meta\.env\.DEV;/u;
    expect(routeSource).toMatch(gate);
    expect(appSource).not.toMatch(/SPECIMEN_ENABLED = /u);
  });

  it('reads the demo switch the same way lib/demoMode.js does', () => {
    const demoTest = /import\.meta\.env\.VITE_DEMO_MODE === '1' \|\|\s+import\.meta\.env\.VITE_DEMO_MODE === 'true'/u;
    expect(demoModeSource).toMatch(demoTest);
    expect(routeSource).toMatch(demoTest);
  });

  it('agrees with the pure predicate in this environment', () => {
    expect(SPECIMEN_ENABLED).toBe(specimenRouteEnabled());
    expect(typeof loadSpecimenPage).toBe(SPECIMEN_ENABLED ? 'function' : 'object');
  });

  it('renders the route only when the gate is open', () => {
    expect(appSource).toContain('{SpecimenPage ? (');
  });

  it('imports the page exactly once, and only through that gate', () => {
    const appImports = appSource.match(/import\('\.\/pages\/specimen\/Specimen\.jsx'\)/gu) ?? [];
    const routeImports = routeSource.match(/import\('\.\/Specimen\.jsx'\)/gu) ?? [];
    expect(appImports).toHaveLength(0);
    expect(routeImports).toHaveLength(1);
  });
});
