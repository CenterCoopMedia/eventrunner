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

const PAINT_PROPERTIES = new Set([
  'color',
  'fill',
  'flood-color',
  'lighting-color',
  'stop-color',
  'stroke',
]);

function readAsset(file) {
  return readFileSync(resolve(ASSET_DIR, file), 'utf8');
}

function markupOnly(svg) {
  return svg.replace(/<!--[\s\S]*?-->/g, '');
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
