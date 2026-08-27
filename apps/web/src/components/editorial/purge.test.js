// Every device class survives the build (design brief §3.4).
//
// Tailwind TREE-SHAKES anything written into `@layer components`: a rule
// whose class name it cannot find as a literal string in the files it scans
// is deleted from the stylesheet. A class assembled from a template literal
// — `motif--${slot}` — is not a literal string, so the rule that carries the
// mask disappears while the element still renders. A `.motif` with no mask
// paints as a SOLID RECTANGLE OF INK, and a wayfinding icon with no mask
// paints as a solid square, which is the worst possible way for a
// decorative device to fail: it is loud, it is wrong, and no unit test that
// renders markup can see it.
//
// So the check is made against the BUILT stylesheet, which is committed as
// part of the demo (docs/demo). If a device class is missing there, it was
// purged, and this test says which one.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const here = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(here, '..', '..', '..', '..', '..');
const ASSETS = path.join(REPO_ROOT, 'docs', 'demo', 'assets');

/** Every class the preset devices draw with, including every modifier. */
const DEVICE_CLASSES = [
  '.motif',
  '.motif--section-mark',
  '.motif--divider',
  '.motif--nameplate-mark',
  '.motif--empty-state',
  '.marginalia',
  '.marginalia--pencil',
  '.marginalia--squiggle',
  '.marginalia--circle',
  '.marginalia-ring',
  '.wayfinding-icon',
  '.wayfinding-icon--venue',
  '.wayfinding-icon--room',
  '.wayfinding-icon--line',
  '.wayfinding-icon--transit',
  '.wayfinding-icon--walk',
  '.wayfinding-icon--step-free',
  '.route-mark',
  '.map-grid',
  '.plate',
  '.plate-number',
  '.specimen-label',
  '.specimen-label__key',
  '.session-block',
  '.session-block__face',
  // The transfer line: a RECORDED move between two places (brief §4.6).
  // Not preset-gated any more — a surveyed walking time is a fact, and a
  // fact five presets hide is a fact withheld from the reader who needed
  // it. So it has to survive the build in every preset.
  '.transfer-line',
  '.callout',
  '.nameplate__coordinate',
  // The hybrid page shell and its density variant (brief §6.1, §6.2).
  '.page-section',
  '.directory-row',
  // The schedule grid, its signature interaction, and the calling points
  // under a parent session (brief §2.1, §2.2, §4.6).
  '.schedule-grid',
  '.schedule-grid__head',
  '.schedule-grid__time',
  '.schedule-grid__cell',
  '.schedule-grid__corner',
  '.schedule-grid__entry',
  '.calling-points__item',
  '.calling-points__marker',
  // The archival treatment (brief §2.1).
  '.back-issue',
  // The printed programme (brief §2.1, every visual story part 2).
  '.schedule-print',
  '.schedule-print__row',
  '.schedule-print__time',
  '.schedule-print__day-head',
  '.schedule-print__calls',
  '.no-print',
];

describe('the built stylesheet', () => {
  const bundled = fs
    .readdirSync(ASSETS)
    .filter((file) => file.endsWith('.css'))
    .map((file) => fs.readFileSync(path.join(ASSETS, file), 'utf8'))
    .join('\n');

  it('keeps every device class Tailwind could otherwise tree-shake', () => {
    expect(bundled.length).toBeGreaterThan(1000);
    for (const selector of DEVICE_CLASSES) {
      expect(bundled, `${selector} survived the build`).toContain(selector);
    }
  });

  it('never leaves a masked device without its mask', () => {
    // The failure mode this file exists for: a `.motif--*` or
    // `.wayfinding-icon--*` rule purged while the base class — which paints
    // the ink — survives.
    for (const selector of DEVICE_CLASSES.filter(
      (name) => name.startsWith('.motif--') || name.startsWith('.wayfinding-icon--'),
    )) {
      const rule = bundled.slice(bundled.indexOf(selector));
      expect(rule.slice(0, 400), `${selector} still carries a mask`).toContain('mask-image');
    }
  });
});
