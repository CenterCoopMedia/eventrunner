// Every path that resolves a style registers the preset remaps first
// (catalog split, 2026-09-23). The web's overlay is tested in
// contexts/EventConfigContext.remaps.test.jsx; this file reads the other
// wiring as source, the way specimenRoute.test.js does, because the fact to
// hold is which module a path imports, not what it renders.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..', '..', '..');
const read = (relative) => fs.readFileSync(path.join(root, relative), 'utf8');

/** Every source file under a directory, recursively, minus tests. */
function sourceFiles(dir) {
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const file = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name !== 'node_modules') out.push(...sourceFiles(file));
    } else if (/\.(cjs|mjs|js|jsx)$/u.test(entry.name) && !/\.test\./u.test(entry.name)) {
      out.push(file);
    }
  }
  return out;
}

const RESOLVERS = /\b(resolvePresetTokens|resolveComponentFonts|resolveFontRoles|pickedChoices)\b/u;

describe('the preset remaps reach every path that resolves a style', () => {
  it('loads them alongside the admin chunk, which resolves styles on every branding surface', () => {
    const app = read('apps/web/src/App.jsx');
    expect(app).toMatch(/import\('\.\/admin\/AdminApp\.jsx'\),\s*loadPresetRemaps\(\)/u);
  });

  it('prefetches them where the demo band mounts, so the first style switch is not the slow one', () => {
    expect(read('apps/web/src/components/DemoBanner.jsx')).toMatch(/loadPresetRemaps\(\)/u);
  });

  it('requires them once for every script that reaches the resolver, the token generator included', () => {
    expect(read('scripts/lib/shared-theme.cjs')).toMatch(/require\('\.\.\/\.\.\/packages\/shared\/src\/presetRemaps\.cjs'\)/u);
    // The generator takes the resolver through that shim and not directly.
    const tokens = read('scripts/lib/tokens.cjs');
    expect(tokens).toMatch(/require\('\.\/shared-theme\.cjs'\)/u);
    expect(tokens).not.toMatch(/require\('shared\/theme'\)/u);
  });

  it('is never needed in Cloud Functions, which call no style resolver', () => {
    // The functions bundle resolves palettes and contrast, which the catalog
    // carries; the remaps stay out of the deploy. A function that started
    // resolving a style would need to require shared/presetRemaps first.
    const offenders = sourceFiles(path.join(root, 'functions', 'src'))
      .filter((file) => RESOLVERS.test(fs.readFileSync(file, 'utf8')))
      .map((file) => path.relative(root, file));
    expect(offenders).toEqual([]);
  });

  it('is registered for every web test, so a component under test resolves every style', () => {
    expect(read('apps/web/src/test/setup.js')).toMatch(/registerPresetRemaps\(PRESET_REMAPS\)/u);
  });
});
