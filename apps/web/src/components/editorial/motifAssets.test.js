import { Buffer } from 'node:buffer';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { cwd } from 'node:process';
import sharp from 'sharp';
import { describe, expect, it } from 'vitest';

const ASSET_DIR = resolve(cwd(), 'public/motifs/fauna');

const LIVE_SLOTS = [
  { file: 'section-mark.svg', width: 20, height: 20 },
  { file: 'nameplate-mark.svg', width: 24, height: 24 },
  { file: 'divider.svg', width: 320, height: 32 },
  { file: 'empty-state.svg', width: 320, height: 128 },
];

const PAINT_PROPERTIES = new Set([
  'color',
  'fill',
  'flood-color',
  'lighting-color',
  'stop-color',
  'stroke',
]);

// The held-up figure's drawings (#1090): a body and a moving part per set,
// drawn as solid silhouettes for the 32px wait slot.
const WAIT_DRAWINGS = ['botanical', 'fauna', 'cartographic'].flatMap((set) =>
  ['wait-body.svg', 'wait-part.svg'].map((file) => ({ set, file })));
const WAIT_SLOT = 32;

function readAsset(file, dir = ASSET_DIR) {
  return readFileSync(resolve(dir, file), 'utf8');
}

/**
 * A silhouette has no stroke to measure, so measure its ink instead: render
 * it at the slot size, and count the visible pixels with no solid pixel
 * beside them. A part narrower than about a pixel is all such pixels; a
 * solid form has a solid core under every edge.
 */
async function strayInk(svg, size) {
  const { data, info } = await sharp(Buffer.from(svg), { density: (72 * size) / WAIT_SLOT })
    .resize(size, size)
    .ensureAlpha()
    .extractChannel('alpha')
    .raw()
    .toBuffer({ resolveWithObject: true });
  const alpha = (x, y) => (x < 0 || y < 0 || x >= info.width || y >= info.height ? 0 : data[y * info.width + x]);
  let ink = 0;
  let stray = 0;
  for (let y = 0; y < info.height; y += 1) {
    for (let x = 0; x < info.width; x += 1) {
      if (alpha(x, y) < 64) continue;
      ink += 1;
      const solid = [-1, 0, 1].some((dy) => [-1, 0, 1].some((dx) => alpha(x + dx, y + dy) >= 230));
      if (!solid) stray += 1;
    }
  }
  return { ink, stray };
}

// Comments are removed until none is left: removing one can join the text
// around it into another, and paint hidden there must not slip past.
function markupOnly(svg) {
  let previous;
  let markup = svg;
  do {
    previous = markup;
    markup = markup.replace(/<!--[\s\S]*?-->/g, '');
  } while (markup !== previous);
  return markup;
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

function parseNumericStrokeWidth(value) {
  if (!/^(?:\d+(?:\.\d+)?|\.\d+)$/.test(value.trim())) {
    throw new Error(`Unsupported stroke-width value: ${JSON.stringify(value)}`);
  }
  return Number(value);
}

function styleDeclarations(style) {
  return style
    .split(';')
    .map((declaration) => declaration.trim())
    .filter(Boolean)
    .map((declaration) => {
      const colon = declaration.indexOf(':');
      if (colon < 1) throw new Error(`Unsupported inline style: ${JSON.stringify(declaration)}`);
      return {
        property: declaration.slice(0, colon).trim().toLowerCase(),
        value: declaration.slice(colon + 1).trim(),
      };
    });
}

function strokeWidths(svg) {
  const markup = markupOnly(svg);
  if (/<style\b/i.test(markup) || /\bclass\s*=/i.test(markup)) {
    throw new Error('Motif SVGs cannot use stylesheet or class-based stroke declarations.');
  }

  const widths = [...markup.matchAll(/\bstroke-width\s*=\s*["']([^"']+)["']/gi)].map(
    (match) => parseNumericStrokeWidth(match[1]),
  );

  for (const match of markup.matchAll(/\bstyle\s*=\s*["']([^"']*)["']/gi)) {
    for (const { property, value } of styleDeclarations(match[1])) {
      if (property === 'stroke-width') widths.push(parseNumericStrokeWidth(value));
    }
  }

  const withoutSupportedDeclarations = markup
    .replace(/\bstroke-width\s*=\s*["'](?:\d+(?:\.\d+)?|\.\d+)["']/gi, '')
    .replace(/\bstyle\s*=\s*["']([^"']*)["']/gi, (_attribute, style) => {
      const remaining = styleDeclarations(style).filter(
        ({ property }) => property !== 'stroke-width',
      );
      return remaining.length
        ? `style="${remaining.map(({ property, value }) => `${property}: ${value}`).join('; ')}"`
        : '';
    });

  if (/\bstroke-width\b/i.test(withoutSupportedDeclarations)) {
    throw new Error('Motif SVG contains an unsupported stroke-width declaration.');
  }
  return widths;
}

function paintValues(svg) {
  const markup = markupOnly(svg);
  if (/<style\b/i.test(markup) || /\bclass\s*=/i.test(markup)) {
    throw new Error('Motif SVGs cannot use stylesheet or class-based paint declarations.');
  }

  const values = [];
  for (const match of markup.matchAll(
    /\b(color|fill|flood-color|lighting-color|stop-color|stroke)\s*=\s*["']([^"']+)["']/gi,
  )) {
    values.push({ property: match[1].toLowerCase(), value: match[2].trim() });
  }
  for (const match of markup.matchAll(/\bstyle\s*=\s*["']([^"']*)["']/gi)) {
    for (const declaration of styleDeclarations(match[1])) {
      if (PAINT_PROPERTIES.has(declaration.property)) values.push(declaration);
    }
  }
  return values;
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
    const values = paintValues(readAsset(file));
    expect(values.length).toBeGreaterThan(0);
    for (const { property, value } of values) {
      expect([`${property}: currentColor`, `${property}: none`]).toContain(
        `${property}: ${value}`,
      );
    }
  });
});

describe('wait drawings', () => {
  it.each(WAIT_DRAWINGS)('$set/$file is a solid silhouette in motif ink', ({ set, file }) => {
    const svg = readAsset(file, resolve(cwd(), 'public/motifs', set));
    expect(strokeWidths(svg)).toEqual([]);
    expect(parseViewBox(svg)).toEqual({ width: WAIT_SLOT, height: WAIT_SLOT });
    for (const { property, value } of paintValues(svg)) {
      expect(`${property}: ${value}`).toBe(`${property}: currentColor`);
    }
  });

  it.each(WAIT_DRAWINGS)('$set/$file has no part thinner than a pixel at 32px', async ({ set, file }) => {
    const { ink, stray } = await strayInk(readAsset(file, resolve(cwd(), 'public/motifs', set)), WAIT_SLOT);
    expect(ink).toBeGreaterThan(0);
    expect(stray / ink).toBeLessThanOrEqual(0.02);
  });

  it('the measure rejects a hairline', async () => {
    const hairline = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32"><path d="M4 10 L28 22 L28 22.7 L4 10.7 Z"/></svg>';
    const { ink, stray } = await strayInk(hairline, WAIT_SLOT);
    expect(stray / ink).toBeGreaterThan(0.5);
  });
});
