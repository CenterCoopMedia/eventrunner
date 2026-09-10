// The states a control declares, and the two states the book has to force.
//
// A capture cannot hover, focus, or hold down a control, so the book draws
// those three with the utilities the state normally applies. That makes the
// book a SECOND source for a rule the product already owns, and a second
// source drifts: the focus cell drew a 2px ring at 2px offset while the
// shipped rule draws --focus-ring-width, which is 3px — directly under a
// table in the same section printing "Ring width 3px".
//
// So the forced focus state is one class in index.css that repeats the
// shipped declarations, and this file pins the two together. When it fails,
// the fix is to make the class say what the rule says, never to change the
// number the book prints.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import postcss from 'postcss';
import { describe, expect, it } from 'vitest';
import { CONTROL_STATES, FORCED_FOCUS, FORCED_PRESS, STATE_IDS, forcedTint } from './states.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const INDEX_CSS = path.resolve(here, '..', '..', '..', 'index.css');
const root = postcss.parse(fs.readFileSync(INDEX_CSS, 'utf8'), { from: INDEX_CSS });

/** Every declaration of one selector, as `prop: value` in source order. */
function declarationsOf(selector) {
  const found = [];
  root.walkRules((rule) => {
    if (rule.selector !== selector) return;
    rule.walkDecls((decl) => found.push(`${decl.prop}: ${decl.value}`));
  });
  return found;
}

describe('the forced focus ring', () => {
  it('is one class, not a set of outline utilities', () => {
    expect(FORCED_FOCUS).toBe('focus-ring-forced');
    expect(FORCED_FOCUS).not.toMatch(/outline-\d/u);
  });

  it('draws exactly what the shipped :focus-visible rule draws', () => {
    const shipped = declarationsOf(':focus-visible');
    const forced = declarationsOf(`.${FORCED_FOCUS}`);
    expect(shipped.length).toBeGreaterThan(0);
    expect(forced).toEqual(shipped);
  });

  it('reads the ring tokens the book prints beside it', () => {
    // The section prints --focus-ring-width and --focus-ring-offset in a
    // table over these cells, so the cells have to read those two.
    const forced = declarationsOf(`.${FORCED_FOCUS}`).join('\n');
    expect(forced).toContain('var(--focus-ring-width)');
    expect(forced).toContain('var(--focus-ring-offset)');
  });
});

describe('the state list', () => {
  it('holds the record’s ten states, once each, in its own order', () => {
    expect(STATE_IDS).toHaveLength(10);
    expect(new Set(STATE_IDS).size).toBe(10);
    expect(STATE_IDS[0]).toBe('rest');
    expect(CONTROL_STATES.every((state) => state.label)).toBe(true);
  });

  it('forces a press as the scale the motion grammar gives it', () => {
    expect(FORCED_PRESS).toBe('scale-[0.98]');
  });

  it('forces a tint as a share of the ground, never as a colour', () => {
    // A background utility would show a colour the control never takes.
    for (const state of ['hover', 'pressed', 'selected']) {
      expect(forcedTint(state)).toEqual({
        '--control-tint-share': `var(--state-${state}-share)`,
      });
    }
    expect(forcedTint('rest')).toBeUndefined();
  });
});
