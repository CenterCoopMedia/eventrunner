import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { build } from 'vite';
import { specimenBoundary } from './specimenBoundary.js';

afterEach(() => vi.unstubAllEnvs());

async function compile(mode, source) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'specimen-boundary-'));
  try {
    vi.stubEnv('VITE_DEMO_MODE', mode);
    await fs.writeFile(path.join(root, 'entry.js'), source);
    return await build({ configFile: false, root, logLevel: 'silent', plugins: [specimenBoundary()],
      build: { write: false, rolldownOptions: { input: path.join(root, 'entry.js') } } });
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
}

describe('the emitted client/specimen boundary', () => {
  it.each(['', '0'])('refuses review code in client mode %j', async (mode) => {
    await expect(compile(mode, 'document.body.setAttribute("data-admin-specimen", "example");')).rejects.toThrow('Client build contains specimen UI');
  });
  it.each(['1', 'true'])('keeps review code in demo mode %j', async (mode) => {
    const output = await compile(mode, 'document.body.setAttribute("data-admin-specimen", "example");');
    expect(output.output.some((item) => item.type === 'chunk' && item.code.includes('data-admin-specimen'))).toBe(true);
  });
  it('accepts a client without review code', async () => {
    await expect(compile('0', 'document.body.textContent = "Event site";')).resolves.toHaveProperty('output');
  });
});
