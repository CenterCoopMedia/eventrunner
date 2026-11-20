import fs from 'node:fs/promises';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import { expect, it, vi } from 'vitest';
import { build } from 'vite';

const root = process.cwd();
const entry = '\0preset-remaps-test';

it('a recovered Vite preload failure does not report that the remaps loaded', async () => {
  const { output } = await build({
    configFile: false,
    root,
    base: './',
    logLevel: 'silent',
    plugins: [{
      name: 'preset-remaps-test',
      resolveId: (id) => id === entry ? entry : null,
      load: (id) => id === entry
        ? `export { loadPresetRemaps, presetRemapsLoaded } from ${JSON.stringify(path.join(root, 'src/lib/presetRemaps.js'))};
           export { resolveFontRoles } from 'shared/theme';`
        : null,
    }],
    build: {
      write: false,
      rolldownOptions: {
        input: { entry },
        preserveEntrySignatures: 'strict',
        output: { entryFileNames: '[name].mjs', chunkFileNames: '[name]-[hash].mjs' },
      },
    },
  });
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'preset-remaps-'));
  // Model a browser whose recovery listener starts a reload. Node's missing
  // file error has different wording from a browser's failed module fetch.
  const onPreloadError = vi.fn((event) => event.preventDefault());
  window.addEventListener('vite:preloadError', onPreloadError);
  try {
    const remaps = output.find((chunk) => chunk.type === 'chunk' && chunk.isDynamicEntry);
    const entryChunk = output.find((chunk) => chunk.type === 'chunk' && chunk.isEntry);
    const write = (chunk) => fs.writeFile(path.join(dir, chunk.fileName), chunk.code);
    await Promise.all(output.filter((chunk) => chunk.type === 'chunk' && chunk !== remaps).map(write));
    // Use Node's loader so the emitted dynamic import runs outside Vitest's transform.
    const require = createRequire(path.join(root, 'package.json'));
    const loader = require(path.join(dir, entryChunk.fileName));
    expect(loader.presetRemapsLoaded()).toBe(false);
    const resolveTheme = () => loader.loadPresetRemaps().then(() => loader.resolveFontRoles({ preset: 'zine' }));
    await expect(resolveTheme()).rejects.toMatchObject({ name: 'ChunkLoadError' });
    expect(onPreloadError).toHaveBeenCalledOnce();
    expect(loader.presetRemapsLoaded()).toBe(false);

    await write(remaps);
    expect(await resolveTheme()).toHaveProperty('heading');
    expect(loader.presetRemapsLoaded()).toBe(true);
  } finally {
    window.removeEventListener('vite:preloadError', onPreloadError);
    await fs.rm(dir, { recursive: true, force: true });
  }
});
