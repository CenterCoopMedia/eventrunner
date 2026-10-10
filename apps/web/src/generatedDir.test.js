import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { resolveGeneratedDir } from '../generatedDir.js';

const fallback = path.resolve('/repo/apps/web/src/generated');

describe('resolveGeneratedDir', () => {
  it('uses a client export only outside demo mode', () => {
    const client = path.resolve('/scratch/generated');
    expect(resolveGeneratedDir({ GENERATED_DIR: client }, fallback)).toBe(client);
    expect(resolveGeneratedDir({ VITE_DEMO_MODE: '1', GENERATED_DIR: client }, fallback)).toBe(fallback);
  });

  it('uses the committed snapshot when no client export is set', () => {
    expect(resolveGeneratedDir({}, fallback)).toBe(fallback);
    expect(resolveGeneratedDir({ GENERATED_DIR: '' }, fallback)).toBe(fallback);
    expect(resolveGeneratedDir({ VITE_DEMO_MODE: '1' }, fallback)).toBe(fallback);
  });
});
