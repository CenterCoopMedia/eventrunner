import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { cwd } from 'node:process';
import { describe, expect, it } from 'vitest';

const ASSET_DIR = resolve(cwd(), 'public/motifs/fauna');

const LIVE_SLOTS = [
  { file: 'section-mark.svg', width: 20, height: 20 },
  { file: 'nameplate-mark.svg', width: 24, height: 24 },
  { file: 'divider.svg', width: 320, height: 32 },
  { file: 'empty-state.svg', width: 320, height: 128 },
];

function readAsset(file) {
  return readFileSync(resolve(ASSET_DIR, file), 'utf8');
}

function parseViewBox(svg) {
  const match = svg.match(/viewBox="([^"]+)"/);
  if (!match) throw new Error('SVG is missing a viewBox.');
  const [, , width, height] = match[1].trim().split(/\s+/).map(Number);
  if (![width, height].every((value) => Number.isFinite(value) && value > 0)) {
    throw new Error(`SVG has an invalid viewBox: ${match[1]}`);
  }
  return { width, height };
}

function strokeWidths(svg) {
  return [...svg.matchAll(/stroke-width="([0-9]*\.?[0-9]+)"/g)]
    .map((match) => Number(match[1]))
    .filter(Number.isFinite);
}

describe('fauna motif assets', () => {
  it.each(LIVE_SLOTS)(
    '$file keeps every stroke at 0.5 CSS pixels or more in its smallest live slot',
    ({ file, width, height }) => {
      const svg = readAsset(file);
      const viewBox = parseViewBox(svg);
      const scale = Math.min(width / viewBox.width, height / viewBox.height);
      const widths = strokeWidths(svg);

      expect(widths.length).toBeGreaterThan(0);
      expect(Math.min(...widths) * scale).toBeGreaterThanOrEqual(0.5);
    },
  );

  it.each(LIVE_SLOTS)('$file inherits motif ink and carries no fixed color', ({ file }) => {
    const svg = readAsset(file);
    expect(svg).toContain('currentColor');
    expect(svg).not.toMatch(/#[0-9a-f]{3,8}\b/i);
  });
});
