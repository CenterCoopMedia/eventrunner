'use strict';

// ADR 0007 keeps console styles isolated. Restated civic colours still have
// one source of truth, including the derived control and hairline rules.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { test } = require('node:test');
const { contrastRatio, deriveRuleColors } = require('./lib/shared-theme.cjs');
const civic = require('../design/tokens/presets/civic.json');

const css = fs.readFileSync(path.join(__dirname, '../console/web/src/styles.css'), 'utf8');
const PALETTE = {
  surface: 'surface', 'surface-alt': 'surfaceAlt', ink: 'ink', 'ink-muted': 'inkMuted',
  accent: 'primary', 'accent-strong': 'primaryDark', 'on-accent': 'surface',
  danger: 'danger', success: 'success', focus: 'primary',
};
function colors(text, mode) {
  const pattern = mode === 'light' ? /^:root\s*\{([^}]+)\}/m
    : /@media\s*\(prefers-color-scheme:\s*dark\)\s*\{\s*:root\s*\{([^}]+)\}/;
  const block = text.match(pattern)?.[1];
  assert.ok(block, `${mode} palette exists`);
  return Object.fromEntries([...block.matchAll(/--([\w-]+):\s*(\d+ \d+ \d+);/g)]
    .map(([, name, value]) => [name, value.split(' ').map(Number)]));
}
function mismatches(text, mode) {
  const palette = civic.palette[mode];
  const rules = deriveRuleColors(palette);
  const expected = { ...Object.fromEntries(Object.entries(PALETTE).map(([name, key]) => [name, palette[key]])),
    rule: rules.hairline, 'control-border': rules.control };
  const actual = colors(text, mode);
  return Object.keys(expected).filter((name) => JSON.stringify(actual[name]) !== JSON.stringify(expected[name]));
}

for (const mode of ['light', 'dark']) {
  test(`console ${mode} colours match the civic palette and derived rules`, () => {
    assert.deepEqual(mismatches(css, mode), []);
  });
  test(`console ${mode} text and focus hold their contrast floor`, () => {
    const palette = colors(css, mode);
    for (const ground of ['surface', 'surface-alt']) {
      for (const text of ['ink', 'ink-muted', 'accent', 'danger', 'success']) {
        assert.ok(contrastRatio(palette[text], palette[ground]) >= 4.5, `${text} on ${ground}`);
      }
      assert.ok(contrastRatio(palette.focus, palette[ground]) >= 3, `focus on ${ground}`);
    }
  });
}
test('the parity check rejects a restated colour drift', () => {
  assert.deepEqual(mismatches(css.replace('--danger: 162 26 36;', '--danger: 1 2 3;'), 'light'), ['danger']);
});
