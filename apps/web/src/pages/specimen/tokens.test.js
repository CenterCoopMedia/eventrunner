// The book's lists are the token source, or the book is out of date.
//
// design/tokens/semantic.json is tier 2. A scale that adds a step, a
// palette that adds a colour, or a rule weight that is retired must move
// this file too, and until it does these tests fail. That is the whole
// point of a specimen book: a device or a value the page does not show is a
// value nobody reviews.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  COLOUR_GROUPS,
  COLOUR_TOKENS,
  FOCUS_TOKENS,
  RULE_WEIGHTS,
  SPACING_STEPS,
  STAGE_WIDTHS,
  STATE_SHARES,
  TYPE_ROLES,
  TYPE_STEPS,
  formatContrast,
  formatTokenValue,
  measureContrast,
  parseRgbTriple,
  readToken,
} from './tokens.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(here, '..', '..', '..', '..', '..');
const semantic = JSON.parse(
  fs.readFileSync(path.join(REPO_ROOT, 'design', 'tokens', 'semantic.json'), 'utf8'),
);

/** The token file marks its prose with a leading `$`. */
const names = (group) => Object.keys(group).filter((key) => !key.startsWith('$'));

describe('the lists the specimen book draws', () => {
  it('holds every tier 2 colour token, once', () => {
    expect([...COLOUR_TOKENS].sort()).toEqual(names(semantic.color).sort());
    expect(new Set(COLOUR_TOKENS).size).toBe(COLOUR_TOKENS.length);
  });

  it('gives every colour token exactly one group', () => {
    const grouped = COLOUR_GROUPS.flatMap((group) => group.tokens);
    expect(grouped).toHaveLength(COLOUR_TOKENS.length);
  });

  it('holds every step of the type scale', () => {
    expect(TYPE_STEPS.map((entry) => entry.step).sort()).toEqual(names(semantic.text).sort());
  });

  it('holds every spacing step', () => {
    expect([...SPACING_STEPS].sort()).toEqual(names(semantic.space).sort());
  });

  it('holds every rule weight', () => {
    expect(RULE_WEIGHTS.map((entry) => entry.weight).sort()).toEqual(names(semantic.rule).sort());
  });

  it('holds the four type roles and no fifth', () => {
    expect(TYPE_ROLES.map((entry) => entry.role)).toEqual(['heading', 'body', 'data', 'mono']);
  });

  // The three families this wave added. Each one is pinned to its tier 2
  // family, so a share, a width or a ring value added to the system fails
  // here until the book shows it.

  it('holds both widths a page is built on', () => {
    expect(STAGE_WIDTHS.map((entry) => entry.base).sort()).toEqual(
      names(semantic.stage).map((step) => `--stage-${step}`).sort(),
    );
    // Every band draws the tier 3 name a component actually reads, because
    // that is the name a style retunes.
    for (const entry of STAGE_WIDTHS) {
      expect(entry.token.startsWith('--')).toBe(true);
      expect(entry.job.length).toBeGreaterThan(20);
    }
  });

  it('holds every interaction-state share', () => {
    expect(STATE_SHARES.map((entry) => entry.token).sort()).toEqual(
      names(semantic.state).map((step) => `--state-${step}`).sort(),
    );
  });

  it('holds every value the focus ring is drawn from', () => {
    expect(FOCUS_TOKENS.map((entry) => entry.token).sort()).toEqual(
      names(semantic.focus).map((step) => `--focus-${step}`).sort(),
    );
  });
});

describe('parseRgbTriple', () => {
  it('reads the stored space-separated triple', () => {
    expect(parseRgbTriple(' 17 24 39 ')).toEqual([17, 24, 39]);
  });

  it('reads a comma-separated triple too', () => {
    expect(parseRgbTriple('17, 24, 39')).toEqual([17, 24, 39]);
  });

  it('refuses a value that is not three channels', () => {
    expect(parseRgbTriple('17 24')).toBeNull();
    expect(parseRgbTriple('')).toBeNull();
    expect(parseRgbTriple(null)).toBeNull();
  });
});

describe('measureContrast', () => {
  it('measures the token against the ground the document resolves now', () => {
    const root = document.documentElement;
    root.style.setProperty('--color-surface-rgb', '255 255 255');
    root.style.setProperty('--color-text-primary-rgb', '0 0 0');
    expect(measureContrast('--color-text-primary-rgb')).toBeCloseTo(21, 5);
    root.style.removeProperty('--color-surface-rgb');
    root.style.removeProperty('--color-text-primary-rgb');
  });

  it('returns null rather than a wrong number when a token is unreadable', () => {
    expect(measureContrast('--color-nothing-here-rgb')).toBeNull();
  });
});

describe('formatContrast', () => {
  it('states the ratio to two decimals', () => {
    expect(formatContrast(4.512)).toBe('4.51:1');
  });

  it('says so when nothing was measured', () => {
    expect(formatContrast(null)).toBe('Not measured here');
  });
});

describe('formatTokenValue', () => {
  it('puts the leading zero back on a share', () => {
    // A share is authored as 0.06 and the browser hands the substituted
    // property back as `.06`, which the table printed verbatim.
    expect(formatTokenValue('.06')).toBe('0.06');
    expect(formatTokenValue('.1')).toBe('0.1');
    expect(formatTokenValue('.08')).toBe('0.08');
  });

  it('prints every other value as it was read', () => {
    expect(formatTokenValue('3px')).toBe('3px');
    expect(formatTokenValue('72.5rem')).toBe('72.5rem');
    expect(formatTokenValue('0.06')).toBe('0.06');
    expect(formatTokenValue('  2px  ')).toBe('2px');
    expect(formatTokenValue('')).toBe('');
    expect(formatTokenValue(null)).toBe('');
  });
});

describe('readToken', () => {
  it('returns an empty string for a property the document does not set', () => {
    expect(readToken('--color-nothing-here-rgb')).toBe('');
  });
});
